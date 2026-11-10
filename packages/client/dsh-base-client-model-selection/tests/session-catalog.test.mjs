/** Real Host + plugin-control + client fork: Session availability never shares an account cache. */
import '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const { transformSync } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'agents') return { url: 'data:text/javascript,export function getAgentByName(){throw new Error("Catalog tests cannot execute inference")}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.includes('/dsh-base-client-model-selection/src/') && url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' }).code };
    }
    return next(url, context);
  },
});
const { Context } = await import('@deepseek-ai/cordis');
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store');
const { ModelDirectoryResolver } = await import('../src/client/service.ts');
const { createSessionModelCatalog } = await import('../../dsh-base-client-session-adapter/src/client/session-model-catalog.ts');
const { SessionHostObject } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/do.ts');
const { PluginControl } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-control/src/control.ts');
const { createRemoteInvalidations } = await import('../../dsh-base-client-session-adapter/src/client/remote-events.ts');
const gateway = '@dsh-base/cloudflare-think-ai-gateway';
const selected = { provider: 'cloudflare-ai-gateway', model: 'cloudflare-ai-gateway/deepseek-flash' };
const until = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('catalog did not settle'); await new Promise(resolve => setTimeout(resolve, 2)); }
};

test('real Session catalogs isolate overrides, refresh both directions, fail closed and fence obsolete reads', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = { exec(query, ...bindings) { const rows = db.prepare(query).all(...bindings); return { toArray: () => rows }; } };
  let storage = new Map();
  let pendingTransaction = Promise.resolve();
  const control = new PluginControl({ storage: {
    get: async key => storage.get(key),
    put: async (key, value) => storage.set(key, value),
    transaction(callback) {
      const pending = pendingTransaction.then(async () => {
        const draft = structuredClone(storage);
        const result = await callback({ get: async key => draft.get(key), put: async (key, value) => draft.set(key, value) });
        storage = draft;
        return result;
      });
      pendingTransaction = pending.then(() => undefined, () => undefined);
      return pending;
    },
  } });
  let failed = false;
  const host = new SessionHostObject({ id: { name: 'owner:alice:default-v49' }, storage: { sql, transactionSync(callback) {
    db.exec('BEGIN');
    try { const value = callback(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  } } }, {
    PLATFORM_AI_ENABLED: 'true', AI_GATEWAY_ID: 'configured',
    PluginControl: { idFromName(name) { assert.equal(name, 'owner:alice:plugins'); return name; }, get() { return { fetch: request => failed ? Response.json({ error: 'offline' }, { status: 503 }) : control.fetch(request) }; } },
  });
  const change = async patch => {
    const response = await control.fetch(new Request('https://control/api/plugin-manager', { method: 'PUT', body: JSON.stringify({ name: gateway, ...patch }) }));
    assert.equal(response.status, 200);
  };
  const hostCall = async (method, params) => {
    const response = await host.fetch(new Request('https://host/api/session-host', { method: 'POST', body: JSON.stringify({ method, params }) }));
    const body = await response.json();
    if (!response.ok) throw new Error(`${body.error.code}: ${body.error.message}`);
    return body.result;
  };
  for (const sessionId of ['a', 'b']) await hostCall('create', { sessionId });
  await change({ sessionId: 'a', disabled: true });
  let account = { id: 'alice' }, delay;
  const reads = [];
  const seam = createSessionModelCatalog({ account: async () => account, locale: () => 'zh-CN', access: async sessionId => {
    reads.push(sessionId);
    const result = await hostCall('modelAccess', { sessionId });
    const pending = delay;
    delay = undefined;
    if (pending) { pending.started(); await pending.promise; }
    return result;
  } });
  const ctx = new Context();
  const events = createRemoteInvalidations();
  const cleanups = new Map(), bindings = new Map();
  for (const id of ['a', 'b']) {
    const projected = createSnapshotStore({ next: selected });
    const disposers = [];
    cleanups.set(id, disposers);
    bindings.set(id, { session: { projections: { faceOf: () => projected }, getSnapshot: () => ({ blank: false }) }, scope: { effect(factory) { disposers.push(factory()); } } });
  }
  let mutations = 0, accountCatalogReads = 0;
  const remote = { $on: events.on, session: {
    modelCatalog: async () => { accountCatalogReads++; throw new Error('Session selection must not use account catalog'); },
    selectModel: async input => { mutations++; return { ok: true, value: await hostCall('selectModel', input) }; },
  } };
  ctx.provide('remote', remote);
  ctx.provide('sessions', { scope: id => bindings.get(id)?.scope, binding: id => bindings.get(id), subagentAddress: () => undefined });
  ctx.provide('sessionModelCatalog', seam);
  const resolver = new ModelDirectoryResolver(ctx);
  const a = resolver.directoryFor('a'), b = resolver.directoryFor('b');
  assert.equal(resolver.directoryFor('a'), a, 'composer and /model share one Session directory');
  await Promise.all([a.load(), b.load()]);
  const model = directory => directory.store.getSnapshot().groups.find(group => group.id === selected.provider).models[0];
  assert.equal(model(a).unavailable, true);
  assert.match(model(a).unavailableReason, /账号或会话/);
  assert.equal(a.store.getSnapshot().routable, false);
  assert.equal(model(b).unavailable, undefined);
  assert.equal(b.store.getSnapshot().routable, true);
  assert.equal((await a.select(selected)).ok, false);
  assert.equal(mutations, 0, 'disabled rows reject before Host selection RPC');
  assert.equal((await b.select(selected)).ok, true);
  assert.equal(mutations, 1);
  assert.equal(accountCatalogReads, 0);
  assert.deepEqual(new Set(reads), new Set(['a', 'b']));

  await change({ disabled: true });
  await change({ sessionId: 'a', disabled: false });
  events.emit('llm/adapters-updated');
  assert.equal(a.store.getSnapshot().routable, null, 'invalidated availability is withdrawn while loading');
  assert.equal((await b.select(selected)).ok, false, 'old enabled data cannot authorize a stale menu row');
  await until(() => a.store.getSnapshot().status === 'ready' && b.store.getSnapshot().status === 'ready');
  assert.equal(model(a).unavailable, undefined, 'Session enable overrides owner disable');
  assert.equal(model(b).unavailable, true, 'other Session inherits owner disable');
  assert.equal((await hostCall('modelAccess')).providers[selected.provider].available, false, 'account directory remains owner scoped');

  failed = true;
  events.emit('settings/document-updated');
  await until(() => a.store.getSnapshot().status === 'error' && b.store.getSnapshot().status === 'error');
  assert.deepEqual(a.store.getSnapshot().groups, []);
  assert.equal(a.store.getSnapshot().routable, null);
  assert.match(a.store.getSnapshot().error, /selection-unavailable/);
  assert.equal((await a.select(selected)).ok, false);
  assert.equal(mutations, 1, 'a failed read never restores an enabled account fallback');
  failed = false;
  events.emit('credentials/record-updated');
  await until(() => a.store.getSnapshot().status === 'ready' && b.store.getSnapshot().status === 'ready');

  // Let an older enabled result arrive after a newer disabled result.
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  delay = { promise: new Promise(resolve => { release = resolve; }), started };
  events.emit('llm/models-updated');
  await waiting;
  await change({ sessionId: 'a', disabled: true });
  events.emit('llm/adapters-updated');
  await until(() => a.store.getSnapshot().status === 'ready');
  assert.equal(model(a).unavailable, true);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(model(a).unavailable, true, 'late old enabled snapshot cannot overwrite the new generation');

  await change({ sessionId: 'a', disabled: false });
  await a.load();
  assert.equal(model(a).unavailable, undefined, 'opening a retained Session menu re-reads out-of-tab changes even without an event');

  for (const dispose of cleanups.get('a')) dispose();
  const before = reads.filter(id => id === 'a').length;
  events.emit('llm/adapters-updated');
  await until(() => b.store.getSnapshot().status === 'ready');
  assert.equal(reads.filter(id => id === 'a').length, before, 'released Session bindings stop refreshing');
  assert.notEqual(resolver.directoryFor('a'), a, 'returning to a released Session loads a new binding directory');
  await resolver.directoryFor('a').load();
  for (const disposers of cleanups.values()) for (const dispose of disposers) dispose();
  account = null;
  const noReads = reads.length;
  await assert.rejects(seam.load('a'), /auth\/required/);
  assert.equal(reads.length, noReads, 'anonymous requests never enter the private Host transport');
});

test('catalog seam preserves auth/Host failures, exact identity and all supported localized disabled explanations', async () => {
  const error = new Error('auth read failed');
  await assert.rejects(createSessionModelCatalog({ account: async () => { throw error; }, access: () => { throw new Error('private request'); } }).load('s'), error);
  const hostError = new Error('selection unavailable');
  await assert.rejects(createSessionModelCatalog({ account: async () => ({ id: 'alice' }), access: async () => { throw hostError; } }).load('s'), hostError);
  const reasons = new Set();
  for (const locale of ['en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt_BR']) {
    const catalog = await createSessionModelCatalog({ account: async () => ({ id: 'alice' }), locale: () => locale, access: async sessionId => {
      assert.equal(sessionId, 'exact/session:id');
      return { providers: { [selected.provider]: { available: false, catalog: [] } } };
    } }).load('exact/session:id');
    const rows = catalog.groups.find(group => group.id === selected.provider).models;
    assert.equal(rows.length, 2, 'unavailable official controls remain present');
    assert.equal(rows[0].unavailable, true);
    reasons.add(rows[0].unavailableReason);
  }
  assert.equal(reasons.size, 8);
  const catalog = await createSessionModelCatalog({ account: async () => ({}), access: async () => ({ providers: { [selected.provider]: { available: false, catalog: [], unavailableReason: 'Authoritative Host explanation' } } }) }).load('s');
  assert.equal(catalog.groups.find(group => group.id === selected.provider).models[0].unavailableReason, 'Authoritative Host explanation');
});
