/** Durable Host task store contract. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ScheduleStore } from "../src/schedule-store.ts";
import type { SqlCursor, SqlStorage } from "../src/sqlite-storage.ts";

class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
    const statement = this.db.prepare(query);
    let rows: Array<Record<string, unknown>> = [];
    try { rows = statement.all(...bindings) as Array<Record<string, unknown>>; } catch { statement.run(...bindings); }
    return { toArray: () => rows };
  }
}

const store = new ScheduleStore(new NodeSqlStorage());
assert.deepEqual(store.list(), { items: [], total: 0, limit: 100, offset: 0 });
const createdAt = new Date().toISOString();
const future = new Date(Date.now() + 5_000).toISOString();
const entry = store.create({
  record: { id: "s1", kind: "after", title: "task", prompt: "hello", afterSeconds: 5, scheduledAt: future },
  target: { kind: "new_once", sessionId: "session-1", create: {} },
  involvedSessionIds: [],
  createdAt,
});
assert.equal(entry.id, "s1");
assert.equal(entry.status, "active");
assert.equal(entry.scheduledAt, future);
const due = store.due(new Date(Date.now() + 10_000).toISOString());
assert.equal(due.length, 1);
const delivered = store.deliver("s1", {
  scheduledAt: future,
  deliveredAt: new Date().toISOString(),
  messageId: "sub-1",
  targetSessionId: "session-1",
  prompt: "hello",
}, { target: { kind: "session", sessionId: "session-1" }, status: "ended" });
assert.equal(delivered?.status, "ended");
assert.equal(delivered?.target.kind, "session");
const history = store.history({ id: "s1", limit: 10 });
assert.equal("records" in history ? history.records.length : -1, 1);
assert.deepEqual(store.deleteInactive(), 1);
assert.equal(store.view("s1"), undefined);
console.log("session-host: durable schedule store passed");
