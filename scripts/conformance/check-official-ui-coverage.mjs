#!/usr/bin/env node
/** Declared official Web UI coverage; runtime and rendered parity need acceptance. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientRows, isMain, isPackageExported, localPackages, officialPackages, packageName, printResult, readJson, repoRoot } from "./lib.mjs";

export function checkOfficialUiCoverage(root) {
  const failures = [];
  const lock = readJson(join(root, "dsh-source.lock.json"));
  const patch = readFileSync(join(root, ".submodules/deepseek-harness/packages/bundle/web-app/cordis.patch.yml"), "utf8");
  const official = officialPackages(root);
  const required = [...new Set([...patch.matchAll(/^\s+name:\s*['"](@deepseek-ai\/dsh-client-[^'"\n]+)['"]/gm)].map((match) => match[1]))];
  if (required.length === 0) failures.push("official web-app patch yielded no client packages; review the pinned composition format");
  const rows = clientRows(root);
  const active = new Map(rows.filter((row) => row.disabled !== true).map((row) => [row.name, row]));
  const locals = new Map(localPackages(root).map(({ manifest }) => [manifest.name, manifest]));
  const replacements = new Map();
  const ids = new Set();
  const names = new Set();
  for (const row of rows) {
    if (names.has(row.name)) failures.push(`duplicate client package: ${row.name}`);
    if (typeof row.id !== "string" || ids.has(row.id)) failures.push(`missing or duplicate client composition id: ${row.id}`);
    names.add(row.name); ids.add(row.id);
    if (row.disabled === true) continue;
    if (official.has(row.name) && row.origin !== "upstream") failures.push(`${row.name}: official active row must have origin upstream`);
    if (locals.has(row.name) && row.origin !== "custom") failures.push(`${row.name}: local active row must have origin custom`);
    if (row.replaces === undefined) continue;
    const metadata = locals.get(row.name)?.dshBase;
    const fork = metadata?.forkOf;
    const reuse = metadata?.reuse;
    const trackedFork = fork?.package === row.replaces && fork.commit === lock.commit && fork.path && fork.license;
    const componentEntries = Array.isArray(reuse?.sourceEntries) ? reuse.sourceEntries.filter((entry) => packageName(entry) === row.replaces) : [];
    const componentSeam = reuse?.mode === "seam" && (reuse.for ?? reuse.official)?.includes(row.replaces)
      && reuse.sourceReviewCommit === lock.commit && componentEntries.length > 0
      && componentEntries.every((entry) => isPackageExported(official.get(row.replaces)?.manifest ?? {}, `.${entry.slice(row.replaces.length)}`));
    if (!trackedFork && !componentSeam) {
      failures.push(`${row.name}: replacement ${row.replaces} requires a pinned fork or a reviewed seam reusing its exported components`);
      continue;
    }
    if (!official.get(row.replaces)?.manifest.dsh?.client) failures.push(`${row.name}: replaces is not an official client plugin: ${row.replaces}`);
    if (active.has(row.replaces)) failures.push(`${row.name}: replaced official package ${row.replaces} must remain disabled`);
    if (replacements.has(row.replaces)) failures.push(`${row.replaces}: multiple active replacements`);
    replacements.set(row.replaces, row.name);
  }
  for (const name of required) if (!active.has(name) && !replacements.has(name)) failures.push(`official Web UI package absent or disabled without an active tracked fork: ${name}`);
  const enabled = required.filter((name) => active.has(name)).length;
  const replaced = required.filter((name) => replacements.has(name)).length;
  return { failures, summary: `${required.length} official packages: ${enabled} enabled, ${replaced} active tracked replacements; declaration coverage only, runtime origin/fibers and rendered parity require browser acceptance` };
}

if (isMain(import.meta.url)) printResult("official UI composition", checkOfficialUiCoverage(repoRoot));
