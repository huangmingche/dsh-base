import { productOutputPath } from "../composition/project-context.mjs";
import { buildContext, cliProductRoot } from "../build/product-paths.mjs";
/** Retain the complete dependency inventory as a private distribution artifact. */
import { createRequire, isBuiltin } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const { baseRoot: root, productRoot, appRoot: app, appId } = buildContext(cliProductRoot());
const sections = [];
const add = (label, path) => { if (existsSync(path)) sections.push(`${label}\n${"=".repeat(72)}\n${readFileSync(path, "utf8")}`); };
add("DeepSeek Harness Base attribution", join(root, "THIRD_PARTY_NOTICES.md"));
add("DeepSeek Harness Base license", join(root, "LICENSE"));
add("Cloudflare plugin cloudmark (MIT; Cloudflare trademark)", join(root, "packages/client/dsh-base-client-session-adapter/src/client/assets/cloudflare.LICENSE"));
const upstream = join(root, ".submodules/deepseek-harness");
add("DeepSeek Harness license", join(upstream, "LICENSE"));
add("DeepSeek Harness third-party notices", join(upstream, "THIRD_PARTY_NOTICES.md"));
add("Montserrat font used by official UI and generated social image (SIL OFL 1.1)", join(upstream, "packages/client/ui-theme/src/styles/Montserrat-OFL.txt"));
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
const relative = join(".artifacts/distribution", appId, "third-party-notices.txt");
const output = productOutputPath(productRoot, relative);
if (output !== join(productRoot, relative)) {
  throw new Error("Private license inventory cannot be written through a symlink");
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sections.join("\n\n\n") + "\n");
console.log(`Generated private attribution for pinned upstream, vendors, and ${visited.size} installed production dependencies.`);
