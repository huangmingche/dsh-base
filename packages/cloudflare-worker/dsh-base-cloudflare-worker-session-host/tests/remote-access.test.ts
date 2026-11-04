/** Authenticated owner baseline, actual Host routing, cancellation and reconnect. */
import assert from 'node:assert/strict';
import { registerRemoteAccessStreamEndpoint } from '../src/remote-access.ts';
import type { WireStreamHandler, WireStreamInvocation } from '../../dsh-base-cloudflare-worker-wire-rpc/src/mux.ts';
let handler!: WireStreamHandler;
let removed = false;
const dispose = registerRemoteAccessStreamEndpoint({ register(name, fn) { assert.equal(name, 'remoteAccess/follow'); handler = fn; return () => { removed = true; }; } });
const owners: string[] = [];
const requests: unknown[] = [];
const env = { SESSION_HOST: { idFromName(name: string) { owners.push(name); return name; }, get() { return { async fetch(request: Request) {
  if (request.url.endsWith('/migrate/status')) return Response.json({ migrated: true });
  requests.push(await request.json());
  return Response.json({ result: { versionId: 'actual-host-test' } });
} }; } } };
const invocation = (signal: AbortSignal, id = 'authenticated-owner'): WireStreamInvocation => ({ request: new Request('https://worker.test/api/remote.mux', { signal }), env, user: { id }, method: 'remoteAccess/follow', rpcId: 'access' });
for (let generation = 0; generation < 2; generation++) {
  const abort = new AbortController();
  const source = await handler({ args: {} }, invocation(abort.signal));
  const iterator = source[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: { type: 'baseline', owner: true }, done: false });
  let settled = false;
  const waiting = iterator.next().then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(settled, false, 'owner stream remains open without invented grants');
  abort.abort();
  assert.equal((await waiting).done, true);
}
assert.equal(requests.length, 2);
assert.ok(requests.every(value => JSON.stringify(value) === JSON.stringify({ method: 'runtimeInfo', params: {} })));
assert.ok(owners.every(name => name.startsWith('owner:authenticated-owner:')));
assert.throws(() => handler({ args: { owner: 'another-user' } }, invocation(new AbortController().signal)), error => (error as { code: string }).code === 'gateway/bad-request');
const unauthenticated = await handler({ args: {} }, invocation(new AbortController().signal, ''));
await assert.rejects(unauthenticated[Symbol.asyncIterator]().next(), error => (error as { code: string }).code === 'remote-access/denied');
assert.equal(requests.length, 2, 'unauthenticated invocation never reaches a Host');
const unavailable = await handler({ args: {} }, { ...invocation(new AbortController().signal), env: {} });
await assert.rejects(unavailable[Symbol.asyncIterator]().next());
const abort = new AbortController(); abort.abort();
const cancelled = await handler({ args: {} }, invocation(abort.signal));
assert.equal((await cancelled[Symbol.asyncIterator]().next()).done, true);
dispose(); assert.equal(removed, true);
console.log('RemoteAccess Host: authenticated owner routing, no client identity/grants, Host failure, cancellation and reconnect passed');
