import './runtime-hook.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
const { createPermissionRuntime } = await import('../src/runtime.ts');
const { PermissionStore } = await import('../../dsh-base-cloudflare-worker-session-host/src/permissions-store.ts');

class Sql {
  db = new DatabaseSync(':memory:');
  fail = false;
  writes = 0;
  constructor() {
    this.db.exec('CREATE TABLE dsh_session_host_sessions (session_id TEXT PRIMARY KEY); CREATE TABLE dsh_session_host_projections (session_id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE dsh_session_host_events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(session_id, seq));');
  }
  exec(query, ...bindings) {
    if (this.fail && query.startsWith('INSERT INTO dsh_session_host_events')) throw Error('injected journal write failure');
    if (/^(INSERT|UPDATE|DELETE)/.test(query)) this.writes += 1;
    const rows = this.db.prepare(query).all(...bindings); return { toArray: () => rows };
  }
  transactionSync(operation) {
    this.db.exec('SAVEPOINT permissions');
    try { const result = operation(); this.db.exec('RELEASE permissions'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO permissions; RELEASE permissions'); throw error; }
  }
}

test('permission journal and snapshot commit atomically with model preservation, restart and session isolation', async () => {
  const sql = new Sql(); const runtime = await createPermissionRuntime(); let selectedDefault = 'workspace-write';
  const store = new PermissionStore(sql, runtime, () => selectedDefault);
  const read = id => JSON.parse(sql.exec('SELECT value FROM dsh_session_host_projections WHERE session_id = ?', id).toArray()[0].value);
  try {
    for (const id of ['first', 'second', 'legacy', 'fork', 'interrupted-create']) sql.exec('INSERT INTO dsh_session_host_sessions VALUES (?)', id);
    sql.exec('INSERT INTO dsh_session_host_projections VALUES (?, ?)', 'first', JSON.stringify({ modelSelection: { next: { provider: 'deepseek', model: 'deepseek-reasoner' } }, totals: { steps: 9 } }));
    assert.equal(store.initialize('first', true).currentValue, 'workspace-write');
    assert.equal(sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'first').toArray().length, 3);
    selectedDefault = 'read-only';
    assert.equal(store.initialize('second', true).currentValue, 'read-only');
    assert.equal(store.snapshot('first').currentValue, 'workspace-write');
    assert.equal(store.initialize('legacy', false).currentValue, 'workspace-write');
    sql.exec('INSERT INTO dsh_session_host_projections VALUES (?, ?)', 'interrupted-create', JSON.stringify({ _dshBasePermissionFresh: 'danger-full-access' }));
    sql.fail = true;
    assert.throws(() => store.snapshot('interrupted-create'), /injected/);
    assert.deepEqual(read('interrupted-create'), { _dshBasePermissionFresh: 'danger-full-access' }, 'failed recovery preserves the creation-time default marker');
    sql.fail = false;
    assert.equal(store.snapshot('interrupted-create').currentValue, 'danger-full-access', 'creation default survives a crash and later user default changes');
    assert.equal(Object.hasOwn(read('interrupted-create'), '_dshBasePermissionFresh'), false, 'successful atomic initialization consumes the marker');
    const before = read('first'); sql.fail = true;
    assert.throws(() => store.select('first', 'danger-full-access'), /injected/);
    assert.deepEqual(read('first'), before, 'projection update rolls back when journal insert fails');
    assert.equal(sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'first').toArray().length, 3);
    sql.fail = false;
    assert.equal(store.select('first', 'danger-full-access').approval, 'never');
    assert.deepEqual(read('first').modelSelection, before.modelSelection);
    assert.deepEqual(read('first').totals, { steps: 9 });
    const writes = sql.writes; store.select('first', 'danger-full-access');
    assert.equal(sql.writes, writes, 'same preset is a true persistence no-op');
    assert.equal(store.snapshot('second').sandbox, 'read-only');
    sql.exec('INSERT INTO dsh_session_host_projections VALUES (?, ?)', 'fork', JSON.stringify(read('first')));
    assert.equal(store.initialize('fork', false).currentValue, 'danger-full-access');
    const restarted = await createPermissionRuntime();
    try {
      const reopened = new PermissionStore(sql, restarted, () => 'read-only');
      assert.equal(reopened.snapshot('first').approval, 'never');
      const changes = await Promise.all(['workspace-write', 'read-only', 'danger-full-access'].map(preset => Promise.resolve().then(() => reopened.select('first', preset))));
      assert.deepEqual(changes.map(value => value.currentValue), ['workspace-write', 'read-only', 'danger-full-access']);
      assert.equal(store.snapshot('first').currentValue, 'danger-full-access');
      const events = sql.exec('SELECT seq FROM dsh_session_host_events WHERE session_id = ? ORDER BY seq', 'first').toArray();
      assert.deepEqual(events.map(row => row.seq), Array.from({ length: events.length }, (_, i) => i + 1));
    } finally { await restarted.dispose(); }
    const latest = read('first');
    sql.exec('UPDATE dsh_session_host_projections SET value = ? WHERE session_id = ?', JSON.stringify({ ...latest, permissionEvents: [{ seq: 12, time: 1, type: 'sandbox/mode', data: { mode: 'danger-full-access' } }] }), 'first');
    assert.throws(() => store.snapshot('first'), /seq|contiguous/);
    assert.throws(() => new PermissionStore({ exec: sql.exec.bind(sql) }, runtime, () => selectedDefault).initialize('second'), /Atomic permission/);
    assert.throws(() => store.snapshot('missing'), /Session not found/);
  } finally { await runtime.dispose(); sql.db.close(); }
});

