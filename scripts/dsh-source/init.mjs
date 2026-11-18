#!/usr/bin/env node
/** Initialize the recorded submodules, then verify its release contract. */
import { execFileSync } from "node:child_process";
import { repoRoot, printResult } from "../conformance/lib.mjs";
import { ensureOfficialTag } from "../project/source-init.mjs";
import { verifySource } from "./verify.mjs";
execFileSync("git", ["submodule", "update", "--init"], { cwd: repoRoot, stdio: "inherit" });
ensureOfficialTag(repoRoot);
printResult("dsh-source", verifySource(repoRoot));
