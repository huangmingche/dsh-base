/** Load the pinned exported generator directly, with the app's locked build dependencies. */
import { registerHooks, createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { officialPackages, isPackageExported, packageName } from "../conformance/lib.mjs";
import { buildContext, cliProductRoot } from "../build/product-paths.mjs";
const { productRoot: repoRoot, appRoot, upstreamRoot } = buildContext(cliProductRoot());
const require = createRequire(join(appRoot, "package.json"));
const official = officialPackages(repoRoot);
const prefixes = [upstreamRoot, realpathSync(upstreamRoot)].map(path => pathToFileURL(`${path}/`).href);
const officialUrl = url => typeof url === 'string' && prefixes.some(prefix => url.startsWith(prefix));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@deepseek-ai/")) {
      const name = packageName(specifier), entry = official.get(name), subpath = specifier.slice(name.length);
      if (!entry || !isPackageExported(entry.manifest, subpath ? `.${subpath}` : ".")) throw new Error(`Unexported official generator import: ${specifier}`);
      if (name !== "@deepseek-ai/dsh-typert-generator") throw new Error(`Unexpected generator runtime dependency: ${specifier}`);
      return { url: pathToFileURL(join(entry.directoryPath, subpath ? subpath.slice(1) : "src/index.ts")).href, shortCircuit: true };
    }
    if (officialUrl(context.parentURL) && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")) return next(specifier, { ...context, parentURL: pathToFileURL(join(appRoot, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (officialUrl(url) && url.endsWith(".ts")) return { format: "module", source: require("esbuild").transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "ts", format: "esm", target: "es2024" }).code, shortCircuit: true };
    return next(url, context);
  },
});
