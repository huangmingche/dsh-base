#!/usr/bin/env node
/** Reproducible strict checks of owned runtime planes, consuming the real pinned dependency declarations. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { localPackages, repoRoot, walk } from "../conformance/lib.mjs";
import { verifySource } from "../dsh-source/verify.mjs";

const source = verifySource(repoRoot);
if (source.failures.length) throw new Error(source.failures.join("\n"));
function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(repoRoot, script), ...args], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("scripts/typecheck/config.mjs");
run("scripts/typecheck/remote-contracts.mjs");
const ts = createRequire(join(repoRoot, "apps/web/package.json"))("typescript");
const checked = {};
for (const plane of ["worker", "client"]) {
  run("scripts/typecheck/dependencies.mjs", [plane]);
  const path = join(repoRoot, `.artifacts/typecheck/${plane}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.compilerOptions.strict !== true || raw.compilerOptions.noCheck === true) throw new Error(`${plane}: owned code must be checked strictly`);
  const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, join(repoRoot, ".artifacts/typecheck"));
  const roots = new Set(parsed.fileNames);
  const groups = plane === "client" ? ["client"] : ["cloudflare-worker", "cloudflare-think"];
  const owned = [];
  for (const pkg of localPackages(repoRoot).filter(pkg => groups.includes(pkg.group))) walk(join(pkg.directoryPath, "src"), file => {
    if (!/\.[cm]?tsx?$/.test(file)) return;
    if (!roots.has(file)) throw new Error(`${plane}: owned source silently excluded from typecheck: ${relative(repoRoot, file)}`);
    owned.push(relative(repoRoot, file));
  });
  checked[plane] = owned;
  run("apps/web/node_modules/typescript/lib/tsc.js", ["--project", path, "--pretty", "false"]);
}
run("apps/web/node_modules/typescript/lib/tsc.js", ["--project", join(repoRoot, ".artifacts/typecheck/build.json"), "--pretty", "false"]);
writeFileSync(join(repoRoot, ".artifacts/typecheck/report.json"), JSON.stringify({ ok: true, scope: "Strict owned Client/Worker/Think source plus app runtime entries; pinned dependencies consumed as compiler-emitted declarations, not a claim of complete upstream semantic checking.", checked }, null, 2));
console.log(`strict types: ${checked.client.length} owned client and ${checked.worker.length} owned Worker/Think source files passed; app runtime entries and Vite configurations included`);
