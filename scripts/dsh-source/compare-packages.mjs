/**
 * Compare official DSH package-tier tags using only committed objects in the reference submodule.
 * Usage: node scripts/dsh-source/compare-packages.mjs <tag> <tag> [<tag> ...]
 * stdout is TSV. Each adjacent pair has one column. The order of flags is stable.
 */
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../.submodules/deepseek-harness/", import.meta.url));
const tags = process.argv.slice(2);
if (tags.length < 2 || tags.some(tag => !/^dsh-v[0-9][0-9A-Za-z.-]*$/.test(tag))) {
  throw new Error("Pass at least two official dsh-v release tags, oldest first.");
}

function git(args, input) {
  return execFileSync("git", ["-C", source, ...args], { input, maxBuffer: 64 * 1024 * 1024 });
}

// Classify every tracked path inside the package, including non-JS/native implementations.
function group(path) {
  if (path === "cordis.patch.yml" || path.startsWith("presets/")) return "C";
  if (/(^|\/)(tests?|__tests__|__snapshots__|e2e|benchmarks?)(\/|$)|\.(test|spec)\.[^/]+$/.test(path)) return "T";
  if (/^(docs\/|README(?:\.|$)|CHANGELOG(?:\.|$)|LICENSE(?:\.|$))/.test(path)) return "D";
  return "F";
}

function readPackages(tag) {
  const trees = new Map();
  for (const record of git(["ls-tree", "-r", "-z", `refs/tags/${tag}`, "--", "packages"]).toString().split("\0")) {
    if (!record) continue;
    const [entry, path] = record.split("\t");
    const [mode, , oid] = entry.split(" ");
    const [, tier, pkg, ...rest] = path.split("/");
    if (!rest.length) continue;
    const key = `${tier}/${pkg}`;
    if (!trees.has(key)) trees.set(key, new Map());
    trees.get(key).set(rest.join("/"), { mode, oid });
  }
  const roots = [...trees].filter(([, files]) => files.has("package.json"));
  const ids = roots.map(([, files]) => files.get("package.json").oid);
  const objects = git(["cat-file", "--batch"], ids.join("\n") + "\n");
  let cursor = 0;
  const packages = new Map();
  for (const [root, files] of roots) {
    const newline = objects.indexOf(10, cursor);
    const [id, type, length] = objects.toString("ascii", cursor, newline).split(" ");
    if (type !== "blob" || id !== files.get("package.json").oid) throw new Error(`Cannot read ${tag}:${root}/package.json`);
    cursor = newline + 1;
    const { name, version, dsh, exports, ...manifest } = JSON.parse(objects.toString("utf8", cursor, cursor + Number(length)));
    cursor += Number(length) + 1;
    if (!name?.startsWith("@deepseek-ai/")) continue;
    if (packages.has(name)) throw new Error(`Duplicate package ${name} at ${tag}`);
    const fields = { P: root, H: dsh, E: exports, M: manifest, C: new Map(), F: new Map(), T: new Map(), D: new Map() };
    for (const [path, entry] of files) {
      if (path !== "package.json") fields[group(path)].set(path, entry);
    }
    packages.set(name, fields);
  }
  return packages;
}

const versions = tags.map(readPackages);
function compare(before, after) {
  if (!before && !after) return ".";
  if (!before) return "+";
  if (!after) return "-";
  return Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key])).join("") || ".";
}

const names = [...new Set(versions.flatMap(packages => [...packages.keys()]))].sort();
console.log(["package", "dsh_fields", ...tags.slice(1).map((tag, i) => `${tags[i]}..${tag}`)].join("\t"));
for (const name of names) {
  const columns = versions.slice(1).map((packages, i) => compare(versions[i].get(name), packages.get(name)));
  if (columns.every(value => value === ".")) continue;
  const roles = [...new Set(versions.flatMap(packages => Object.keys(packages.get(name)?.H ?? {})))].sort();
  console.log([name, roles.join(",") || ".", ...columns].join("\t"));
}
