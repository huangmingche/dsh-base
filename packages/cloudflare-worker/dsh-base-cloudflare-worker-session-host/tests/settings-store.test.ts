/** Durable settings document contract. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SettingsStore } from "../src/settings-store.ts";
import type { SqlCursor, SqlStorage } from "../src/sqlite-storage.ts";
import { HostChangeFeed, observeHostWrites } from '../src/change-feed.ts';

class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
    const statement = this.db.prepare(query);
    const rows = statement.all(...bindings as never[]) as Array<Record<string, unknown>>;
    return { toArray: () => rows };
  }
  transactionSync<T>(operation: () => T): T {
    this.db.exec('BEGIN');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const sql = new NodeSqlStorage();
const store = new SettingsStore(sql);
assert.deepEqual(store.read(), { revision: 0, values: {} });
const first = store.mutate({ ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }] });
assert.equal(first.revision, 1);
assert.deepEqual(first.values.permission, { defaultPreset: "read-only" });
const second = store.mutate({ ns: "ui-settings-general", ops: [{ op: "set", path: ["welcomeNoticeVersion"], value: "next" }], expectedRevision: 1 });
assert.equal(second.revision, 2);
assert.deepEqual(second.values["ui-settings-general"], { welcomeNoticeVersion: "next" });
assert.throws(
  () => store.mutate({ ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "x" }], expectedRevision: 1 }),
  (error: unknown) => error instanceof Error && error.message.includes("does not match"),
);
const unset = store.mutate({ ns: "permission", ops: [{ op: "unset", path: ["defaultPreset"] }], expectedRevision: 2 });
assert.deepEqual(unset.values.permission, {});
// A second store over the same SQL sees the persisted document.
const reopened = new SettingsStore(sql);
assert.deepEqual(reopened.read(), unset);
console.log("session-host: durable settings store passed");

const nested = store.update({ ns: "nested", patch: { object: { left: 1, right: 2 }, list: [1, 2], scalar: "old" } });
const merged = store.update({ ns: "nested", expectedRevision: nested.revision, patch: { object: { left: 3 }, list: [4], scalar: {} } });
assert.deepEqual(merged.values.nested, { object: { left: 3, right: 2 }, list: [4], scalar: {} });
assert.deepEqual(store.update({ ns: "nested", patch: { object: {} } }).values.nested.object, { left: 3, right: 2 });
assert.throws(() => store.update({ ns: "nested", patch: {}, expectedRevision: nested.revision }), /does not match/);
assert.throws(() => store.update({ ns: "nested", patch: JSON.parse('{"__proto__":{"polluted":true}}') }), /unsafe settings/);
assert.throws(() => store.mutate({ ns: "nested", ops: [{ op: "set", path: ["__proto__", "polluted"], value: true }] }), /unsafe settings/);
assert.equal(({} as { polluted?: boolean }).polluted, undefined);
console.log("session-host: nested settings update, conflict and path validation passed");

// Validate the resulting document, not individual intermediate operations. All
// public write paths reach this guard before revision or invalidation changes.
{
  const raw = new NodeSqlStorage();
  const feed = new HostChangeFeed();
  const observed = observeHostWrites(raw, feed);
  const durable = new SettingsStore(observed);
  const abort = new AbortController();
  const iterator = feed.subscribe(abort.signal)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value!.revision, 0);
  let delivered = false;
  const pending = iterator.next().then(value => { delivered = true; return value; });
  const original = durable.read();
  for (const value of ['not-a-preset', 'auto', 'custom', '', null, 0, {}, []]) {
    for (const mutate of [
      () => durable.mutate({ ns: 'permission', ops: [{ op: 'set', path: ['defaultPreset'], value }] }),
      () => durable.update({ ns: 'permission', patch: { defaultPreset: value } }),
      () => durable.mutate({ ns: 'permission', ops: [{ op: 'set', path: [], value: { defaultPreset: value } }] }),
    ]) {
      assert.throws(mutate, (error: unknown) => error instanceof Error && 'code' in error && error.code === 'gateway/bad-request');
      assert.deepEqual(durable.read(), original, 'invalid settings never create a row or advance revision');
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false, 'invalid settings must not wake owner subscribers');

  // A later invalid write rolls back earlier valid writes in the enclosing
  // production SQL transaction and suppresses its deferred invalidation.
  assert.throws(() => observed.transactionSync!(() => {
    durable.update({ ns: 'permission', patch: { defaultPreset: 'read-only' } });
    durable.update({ ns: 'permission', patch: { defaultPreset: 'not-a-preset' } });
  }), /configured preset/);
  assert.deepEqual(durable.read(), original);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false, 'rolled-back settings must not publish a revision');

  const accepted = durable.mutate({ ns: 'permission', ops: [
    { op: 'set', path: ['defaultPreset'], value: 'not-a-preset' },
    { op: 'set', path: ['defaultPreset'], value: 'read-only' },
  ] });
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.values.permission!.defaultPreset, 'read-only');
  assert.deepEqual((await pending).value, { type: 'invalidate', revision: 1, topics: ['settings'] });
  assert.deepEqual(new SettingsStore(raw).read(), accepted, 'accepted value survives a store restart');

  const pendingFailure = iterator.next();
  raw.exec("CREATE TRIGGER settings_failure BEFORE UPDATE ON dsh_session_host_settings BEGIN SELECT RAISE(ABORT, 'injected settings disk failure'); END");
  assert.throws(() => durable.update({ ns: 'permission', patch: { defaultPreset: 'workspace-write' } }), /injected settings disk failure/);
  assert.deepEqual(durable.read(), accepted, 'failed SQL preserves the value and revision');
  raw.exec('DROP TRIGGER settings_failure');
  const cleared = durable.mutate({ ns: 'permission', ops: [{ op: 'unset', path: ['defaultPreset'] }] });
  assert.deepEqual(cleared.values.permission, {}, 'unset restores the composition default');
  assert.equal(cleared.revision, 2);
  assert.deepEqual((await pendingFailure).value, { type: 'invalidate', revision: 2, topics: ['settings'] }, 'failed write emits no extra revision');
  const replaced = durable.mutate({ ns: 'permission', ops: [{ op: 'set', path: [], value: {} }] });
  assert.deepEqual(replaced.values.permission, {}, 'empty replacement is an allowed reset');
  abort.abort();
  await iterator.return?.();
  console.log('session-host: permission final-value validation, rollback, restart and invalidation silence passed');
}
