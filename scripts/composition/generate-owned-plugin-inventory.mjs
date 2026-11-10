#!/usr/bin/env node
import { buildContext, cliProductRoot, outputPath } from "../build/product-paths.mjs";
/** Complete display inventory from production metadata; management is a separate projection. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, localPackages, repoRoot } from '../conformance/lib.mjs';
import { readClientMetadataRows, readWorkerMetadataRows, readAgentMetadataRows } from './metadata-roster.mjs';
import { readPackManifests } from './packs.mjs';
import { checkPluginOrigin } from '../conformance/plugin-origin.mjs';

export const ownedInventoryTarget = 'packages/client/dsh-base-client-session-adapter/src/client/owned-plugin-inventory.generated.ts';
const planes = ['client', 'worker', 'think'];
const metadataKey = { client: 'client', worker: 'worker', think: 'agent' };
const nameOf = value => typeof value === 'string' ? value : value.name;

/**
 * Project validated production rows and package declarations without importing
 * any plugin runtime. Packs group these rows and set management permissions;
 * they never determine which declared plugins exist or are visible.
 */
export function projectOwnedPluginInventory({ packages, rosters, packs }) {
  const local = new Map();
  const declared = new Map();
  for (const { manifest } of packages) {
    if (typeof manifest.name !== 'string' || local.has(manifest.name)) throw new Error('owned inventory: missing or duplicate package name');
    local.set(manifest.name, manifest);
    const declarations = planes.filter(plane => manifest.dshBase?.[metadataKey[plane]] !== undefined);
    if (declarations.length > 1) throw new Error(`${manifest.name}: runtime package declares multiple planes`);
    if (declarations.length === 1) {
      const plane = declarations[0];
      if (plane === 'client' && manifest.dsh?.client === undefined) throw new Error(`${manifest.name}: client inventory requires dsh.client`);
      declared.set(manifest.name, plane);
    }
  }

  const membership = new Map();
  const packIds = new Set();
  const productionNames = new Set(planes.flatMap(plane => rosters[plane].map(row => row.name)));
  for (const pack of packs) {
    if (packIds.has(pack.id)) throw new Error(`duplicate inventory pack: ${pack.id}`);
    packIds.add(pack.id);
    if (!['L1', 'none'].includes(pack.toggleable)) throw new Error(`${pack.id}: unsupported inventory management policy`);
    for (const plane of planes) for (const member of pack.planes[plane] ?? []) {
      const name = nameOf(member);
      if (!productionNames.has(name)) throw new Error(`${name}: inventory grouping references a missing production row`);
      if (!local.has(name)) continue;
      if (declared.get(name) !== plane) throw new Error(`${name}: pack membership has no matching ${plane} runtime declaration`);
      if (membership.has(name)) throw new Error(`${name}: duplicate inventory pack membership`);
      if (plane === 'worker' && pack.toggleable === 'L1') throw new Error(`${name}: Worker plugins cannot be owner-managed`);
      membership.set(name, pack);
    }
  }

  const seenNames = new Set(), seenIds = new Set();
  const rows = [];
  for (const plane of planes) for (const entry of rosters[plane]) {
    if (!local.has(entry.name)) continue;
    if (declared.get(entry.name) !== plane) throw new Error(`${entry.name}: production row has no matching ${plane} runtime declaration`);
    if (seenNames.has(entry.name)) throw new Error(`${entry.name}: duplicate owned production row`);
    if (typeof entry.id !== 'string' || entry.id === '' || seenIds.has(entry.id)) throw new Error(`${entry.name}: missing or duplicate owned entry id`);
    if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') throw new Error(`${entry.name}: display inventory requires a literal disabled state`);
    seenNames.add(entry.name); seenIds.add(entry.id);
    const pack = membership.get(entry.name);
    if (pack === undefined) throw new Error(`${entry.name}: runtime plugin is missing from inventory grouping`);
    const manifest = local.get(entry.name);
    const origin = entry.origin ?? manifest.dshBase?.[metadataKey[plane]]?.origin ?? 'custom';
    if (!['upstream', 'fork', 'custom'].includes(origin)) throw new Error(`${entry.name}: invalid composition origin`);
    const originFailures = [
      ...checkPluginOrigin(manifest, manifest.dshBase?.[metadataKey[plane]]?.origin, `dshBase.${metadataKey[plane]}.origin`),
      ...checkPluginOrigin(manifest, origin, 'inventory composition origin'),
    ];
    if (originFailures.length > 0) throw new Error(originFailures.join('\n'));
    const sourceAvailability = manifest.dshBase?.reuse?.availability;
    if (sourceAvailability !== undefined && sourceAvailability !== 'unavailable') throw new Error(`${entry.name}: unsupported source availability ${sourceAvailability}`);
    rows.push({
      plane, name: entry.name, entryId: entry.id,
      declaredEnabled: entry.disabled !== true,
      origin,
      packId: pack.id,
      management: pack.toggleable === 'L1' ? 'optional' : plane === 'worker' ? 'deployment' : 'required',
      ...(sourceAvailability === undefined ? {} : { sourceAvailability }),
      ...(entry.unavailableReason === undefined ? {} : { unavailableReason: entry.unavailableReason }),
    });
  }
  for (const name of declared.keys()) if (!seenNames.has(name)) throw new Error(`${name}: declared runtime plugin is missing from production inventory`);
  for (const name of membership.keys()) if (!seenNames.has(name)) throw new Error(`${name}: inventory grouping references a missing production row`);

  const bundles = [];
  for (const pack of packs) {
    const members = rows.filter(row => row.packId === pack.id).map(row => row.name);
    if (members.length === 0) continue;
    if (pack.toggleable !== 'L1') {
      // These are logical deployment groups, not invented registry packages.
      bundles.push({ name: `dsh-base:${pack.id}`, packId: pack.id, management: 'required', members });
    } else if (pack.id === 'gateway-provider') {
      // Preserve the existing public identity and the reviewed single-switch
      // Gateway contract. Both components remain independently inspectable.
      const clients = rows.filter(row => row.packId === pack.id && row.plane === 'client');
      if (clients.length !== 1) throw new Error('gateway-provider: the unified bundle requires exactly one client member');
      bundles.push({ name: clients[0].name, packId: pack.id, management: 'optional', members });
    } else {
      for (const name of members) bundles.push({ name, packId: pack.id, management: 'optional', members: [name] });
    }
  }
  if (new Set(bundles.map(bundle => bundle.name)).size !== bundles.length) throw new Error('owned inventory: duplicate bundle identity');
  const coverage = bundles.flatMap(bundle => bundle.members);
  if (coverage.length !== rows.length || new Set(coverage).size !== rows.length || rows.some(row => !coverage.includes(row.name))) {
    throw new Error('owned inventory: every runtime component must belong to exactly one visible bundle');
  }
  return { rows, bundles };
}

