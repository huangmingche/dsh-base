/** Actual pinned Connection + Gateway + Typert + RemoteAccess over the Worker mux. */
import '../../../../packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-api-remote-access/remote') return { url: new URL('../../../../.artifacts/typecheck/remote/dsh-api-remote-access/remote.js', import.meta.url).href, shortCircuit: true };
  if (specifier === 'zod') return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
  return next(specifier, context);
} });
const { Context } = await import('@deepseek-ai/cordis');
const { installConnection } = await import('@deepseek-ai/dsh-client-connection/client');
const Registry = await import('@deepseek-ai/dsh-typert-registry/client');
const Access = await import('@deepseek-ai/dsh-api-remote-access/client');
const { createHostRemoteStream } = await import('../../dsh-base-client-session-host/src/remote-stream.ts');
const { installRemoteMount } = await import('../src/client/remote-mount.ts');
const { RemoteStreamMux } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-wire-rpc/src/mux.ts');
const { registerRemoteAccessStreamEndpoint } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-access.ts');
const until = async (predicate, label) => { const deadline = Date.now() + 3000; while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 2)); } };
class Socket extends EventTarget {
  readyState = 0;
  sent = [];
  peer;
  emit(type, values = {}) { const event = Object.assign(new Event(type), values); this.dispatchEvent(event); }
  send(text) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(text)); queueMicrotask(() => { if (this.peer.readyState === 1) this.peer.emit('message', { data: text }); }); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = this.peer.readyState = 3; this.emit('close', { code, reason }); this.peer.emit('close', { code, reason }); }
}
let releaseHost;
const readyHost = new Promise(resolve => { releaseHost = resolve; });
let hostReads = 0, streamsOpened = 0, streamsAborted = 0;
const observedOwners = [];
const env = { SESSION_HOST: { idFromName(name) { observedOwners.push(name); return name; }, get() { return { async fetch(request) {
  if (request.url.endsWith('/migrate/status')) return Response.json({ migrated: true });
  assert.deepEqual(await request.json(), { method: 'runtimeInfo', params: {} }); hostReads++;
  await readyHost;
  return Response.json({ result: { versionId: 'verified-owner-host' } });
} }; } } };
const handlers = new Map();
registerRemoteAccessStreamEndpoint({ register(name, handler) { handlers.set(name, handler); return () => handlers.delete(name); } });
const sockets = [];
function createWebSocket(url) {
  assert.equal(new URL(url).pathname, '/api/remote.mux');
  const browser = new Socket(), server = new Socket(); browser.peer = server; server.peer = browser; sockets.push(browser);
  new RemoteStreamMux(async (endpoint, payload, invocation) => {
    assert.equal(endpoint, 'remoteAccess/follow'); streamsOpened++;
    invocation.request.signal.addEventListener('abort', () => { streamsAborted++; }, { once: true });
    return handlers.get(endpoint)(payload, invocation);
  }).handle(server, { request: new Request('https://owner.test/api/remote.mux'), env, user: { id: 'owner-from-auth' }, method: '', rpcId: '' });
  queueMicrotask(() => { browser.readyState = server.readyState = 1; browser.emit('open'); });
  return browser;
}
const ctx = new Context(); let accessSource;
const provider = ctx.plugin({ apply(scope) {
  scope.provide('slots', { provideRoot(value) { accessSource = value.keyedHooks.remoteAccess('schedule/catalog'); } });
  Registry.apply(scope);
  installConnection(scope, { interactions: 'answer', location: new URL('https://owner.test/'), recovery: { backoffBaseMs: 1, backoffMaxMs: 5 }, transport: { streamBaseUrl: 'https://owner.test', createWebSocket } });
} }); await provider.await();
const connection = ctx.get('connection');
const bridge = ctx.plugin({ inject: ['connection', 'typert'], apply: scope => installRemoteMount(scope, { $stream: options => createHostRemoteStream(connection, options), existingHostNamespace: { preserved: true } }) });
await bridge.await();
assert.equal(ctx.get('remote').existingHostNamespace.preserved, true);
const access = ctx.plugin(Access); await access.await();
assert.equal(accessSource.getSnapshot(), false, 'no owner permission before authenticated Host baseline');
await until(() => connection.generation.getSnapshot() !== undefined && hostReads === 1, 'actual $events readiness and Host call');
const firstGeneration = connection.generation.getSnapshot().id;
assert.equal(connection.state.getSnapshot(), 'connected');
assert.equal(sockets.length, 1, 'one official Gateway owns the physical lifecycle');
assert.ok(sockets[0].sent.some(frame => frame.endpoint === '$events'));
assert.ok(sockets[0].sent.some(frame => frame.endpoint === 'remoteAccess/follow' && JSON.stringify(frame.payload) === '{"args":{}}'));
assert.throws(() => connection.start({}), /already owned/, 'there is exactly one Connection generation owner');
const stages = ['overlay', 'right-pane', 'tab-title', 'main-page', 'sidebar-entry', 'turn-card', 'session-header', 'row-mark', 'row-hover'];
const log = [];
const consumer = ctx.plugin({ inject: ['remoteAccess'], apply(scope) { scope.remoteAccess.whenAccess('schedule/catalog', function* () { for (const stage of stages) { log.push(`add:${stage}`); yield () => log.push(`remove:${stage}`); } }); } });
await consumer.await(); assert.deepEqual(log, []);
releaseHost();
await until(() => accessSource.getSnapshot(), 'owner baseline');
assert.deepEqual(log, stages.map(stage => `add:${stage}`));
assert.ok(observedOwners.every(owner => owner.startsWith('owner:owner-from-auth:')));
assert.equal(typeof ctx.get('remote.remoteAccess').follow, 'function');

