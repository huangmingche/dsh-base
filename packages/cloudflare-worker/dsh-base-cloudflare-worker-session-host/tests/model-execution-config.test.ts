/** Actual SQLite transactions and official RPC; no provider/network requests. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SessionHost } from '../src/host.ts';
import { SqliteSessionHostStorage, type SqlStorage } from '../src/sqlite-storage.ts';
import { dispatchSessionHost } from '../src/service.ts';
import { registerSessionRemoteEndpoints } from '../src/remote.ts';

const db = new DatabaseSync(':memory:');
// An existing deployment has no effort column. Opening it upgrades in place.
db.exec(`CREATE TABLE dsh_session_host_sessions (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, running INTEGER NOT NULL, blank INTEGER NOT NULL, archived INTEGER NOT NULL, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
db.prepare('INSERT INTO dsh_session_host_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('legacy', 'Preserved', 0, 0, 0, 'deepseek-v4-pro', 1, 2);
let failAdmission = false;
const sql: SqlStorage = {
  exec(query, ...bindings) {
    if (failAdmission && query.startsWith('INSERT INTO dsh_session_host_events')) { failAdmission = false; throw Error('admission write interrupted'); }
    const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
    return { toArray: () => rows };
  },
  transactionSync(operation) { db.exec('BEGIN'); try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
};
let storage = new SqliteSessionHostStorage(sql);
const catalog = [
  { id: 'deepseek-flash', label: 'Flash', contextWindow: 1048576 },
  { id: 'deepseek-v4-pro', label: 'Pro', contextWindow: 1048576 },
];
let host = new SessionHost(storage, catalog);
assert.equal((await host.state({ sessionId: 'legacy' })).title, 'Preserved');
assert.equal(await host.inputExecutionConfig('legacy', 'unrecorded'), undefined, 'legacy runs have no invented configuration');
await host.create({ sessionId: 'session' });
const original = (await storage.getSession('session'))!;
const handlers = new Map<string, (input: unknown, invocation: unknown) => Promise<any>>();
registerSessionRemoteEndpoints({ register(method: string, handler: any) { handlers.set(method, handler); return () => {}; } } as never);
const stub = { async fetch(request: Request) {
  if (new URL(request.url).pathname.endsWith('/migrate/status')) return Response.json({ migrated: true });
  return Response.json(await dispatchSessionHost(host, await request.json()));
} };
const invocation = { request: new Request('https://host/api/session/selectModel'), user: { id: 'model-owner' }, env: { SESSION_HOST: { idFromName: (name: string) => name, get: () => stub } } };
const select = (reasoningEffort?: string, model = 'deepseek-v4-pro') => handlers.get('session/selectModel')!({ args: { request: { sessionId: 'session', provider: 'deepseek-official', model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } } }, invocation);
for (const effort of ['off', 'low', 'high', 'max', undefined]) {
  const expected = effort ?? 'high';
  assert.deepEqual(await select(effort), { selected: { provider: 'deepseek-official', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: expected } });
  assert.equal((await host.state({ sessionId: 'session' })).reasoningEffort, expected);
  // A status/rename snapshot read before the picker must not reset selection.
  await storage.putSession({ ...original, running: false, title: 'Renamed' });
  assert.equal((await host.state({ sessionId: 'session' })).model, 'deepseek-official/deepseek-v4-pro');
  assert.equal((await host.state({ sessionId: 'session' })).reasoningEffort, expected);
}
await assert.rejects(select('ultra'), (error: any) => error.code === 'gateway/bad-request');
await assert.rejects(select('low', 'invented'), (error: any) => error.code === 'gateway/bad-request');
await select('max');
await host.prompt({ sessionId: 'session', requestId: 'first', text: 'one' });
assert.deepEqual(await host.inputExecutionConfig('session', 'first'), { model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' });
await select('off', 'deepseek-flash');
await host.prompt({ sessionId: 'session', requestId: 'first', text: 'duplicate delivery' });
assert.deepEqual(await host.inputExecutionConfig('session', 'first'), { model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' }, 'duplicate delivery and future choices cannot mutate admitted config');
await host.prompt({ sessionId: 'session', requestId: 'second', text: 'two' });
assert.deepEqual(await host.inputExecutionConfig('session', 'second'), { model: 'deepseek-official/deepseek-flash', reasoningEffort: 'off' });
failAdmission = true;
await assert.rejects(host.prompt({ sessionId: 'session', requestId: 'rolled-back', text: 'fail' }), /interrupted/);
assert.equal(await host.inputExecutionConfig('session', 'rolled-back'), undefined);
assert.equal((await host.history({ sessionId: 'session' })).records.some(record => record.id === 'rolled-back'), false);
// Check the SQL read boundary explicitly: the record supplied by a stale caller
// is irrelevant; only the selection present inside admission is authoritative.
await select('low', 'deepseek-v4-pro');
await storage.admitSubmission({ sessionId: 'session', requestId: 'fresh-sql', submissionId: 'fresh-sql', text: 'fresh', status: 'queued', createdAt: 5, updatedAt: 5 }, [{ type: 'text', text: 'fresh' }], 'fresh', [], { model: 'deepseek-flash', reasoningEffort: 'high' });
assert.deepEqual(await host.inputExecutionConfig('session', 'fresh-sql'), { model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'low' });
storage = new SqliteSessionHostStorage(sql);
host = new SessionHost(storage, catalog);
assert.deepEqual(await host.inputExecutionConfig('session', 'first'), { model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' });
assert.deepEqual(await host.inputExecutionConfig('session', 'second'), { model: 'deepseek-official/deepseek-flash', reasoningEffort: 'off' });
assert.equal((await host.state({ sessionId: 'session' })).reasoningEffort, 'low');
// lastUsed records the actual admitted model attempt, even before any response.
const staleProjection = await storage.getProjections('session');
const firstRequest = { sessionId: 'session', requestId: 'first', sdkRequestId: 'sdk-first', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' as const };
await host.recordModelRequest(firstRequest);
await assert.rejects(host.recordModelRequest({ ...firstRequest, model: 'deepseek-official/deepseek-flash' }), /does not match/);
await assert.rejects(host.recordModelRequest({ ...firstRequest, requestId: 'unrecorded' }), /does not match/);
await storage.putProjections('session', { ...staleProjection, usage: { inputTokens: 10 } });
let projected = await storage.getProjections('session');
assert.deepEqual((projected.modelSelection as any).lastUsed, { provider: 'deepseek-official', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'max' });
await host.recordModelRequest({ sessionId: 'session', requestId: 'second', sdkRequestId: 'sdk-second', model: 'deepseek-official/deepseek-flash', reasoningEffort: 'off' });
await host.recordModelRequest(firstRequest);
projected = await storage.getProjections('session');
assert.deepEqual((projected.modelSelection as any).lastUsed, { provider: 'deepseek-official', model: 'deepseek-official/deepseek-flash', reasoningEffort: 'off' }, 'old delivery cannot rewind a later attempt');
assert.equal((await host.state({ sessionId: 'session' })).model, 'deepseek-official/deepseek-v4-pro', 'lastUsed never overwrites the next picker');
assert.equal((await host.state({ sessionId: 'session' })).reasoningEffort, 'low');
const baseline = await storage.projectionSnapshot('session');
await select('high', 'deepseek-flash');
const changed = await storage.projectionSnapshot('session');
assert.ok(changed.revision > baseline.revision);
assert.equal(changed.session.model, 'deepseek-official/deepseek-flash');
assert.equal(changed.session.reasoningEffort, 'high');
assert.equal((await host.projections({ sessionId: 'session' }))._dshBaseProjectionRevision, changed.revision);
const renamed = await host.rename({ sessionId: 'session', title: 'Transaction rename' });
assert.equal(renamed.projectionRevision, (await storage.projectionSnapshot('session')).revision);
assert.ok(renamed.projectionRevision! > changed.revision);
const preRollback = await storage.projectionSnapshot('session');
assert.throws(() => sql.transactionSync!(() => { sql.exec('UPDATE dsh_session_host_sessions SET title = ? WHERE session_id = ?', 'rolled back title', 'session'); throw Error('rollback'); }), /rollback/);
assert.deepEqual(await storage.projectionSnapshot('session'), preRollback, 'revisions and values roll back together');
// A direct permission-store SQL write is covered without calling putProjections.
sql.exec('UPDATE dsh_session_host_projections SET value = ? WHERE session_id = ?', JSON.stringify({ permissions: { currentValue: 'read-only' } }), 'session');
const policy = await storage.projectionSnapshot('session');
assert.ok(policy.revision > preRollback.revision);
assert.deepEqual(policy.values.permissions, { currentValue: 'read-only' });
console.log('session-host: effort RPC, legacy migration, stale writes, atomic input config, duplicate delivery, rollback and restart passed');
