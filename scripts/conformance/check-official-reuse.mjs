#!/usr/bin/env node
/** Enforce declared official exports and auditable package reuse decisions. */
import { checkClientContract } from "./client-contracts.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { clientRows, importsIn, isMain, isPackageExported, localPackages, officialPackages, packageName, printResult, readJson, repoRoot, runtimeGroups, walk } from "./lib.mjs";

const nonempty = (value) => typeof value === "string" && value.trim() !== "";
const stringList = (value) => Array.isArray(value) && value.every(nonempty);

export function checkOfficialReuse(root) {
  const failures = [];
  const lock = readJson(join(root, "dsh-source.lock.json"));
  const official = officialPackages(root);
  const packages = localPackages(root);
  const sourceRoot = join(root, ".submodules/deepseek-harness");
  const active = new Set(clientRows(root).filter((row) => row.disabled !== true).map((row) => row.name));
  let imports = 0;
  if (official.size === 0) failures.push("no pinned official packages found; initialize the reference submodule");

  // A seam cannot contain copied official implementation. This catches exact
  // source copies; edited fragments still need review against the pinned source.
  const officialSourceHashes = new Map();
  for (const [name, entry] of official) walk(join(entry.directoryPath, "src"), (file) => {
    if (!/\.(?:[cm]?[jt]sx?|css)$/.test(file)) return;
    const source = readFileSync(file);
    if (source.length < 256) return;
    const hash = createHash("sha256").update(source).digest("hex");
    const candidates = officialSourceHashes.get(hash) ?? [];
    candidates.push({ name, file });
    officialSourceHashes.set(hash, candidates);
  });

  for (const { group, manifest, path } of packages) {
    if (runtimeGroups[group] === undefined && manifest.dshBase === undefined) continue;
    const label = manifest.name ?? relative(root, path);
    if (group === "client") failures.push(...checkClientContract({ manifest, path }));
    const fork = manifest.dshBase?.forkOf;
    const reuse = manifest.dshBase?.reuse;
    if (fork === undefined) walk(join(dirname(path), "src"), (file) => {
      if (!/\.(?:[cm]?[jt]sx?|css)$/.test(file)) return;
      const source = readFileSync(file);
      if (source.length < 256) return;
      const copied = officialSourceHashes.get(createHash("sha256").update(source).digest("hex"));
      if (copied) failures.push(`${relative(root, file)}: unmarked exact official source copy from ${copied.map(entry => `${entry.name} (${relative(sourceRoot, entry.file)})`).join(", ")}; mount an exported implementation or record a complete fork`);
    });
    if (fork === undefined && reuse === undefined) failures.push(`${label}: every client/worker/agent package must record dshBase.reuse or dshBase.forkOf`);
    if (reuse !== undefined) {
      if (!["custom", "seam", "fork"].includes(reuse.mode)) failures.push(`${label}: reuse.mode must be custom, seam, or fork`);
      if (!nonempty(reuse.reason)) failures.push(`${label}: reuse.reason must explain the official reuse decision`);
      if (!stringList(reuse.official ?? reuse.for)) failures.push(`${label}: reuse.official (or reuse.for) must list the official candidates considered; use [] only when none exist`);
      if (reuse.mode === "fork" && fork === undefined) failures.push(`${label}: reuse.mode fork requires complete dshBase.forkOf metadata`);
      if (reuse.sourceEntries !== undefined) {
        if (!stringList(reuse.sourceEntries)) failures.push(`${label}: reuse.sourceEntries must list exact official source specifiers`);
        else for (const specifier of reuse.sourceEntries) {
          const name = packageName(specifier);
          if (!specifier.startsWith("@deepseek-ai/") || !specifier.slice(name.length).startsWith("/src/") || !official.has(name) || !isPackageExported(official.get(name).manifest, `.${specifier.slice(name.length)}`)) failures.push(`${label}: unexported or invalid sourceEntries entry ${specifier}`);
        }
        if (reuse.sourceReviewCommit !== lock.commit) failures.push(`${label}: reuse.sourceReviewCommit must match the pinned commit; re-audit ./src/* imports on pin changes`);
      }
    }
    if (fork !== undefined) {
      for (const field of ["package", "path", "commit", "license"]) if (!nonempty(fork[field])) failures.push(`${label}: forkOf.${field} is missing`);
      if (fork.commit !== lock.commit) failures.push(`${label}: forkOf.commit must match ${lock.commit}`);
      const upstream = official.get(fork.package);
      if (!upstream) failures.push(`${label}: forkOf.package is absent from the pinned official source: ${fork.package}`);
      else {
        if (typeof fork.path !== "string" || resolve(sourceRoot, fork.path) !== upstream.directoryPath) failures.push(`${label}: forkOf.path must point to the pinned ${fork.package} package`);
        if (fork.license !== upstream.manifest.license) failures.push(`${label}: forkOf.license must match the upstream package license`);
      }
      if (group === "client" && active.has(manifest.name) && manifest.dshBase?.client?.replaces !== fork.package) failures.push(`${label}: active client fork must record dshBase.client.replaces = ${fork.package}`);
    }
  }

  for (const plane of ["packages", "apps"]) walk(join(root, plane), (file) => {
    if (!/\.(?:[cm]?[jt]sx?|css)$/.test(file)) return;
    const source = readFileSync(file, "utf8");
    for (const { specifier, line } of importsIn(source)) {
      const label = `${relative(root, file)}:${line}`;
      const resolved = specifier.startsWith(".") || specifier.startsWith("/") ? resolve(dirname(file), specifier) : undefined;
      if (resolved?.startsWith(sourceRoot + sep)) failures.push(`${label}: official source must be imported through its package exports, not ${specifier}`);
      if (!specifier.startsWith("@deepseek-ai/")) continue;
      imports += 1;
      const name = packageName(specifier);
      const subpath = specifier.slice(name.length);
      const upstream = official.get(name);
      if (!upstream || !isPackageExported(upstream.manifest, subpath === "" ? "." : `.${subpath}`)) failures.push(`${label}: ${specifier} is not exported by a pinned official package`);
      if (!subpath.startsWith("/src/")) continue;
      let owner = dirname(file);
      while (owner !== root && !existsSync(join(owner, "package.json"))) owner = dirname(owner);
      const manifest = existsSync(join(owner, "package.json")) ? readJson(join(owner, "package.json")) : {};
      const reuse = manifest.dshBase?.reuse;
      if (!Array.isArray(reuse?.sourceEntries) || !reuse.sourceEntries.includes(specifier)) failures.push(`${label}: record ${specifier} in the owning package's dshBase.reuse.sourceEntries`);
      if (reuse?.sourceReviewCommit !== lock.commit) failures.push(`${label}: source-entry review is missing or stale; set sourceReviewCommit only after reviewing the pinned exports`);
    }
  });
  return { failures, summary: `${imports} official imports use declared exports; every runtime package records reuse, composed clients expose loader contracts, and source-entry reviews match the pin` };
}

if (isMain(import.meta.url)) printResult("official reuse", checkOfficialReuse(repoRoot));
