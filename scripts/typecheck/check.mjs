#!/usr/bin/env node
/** Reproducible strict checks of both owned roots against pinned declarations. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { verifySource } from "../dsh-source/verify.mjs";
import { buildContext, cliProductRoot } from "../build/product-paths.mjs";
import { checkedOwnedFiles, createTypecheckProgram, parseTypecheckProject } from "./compiler.mjs";

const context = buildContext(cliProductRoot());
const { productRoot, baseRoot, appRoot, typecheckRoot } = context;
const source = verifySource(baseRoot);
if (source.failures.length) throw new Error(source.failures.join("\n"));
function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(baseRoot, script), ...args], {
    cwd: productRoot, env: { ...process.env, DSH_PRODUCT_ROOT: productRoot, DSH_APP: context.appId }, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("scripts/typecheck/config.mjs");
run("scripts/typecheck/remote-contracts.mjs");
const ts = createRequire(join(appRoot, "package.json"))("typescript");
const checked = {};
for (const plane of ["worker", "client", "build"]) {
  if (plane !== "build") run("scripts/typecheck/dependencies.mjs", [plane]);
  const path = join(typecheckRoot, `${plane}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.compilerOptions.strict !== true || raw.compilerOptions.noCheck === true) throw new Error(`${plane}: owned code must be checked strictly`);
  const parsed = parseTypecheckProject(ts, raw, context);
  if (plane !== "build") checked[plane] = checkedOwnedFiles(plane, parsed.fileNames, context);
  const program = createTypecheckProgram(ts, { rootNames: parsed.fileNames, options: parsed.options }, context);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => productRoot, getNewLine: () => "\n" }));
    process.exit(1);
  }
}
writeFileSync(join(typecheckRoot, "report.json"), JSON.stringify({ ok: true, scope: "Strict owned Client/Worker/Think source from base and product plus app runtime entries; pinned dependencies consumed as compiler-emitted declarations, not a claim of complete upstream semantic checking.", checked }, null, 2));
console.log(`strict types: ${checked.client.length} owned client and ${checked.worker.length} owned Worker/Think source files passed; app runtime entries and Vite configurations included`);
