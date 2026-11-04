#!/usr/bin/env node
/** Verify the sole official source is clean and locked to an official release tag. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMain, printResult, readJson, repoRoot } from "../conformance/lib.mjs";

export function verifySource(root) {
  const failures = [];
  const lock = readJson(join(root, "dsh-source.lock.json"));
  if (lock.repository !== "https://github.com/deepseek-ai/deepseek-harness.git") failures.push("lock.repository must identify the official DeepSeek Harness repository");
  if (lock.referencePath !== ".submodules/deepseek-harness") failures.push("official source must remain at .submodules/deepseek-harness");
  if (!/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(lock.tag ?? "")) failures.push("lock.tag must name an official dsh-v release, not a branch or arbitrary commit");
  if (!/^[0-9a-f]{40}$/.test(lock.commit ?? "") || !/^[0-9a-f]{40}$/.test(lock.tree ?? "")) failures.push("lock.commit and lock.tree must be full Git object ids");
  const submodule = join(root, ".submodules/deepseek-harness");
  if (!existsSync(join(submodule, ".git"))) failures.push("reference submodule is not initialized (run pnpm dsh:init)");
  if (failures.length > 0) return { failures, summary: "" };
  const git = (args) => execFileSync("git", ["-C", submodule, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const head = git(["rev-parse", "HEAD"]);
    const tree = git(["rev-parse", "HEAD^{tree}"]);
    if (head !== lock.commit || tree !== lock.tree) failures.push(`submodule HEAD/tree does not match the lock: ${head} (${tree})`);
    const tagCommit = git(["rev-parse", "--verify", `refs/tags/${lock.tag}^{commit}`]);
    if (tagCommit !== lock.commit) failures.push(`release tag ${lock.tag} resolves to ${tagCommit}, not the locked commit`);
    if (git(["status", "--porcelain", "--untracked-files=all"]) !== "") failures.push("reference submodule has local changes or untracked files; official source must remain clean");
  } catch (error) {
    failures.push(`cannot verify the pinned Git source/tag: ${String(error.stderr ?? error.message).trim()}`);
  }
  return { failures, summary: `.submodules/deepseek-harness matches release ${lock.tag} (${lock.commit.slice(0, 8)}, clean)` };
}

if (isMain(import.meta.url)) printResult("dsh-source", verifySource(repoRoot));
