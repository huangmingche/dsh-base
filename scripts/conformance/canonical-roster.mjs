/**
 * Audit-only oracle for the three composition rosters.
 *
 * Production reads `packs/` only: `readClientComposition()` at the repository
 * root and both `generate-*-composition.mjs` generators resolve every row from
 * the capability-pack manifests. This module re-derives the same rosters from
 * package metadata, `apps/web/composition.profile.json` and the pinned official
 * inventory, so `check:packs` and the pack tests can prove the pack model did
 * not add, drop, reorder or reshape a row. It must never be imported by the
 * build.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clientRows, officialPackages, repoRoot } from "./lib.mjs";
import { readThinkComposition } from "../composition/think-composition.mjs";

const compareOrder = (left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id);

/**
 * Client roster without packs: profile rows first (profile precedence), then
 * local client metadata, then the disabled official inventory, in stable
 * `order` / `id` order.
 */
export function canonicalClientRows(root = repoRoot) {
  const rows = clientRows(root).map(row => ({
    ...row, module: row.module ?? row.name, origin: row.origin ?? "custom",
  }));
  const names = new Set(rows.map(row => row.name));
  const official = [...officialPackages(root).values()]
    .filter(({ manifest }) => manifest.dsh?.client !== undefined
      && (manifest.dsh.client.platform === undefined || manifest.dsh.client.platform === "web")
      && !names.has(manifest.name))
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  for (const [index, { manifest, directoryPath }] of official.entries()) {
    rows.push({
      name: manifest.name,
      id: `client:official:${directoryPath.split(/[\\/]/).at(-1)}`,
      origin: "upstream",
      order: 1000 + index,
      disabled: true,
      unavailableReason: "Official DSH plugin is present in the roster but not started by this deployment.",
    });
  }
  rows.sort(compareOrder);
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate composition id: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

/** Worker roster without packs: every package's own `dshBase.worker` metadata. */
export function canonicalWorkerRows(root = repoRoot) {
  const packagesDir = join(root, "packages", "cloudflare-worker");
  const rows = [];
  if (existsSync(packagesDir)) for (const directory of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, directory, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const meta = manifest.dshBase?.worker;
    if (manifest.name === undefined || meta?.id === undefined) continue;
    rows.push({ name: manifest.name, module: meta.module ?? manifest.name, id: meta.id, origin: meta.origin ?? "custom", order: meta.order ?? 100 });
  }
  rows.sort(compareOrder);
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate worker composition id: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

/** Agent (Think) roster without packs: the shared `readThinkComposition` reader. */
export function canonicalAgentRows(root = repoRoot) {
  return readThinkComposition(root);
}