test('actual permission command receipts are atomic, idempotent, durable and report failures without model work', async () => {
  const sql = new Sql(), runtime = await createPermissionRuntime();
  let reopened;
  try {
    sql.exec('INSERT INTO dsh_session_host_sessions VALUES (?)', 'commands');
    const store = new PermissionStore(sql, runtime, () => 'workspace-write');
    store.initialize('commands', true);
    assert.equal(store.commands('commands')[0].definitionId, '@deepseek-ai/dsh-permission-presets');
    const receipt = await store.executeCommand('commands', '/permission read-only', [], 'rpc-1');
    assert.match(receipt.commandId, /^cmd-/);
    assert.deepEqual(receipt.result, { kind: 'success', text: 'preset read-only' });
    assert.equal(store.snapshot('commands').currentValue, 'read-only');
    const before = sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'commands').toArray();
    const run = before.find(event => event.type === 'command/run'), done = before.find(event => event.type === 'command/done');
    assert.equal(JSON.parse(run.payload).commandId, receipt.commandId);
    assert.equal(JSON.parse(done.payload).commandId, receipt.commandId);
    assert.ok(run.seq < done.seq);
    assert.deepEqual(await store.executeCommand('commands', '/permission read-only', [], 'rpc-1'), receipt);
    assert.deepEqual(sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'commands').toArray(), before);
    await assert.rejects(store.executeCommand('commands', '/permission danger-full-access', [], 'rpc-1'), error => error.code === 'session/command-conflict');
    assert.equal(store.snapshot('commands').currentValue, 'read-only');
    const invalid = await store.executeCommand('commands', '/permission invented', [], 'rpc-invalid');
    assert.equal(invalid.result.kind, 'error'); assert.match(invalid.result.text, /unknown preset/);
    const attachment = await store.executeCommand('commands', '/permission danger-full-access', [{ type: 'file', receiptId: 'never-admitted' }], 'rpc-file');
    assert.deepEqual(attachment.result, { kind: 'error', text: '/permission does not accept attachments' });
    assert.equal(store.snapshot('commands').currentValue, 'read-only');
    const count = sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'commands').toArray().length;
    await assert.rejects(store.executeCommand('commands', '/unsupported', [], 'unsupported'), error => error.code === 'gateway/endpoint-unavailable');
    assert.equal(sql.exec('SELECT * FROM dsh_session_host_events WHERE session_id = ?', 'commands').toArray().length, count);
    sql.fail = true;
    await assert.rejects(store.executeCommand('commands', '/permission danger-full-access', [], 'interrupted'), /injected/);
    sql.fail = false;
    assert.equal(store.snapshot('commands').currentValue, 'read-only');
    const recovered = await store.executeCommand('commands', '/permission danger-full-access', [], 'interrupted');
    assert.equal(recovered.result.kind, 'success');
    reopened = await createPermissionRuntime();
    const restored = new PermissionStore(sql, reopened, () => 'read-only');
    assert.deepEqual(await restored.executeCommand('commands', '/permission danger-full-access', [], 'interrupted'), recovered);
    const raced = await Promise.all(Array.from({ length: 8 }, () => restored.executeCommand('commands', '/permission workspace-write', [], 'concurrent')));
    assert.equal(new Set(raced.map(result => result.commandId)).size, 1);
    const commands = sql.exec("SELECT payload FROM dsh_session_host_events WHERE session_id = ? AND type = 'command/run'", 'commands').toArray().map(row => JSON.parse(row.payload));
    assert.equal(commands.filter(row => row.commandId === raced[0].commandId).length, 1);
    assert.equal(restored.snapshot('commands').currentValue, 'workspace-write');
    assert.equal(sql.exec("SELECT * FROM dsh_session_host_events WHERE session_id = ? AND type IN ('user/message','submission.queued')", 'commands').toArray().length, 0);
  } finally { await reopened?.dispose(); await runtime.dispose(); sql.db.close(); }
});