/** Read the actual metadata/profile roster, including non-preset Think providers. */
export function loadOwnedPluginInventory(root = repoRoot) {
  const { rows, bundles } = projectOwnedPluginInventory({
    packages: localPackages(root),
    rosters: {
      client: readClientMetadataRows(root),
      worker: readWorkerMetadataRows(root),
      think: readAgentMetadataRows(root),
    },
    packs: readPackManifests(root),
  });
  const source = [
    '/* Generated by scripts/composition/generate-owned-plugin-inventory.mjs; do not edit. */',
    '/* Metadata/profile display declarations only. No plugin resolver or observed runtime state. */',
    'export interface OwnedPluginRow {',
    "  readonly plane: 'client' | 'worker' | 'think';",
    '  readonly name: string;',
    '  readonly entryId: string;',
    '  readonly declaredEnabled: boolean;',
    "  readonly origin: 'upstream' | 'fork' | 'custom';",
    '  readonly packId: string;',
    "  readonly management: 'optional' | 'required' | 'deployment';",
    "  readonly sourceAvailability?: 'unavailable';",
    '  readonly unavailableReason?: string;',
    '}',
    'export interface OwnedPluginBundle {',
    '  readonly name: string;',
    '  readonly packId: string;',
    "  readonly management: 'optional' | 'required';",
    '  readonly members: readonly string[];',
    '}',
    `export const OWNED_PLUGIN_ROWS: readonly OwnedPluginRow[] = ${JSON.stringify(rows, null, 2)} as const;`,
    `export const OWNED_PLUGIN_BUNDLES: readonly OwnedPluginBundle[] = ${JSON.stringify(bundles, null, 2)} as const;`,
    '',
  ].join('\n');
  return { rows, bundles, source };
}

if (isMain(import.meta.url)) {
  const root = cliProductRoot();
  const { rows, bundles, source } = loadOwnedPluginInventory(root);
  const target = outputPath(root, ownedInventoryTarget);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* Missing is stale. */ }
    if (current !== source) {
      console.error('owned plugin inventory is stale: run node scripts/composition/generate-owned-plugin-inventory.mjs');
      process.exitCode = 1;
    } else console.log(`owned plugin inventory: ${rows.length} components in ${bundles.length} bundles verified`);
  } else {
    writeFileSync(target, source);
    console.log(`owned plugin inventory: ${rows.length} components in ${bundles.length} bundles generated`);
  }
}
