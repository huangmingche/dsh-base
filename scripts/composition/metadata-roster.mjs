/**
 * Production roster readers: package metadata plus the application profile.
 *
 * These readers never consume packs/. Packs independently describe grouping
 * and optional management; check:packs compares that description against the
 * actual production rows, including order and fields, before release.
 */
import { clientRows, localPackages, officialPackages, repoRoot } from "../conformance/lib.mjs";
import { readThinkComposition } from "./think-composition.mjs";

const compareOrder = (left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id);

/**
 * Client roster without packs: profile rows first (profile precedence), then
 * local client metadata, then the disabled official inventory, in stable
 * `order` / `id` order.
 */
export function readClientMetadataRows(root = repoRoot, options = {}) {
  const rows = clientRows(root, options).map(row => ({
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
  const ids = new Set(), seenNames = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate composition id: ${row.id}`);
    if (seenNames.has(row.name)) throw new Error(`duplicate composition member: ${row.name}`);
    ids.add(row.id);
    seenNames.add(row.name);
  }
  return rows;
}

/** Worker roster without packs: every package's own `dshBase.worker` metadata. */
export function readWorkerMetadataRows(root = repoRoot) {
  const rows = [];
  for (const { group, manifest } of localPackages(root)) {
    if (group !== "cloudflare-worker") continue;
    const meta = manifest.dshBase?.worker;
    if (manifest.name === undefined || meta?.id === undefined) continue;
    if (typeof meta.id !== "string" || meta.id === "") throw new Error(`${manifest.name}: dshBase.worker.id must be a non-empty string`);
    if (meta.order !== undefined && !Number.isFinite(meta.order)) throw new Error(`${manifest.name}: dshBase.worker.order must be a finite number`);
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
export function readAgentMetadataRows(root = repoRoot) {
  return readThinkComposition(root);
}
