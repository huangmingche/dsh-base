import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { projectContext } from "../composition/project-context.mjs";
import { applicationContext } from "../composition/applications.mjs";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const runtimeGroups = { client: "client", "cloudflare-worker": "worker", "cloudflare-think": "think" };
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const isMain = (url) => process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url);

export function walk(directory, visit) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).sort()) {
    if (["node_modules", ".git", ".wrangler", ".cf", ".cloudflare", "lib", "dist", "coverage"].includes(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, visit);
    else visit(path);
  }
}

function packagesAt(root) {
  const packages = [];
  const base = join(root, "packages");
  if (!existsSync(base)) return packages;
  for (const group of readdirSync(base).sort()) {
    const groupPath = join(base, group);
    if (!statSync(groupPath).isDirectory()) continue;
    for (const directory of readdirSync(groupPath).sort()) {
      const path = join(groupPath, directory, "package.json");
      if (existsSync(path)) packages.push({ group, directory, path, directoryPath: dirname(path), ownerRoot: root, manifest: readJson(path) });
    }
  }
  return packages;
}

/** Owned packages from both roots. Never silently shadow a base package. */
export function localPackages(root = repoRoot) {
  const context = projectContext(root);
  const packages = packagesAt(context.baseRoot);
  if (context.consumer) packages.push(...packagesAt(context.productRoot));
  const names = new Set();
  for (const entry of packages) {
    const { manifest, ownerRoot, directoryPath } = entry;
    if (names.has(manifest.name)) throw new Error(`duplicate local package name: ${manifest.name}`);
    names.add(manifest.name);
    if (!context.consumer || ownerRoot !== context.productRoot) continue;
    if (!manifest.name?.startsWith(`@${context.namespace}/`)) throw new Error(`${manifest.name}: product packages must use @${context.namespace}/ namespace`);
    const actual = realpathSync(directoryPath);
    if (!actual.startsWith(join(context.productRoot, "packages") + sep)
      || actual.startsWith(context.baseRoot + sep)) throw new Error(`${manifest.name}: product package resolves outside its owned packages directory`);
    for (const key of ["client", "worker", "agent"]) {
      const meta = manifest.dshBase?.[key];
      if (meta !== undefined) {
        const prefixes = { client: ["client-", "client:"], worker: ["cloudflare-worker-", "cloudflare:worker:"], agent: ["cloudflare-think-", "cloudflare:think:"] };
        const [namePrefix, idPrefix] = prefixes[key];
        if (!manifest.name.startsWith(`@${context.namespace}/${namePrefix}`)
          || typeof meta.id !== "string" || !meta.id.startsWith(`${idPrefix}${context.namespace}:`)) throw new Error(`${manifest.name}: product plugin name/id must retain its plane and product namespace`);
        assertOwnedModule(manifest, meta.module ?? manifest.name);
      }
    }
  }
  return packages;
}

/** Product composition cannot relabel another package or bypass its exports. */
export function assertOwnedModule(manifest, specifier) {
  if (typeof specifier !== "string" || packageName(specifier) !== manifest.name
    || !isPackageExported(manifest, specifier === manifest.name ? "." : `.${specifier.slice(manifest.name.length)}`)) {
    throw new Error(`${manifest.name}: composition module must be an exported entry of its own package`);
  }
}

