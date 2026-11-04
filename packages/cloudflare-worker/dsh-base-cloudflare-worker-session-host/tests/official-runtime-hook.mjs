/** Test-only resolution of stable official exports from the pinned submodule. */
import { registerHooks, createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { officialPackages, isPackageExported, packageName, repoRoot } from "../../../../scripts/conformance/lib.mjs";
import { serverPackageName, serverManifestPath } from "../../../build/dsh-base-build-server-dependencies/src/resolution.mjs";
const official = officialPackages(repoRoot);
const app = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const { transformSync } = app("esbuild");
const dependencies = new Map(["@js-temporal/polyfill", "rrule"].map((name) => [name, app.resolve(name)]));
const officialTime = new URL("../../../../.submodules/deepseek-harness/packages/util/time/src/index.ts", import.meta.url).href;
const permissions = new URL('../../dsh-base-cloudflare-worker-permissions/', import.meta.url);
const permissionsManifest = JSON.parse(readFileSync(new URL('package.json', permissions), 'utf8'));
const executable = value => typeof value === 'string' ? value : value?.import ? executable(value.import) : value?.default ? executable(value.default) : undefined;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (serverPackageName(specifier)) return nextResolve(specifier, { ...context, parentURL: pathToFileURL(serverManifestPath).href });
  if (specifier === "@dsh-base/session-wire") return { url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href, shortCircuit: true };
  if (specifier === permissionsManifest.name || specifier.startsWith(permissionsManifest.name + '/')) {
    const key = '.' + specifier.slice(permissionsManifest.name.length);
    const target = executable(permissionsManifest.exports[key]);
    if (!target) throw new Error(`Unexported permission test import: ${specifier}`);
    return { url: new URL(target, permissions).href, shortCircuit: true };
  }
  if (specifier.startsWith("@deepseek-ai/")) {
    const name = packageName(specifier), entry = official.get(name), subpath = specifier.slice(name.length);
    if (!entry || !isPackageExported(entry.manifest, subpath ? `.${subpath}` : ".")) throw new Error(`Unexported official test import: ${specifier}`);
    const target = executable(entry.manifest.exports?.[subpath ? `.${subpath}` : '.']);
    if (target) {
      const source = join(entry.directoryPath, target.replace(/^\.\/lib\/(?:types\/)?/u, './src/').replace(/\.js$/u, '.ts'));
      if (existsSync(source)) return { url: pathToFileURL(source).href, shortCircuit: true };
    }
    // Official clientBundle outputs client(.browser|.node).js from the
    // declared client/index source. Resolve that exported face in source tests.
    if (subpath === '/client') {
      const source = join(entry.directoryPath, 'src/client/index.ts');
      if (existsSync(source)) return { url: pathToFileURL(source).href, shortCircuit: true };
    }
    return { url: pathToFileURL(join(entry.directoryPath, subpath.startsWith("/src/") || subpath.startsWith("/locale/") ? subpath.slice(1) : subpath ? `src/${subpath.slice(1)}.ts` : "src/index.ts")).href, shortCircuit: true };
  }
  if (dependencies.has(specifier)) return nextResolve(dependencies.get(specifier), context);
  if ((context.parentURL?.includes("/.submodules/deepseek-harness/") || context.parentURL?.startsWith(permissions.href)) && !specifier.startsWith(".") && !specifier.startsWith("node:")) return nextResolve(specifier, { ...context, parentURL: new URL("../../../../apps/web/package.json", import.meta.url).href });
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if ((url.includes("/.submodules/deepseek-harness/") || url.startsWith(permissions.href)) && url.endsWith(".ts")) {
    return { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm", target: "es2022", sourcefile: url }).code };
  }
  return nextLoad(url, context);
} });
