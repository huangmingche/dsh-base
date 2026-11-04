/** Build adapters for the pinned source graph; runtime product behavior stays official. */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../../boot/browser-compat/src/", import.meta.url));
const pdfWorkerId = "\0dsh-base:pdf-worker-source";
const excelWorkerId = "\0dsh-base:excel-worker-source";

/** @returns {import("vite").Plugin} */
export function browserCompatibility({ appRoot, sourceRoot }) {
  const require = createRequire(join(appRoot, "package.json"));
  const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const previewRoot = join(sourceRoot, "packages/client/ui-sidebar-documentpreview");
  const workerPath = join(previewRoot, "src/client/excel/worker.ts");
  const assets = Object.fromEntries([["cMapUrl", "cmaps"], ["standardFontDataUrl", "standard_fonts"], ["wasmUrl", "wasm"]].map(([kind, folder]) => [kind,
    Object.fromEntries(readdirSync(join(pdfRoot, folder)).filter(name => !name.startsWith("LICENSE")).sort().map(name => [name, readFileSync(join(pdfRoot, folder, name)).toString("base64")])),
  ]));
  let excelBuild;
  const notices = [
    ...["LICENSE", ...["cmaps", "standard_fonts", "wasm"].flatMap(folder => readdirSync(join(pdfRoot, folder)).filter(name => name.startsWith("LICENSE")).map(name => `${folder}/${name}`))]
      .map(name => `PDF.js ${name}\n${readFileSync(join(pdfRoot, name), "utf8")}`),
    `FortuneSheet\n${readFileSync(join(previewRoot, "licenses/FortuneSheet.txt"), "utf8")}`,
  ];
  for (const name of ["exceljs", "fast-xml-parser", "papaparse", "fflate", "xlsx"]) {
    let root = dirname(require.resolve(name));
    while (root !== dirname(root)) {
      try { if (JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name === name) break; } catch {}
      root = dirname(root);
    }
    for (const file of readdirSync(root).filter(file => /^(?:LICENSE|NOTICE)(?:\.|$)/i.test(file)).sort()) notices.push(`${name} ${file}\n${readFileSync(join(root, file), "utf8")}`);
  }
  return {
    name: "dsh-base:browser-source-compatibility",
    enforce: "pre",
    // A Worker may use real nodejs_compat modules. Browser stubs never cross that boundary.
    applyToEnvironment(environment) { return environment.name === "client"; },
    resolveId(id, importer) {
      if (id === "pdfjs-dist/build/pdf.worker.min.mjs?raw") return pdfWorkerId;
      if (id === "@fortune-sheet/react/dist/index.css?inline") return `${require.resolve("@fortune-sheet/react/dist/index.css")}?inline`;
      if (id === "./worker.ts?raw" && importer?.split("?")[0] === join(previewRoot, "src/client/excel/parse.ts")) return excelWorkerId;
      const names = { "node:path": "node-path.ts", "node:module": "node-module.ts", "node:fs/promises": "node-fs-promises.ts", "node:fs": "node-fs.ts", "node:url": "node-url.ts" };
      if (Object.hasOwn(names, id)) return join(directory, names[id]);
      return null;
    },
    async load(id) {
      if (id === pdfWorkerId) {
        const file = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
        this.addWatchFile(file);
        return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
      }
      if (id !== excelWorkerId) return null;
      excelBuild ??= require("esbuild").build({
        entryPoints: [workerPath], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", minify: true,
        nodePaths: [join(appRoot, "node_modules")], define: { "process.env.NODE_ENV": '"production"' }, metafile: true,
      });
      const built = await excelBuild;
      for (const input of Object.keys(built.metafile.inputs)) this.addWatchFile(resolve(input));
      return `export default ${JSON.stringify(built.outputFiles[0].text)};`;
    },
    transform(code, id) {
      if (id.split("?")[0] !== join(previewRoot, "src/client/pdf/assets.ts")) return null;
      // Replace the build-owned value in the module that consumes it, without a global runtime shim.
      return { code: code.replace("assets: PdfAssetMap = __DSH_PDFJS_ASSETS__", `assets: PdfAssetMap = ${JSON.stringify(assets)}`), map: null };
    },
    generateBundle() { this.emitFile({ type: "asset", fileName: "third-party/document-preview.txt", source: notices.join("\n\n") }); },
  };
}
