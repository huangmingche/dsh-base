/** Load the pinned exported generator directly, with the app's locked build dependencies. */
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { repoRoot, officialPackages, isPackageExported, packageName } from "../conformance/lib.mjs";
const require = createRequire(join(repoRoot, "apps/web/package.json"));
const official = officialPackages(repoRoot);
const prefix = pathToFileURL(join(repoRoot, ".submodules/deepseek-harness/")).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@deepseek-ai/")) {
      const name = packageName(specifier), entry = official.get(name), subpath = specifier.slice(name.length);
      if (!entry || !isPackageExported(entry.manifest, subpath ? `.${subpath}` : ".")) throw new Error(`Unexported official generator import: ${specifier}`);
      if (name !== "@deepseek-ai/dsh-typert-generator") throw new Error(`Unexpected generator runtime dependency: ${specifier}`);
      return { url: pathToFileURL(join(entry.directoryPath, subpath ? subpath.slice(1) : "src/index.ts")).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(prefix) && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")) return next(specifier, { ...context, parentURL: pathToFileURL(join(repoRoot, "apps/web/package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith(".ts")) return { format: "module", source: require("esbuild").transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "ts", format: "esm", target: "es2024" }).code, shortCircuit: true };
    return next(url, context);
  },
});
