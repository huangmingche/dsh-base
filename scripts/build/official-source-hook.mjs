/**
 * Build-time resolver for official source exports from the pinned submodule.
 *
 * Build generators may read official semantics directly from the checked-out pin
 * (the worker tests use a richer hook of their own); this helper only maps
 * exported `@deepseek-ai/*` specifiers to their pinned source and compiles that
 * TypeScript for Node's ESM loader. It is not imported by the production bundle.
 */
import { registerHooks, createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { officialPackages, isPackageExported, packageName } from "../conformance/lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const official = officialPackages(root);
const app = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { transformSync } = app("esbuild");
const dependencies = new Map(["@js-temporal/polyfill", "rrule"].map((name) => [name, app.resolve(name)]));
let registered = false;

/** Executable path from a package exports value. */
function executable(value) {
  if (typeof value === "string") return value;
  if (value?.import) return executable(value.import);
  if (value?.default) return executable(value.default);
  return undefined;
}

/** Register the official-source resolver once for this build process. */
export function registerOfficialSourceHooks() {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@deepseek-ai/")) {
        const name = packageName(specifier);
        const entry = official.get(name);
        const subpath = specifier.slice(name.length);
        if (!entry || !isPackageExported(entry.manifest, subpath ? `.${subpath}` : ".")) {
          throw new Error(`Unexported official build import: ${specifier}`);
        }
        const target = executable(entry.manifest.exports?.[subpath ? `.${subpath}` : "."]);
        if (target !== undefined) {
          const source = join(entry.directoryPath, target.replace(/^\.\/lib\/(?:types\/)?/u, "./src/").replace(/\.js$/u, ".ts"));
          if (existsSync(source)) return { url: pathToFileURL(source).href, shortCircuit: true };
        }
        return {
          url: pathToFileURL(join(entry.directoryPath, subpath.startsWith("/src/") || subpath.startsWith("/locale/") ? subpath.slice(1) : subpath ? `src/${subpath.slice(1)}.ts` : "src/index.ts")).href,
          shortCircuit: true,
        };
      }
      if (dependencies.has(specifier)) return nextResolve(dependencies.get(specifier), context);
      if (context.parentURL?.includes("/.submodules/deepseek-harness/") && !specifier.startsWith(".") && !specifier.startsWith("node:")) {
        return nextResolve(specifier, { ...context, parentURL: new URL("../../apps/web/package.json", import.meta.url).href });
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.includes("/.submodules/deepseek-harness/") && url.endsWith(".ts")) {
        return {
          format: "module",
          shortCircuit: true,
          source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm", target: "es2022", sourcefile: url }).code,
        };
      }
      return nextLoad(url, context);
    },
  });
}
