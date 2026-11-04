/**
 * One metadata reader for the Cloudflare Think agent composition.
 *
 * Both the runtime Worker roster and the read-only inventory projection consume
 * this helper, so name/id/order/module cannot drift between them. It validates
 * duplicate ids, required exports, module strings and order values before either
 * generator writes output.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Read and validate the Think composition from package metadata.
 * @param {string} root repository root (contains packages/cloudflare-think).
 * @returns {readonly {name: string, module: string, export: string, id: string, order: number}[]}
 */
function readThinkRows(root) {
  const packagesDir = join(root, "packages", "cloudflare-think");
  const rows = [];
  const ids = new Set();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const meta = manifest.dshBase?.agent;
    if (manifest.name === undefined || meta?.id === undefined) continue;
    if (typeof meta.id !== "string" || meta.id === "") throw new Error(`${manifest.name}: dshBase.agent.id must be a non-empty string`);
    if (typeof meta.export !== "string" || meta.export === "") throw new Error(`${manifest.name}: dshBase.agent.export is required`);
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
      presetRow: meta.presetRow !== false,
    });
  }
  rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return rows;
}

/** Composition rows (shape shared with pack-derived rows; provider-only rows included). */
export function readThinkComposition(root) {
  return readThinkRows(root).map(({ presetRow: _presetRow, ...row }) => row);
}

/** User-facing preset rows: model-provider seams are composed but not listed as plugins. */
export function readThinkPresetRows(root) {
  return readThinkRows(root).filter(row => row.presetRow !== false).map(({ presetRow: _presetRow, ...row }) => row);
}
