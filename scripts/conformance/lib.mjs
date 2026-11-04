import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const runtimeGroups = { client: "client", "cloudflare-worker": "worker", "cloudflare-think": "think" };
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const isMain = (url) => process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url);

export function walk(directory, visit) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).sort()) {
    if (["node_modules", ".git", ".wrangler", ".cf", "lib", "dist", "coverage"].includes(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, visit);
    else visit(path);
  }
}

export function localPackages(root) {
  const packages = [];
  const base = join(root, "packages");
  if (!existsSync(base)) return packages;
  for (const group of readdirSync(base).sort()) {
    const groupPath = join(base, group);
    if (!statSync(groupPath).isDirectory()) continue;
    for (const directory of readdirSync(groupPath).sort()) {
      const path = join(groupPath, directory, "package.json");
      if (existsSync(path)) packages.push({ group, directory, path, directoryPath: dirname(path), manifest: readJson(path) });
    }
  }
  return packages;
}

export function officialPackages(root) {
  const packages = new Map();
  const source = join(root, ".submodules/deepseek-harness");
  for (const group of ["packages", "vendor"]) walk(join(source, group), (path) => {
    if (!path.endsWith("/package.json")) return;
    const manifest = readJson(path);
    if (manifest.name?.startsWith("@deepseek-ai/")) packages.set(manifest.name, { manifest, path, directoryPath: dirname(path) });
  });
  return packages;
}

/** Preserve lines while ignoring comments; static, side-effect, re-export,
 * literal dynamic-import, require, and CSS @import dependencies. */
export function importsIn(source) {
  const uncommented = source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
    (match, quoted) => quoted ?? match.replace(/[^\n]/g, " "));
  const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|@import\s*(?:url\(\s*)?)["']([^"']+)["']/g;
  return [...uncommented.matchAll(pattern)].map((match) => ({ specifier: match[1], line: source.slice(0, match.index).split("\n").length }));
}

export function packageName(specifier) {
  if (!specifier.startsWith("@")) return specifier.split("/")[0];
  return specifier.split("/").slice(0, 2).join("/");
}

function usableTarget(target) {
  if (typeof target === "string") return target.startsWith("./");
  if (Array.isArray(target)) return target.some(usableTarget);
  return target !== null && typeof target === "object" && Object.values(target).some(usableTarget);
}

/** Shared by the checker and build resolver. Exact null exclusions take
 * precedence over wildcards; a missing exports map fails closed. */
export function isPackageExported(manifest, subpath = ".") {
  if (subpath !== "." && (!subpath.startsWith("./") || subpath.slice(2).split("/").some((part) => ["", ".", "..", "node_modules"].includes(part)) || /%(?:2e|2f|5c)/i.test(subpath) || subpath.includes("\\"))) return false;
  const exports = manifest.exports;
  if (exports === undefined || exports === null) return false;
  if (typeof exports === "string" || Array.isArray(exports)) return subpath === "." && usableTarget(exports);
  const keys = Object.keys(exports);
  if (!keys.some((key) => key.startsWith("."))) return subpath === "." && usableTarget(exports);
  if (Object.hasOwn(exports, subpath)) return usableTarget(exports[subpath]);
  const matches = keys.filter((key) => {
    if (!key.includes("*")) return false;
    const [before, after] = key.split("*");
    return subpath.startsWith(before) && subpath.endsWith(after) && subpath.length >= before.length + after.length;
  }).sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length);
  return matches.length > 0 && usableTarget(exports[matches[0]]);
}

/** Match profile override + local metadata composition without loading code.
 * Runtime inventory/fibers are a separate acceptance concern. */
export function clientRows(root) {
  const path = join(root, "apps/web/composition.profile.json");
  const packages = localPackages(root);
  const rows = (existsSync(path) ? readJson(path).client ?? [] : []).map(row => {
    const routes = packages.find(({ manifest }) => manifest.name === row.name)?.manifest.dshBase?.client?.documentRoutes;
    return routes === undefined ? row : { ...row, documentRoutes: routes };
  });
  const names = new Set(rows.map((row) => row.name));
  return [...rows, ...packages.filter(({ group, manifest }) => group === "client" && manifest.dshBase?.client && !names.has(manifest.name))
    .map(({ manifest }) => ({ name: manifest.name, ...manifest.dshBase.client }))];
}

export function printResult(label, result) {
  if (result.failures.length > 0) {
    console.error(`${label}: ${result.failures.length} violation(s)`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log(`${label}: ${result.summary}`);
}