export function officialPackages(root) {
  const packages = new Map();
  const source = projectContext(root).upstreamRoot;
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
function clientRowsAt(root, packages, path = join(root, "apps/web/composition.profile.json")) {
  const rows = (existsSync(path) ? readJson(path).client ?? [] : []).map(row => {
    const routes = packages.find(({ manifest }) => manifest.name === row.name)?.manifest.dshBase?.client?.documentRoutes;
    return routes === undefined ? row : { ...row, documentRoutes: routes };
  });
  const names = new Set(rows.map((row) => row.name));
  return [...rows, ...packages.filter(({ group, manifest }) => group === "client" && manifest.dshBase?.client && !names.has(manifest.name))
    .map(({ manifest }) => ({ name: manifest.name, ...manifest.dshBase.client }))];
}

/** Apply only app configuration; identity and official replacement decisions stay in metadata. */
export function applicationClientOverrides(root = repoRoot, options = {}) {
  const context = applicationContext(root, options);
  if (!context.consumer && context.appPath === 'apps/web' && context.appId === 'web') return new Map();
  const packages = localPackages(root);
  const owned = packages.filter(entry => entry.ownerRoot === context.productRoot && entry.group === "client");
  // Consumer composition is additive. Keep the base's reviewed replacements,
  // but reject a product replacement declaration even when empty or disabled.
  for (const { manifest } of owned) {
    const meta = manifest.dshBase?.client;
    if (context.consumer && meta !== undefined && Object.hasOwn(meta, "replaces")) throw new Error(`${manifest.name}: product client composition is additive; replaces is not supported`);
  }
  const profilePath = context.profilePath;
  if (context.appPath !== 'apps/web' && !existsSync(profilePath)) throw new Error(`Application profile is missing: ${profilePath}`);
  const profile = existsSync(profilePath) ? readJson(profilePath) : {};
  if (Object.keys(profile).some(key => key !== "client") || !Array.isArray(profile.client ?? [])) throw new Error("product composition profile supports client rows only");
  const overrides = new Map();
  for (const row of profile.client ?? []) {
    const entry = owned.find(entry => entry.manifest.name === row?.name);
    if (entry === undefined || entry.manifest.dshBase?.client === undefined) throw new Error(`${row?.name}: product profile may configure only its own client packages`);
    if (overrides.has(row.name)) throw new Error(`duplicate product profile member: ${row.name}`);
    if (Object.hasOwn(row, "replaces")) throw new Error(`${row.name}: product client composition is additive; replaces is not supported`);
    if (Object.keys(row).some(key => !['name', 'id', 'origin', 'module', 'documentRoutes', 'disabled', 'config', 'unavailableReason', 'order'].includes(key))) throw new Error(`${row.name}: unsupported application profile field`);
    const meta = entry.manifest.dshBase.client;
    for (const key of ["id", "origin", "module", "documentRoutes"]) {
      if (row[key] !== undefined && JSON.stringify(row[key]) !== JSON.stringify(meta[key] ?? (key === "module" ? row.name : undefined))) throw new Error(`${row.name}: product profile cannot replace metadata ${key}`);
    }
    if (row.disabled !== undefined && typeof row.disabled !== "boolean") throw new Error(`${row.name}: disabled must be a boolean`);
    if (row.order !== undefined && !Number.isFinite(row.order)) throw new Error(`${row.name}: order must be finite`);
    if (row.unavailableReason !== undefined && typeof row.unavailableReason !== 'string') throw new Error(`${row.name}: unavailableReason must be a string`);
    overrides.set(row.name, Object.fromEntries(['config', 'disabled', 'order', 'unavailableReason'].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  }
  return overrides;
}

export function clientRows(root = repoRoot, options = {}) {
  const context = applicationContext(root, options);
  const packages = localPackages(root);
  const inherited = clientRowsAt(context.baseRoot, packages.filter(entry => entry.ownerRoot === context.baseRoot));
  const overrides = applicationClientOverrides(root, options);
  if (!context.consumer) return inherited.map(row => ({ ...row, ...overrides.get(row.name) }));
  const owned = packages.filter(entry => entry.ownerRoot === context.productRoot && entry.group === 'client');
  return [...inherited, ...owned.filter(entry => entry.manifest.dshBase?.client !== undefined).map(({ manifest }) => ({
    name: manifest.name, ...manifest.dshBase.client, ...overrides.get(manifest.name),
  }))];
}

export function printResult(label, result) {
  if (result.failures.length > 0) {
    console.error(`${label}: ${result.failures.length} violation(s)`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log(`${label}: ${result.summary}`);
}
