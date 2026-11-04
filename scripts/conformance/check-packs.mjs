#!/usr/bin/env node
/**
 * Enforce capability-pack integrity.
 *
 * - The client, Worker and Think rosters derived from `packs/` must equal the
 *   pack-independent canonical rosters row for row (order and fields included).
 * - Empty plane declarations, duplicate members, broken/cyclic `requires`, and
 *   missing package metadata fail closed in the loader itself.
 * - A pack that promises `toggleable: L1` may not contain a module from
 *   `CLIENT_PLUGIN_POLICY.required`: those modules can never be switched off.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditPacks, auditToggleablePacks, readPackManifests } from "../composition/packs.mjs";
import { canonicalAgentRows, canonicalClientRows, canonicalWorkerRows } from "./canonical-roster.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packs = readPackManifests(repoRoot);
const audit = auditPacks(repoRoot, {
  client: canonicalClientRows(repoRoot),
  worker: canonicalWorkerRows(repoRoot),
  agent: canonicalAgentRows(repoRoot),
});
const errors = [...audit.errors];

if (errors.length > 0) {
  console.error(`capability packs: ${errors.length} violation(s)`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`capability packs: ${audit.packs.length} packs cover ${audit.rows.client} client + ${audit.rows.worker} worker + ${audit.rows.think} think rows; no orphan/missing member, no empty plane, no L1 required-module overlap`);
  console.log(`capability packs: ${audit.packs.map(id => `${id} (${audit.members[id].client}/${audit.members[id].worker}/${audit.members[id].think})`).join(", ")}`);
}
