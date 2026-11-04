#!/usr/bin/env node
/** Initialize only the pinned official dependency, then verify its release contract. */
import { execFileSync } from "node:child_process";
import { repoRoot, printResult } from "../conformance/lib.mjs";
import { verifySource } from "./verify.mjs";
execFileSync("git", ["submodule", "update", "--init", "--", ".submodules/deepseek-harness"], { cwd: repoRoot, stdio: "inherit" });
printResult("dsh-source", verifySource(repoRoot));
