/** Durable maintenance registration/run-journal contract. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MaintenanceJobStore } from "../src/maintenance-jobs.ts";
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

const store = new MaintenanceJobStore(new NodeSqlStorage());
assert.deepEqual(store.list(), []);
const cleanup = store.ensureInterval("cleanupFiles", 3600);
assert.equal(cleanup.kind, "cleanupFiles");
assert.equal(cleanup.intervalSeconds, 3600);
assert.ok(cleanup.nextAt > Date.now());
store.ensureInterval("pruneSchedules", 3600);
store.ensureInterval("recoverSubmissions", 120);
assert.deepEqual(store.list().map((schedule) => schedule.kind), ["cleanupFiles", "pruneSchedules", "recoverSubmissions"]);
assert.equal(store.due(Date.now()).length, 0);
assert.equal(store.due(Date.now() + 4 * 3600_000).length, 3);
assert.equal(typeof store.nextDueAtMs(), "number");
const run = store.recordRun({ kind: "cleanupFiles", status: "ok", startedAt: Date.now(), finishedAt: Date.now(), detail: { deletedVersions: 3 }, nextAt: Date.now() + 1_000 });
assert.equal(run.kind, "cleanupFiles");
assert.equal(run.status, "ok");
assert.deepEqual(run.detail, { deletedVersions: 3 });
assert.equal(store.history(10).length, 1);
store.recordRun({ kind: "pruneSchedules", status: "failed", startedAt: Date.now(), finishedAt: Date.now(), detail: { error: "boom" }, nextAt: Date.now() + 1_000 });
const history = store.history(10);
assert.equal(history[0]?.status, "failed");
assert.equal(history[1]?.status, "ok");
assert.equal(store.list().find((schedule) => schedule.kind === "pruneSchedules")?.lastError, "boom");
console.log("session-host: maintenance jobs passed");
