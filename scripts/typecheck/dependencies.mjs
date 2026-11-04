/** Extract pinned dependency declarations; strict checking is for owned source, not a flattened upstream program. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../conformance/lib.mjs";
const app = join(repoRoot, "apps/web"), source = join(repoRoot, ".submodules/deepseek-harness"), output = join(repoRoot, ".artifacts/typecheck");
const ts = createRequire(join(app, "package.json"))("typescript");
const plane = process.argv[2] ?? "client";
if (!["client", "worker"].includes(plane)) throw new Error("Expected client or worker plane");
const configPath = join(output, `${plane}.json`);
const raw = JSON.parse(readFileSync(configPath, "utf8"));
const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, output);
const graph = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const roots = graph.getSourceFiles().filter(file => file.fileName.startsWith(`${source}/`) && !file.isDeclarationFile).map(file => file.fileName);
const declarationRoot = join(output, `${plane}-dependencies`);
const program = ts.createProgram({ rootNames: roots, options: {
  ...parsed.options, rootDir: source, outDir: declarationRoot, noEmit: false, declaration: true, declarationMap: false,
  emitDeclarationOnly: true, noCheck: true, types: ["node"], typeRoots: [join(app, "node_modules/@types")],
} });
const emitted = program.emit();
if (emitted.emitSkipped || emitted.diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => repoRoot, getNewLine: () => "\n" }));
  throw new Error("Official dependency declaration emission failed");
}
function declarationPath(path) {
  return path.startsWith(`${source}/`) && !path.endsWith(".d.ts") && !path.endsWith(".json")
    ? join(declarationRoot, relative(source, path)).replace(/\.[cm]?tsx?$/, ".d.ts") : path;
}
raw.compilerOptions.paths = Object.fromEntries(Object.entries(raw.compilerOptions.paths).map(([name, targets]) => [name, targets.map(declarationPath)]));
raw.files = raw.files.map(declarationPath);
writeFileSync(configPath, JSON.stringify(raw, null, 2));
console.log(`Prepared ${roots.length} pinned ${plane} dependency source modules as compiler-emitted declarations; no owned source is excluded from strict checking`);
