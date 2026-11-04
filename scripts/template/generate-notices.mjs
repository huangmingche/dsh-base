/** Retain source and installed production dependency licenses with deployed assets. */
import { createRequire, isBuiltin } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(root, "apps/web");
const sections = [];
const add = (label, path) => { if (existsSync(path)) sections.push(`${label}\n${"=".repeat(72)}\n${readFileSync(path, "utf8")}`); };
add("DeepSeek Harness Base attribution", join(root, "THIRD_PARTY_NOTICES.md"));
add("DeepSeek Harness Base license", join(root, "LICENSE"));
const upstream = join(root, ".submodules/deepseek-harness");
add("DeepSeek Harness license", join(upstream, "LICENSE"));
add("DeepSeek Harness third-party notices", join(upstream, "THIRD_PARTY_NOTICES.md"));
for (const entry of readdirSync(join(upstream, "vendor"), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.isDirectory()) add(`Upstream vendor ${entry.name}`, join(upstream, "vendor", entry.name, "LICENSE"));
}
const visited = new Set();
const licensePattern = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/iu;
function collect(name, from, optional = false) {
  if (isBuiltin(name)) return;
  const resolver = createRequire(from);
  const path = (resolver.resolve.paths(name) ?? []).map(base => join(base, name, "package.json")).find(existsSync);
  if (!path) { if (optional) return; throw new Error(`Missing production dependency for notices: ${name}`); }
  const real = realpathSync(path);
  if (visited.has(real)) return;
  visited.add(real);
  const pkg = JSON.parse(readFileSync(real, "utf8"));
  const directory = dirname(real);
  const label = `${pkg.name}@${pkg.version} (${typeof pkg.license === "string" ? pkg.license : "see package license"})`;
  const files = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && licensePattern.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) sections.push(`${label}\nLicense declaration: ${JSON.stringify(pkg.license ?? pkg.licenses ?? "not declared")}\nRepository: ${JSON.stringify(pkg.repository ?? pkg.homepage ?? "not declared")}\n`);
  for (const file of files) add(`${label}: ${file.name}`, join(directory, file.name));
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) collect(dependency, real, dependency in (pkg.optionalDependencies ?? {}));
  for (const dependency of Object.keys(pkg.optionalDependencies ?? {}).sort()) collect(dependency, real, true);
}
const manifest = join(app, "package.json");
for (const name of Object.keys(JSON.parse(readFileSync(manifest, "utf8")).dependencies).sort()) collect(name, manifest);
const output = join(app, "public/third-party-notices.txt");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sections.join("\n\n\n") + "\n");
console.log(`Generated deployed attribution for pinned upstream, vendors, and ${visited.size} installed production dependencies.`);
