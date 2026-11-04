/**
 * Capability-pack manifests: the single source for which packages are composed
 * into the client, Worker and Think planes.
 *
 * A package's own metadata still describes how that package is loaded (module,
 * export, id, order); it is not allowed to add or remove a composed member. The
 * rosters are derived here, sorted deterministically, and written to gitignored
 * generated files by the two generators plus the Vite virtual module.
 *
 * Every read fails closed: a missing/duplicated pack, a member without the
 * metadata its plane needs, a cross-pack duplicate, a broken `requires` graph or
 * a duplicated composition id throws instead of degrading to a partial roster.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { localPackages, officialPackages, repoRoot } from "../conformance/lib.mjs";

const PLANES = ["client", "worker", "think"];
const TOGGLEABLE = new Set(["L1", "none"]);

const readJson = path => JSON.parse(readFileSync(path, "utf8"));

const requireObject = (value, message) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
};

const requireString = (value, message) => {
  if (typeof value !== "string" || value === "") throw new Error(message);
  return value;
};

/** Read, validate and topologically check every pack manifest in a directory. */
export function readPackManifests(root = repoRoot) {
  const base = join(root, "packs");
  if (!existsSync(base)) throw new Error("packs/: capability-pack manifests are required");
  const packs = readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const path = join(base, entry.name, "pack.json");
      if (!existsSync(path)) throw new Error(`packs/${entry.name}/pack.json is missing`);
      return { directory: entry.name, path, manifest: readJson(path) };
    })
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  if (packs.length === 0) throw new Error("packs/: at least one pack manifest is required");

  const ids = new Set();
  const members = Object.fromEntries(PLANES.map(plane => [plane, new Map()]));
  for (const { directory, manifest } of packs) {
    requireString(manifest.id, `packs/${directory}: id must be a non-empty string`);
    if (ids.has(manifest.id)) throw new Error(`duplicate pack id: ${manifest.id}`);
    ids.add(manifest.id);
    requireObject(manifest.planes, `${manifest.id}: planes must be an object`);
    for (const plane of PLANES) {
      const entries = manifest.planes[plane] ?? [];
      if (!Array.isArray(entries)) throw new Error(`${manifest.id}: planes.${plane} must be an array`);
      if (manifest.planes[plane] !== undefined && entries.length === 0) throw new Error(`${manifest.id}: planes.${plane} is declared empty; omit the plane instead`);
      for (const entry of entries) {
        const name = typeof entry === "string" ? entry : entry?.name;
        if (typeof name !== "string" || name === "") throw new Error(`${manifest.id}: planes.${plane} entry must be a package name or an object with name`);
        if (members[plane].has(name)) throw new Error(`${manifest.id}: ${plane} member ${name} is already in pack ${members[plane].get(name)}`);
        members[plane].set(name, manifest.id);
      }
    }
    if (!Array.isArray(manifest.requires)) throw new Error(`${manifest.id}: requires must be an array`);
    for (const dependency of manifest.requires) requireString(dependency, `${manifest.id}: requires entries must be pack ids`);
    if (!TOGGLEABLE.has(manifest.toggleable)) throw new Error(`${manifest.id}: toggleable must be L1 or none`);
    requireObject(manifest.config, `${manifest.id}: config must be a JSON-schema object`);
    if (manifest.config.type !== undefined && manifest.config.type !== "object") throw new Error(`${manifest.id}: config.type must be object`);
    if (manifest.config.properties !== undefined) requireObject(manifest.config.properties, `${manifest.id}: config.properties must be an object`);
    if (manifest.config.required !== undefined && (!Array.isArray(manifest.config.required) || !manifest.config.required.every(value => typeof value === "string"))) throw new Error(`${manifest.id}: config.required must be an array of strings`);
    requireString(manifest.uninstallImpact, `${manifest.id}: uninstallImpact must explain the removal impact`);
    requireObject(manifest.reuse, `${manifest.id}: reuse metadata is required`);
    if (!["custom", "seam", "fork"].includes(manifest.reuse.mode)) throw new Error(`${manifest.id}: reuse.mode must be custom, seam or fork`);
    requireString(manifest.reuse.reason, `${manifest.id}: reuse.reason is required`);
    if (manifest.reuse.mode === "fork" && (manifest.reuse.forkOf === null || typeof manifest.reuse.forkOf !== "object" || Array.isArray(manifest.reuse.forkOf))) throw new Error(`${manifest.id}: reuse.mode fork requires reuse.forkOf`);
    if (!Array.isArray(manifest.reuse.official)) throw new Error(`${manifest.id}: reuse.official must be an array`);
    for (const name of manifest.reuse.official) requireString(name, `${manifest.id}: reuse.official entries must be package names`);
    const memberCount = PLANES.reduce((total, plane) => total + (manifest.planes[plane] ?? []).length, 0);
    if (memberCount === 0) throw new Error(`${manifest.id}: pack declares no plane members`);
  }
  for (const { manifest } of packs) for (const dependency of manifest.requires) {
    if (!ids.has(dependency)) throw new Error(`${manifest.id}: requires unknown pack ${dependency}`);
    if (dependency === manifest.id) throw new Error(`${manifest.id}: cannot require itself`);
  }
  const visiting = new Set(), visited = new Set();
  const byId = new Map(packs.map(({ manifest }) => [manifest.id, manifest]));
  const visit = id => {
    if (visiting.has(id)) throw new Error(`pack dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).requires) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return packs.map(({ manifest }) => manifest);
}

/** Every package the packs may reference, from local packages and the pinned official tree. */
const packageIndex = root => {
  const index = new Map();
  for (const { manifest } of localPackages(root)) index.set(manifest.name, manifest);
  for (const { manifest } of officialPackages(root).values()) index.set(manifest.name, manifest);
  return index;
};

const validateOrder = (order, message) => {
  if (order !== undefined && !Number.isFinite(order)) throw new Error(message);
  return order ?? 100;
};

const normalizeClient = (name, meta) => ({
  name,
  ...meta,
  module: meta.module ?? name,
  origin: meta.origin ?? "custom",
  order: validateOrder(meta.order, `${name}: dshBase.client.order must be a finite number`),
});

/**
 * Derive the client roster from pack manifests plus package metadata. Disabled
 * rows stay inventory only; `generateClientComposition` never imports them.
 */
export function readClientRows(root = repoRoot) {
  const packs = readPackManifests(root);
  const index = packageIndex(root);
  const rows = [];
  for (const pack of packs) for (const entry of pack.planes.client ?? []) {
    if (typeof entry === "string") {
      const meta = index.get(entry)?.dshBase?.client;
      if (meta === undefined) throw new Error(`${pack.id}: client member ${entry} has no dshBase.client metadata`);
      rows.push(normalizeClient(entry, meta));
      continue;
    }
    requireString(entry.id, `${pack.id}: client object ${entry.name} needs id`);
    if (entry.origin !== undefined) requireString(entry.origin, `${pack.id}: client member ${entry.name} origin must be a string`);
    if (entry.module !== undefined) requireString(entry.module, `${pack.id}: client member ${entry.name} module must be a string`);
    if (entry.disabled !== undefined && typeof entry.disabled !== "boolean") throw new Error(`${pack.id}: client member ${entry.name} disabled must be a boolean`);
    const row = { ...entry };
    if (entry.order !== undefined) row.order = validateOrder(entry.order, `${pack.id}: client member ${entry.name} order must be a finite number`);
    rows.push(row);
  }
  rows.sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
  const ids = new Set(), names = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate composition id: ${row.id}`);
    if (names.has(row.name)) throw new Error(`duplicate composition member: ${row.name}`);
    ids.add(row.id);
    names.add(row.name);
  }
  return rows;
}

