import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadOwnedPluginInventory, ownedInventoryTarget, projectOwnedPluginInventory } from '../../composition/generate-owned-plugin-inventory.mjs';
import { localPackages, repoRoot } from '../lib.mjs';

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-owned-inventory-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, JSON.stringify(value));
  };
  const plugin = (plane, suffix, extra = {}) => {
    const group = { client: 'client', worker: 'cloudflare-worker', think: 'cloudflare-think' }[plane];
    const name = `@dsh-base/${group}-${suffix}`;
    const prefix = plane === 'client' ? 'client' : `cloudflare:${plane}`;
    const metadata = { id: `${prefix}:${suffix}`, order: 10, ...(plane === 'think' ? { export: 'plugin' } : {}) };
    const manifest = { name, ...(plane === 'client' ? { dsh: { client: {} } } : {}), dshBase: { [{ client: 'client', worker: 'worker', think: 'agent' }[plane]]: metadata, ...extra } };
    write(`packages/${group}/${suffix}/package.json`, manifest);
    return { name, id: metadata.id, manifest };
  };
  for (const group of ['client', 'cloudflare-worker', 'cloudflare-think']) mkdirSync(join(root, 'packages', group), { recursive: true });
  const client = plugin('client', 'shell');
  const retired = plugin('client', 'retired');
  const worker = plugin('worker', 'host');
  const provider = plugin('think', 'provider');
  provider.manifest.dshBase.agent.presetRow = false;
  write('packages/cloudflare-think/provider/package.json', provider.manifest);
  const unavailable = plugin('think', 'unavailable', { reuse: { availability: 'unavailable' } });
  const gatewayClient = plugin('client', 'gateway');
  const gatewayThink = plugin('think', 'gateway');
  const fetch = plugin('think', 'fetch');
  const memory = plugin('think', 'memory');
  write('packages/boot/support/package.json', { name: '@dsh-base/support', dshBase: { boot: { kind: 'browser-support' } } });
  write('apps/web/composition.profile.json', { client: [{ name: retired.name, id: retired.id, disabled: true, unavailableReason: 'Retired in this deployment.' }] });
  const pack = (id, planes, toggleable = 'none') => {
    const value = { id, planes, toggleable, requires: [], config: {}, uninstallImpact: 'Configured by the deployment.', reuse: { mode: 'custom', official: [], reason: 'Fixture grouping.' } };
    write(`packs/${id}/pack.json`, value);
    return value;
  };
  const base = pack('base', { client: [client.name, retired.name], worker: [worker.name], think: [provider.name, unavailable.name] });
  const gateway = pack('gateway-provider', { client: [gatewayClient.name], think: [gatewayThink.name] }, 'L1');
  const optional = pack('optional-think', { think: [fetch.name, memory.name] }, 'L1');
  return { root, write, client, retired, worker, provider, unavailable, gatewayClient, gatewayThink, fetch, memory, base, gateway, optional };
}

