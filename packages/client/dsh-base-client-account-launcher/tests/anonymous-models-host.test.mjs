import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import Schema from '@deepseek-ai/schemastery';

// This test uses the repository's official-runtime-hook to resolve the actual
// pinned store/selector implementation. Private services are never substituted.
const shared = new URL('../../../boot/dsh-base-model-declarations/src/index.ts', import.meta.url);
const network = [];
const privateRuntimeImports = [];
let importingAnonymousHost = true;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@dsh-base/model-declarations') return { url: shared.href, shortCircuit: true };
    if (importingAnonymousHost && (
      specifier.startsWith('@deepseek-ai/dsh-api-remotes')
      || specifier.startsWith('@dsh-base/cloudflare-')
      || specifier === '@dsh-base/client-deepseek-provider/client'
      || /client-deepseek-provider\/src\/client\/(?:store|operations)\.ts$/u.test(specifier)
    )) {
      privateRuntimeImports.push(specifier);
      throw new Error(`The anonymous declaration Host must not construct a private Remote controller: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
globalThis.fetch = async (...args) => {
  network.push({ kind: 'fetch', args });
  throw new Error('Anonymous declaration tests prohibit all network requests');
};
globalThis.WebSocket = class {
  constructor(...args) {
    network.push({ kind: 'websocket', args });
    throw new Error('Anonymous declaration tests prohibit all WebSocket connections');
  }
};
after(() => {
  globalThis.fetch = originalFetch;
  if (originalWebSocket === undefined) delete globalThis.WebSocket;
  else globalThis.WebSocket = originalWebSocket;
  assert.deepEqual(network, [], 'imports, reads and direct operations must remain offline');
  assert.deepEqual(privateRuntimeImports, [], 'the real private controller is never imported or constructed');
});

const { createAnonymousModelsHost, publicModelNamespaces } = await import('../src/client/anonymous-models-host.ts');
importingAnonymousHost = false;
const { modelsCopy, SUPPORTED_LOCALES } = await import('../src/client/locales.ts');
const { DEEPSEEK_SETTINGS_SCHEMA, DEEPSEEK_SETTINGS_DEFAULTS, DEPLOYMENT_MODELS } = await import(shared.href);
const { settingsViewsFromSnapshot } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-settings.ts');
const { buildFallbackModelCatalog } = await import('../../dsh-base-client-session-adapter/src/client/model-catalog-fallback.ts');
importingAnonymousHost = true;

const declarations = () => DEPLOYMENT_MODELS.map(({ id, label, contextWindow }) => ({ id, name: label, contextWindow }));
const cloneSnapshot = state => structuredClone(state);

test('the anonymous Host exposes a ready read-only declaration snapshot with no owner or credential facts', () => {
  const { controller, useSnapshot } = createAnonymousModelsHost(modelsCopy('en'));
  const state = controller.store.getSnapshot();
  assert.equal(typeof useSnapshot, 'function', 'the actual official selector hook is bound');
  assert.equal(state.status, 'ready');
  assert.equal(state.writable, false);
  assert.equal(state.error, null);
  assert.equal(state.credentialError, null, 'no credential query has failed because none was attempted');
  assert.deepEqual(state.rows.map(row => [row.entry.provider, row.entry.settingsNs]), [
    ['deepseek-official', 'llm-deepseek'], ['cloudflare-ai-gateway', 'llm-cloudflare-gateway'],
  ]);
  for (const row of state.rows) {
    assert.equal(row.configured, false, `${row.entry.provider}: visibility does not require owner configuration`);
    assert.equal(row.removable, false);
    assert.equal(row.entry.active, false);
    assert.equal(row.entry.error, undefined);
    assert.equal(row.accountAvailable, undefined);
    assert.equal(row.apiKeyEnv, undefined);
    assert.equal(row.credential, undefined);
    assert.equal(row.derivedCredential, undefined);
    assert.equal(row.credentialChecks, undefined);
  }
  assert.deepEqual([...state.namespaces.keys()], ['llm-deepseek', 'llm-cloudflare-gateway']);
  for (const namespace of state.namespaces.values()) {
    assert.deepEqual(namespace.user, {}, `${namespace.ns}: no persisted owner layer`);
    assert.deepEqual(namespace.secrets, [], `${namespace.ns}: no credential descriptions`);
    assert.equal(namespace.revision, 0, `${namespace.ns}: a local declaration revision only`);
  }
  assert.deepEqual(network, []);
});

test('public namespace defaults and schemas match the shared source and Worker default projection without private overrides', () => {
  const publicNamespaces = publicModelNamespaces();
  const deepseek = publicNamespaces.get('llm-deepseek');
  const workerDefaults = settingsViewsFromSnapshot({}).namespaces.find(row => row.ns === 'llm-deepseek');
  assert.ok(deepseek);
  assert.ok(workerDefaults);
  assert.deepEqual(deepseek.schema, DEEPSEEK_SETTINGS_SCHEMA);
  assert.deepEqual(deepseek.value, DEEPSEEK_SETTINGS_DEFAULTS);
  assert.deepEqual(deepseek.base, DEEPSEEK_SETTINGS_DEFAULTS);
  assert.deepEqual(deepseek.schema, workerDefaults.schema);
  // The official provider editor validates the whole draft even when applying
  // only a credential change. Exercise its actual Schemastery consumer.
  const validate = new Schema(structuredClone(workerDefaults.schema));
  assert.doesNotThrow(() => validate({}));
  assert.doesNotThrow(() => validate(structuredClone(workerDefaults.base)));
  assert.doesNotThrow(() => validate({ models: [{ id: 'owner-model' }] }));
  assert.throws(() => validate({ models: [{ id: 3 }] }), /models\[0\]\.id.*expected string/u);
  assert.deepEqual(deepseek.value, workerDefaults.value);
  assert.deepEqual(deepseek.base, workerDefaults.base);
  assert.deepEqual(deepseek.value.models, declarations());
  assert.deepEqual(deepseek.schema.dict.models.meta.default, declarations());
  assert.notEqual(deepseek.value, DEEPSEEK_SETTINGS_DEFAULTS);
  assert.notEqual(deepseek.base, deepseek.value);
  assert.notEqual(deepseek.schema, DEEPSEEK_SETTINGS_SCHEMA);
  assert.notEqual(deepseek.value.models, DEEPSEEK_SETTINGS_DEFAULTS.models);

  const owner = { apiKeyEnv: 'OWNER_ONLY_REFERENCE', baseURL: 'https://owner-only.invalid/v1', models: [{ id: 'owner-only-model' }] };
  const privateView = settingsViewsFromSnapshot({ revision: 19, values: { 'llm-deepseek': owner } })
    .namespaces.find(row => row.ns === 'llm-deepseek');
  assert.deepEqual(privateView.user, owner, 'the real Worker projection distinguishes owner state');
  assert.equal(privateView.revision, 19);
  assert.deepEqual(deepseek.user, {});
  assert.deepEqual(deepseek.value, DEEPSEEK_SETTINGS_DEFAULTS);
  assert.doesNotMatch(JSON.stringify([...publicNamespaces]), /OWNER_ONLY_REFERENCE|owner-only/u);
  assert.deepEqual(publicModelNamespaces(), publicNamespaces, 'private projection does not alter later public declarations');
});

test('every declared fallback provider uses the same model identities as public schemas and Worker defaults', () => {
  const catalog = buildFallbackModelCatalog({});
  const publicModels = publicModelNamespaces().get('llm-deepseek').value.models;
  assert.deepEqual(catalog.groups.map(group => group.id), ['deepseek-official', 'cloudflare-ai-gateway']);
  assert.deepEqual(catalog.routableProviders, [], 'public catalog declarations grant no route');
  for (const group of catalog.groups) {
    assert.deepEqual(group.models.map(({ id, name }) => ({ id, name })),
      publicModels.map(({ id, name }) => ({ id: `${group.id}/${id}`, name })));
    assert.ok(group.models.every(model => model.unavailable === true));
  }
});

test('direct credential and settings operations refuse locally in every locale without changing the snapshot', async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = modelsCopy(locale);
    const { controller, operations } = createAnonymousModelsHost(copy);
    const original = controller.store.getSnapshot();
    const before = cloneSnapshot(original);
    let notifications = 0;
    const unsubscribe = controller.store.subscribe(() => { notifications += 1; });
    try {
      assert.equal(await operations.storeCredential('DEEPSEEK_OFFICIAL_API_KEY', 'test-only-private-key'), copy.signInRequired);
      assert.equal(await operations.removeCredential('DEEPSEEK_OFFICIAL_API_KEY'), copy.signInRequired);
      for (const ns of ['llm-deepseek', 'llm-cloudflare-gateway', 'llm-pi-ai', 'private-namespace']) {
        assert.deepEqual(await operations.writeSettings(ns, [{ op: 'set', path: ['baseURL'], value: 'https://owner-only.invalid/v1' }], 0),
          { kind: 'refused', message: copy.signInRequired }, `${locale}/${ns}`);
      }
      await controller.load();
      await controller.load();
      await Promise.resolve();
      assert.equal(controller.store.getSnapshot(), original);
      assert.deepEqual(controller.store.getSnapshot(), before);
      assert.equal(notifications, 0);
    } finally { unsubscribe(); }
  }
  assert.deepEqual(network, []);
});

test('model discovery returns only local DeepSeek declarations and refuses other providers or entered credentials', async () => {
  const copy = modelsCopy('en');
  const { controller, operations } = createAnonymousModelsHost(copy);
  const original = controller.store.getSnapshot();
  const before = cloneSnapshot(original);
  const expected = { kind: 'found', models: declarations() };
  assert.deepEqual(await operations.discoverModels('llm-deepseek', { provider: 'deepseek-official' }), expected);
  assert.deepEqual(await operations.discoverModels('llm-deepseek', {
    provider: 'deepseek-official', baseURL: 'https://arbitrary-host.invalid/private-endpoint',
  }), expected, 'public declarations never interrogate the supplied endpoint');
  for (const [namespace, request] of [
    ['llm-cloudflare-gateway', { provider: 'cloudflare-ai-gateway' }],
    ['llm-pi-ai', { provider: 'deepseek-official' }],
    ['llm-deepseek', { provider: 'other-provider' }],
    ['llm-deepseek', {}],
    ['llm-deepseek', { provider: 'deepseek-official', apiKey: 'test-only-private-key' }],
  ]) assert.deepEqual(await operations.discoverModels(namespace, request), { kind: 'refused', message: copy.signInRequired });
  await controller.load();
  assert.equal(controller.store.getSnapshot(), original);
  assert.deepEqual(controller.store.getSnapshot(), before);
  assert.deepEqual(network, []);
});
