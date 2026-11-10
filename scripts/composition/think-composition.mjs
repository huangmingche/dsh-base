/**
 * One metadata reader for the Cloudflare Think agent composition.
 *
 * Both the runtime Worker roster and the read-only inventory projection consume
 * this helper, so name/id/order/module cannot drift between them. It validates
 * duplicate ids, required exports, module strings and order values before either
 * generator writes output.
 */
import { localPackages } from "../conformance/lib.mjs";

/**
 * Read and validate the Think composition from package metadata.
 * @param {string} root repository root (contains packages/cloudflare-think).
 * @returns {readonly {name: string, module: string, export: string, id: string, order: number}[]}
 */
function readThinkRows(root) {
  const rows = [];
  const ids = new Set();
  for (const { group, manifest } of localPackages(root)) {
    if (group !== "cloudflare-think") continue;
    const meta = manifest.dshBase?.agent;
    if (manifest.name === undefined || meta?.id === undefined) continue;
    if (typeof meta.id !== "string" || meta.id === "") throw new Error(`${manifest.name}: dshBase.agent.id must be a non-empty string`);
    if (typeof meta.export !== "string" || !/^[$A-Z_][0-9A-Z_$]*$/i.test(meta.export)) throw new Error(`${manifest.name}: dshBase.agent.export is required and must be an identifier`);
    if (meta.module !== undefined && (typeof meta.module !== "string" || meta.module === "")) throw new Error(`${manifest.name}: dshBase.agent.module must be a non-empty string`);
    if (meta.order !== undefined && !Number.isFinite(meta.order)) throw new Error(`${manifest.name}: dshBase.agent.order must be a finite number`);
    if (ids.has(meta.id)) throw new Error(`duplicate agent composition id: ${meta.id}`);
    ids.add(meta.id);
    rows.push({
      name: manifest.name,
      module: meta.module ?? manifest.name,
      export: meta.export,
      id: meta.id,
      order: meta.order ?? 100,
    });
  }
  rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return rows;
}

/** Composition rows (shape shared with pack-derived rows; provider-only rows included). */
export function readThinkComposition(root) {
  return readThinkRows(root);
}

/** Complete declared Think inventory, including model providers; visibility is independent of editability. */
export function readThinkPresetRows(root) {
  return readThinkRows(root);
}