test('complete owned inventory covers every registered runtime package and no support package', () => {
  const result = loadOwnedPluginInventory();
  const declared = localPackages(repoRoot).filter(({ manifest }) => ['client', 'worker', 'agent'].some(key => manifest.dshBase?.[key] !== undefined));
  assert.deepEqual(result.rows.map(row => row.name).sort(), declared.map(({ manifest }) => manifest.name).sort());
  assert.deepEqual(result.bundles.flatMap(bundle => bundle.members).sort(), result.rows.map(row => row.name).sort(), 'every component occurs in exactly one visible bundle');
  assert.ok(result.rows.some(row => row.name === '@dsh-base/cloudflare-think-deepseek'), 'non-preset providers remain in complete inventory');
  assert.equal(result.rows.find(row => row.name === '@dsh-base/cloudflare-think-subagent')?.sourceAvailability, 'unavailable');
  assert.ok(result.rows.filter(row => row.plane === 'worker').every(row => row.management === 'deployment'));
  assert.deepEqual(result.bundles.filter(bundle => bundle.management === 'required').map(bundle => bundle.name).sort(), ['ai-chat-core', 'base', 'global', 'plugin-management', 'waffo', 'email', 'google-auth', 'account-profile', 'user-admin', 'api-keys', 'entitlements', 'files', 'newsletter', 'contact', 'notifications', 'crisp', 'cache', 'dashboard'].map(id => `dsh-base:${id}`).sort());
  assert.deepEqual(result.bundles.find(bundle => bundle.name === '@dsh-base/client-gateway-provider')?.members.sort(), ['@dsh-base/client-gateway-provider', '@dsh-base/cloudflare-think-ai-gateway'].sort());
  assert.equal(result.source, readFileSync(join(repoRoot, ownedInventoryTarget), 'utf8'), 'metadata/profile/group changes must regenerate display inventory');
  assert.doesNotMatch(result.source, /^import\s|\b(?:require|import)\s*\(|fiberPhase|"resolver"|"config"|"module":/mu, 'browser inventory contains declarations, not executable modules, configs or fabricated live state');
});

test('production inventory reports every recorded fork as a fork, preserving custom and seam identities', () => {
  const { rows } = loadOwnedPluginInventory();
  const packages = new Map(localPackages(repoRoot).map(({ manifest }) => [manifest.name, manifest]));
  for (const row of rows) {
    const manifest = packages.get(row.name);
    assert.equal(row.origin, manifest.dshBase.forkOf === undefined ? 'custom' : 'fork', row.name);
  }
  assert.equal(rows.filter(row => row.origin === 'fork').length, 16);
  assert.equal(rows.filter(row => row.origin === 'custom').length, 71);
});

test('inventory refuses provenance drift in either the package or effective roster for all planes', () => {
  for (const [plane, key] of [['client', 'client'], ['worker', 'worker'], ['think', 'agent']]) {
    const name = `@dsh-base/${plane}-fork`, id = `${plane}:fork`;
    const manifest = { name, ...(plane === 'client' ? { dsh: { client: {} } } : {}), dshBase: {
      [key]: { id, origin: 'fork' }, forkOf: { package: '@deepseek-ai/dsh-test' }, reuse: { mode: 'fork' },
    } };
    const entry = { name, id, origin: 'fork', disabled: true };
    const data = { packages: [{ manifest }], rosters: { client: [], worker: [], think: [], [plane]: [entry] }, packs: [{ id: 'base', toggleable: 'none', planes: { [plane]: [name] } }] };
    assert.equal(projectOwnedPluginInventory(data).rows[0].origin, 'fork');
    entry.origin = 'custom';
    assert.throws(() => projectOwnedPluginInventory(data), /inventory composition origin must be fork/);
    entry.origin = 'fork';
    manifest.dshBase[key].origin = 'custom';
    assert.throws(() => projectOwnedPluginInventory(data), /origin must be fork/);
    manifest.dshBase[key].origin = 'fork';
    delete manifest.dshBase.forkOf;
    manifest.dshBase.reuse.mode = 'seam';
    assert.throws(() => projectOwnedPluginInventory(data), /origin fork requires recorded fork provenance/);
  }
});

test('site-wide settings and AI capabilities have distinct groups without changing management policy', () => {
  const { rows, bundles } = loadOwnedPluginInventory();
  const global = bundles.find(bundle => bundle.name === 'dsh-base:global');
  assert.equal(global.management, 'required', 'site editing permission does not grant permission to disable the group');
  assert.deepEqual(global.members.slice().sort(), [
    '@dsh-base/client-brand', '@dsh-base/client-global-settings', '@dsh-base/client-site-config',
    '@dsh-base/client-google-analytics',
    '@dsh-base/cloudflare-worker-seo', '@dsh-base/cloudflare-worker-public-pages', '@dsh-base/cloudflare-worker-site-config', '@dsh-base/cloudflare-worker-google-analytics',
    '@dsh-base/cloudflare-worker-sitemap', '@dsh-base/cloudflare-worker-robots', '@dsh-base/cloudflare-worker-manifest', '@dsh-base/cloudflare-worker-llms',
  ].sort());
  const chat = bundles.find(bundle => bundle.name === 'dsh-base:ai-chat-core');
  for (const name of ['@dsh-base/client-agent-preset', '@dsh-base/client-deepseek-provider', '@dsh-base/cloudflare-think-attachments', '@dsh-base/cloudflare-think-subagent', '@dsh-base/cloudflare-worker-session-export']) {
    assert.ok(chat.members.includes(name), `${name}: conversation capabilities belong to AI chat`);
  }
  const base = bundles.find(bundle => bundle.name === 'dsh-base:base');
  for (const name of ['@dsh-base/client-public-navigation', '@dsh-base/client-sidebar', '@dsh-base/client-workspace', '@dsh-base/client-entry-customization', '@dsh-base/client-locale-label', '@dsh-base/client-locale-url', '@dsh-base/client-route-address', '@dsh-base/cloudflare-worker-assets', '@dsh-base/cloudflare-worker-permissions', '@dsh-base/client-open-in-app-availability', '@dsh-base/cloudflare-worker-open-in-app-availability']) {
    assert.ok(base.members.includes(name), `${name}: infrastructure remains in core features`);
  }
  assert.equal(rows.find(row => row.entryId === 'client:site-config')?.declaredEnabled, true, 'the public site snapshot has an active brand consumer');
  const retiredMenu = rows.find(row => row.entryId === 'client:shell-extras');
  assert.equal(retiredMenu?.packId, 'base');
  assert.equal(retiredMenu?.declaredEnabled, false, 'global settings do not restore removed sidebar links');
  const subagent = rows.find(row => row.entryId === 'cloudflare:think:subagent');
  assert.equal(subagent?.declaredEnabled, true);
  assert.equal(subagent?.sourceAvailability, 'unavailable', 'regrouping does not claim a working subagent');
  assert.deepEqual(Object.fromEntries(bundles.map(bundle => [bundle.name, bundle.members.length])), {
    'dsh-base:ai-chat-core': 18, 'dsh-base:base': 21, 'dsh-base:global': 12, 'dsh-base:plugin-management': 4,
    '@dsh-base/client-gateway-provider': 2, '@dsh-base/cloudflare-think-fetch': 1, '@dsh-base/cloudflare-think-memory': 1,
    ...Object.fromEntries(['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard'].map(id => [`dsh-base:${id}`, 2])),
  });
  assert.deepEqual(Object.fromEntries(['client', 'worker', 'think'].map(plane => [plane, rows.filter(row => row.plane === plane).length])), { client: 48, worker: 32, think: 7 });
  for (const id of ['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard']) {
    const bundle = bundles.find(item => item.name === `dsh-base:${id}`);
    assert.equal(bundle.management, 'required', `${id}: client visibility never enables deployment management`);
    assert.equal(bundle.members.filter(name => name.startsWith('@dsh-base/client-')).length, 1);
    assert.equal(bundle.members.filter(name => name.startsWith('@dsh-base/cloudflare-worker-')).length, 1);
  }
});

test('new core plugins become visible without joining the owner-management allowlist', context => {
  const f = fixture(context);
  const result = loadOwnedPluginInventory(f.root);
  assert.equal(result.rows.length, 9);
  assert.equal(result.bundles.length, 4);
  const core = result.bundles.find(bundle => bundle.name === 'dsh-base:base');
  assert.equal(core.management, 'required');
  assert.deepEqual(new Set(core.members), new Set([f.client.name, f.retired.name, f.worker.name, f.provider.name, f.unavailable.name]));
  assert.equal(result.rows.find(row => row.name === f.provider.name).declaredEnabled, true, 'presetRow:false does not remove runtime components');
  assert.deepEqual(result.rows.find(row => row.name === f.retired.name), {
    plane: 'client', name: f.retired.name, entryId: f.retired.id, declaredEnabled: false,
    origin: 'custom', packId: 'base', management: 'required', unavailableReason: 'Retired in this deployment.',
  });
  const unavailable = result.rows.find(row => row.name === f.unavailable.name);
  assert.equal(unavailable.declaredEnabled, true, 'selected and available are independent facts');
  assert.equal(unavailable.sourceAvailability, 'unavailable');
  assert.equal(result.rows.some(row => row.name === '@dsh-base/support'), false);
  assert.equal(result.bundles.find(bundle => bundle.name === f.gatewayClient.name).members.length, 2);
  for (const name of [f.fetch.name, f.memory.name]) assert.deepEqual(result.bundles.find(bundle => bundle.name === name).members, [name]);
});

test('missing and duplicate grouping fail rather than silently hide runtime plugins', context => {
  const f = fixture(context);
  delete f.base.planes.worker;
  f.write('packs/base/pack.json', f.base);
  assert.throws(() => loadOwnedPluginInventory(f.root), /runtime plugin is missing from inventory grouping/u);
  f.base.planes.worker = ['@dsh-base/cloudflare-worker-absent'];
  f.write('packs/base/pack.json', f.base);
  assert.throws(() => loadOwnedPluginInventory(f.root), /inventory grouping references a missing production row/u);
  f.base.planes.worker = [f.worker.name];
  f.base.planes.client.push(f.gatewayClient.name);
  f.write('packs/base/pack.json', f.base);
  assert.throws(() => loadOwnedPluginInventory(f.root), /already in pack/u);
});

test('projection rejects an omitted production member and cross-plane or duplicate declarations', () => {
  const name = '@dsh-base/client-one';
  const manifest = { name, dsh: { client: {} }, dshBase: { client: { id: 'client:one' } } };
  const data = { packages: [{ manifest }], rosters: { client: [{ name, id: 'client:one' }], worker: [], think: [] }, packs: [{ id: 'base', toggleable: 'none', planes: { client: [name] } }] };
  assert.equal(projectOwnedPluginInventory(data).rows.length, 1);
  assert.throws(() => projectOwnedPluginInventory({ ...data, rosters: { ...data.rosters, client: [] } }), /inventory grouping references a missing production row/u);
  assert.throws(() => projectOwnedPluginInventory({ ...data, rosters: { ...data.rosters, client: [] }, packs: [] }), /declared runtime plugin is missing from production inventory/u);
  assert.throws(() => projectOwnedPluginInventory({ ...data, rosters: { ...data.rosters, client: [data.rosters.client[0], data.rosters.client[0]] } }), /duplicate owned production row/u);
  assert.throws(() => projectOwnedPluginInventory({ ...data, packages: [{ manifest: { ...manifest, dshBase: { ...manifest.dshBase, worker: { id: 'cloudflare:worker:one' } } } }] }), /multiple planes/u);
  assert.throws(() => projectOwnedPluginInventory({ ...data, packs: [{ id: 'base', toggleable: 'none', planes: { worker: [name] } }] }), /no matching worker runtime declaration/u);
  assert.throws(() => projectOwnedPluginInventory({ ...data, rosters: { ...data.rosters, client: [{ name, id: 'client:one', disabled: 'conditional' }] } }), /literal disabled state/u);
});

test('a source package without a runtime contract cannot enter a display bundle', context => {
  const f = fixture(context);
  f.base.planes.client.push('@dsh-base/support');
  f.write('packs/base/pack.json', f.base);
  assert.throws(() => loadOwnedPluginInventory(f.root), /inventory grouping references a missing production row/u);
});