const readPlaneRows = (root, plane) => {
  const packs = readPackManifests(root);
  const index = packageIndex(root);
  const rows = [];
  for (const pack of packs) for (const name of pack.planes[plane] ?? []) {
    const manifest = index.get(name);
    const metaKey = plane === "think" ? "agent" : plane;
    const meta = manifest?.dshBase?.[metaKey];
    if (meta?.id === undefined) throw new Error(`${pack.id}: ${plane} member ${name} has no dshBase.${metaKey} metadata`);
    if (plane === "worker") rows.push({ name, module: meta.module ?? name, id: meta.id, origin: meta.origin ?? "custom", order: validateOrder(meta.order, `${name}: dshBase.worker.order must be a finite number`) });
    else {
      requireString(meta.export, `${name}: dshBase.agent.export is required`);
      rows.push({ name, module: meta.module ?? name, export: meta.export, id: meta.id, order: validateOrder(meta.order, `${name}: dshBase.agent.order must be a finite number`) });
    }
  }
  rows.sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id));
  const ids = new Set(), names = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate ${plane} composition id: ${row.id}`);
    if (names.has(row.name)) throw new Error(`duplicate ${plane} composition member: ${row.name}`);
    ids.add(row.id);
    names.add(row.name);
  }
  return rows;
};

export const readWorkerRows = (root = repoRoot) => readPlaneRows(root, "worker");
export const readAgentRows = (root = repoRoot) => readPlaneRows(root, "think");

/**
 * `toggleable: L1` promises a pack can be switched off without removing a
 * module the user can never switch off. `CLIENT_PLUGIN_POLICY.required` is the
 * only source for that list; membership is checked here, not left to review.
 */
export function auditToggleablePacks(packs, requiredClient) {
  const required = requiredClient instanceof Set ? requiredClient : new Set(requiredClient);
  const errors = [];
  for (const pack of packs) {
    if (pack.toggleable !== "L1") continue;
    for (const entry of pack.planes.client ?? []) {
      const name = typeof entry === "string" ? entry : entry?.name;
      if (required.has(name)) errors.push(`${pack.id}: L1 pack cannot include required client module ${name}`);
    }
  }
  return errors;
}

/**
 * Audit the pack rosters against a caller-supplied canonical oracle (see
 * `scripts/conformance/canonical-roster.mjs`). The oracle is derived from
 * package metadata, the composition profile and the pinned official inventory;
 * it never reads `packs/`. Comparison is row-for-row, so a silent reorder or a
 * dropped field is a violation, not just a name/id mismatch.
 */
export function auditPacks(root, canonical) {
  const packs = readPackManifests(root);
  const rows = { client: readClientRows(root), worker: readWorkerRows(root), agent: readAgentRows(root) };
  const errors = [];
  const packIds = packs.map(pack => pack.id).join(", ");
  const compare = (plane, packRows, canonicalRows) => {
    if (!Array.isArray(canonicalRows)) { errors.push(`${plane}: canonical roster is missing`); return; }
    packRows.forEach(row => {
      if (!canonicalRows.some(candidate => candidate.name === row.name)) errors.push(`${plane}: pack member ${row.name} is absent from the canonical roster`);
      if (!canonicalRows.some(candidate => candidate.id === row.id)) errors.push(`${plane}: pack id ${row.id} is absent from the canonical roster`);
    });
    canonicalRows.forEach(row => {
      if (!packRows.some(candidate => candidate.name === row.name)) errors.push(`${plane}: canonical member ${row.name} is absent from the pack rosters (packs: ${packIds})`);
      if (!packRows.some(candidate => candidate.id === row.id)) errors.push(`${plane}: canonical id ${row.id} is absent from the pack rosters (packs: ${packIds})`);
    });
    if (errors.filter(error => error.startsWith(`${plane}:`)).length > 0) return;
    if (!isDeepStrictEqual(packRows, canonicalRows)) {
      const index = packRows.findIndex((row, i) => !isDeepStrictEqual(row, canonicalRows[i]));
      errors.push(`${plane}: roster differs from the canonical roster at row ${index} (${packRows[index]?.id ?? "missing"}), including order and row fields`);
    }
  };
  compare("client", rows.client, canonical.client);
  compare("worker", rows.worker, canonical.worker);
  compare("think", rows.agent, canonical.agent);
  return {
    ok: errors.length === 0,
    errors,
    packs: packs.map(pack => pack.id),
    rows: { client: rows.client.length, worker: rows.worker.length, think: rows.agent.length },
    members: Object.fromEntries(packs.map(pack => [pack.id, {
      client: (pack.planes.client ?? []).length,
      worker: (pack.planes.worker ?? []).length,
      think: (pack.planes.think ?? []).length,
    }])),
  };
}
