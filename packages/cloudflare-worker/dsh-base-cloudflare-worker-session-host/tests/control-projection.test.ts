/** Real SQLite projection revisions crossing the actual official control stream. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SessionHost } from '../src/host.ts';
import { SqliteSessionHostStorage } from '../src/sqlite-storage.ts';
import { HostChangeFeed, observeHostWrites, invalidationResponse } from '../src/change-feed.ts';
import { dispatchSessionHost } from '../src/service.ts';
import { registerSessionStreamEndpoints } from '../src/remote-streams.ts';

const db = new DatabaseSync(':memory:');
const feed = new HostChangeFeed();
const sql = observeHostWrites({
  exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; },
  transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
}, feed);
const host = new SessionHost(new SqliteSessionHostStorage(sql), [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }], undefined, undefined, undefined, undefined, undefined, undefined, feed);
await host.create({ sessionId: 'control-source' });
for (let i = 0; i < 50; i++) await host.create({ sessionId: `later-session-${i}` });
const methods = new Map<string, any>();
registerSessionStreamEndpoints({ register(name: string, handler: unknown) { methods.set(name, handler); return () => {}; } } as never);
const abort = new AbortController();
const invoke = { user: { id: 'control-owner' }, request: new Request('https://host/api/remote.mux', { signal: abort.signal }), env: { SESSION_HOST: {
  idFromName(name: string) { return name; },
  get() { return { async fetch(request: Request) {
    if (request.url.endsWith('/migrate/status')) return Response.json({ migrated: true });
    if (request.url.endsWith('/changes')) return invalidationResponse(feed, request.signal);
    return Response.json(await dispatchSessionHost(host, await request.json()));
  } }; },
} } };
const iterator = methods.get('session/control')({ args: {} }, invoke)[Symbol.asyncIterator]();
const baseline = (await iterator.next()).value;
assert.equal(baseline.type, 'baseline');
assert.equal(Object.keys(baseline.value.projections).length, 51, 'control baseline includes every Host list page');
const original = baseline.value.projections['control-source'];
assert.ok(original.asOfSeq >= 1);
const pending = iterator.next();
await host.selectModel({ sessionId: 'control-source', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' });
const changed = (await pending).value;
assert.equal(changed.type, 'projection');
assert.ok(changed.seq > original.asOfSeq, 'metadata advances even when chat remains empty');
assert.equal(changed.changes.find((row: any) => row.key === 'modelSelection').val.next.reasoningEffort, 'max');
assert.ok(!changed.changes.some((row: any) => row.key.startsWith('_dshBase')), 'storage internals do not enter the official projection map');
const next = iterator.next();
await host.rename({ sessionId: 'control-source', title: 'Other tab changed the title' });
const renamed = (await next).value;
assert.ok(renamed.seq > changed.seq);
assert.equal(renamed.changes.find((row: any) => row.key === 'title').val, 'Other tab changed the title');
const waiting = iterator.next(); abort.abort(); assert.equal((await waiting).done, true);
await iterator.return?.();
db.close();
console.log('control projections: actual SQLite atomic revisions, unchanged empty chat, model/effort/title mutations, internal filtering, cancel');