// Physical loss is recovered by real official Connection/$events, not by a
// fake generation store. Permission stays stable; generated follow is renewed.
sockets[0].close(1006, 'simulated platform load shedding');
assert.equal(accessSource.getSnapshot(), true);
await until(() => connection.generation.getSnapshot()?.id > firstGeneration && hostReads >= 2 && streamsOpened >= 2, 'official reconnect and new owner baseline');
assert.equal(accessSource.getSnapshot(), true);
assert.deepEqual(log, stages.map(stage => `add:${stage}`), 'recovery must not duplicate guarded effects');
assert.equal(connection.state.getSnapshot(), 'connected');
await consumer.dispose();
assert.deepEqual(log.slice(stages.length), [...stages].reverse().map(stage => `remove:${stage}`));
await consumer.dispose(); assert.equal(log.length, stages.length * 2);
const rolledBack = [];
assert.throws(() => ctx.get('remoteAccess').whenAccess('schedule/catalog', function* () { yield () => rolledBack.push('first'); yield () => rolledBack.push('second'); throw new Error('third failed'); }), /third failed/);
await until(() => rolledBack.length === 2, 'rollback'); assert.deepEqual(rolledBack, ['second', 'first']);

await access.dispose();
await until(() => ctx.get('remote.remoteAccess') === undefined && streamsAborted >= 2, 'caller-owned generated namespace teardown');
assert.equal(connection.state.getSnapshot(), 'connected', 'consumer teardown leaves Gateway generation running');
const again = ctx.plugin(Access); await again.await();
await until(() => accessSource.getSnapshot() && hostReads >= 3, 'fresh mount gets its own baseline');
await again.dispose();
await bridge.dispose();
assert.equal(connection.generation.getSnapshot(), undefined);
assert.ok(sockets.every(socket => socket.readyState === 3));
await provider.dispose();
console.log('RemoteAccess: unchanged official plugin + actual Connection/Gateway/Typert/Worker mux, authenticated baseline, full iterable/rollback/caller teardown, 1006 recovery and remount passed');
