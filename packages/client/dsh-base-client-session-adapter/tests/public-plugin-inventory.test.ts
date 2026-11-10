import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginInventoryRemotes } from '../src/client/plugin-inventory.ts';
import { OWNED_PLUGIN_ROWS, OWNED_PLUGIN_BUNDLES } from '../src/client/owned-plugin-inventory.generated.ts';
import { createScheduleRemote } from '../src/client/schedule-remote.ts';
import { FIXED_AGENT_PRESET_ID, OFFICIAL_AGENT_PRESET_IDS } from '../../../boot/dsh-base-agent-presets/src/index.ts';
import { THINK_PRESET_ROWS, OFFICIAL_PRESET_ROWS } from '../src/client/official-preset-declarations.generated.ts';

test('public catalog lists every declared component without reading account state, runtime observations or private HTTP', async () => {
  let reads = 0;
  const publicRemotes = createPluginInventoryRemotes({
    isAuthenticated: () => false,
    entries: () => { throw new Error('must not observe live account composition'); },
    fetch: (async () => { reads++; throw new Error('private HTTP called'); }) as typeof fetch,
    applyRuntime: async () => { throw new Error('must not apply runtime state'); },
  });
  const [catalog, bundles, plugins] = await Promise.all([publicRemotes.inventory.list(), publicRemotes.manager.listBundles(), publicRemotes.manager.listPlugins()]);
  assert.equal(catalog.ok, true); assert.equal(bundles.ok, true); assert.equal(plugins.ok, true);
  if (!catalog.ok || !bundles.ok || !plugins.ok) throw new Error('public metadata unavailable');
  assert.deepEqual(catalog.value.entries.map(row => row.moduleName).sort(), OWNED_PLUGIN_ROWS.filter(row => row.plane !== 'think').map(row => row.name).sort());
  assert.deepEqual(bundles.value.filter(row => !row.official).map(row => row.name), OWNED_PLUGIN_BUNDLES.map(row => row.name));
  const presets = catalog.value.agentPresets;
  assert.ok(presets, 'public inventory preserves the official session/global grouping');
  assert.deepEqual(presets.map(preset => preset.id), [...OFFICIAL_AGENT_PRESET_IDS, FIXED_AGENT_PRESET_ID]);
  assert.deepEqual(presets.filter(preset => preset.isDefault).map(preset => preset.id), [FIXED_AGENT_PRESET_ID]);
  for (const preset of presets) {
    const declared = preset.id === FIXED_AGENT_PRESET_ID ? THINK_PRESET_ROWS : OFFICIAL_PRESET_ROWS[preset.id];
    assert.deepEqual(preset.rows.map(row => ({ entryId: row.entryId, moduleName: row.moduleName, enabled: row.enabled })), declared!.map(row => ({ entryId: row.entryId, moduleName: row.moduleName, enabled: row.enabled })));
    assert.ok(preset.rows.every(row => row.fiberPhase === null), 'preset declarations never claim active private sessions');
  }
  const thinkNames = new Set(THINK_PRESET_ROWS.map(row => row.moduleName));
  assert.ok(catalog.value.entries.every(row => !thinkNames.has(row.moduleName)), 'Think declarations cannot be duplicated in the global group');
  assert.deepEqual(Object.keys(catalog.value).sort(), ['agentPresets', 'entries', 'managementAvailable']);
  assert.ok(plugins.value.every(row => row.fiberPhase === null), 'declarations cannot claim observed running fibers');
  assert.ok(catalog.value.entries.every(row => !('config' in row) && !('ownerId' in row)));
  for (const bundle of OWNED_PLUGIN_BUNDLES) {
    assert.equal((await publicRemotes.manager.setBundleEnabled(bundle.name, false)).ok, false);
  }
  for (const row of OWNED_PLUGIN_ROWS) {
    assert.equal((await publicRemotes.manager.setPluginEnabled(row.entryId, false)).ok, false);
  }
  assert.equal(reads, 0);
});

test('authenticated inventory still requires owner HTTP and revocation rejects mutations before transport', async () => {
  let authenticated = true, reads = 0;
  const remotes = createPluginInventoryRemotes({ isAuthenticated: () => authenticated, entries: () => [], fetch: (async () => { reads++; return new Response('{}', { status: 401 }); }) as typeof fetch });
  assert.equal((await remotes.manager.listBundles()).ok, false);
  assert.ok(reads > 0);
  const before = reads; authenticated = false;
  assert.equal((await remotes.manager.setBundleEnabled('@dsh-base/cloudflare-think-memory', false)).ok, false);
  assert.equal(reads, before);
});

test('anonymous schedule reads and writes never open the private RPC carrier', async () => {
  let calls = 0;
  const schedules = createScheduleRemote({ isAuthenticated: () => false, rpc: () => { calls++; throw new Error('private RPC created'); }, changed: () => { throw new Error('no accepted mutation'); } });
  const results = await Promise.all([schedules.catalog(), schedules.list({}), schedules.view({}), schedules.history({}), schedules.deliveryLimits(), schedules.create({}), schedules.edit({}), schedules.run({}), schedules.deleteInactive()]);
  assert.ok(results.every(result => !result.ok && result.error.code === 'auth/required'));
  assert.equal(calls, 0);
});
