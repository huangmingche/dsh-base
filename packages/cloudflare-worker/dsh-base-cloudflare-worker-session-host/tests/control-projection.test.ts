/** Real SQLite projection revisions crossing the actual official control stream. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { assistantStepMessageSource } from '@dsh-base/session-wire';
import { RemoteStreamMux } from '../../dsh-base-cloudflare-worker-wire-rpc/src/mux.ts';
import { openWireStream, wireFollowPayload } from '../../../boot/dsh-base-client-session-host/src/wire-stream.ts';
import { SessionHost } from '../src/host.ts';
import { SqliteSessionHostStorage } from '../src/sqlite-storage.ts';
import { HostChangeFeed, observeHostWrites, invalidationResponse } from '../src/change-feed.ts';
import { dispatchSessionHost } from '../src/service.ts';
import { registerSessionStreamEndpoints } from '../src/remote-streams.ts';
import { registerSessionRemoteEndpoints } from '../src/remote.ts';
import { toOfficialProjections } from '../src/remote-mapping.ts';

const db = new DatabaseSync(':memory:');
const feed = new HostChangeFeed();
const sql = observeHostWrites({
  exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; },
  transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
}, feed);
const storage = new SqliteSessionHostStorage(sql);
const host = new SessionHost(storage, [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }], undefined, undefined, undefined, undefined, undefined, undefined, feed);
await host.create({ sessionId: 'control-source' });
for (let i = 0; i < 50; i++) await host.create({ sessionId: `later-session-${i}` });
await storage.putProjections('later-session-9', { customProjection: { enabled: true }, _dshBaseInternal: 'private' });
const methods = new Map<string, any>();
registerSessionStreamEndpoints({ register(name: string, handler: unknown) { methods.set(name, handler); return () => {}; } } as never);
const abort = new AbortController();
const hostReads: string[] = [];
const migrationChecks: string[] = [];
const invoke = { user: { id: 'control-owner' }, request: new Request('https://host/api/remote.mux', { signal: abort.signal }), env: { SESSION_HOST: {
  idFromName(name: string) { return name; },
  get(owner: string) { return { async fetch(input: string | Request) {
    const request = typeof input === 'string' ? new Request(input) : input;
    if (new URL(request.url).pathname.endsWith('/live-push')) return Response.json({ live: null });
    if (request.url.endsWith('/migrate/status')) { migrationChecks.push(owner); return Response.json({ migrated: true }); }
    if (request.url.endsWith('/changes')) return invalidationResponse(feed, request.signal);
    const body = await request.json();
    assert.ok(owner.startsWith('owner:control-owner:'), 'reads route to the authenticated owner');
    hostReads.push(body.method);
    return Response.json(await dispatchSessionHost(host, body));
  } }; },
} } };
const iterator = methods.get('session/control')({ args: {} }, invoke)[Symbol.asyncIterator]();
const baseline = (await iterator.next()).value;
assert.equal(baseline.type, 'baseline');
assert.equal(Object.keys(baseline.value.projections).length, 51, 'control baseline includes every Host list page');
assert.ok(hostReads.length <= 2, `51 sessions must take at most two Host page requests; got ${hostReads.length}`);
assert.ok(migrationChecks.length <= 3, 'migration checks are bounded by projection pages and the change stream');
const lastPage = baseline.value.projections['later-session-9'];
assert.deepEqual(lastPage, toOfficialProjections(await host.projections({ sessionId: 'later-session-9' })));
assert.deepEqual(lastPage.values.customProjection, { enabled: true });
assert.equal(Object.hasOwn(lastPage.values, '_dshBaseInternal'), false);
const original = baseline.value.projections['control-source'];
assert.ok(original.asOfSeq >= 1);
hostReads.length = 0;
const pending = iterator.next();
await host.selectModel({ sessionId: 'control-source', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' });
const changed = (await pending).value;
assert.equal(changed.type, 'projection');
assert.ok(hostReads.length <= 2, 'a cross-tab change also uses bounded Host calls');
assert.ok(changed.seq > original.asOfSeq, 'metadata advances even when chat remains empty');
assert.equal(changed.changes.find((row: any) => row.key === 'modelSelection').val.next.reasoningEffort, 'max');
assert.ok(!changed.changes.some((row: any) => row.key.startsWith('_dshBase')), 'storage internals do not enter the official projection map');
const next = iterator.next();
await host.rename({ sessionId: 'control-source', title: 'Other tab changed the title' });
const renamed = (await next).value;
assert.ok(renamed.seq > changed.seq);
assert.equal(renamed.changes.find((row: any) => row.key === 'title').val, 'Other tab changed the title');
const laterDelta = iterator.next();
await host.rename({ sessionId: 'later-session-9', title: 'Cross-page change' });
const later = (await laterDelta).value;
assert.equal(later.sessionId, 'later-session-9');
assert.ok(later.seq > lastPage.asOfSeq);
assert.equal(later.changes.find((row: any) => row.key === 'title').val, 'Cross-page change');
const waiting = iterator.next(); abort.abort(); assert.equal((await waiting).done, true);
await iterator.return?.();
// The RC4 conversation prepends earlier records using the cursor from the follow opening.
await host.syncAgentMessages({ sessionId: 'control-source', messages: [
  { id: 'input-1', role: 'user', parts: [{ type: 'text', text: 'First' }] },
  { id: 'answer-1', role: 'assistant', parts: [{ type: 'text', text: 'Reply' }] },
  { id: 'input-2', role: 'user', parts: [{ type: 'text', text: 'Second' }] },
] });
registerSessionRemoteEndpoints({ register(name: string, handler: unknown) { methods.set(name, handler); return () => {}; } } as never);
const followAbort = new AbortController();
const follower = { ...invoke, request: new Request('https://host/api/remote.mux', { signal: followAbort.signal }) };
const address = { kind: 'session', sessionId: 'control-source' };
const follow = methods.get('session/follow')({ args: { request: { address, maxMessages: 1 } } }, follower)[Symbol.asyncIterator]();
const { value: opening } = await follow.next();
assert.equal(opening.hasMore, true);
assert.equal(opening.records.at(-1).event.seq, opening.cursor);
const read = (window: object) => methods.get('session/page')({ args: { request: { address, throughSeq: opening.cursor, ...window } } }, follower);
const earlier = await read({ beforeSeq: opening.records[0].event.seq });
const complete = await read({});
assert.equal(earlier.hasMore, false);
assert.deepEqual([...earlier.records, ...opening.records].map(entry => entry.event.seq), complete.records.map((entry: any) => entry.event.seq),
  'pages reassemble the full ordered journal without missing or duplicated events');
followAbort.abort();
await follow.return?.();
// Exercise the RC4 controller's actual opening request through both carrier ends.
// A socket pair in memory keeps the Worker and browser JSON frame codecs active.
const clientSocket = new EventTarget();
const workerSocket = new EventTarget();
const sendTo = (target: EventTarget, text: string) => target.dispatchEvent(new MessageEvent('message', { data: text }));
const closeSockets = () => {
  clientSocket.dispatchEvent(new Event('close'));
  workerSocket.dispatchEvent(new Event('close'));
};
const browserSocket = {
  addEventListener: clientSocket.addEventListener.bind(clientSocket),
  send: (text: string) => sendTo(workerSocket, text), close: closeSockets,
};
const mux = new RemoteStreamMux((endpoint, payload, context) => methods.get(endpoint)(payload, context));
mux.handle({
  addEventListener: workerSocket.addEventListener.bind(workerSocket),
  send: (text: string) => sendTo(clientSocket, text), close: closeSockets,
}, { ...invoke, request: new Request('https://host/api/remote.mux'), method: '', rpcId: '' });

const longAddress = { kind: 'session', sessionId: 'long-history' };
await host.create({ sessionId: longAddress.sessionId });
const messages = Array.from({ length: 60 }, (_, index) => [
  { id: `question-${index}`, role: 'user', parts: [{ type: 'text', text: `Question ${index}` }] },
  { id: `reply-${index}`, role: 'assistant', parts: [{ type: 'text', text: `Reply ${index}` }] },
]).flat();
await host.syncAgentMessages({ sessionId: longAddress.sessionId, messages });
const controller = new AbortController();
const historyWindow = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } };
const stream = openWireStream<any>({
  baseUrl: 'https://host', endpoint: 'session/follow', signal: controller.signal,
  payload: wireFollowPayload({ address: longAddress, ...historyWindow }), socketFactory: () => browserSocket,
})[Symbol.asyncIterator]();
const firstRead = stream.next();
clientSocket.dispatchEvent(new Event('open'));
const snapshot = (await firstRead).value;
assert.equal(snapshot.type, 'snapshot');
assert.equal(snapshot.hasMore, true);
const pages = [snapshot.records];
let hasMore = snapshot.hasMore;
while (hasMore) {
  const beforeSeq = pages[0][0].event.seq;
  const page = await methods.get('session/page')({ args: { request: {
    address: longAddress, ...historyWindow, beforeSeq, throughSeq: snapshot.cursor,
  } } }, { ...invoke, request: new Request('https://host/api/rpc') });
  assert.ok(page.records.length > 0 && page.records[0].event.seq < beforeSeq);
  pages.unshift(page.records);
  hasMore = page.hasMore;
}
assert.equal(pages.length, 3, '120 messages require three turn-aligned pages');
const assembled = pages.flat();
assert.deepEqual(assembled.map(row => row.event.seq), Array.from({ length: snapshot.cursor }, (_, i) => i + 1));
const messageIds = assembled.flatMap(({ event }) => {
  if (event.type === 'user/message') return [event.data.id];
  if (event.type === 'assistant/message') return [assistantStepMessageSource(event.data.message.id)?.messageId];
  return [];
});
assert.deepEqual(messageIds, messages.map(row => row.id));
controller.abort();
await stream.return?.();
db.close();
console.log('control projections: SQLite atomic revisions, model/effort/title changes, internal filtering, cancel and all 120 messages across three MUX/Host pages passed');
