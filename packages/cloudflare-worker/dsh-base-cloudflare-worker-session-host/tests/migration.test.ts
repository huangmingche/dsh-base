/** Recovery fault windows: no partial data or premature completion can escape. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { commitMigration, migrationRowCount, migrationScore, migrationStatus, MIGRATION_KEY, SESSION_HOST_STORAGE_ID } from "../src/migration.ts";
import { handleSessionHostRequest } from "../src/worker-http.ts";
import type { SqlStorage } from "../src/sqlite-storage.ts";

assert.equal(migrationRowCount(undefined), 0);
assert.equal(migrationRowCount({}), 0);
assert.equal(migrationRowCount({ tables: {} }), 0);
assert.equal(migrationScore({ tables: { dsh_session_host_sessions: { rows: [{}, {}] }, dsh_session_host_messages: { rows: [{}] } } }), 3);

function database() {
  const db = new DatabaseSync(":memory:");
  const sql: SqlStorage = {
    exec(query, ...bindings) {
      const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
    transactionSync(operation) {
      db.exec("BEGIN");
      try { const result = operation(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  db.exec("CREATE TABLE dsh_session_host_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE TABLE dsh_session_host_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
  db.exec("CREATE TABLE dsh_session_host_settings (value TEXT NOT NULL)");
  return { db, sql };
}
const snapshot = { tables: { dsh_session_host_sessions: { columns: ["id", "title"], rows: [{ id: "saved", title: "Conversation" }] } } };
{
  const { sql } = database();
  // A historical marker alone is not evidence of successful import.
  sql.exec("INSERT INTO dsh_session_host_meta VALUES ('legacy-v9', 'migrated')");
  assert.equal(migrationStatus(sql).migrated, false);
  assert.throws(() => commitMigration(sql, { snapshot, sidecar: {} }, () => {
    sql.exec("INSERT INTO dsh_session_host_settings VALUES ('restored')");
    throw new Error("sidecar fault");
  }), /sidecar fault/);
  assert.equal(migrationStatus(sql).migrated, false);
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_sessions").toArray().length, 0);
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_settings").toArray().length, 0);
  const result = commitMigration(sql, { snapshot, sidecar: {} }, () => sql.exec("INSERT INTO dsh_session_host_settings VALUES ('restored')"));
  assert.equal(result.imported.dsh_session_host_sessions, 1);
  assert.equal(migrationStatus(sql).migrated, true);
  // Retry after a lost response, including a different stale snapshot, is a no-op.
  commitMigration(sql, { snapshot: { tables: {} } }, () => { throw new Error("must not replay"); });
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_sessions").toArray().length, 1);
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_settings").toArray().length, 1);
}
{
  const { sql } = database();
  const duplicate = structuredClone(snapshot);
  duplicate.tables.dsh_session_host_sessions.rows.push({ id: "saved", title: "Duplicate" });
  assert.throws(() => commitMigration(sql, { snapshot: duplicate }, () => undefined), /UNIQUE/);
  assert.equal(migrationStatus(sql).migrated, false);
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_sessions").toArray().length, 0);
  assert.throws(() => commitMigration(sql, { snapshot: { tables: { dsh_session_host_sessions: { columns: ["unknown"], rows: [{ unknown: "x" }] } } } }, () => undefined), /schema mismatch/);
  assert.equal(sql.exec("SELECT * FROM dsh_session_host_meta WHERE key = ?", MIGRATION_KEY).toArray().length, 0);
}
{
  const { sql } = database();
  sql.exec("INSERT INTO dsh_session_host_sessions VALUES ('current', 'Keep me')");
  assert.equal(commitMigration(sql, { snapshot }, () => { throw new Error("must not overwrite"); }).preservedExisting, true);
  assert.deepEqual(sql.exec("SELECT id FROM dsh_session_host_sessions").toArray().map((row) => row.id), ["current"]);
}

// Worker admission must fail closed before any application request is forwarded.
function environment(fault: "status" | "export" | "sidecar" | "commit" | "lost-response" | "none") {
  const { sql } = database();
  let forwarded = 0;
  let fail = true;
  const current = `owner:user:${SESSION_HOST_STORAGE_ID}`;
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({ fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/migrate/status")) return fault === "status" && fail
        ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(migrationStatus(sql));
      if (path.endsWith("/migrate/export")) {
        assert.notEqual(id, current);
        if (fault === "export" && fail) return Response.json({ error: "unavailable" }, { status: 503 });
        return Response.json(id.endsWith("default-v48") ? snapshot : { tables: {} });
      }
      if (path.endsWith("/migrate/commit")) {
        if (fault === "commit" && fail) return Response.json({ error: "failed" }, { status: 500 });
        const result = commitMigration(sql, await request.json(), () => sql.exec("INSERT INTO dsh_session_host_settings VALUES ('settings')"));
        if (fault === "lost-response" && fail) throw new Error("response lost after commit");
        return Response.json(result);
      }
      assert.equal(id, current);
      forwarded += 1;
      return Response.json({ ok: true });
    } }),
  };
  return {
    env: { SESSION_HOST: namespace, FILES: { get: async () => {
      if (fault === "sidecar" && fail) throw new Error("R2 unavailable");
      return { text: async () => JSON.stringify({ ownerId: "user", settings: { revision: 1, values: {} }, schedules: [] }) };
    } } },
    sql, forwarded: () => forwarded, recover: () => { fail = false; },
  };
}
for (const fault of ["status", "export", "sidecar", "commit", "lost-response"] as const) {
  const test = environment(fault);
  const request = () => new Request("https://example.com/api/session-host", { method: "POST", body: JSON.stringify({ method: "create" }) });
  assert.equal((await handleSessionHostRequest(request(), test.env, "user"))?.status, 503, fault);
  assert.equal(test.forwarded(), 0, fault);
  test.recover();
  assert.equal((await handleSessionHostRequest(request(), test.env, "user"))?.status, 200, fault);
  assert.equal(test.forwarded(), 1, fault);
  assert.equal(test.sql.exec("SELECT * FROM dsh_session_host_sessions").toArray().length, 1, fault);
  assert.equal(test.sql.exec("SELECT * FROM dsh_session_host_settings").toArray().length, 1, fault);
}
console.log("session-host: atomic legacy recovery, retry, preservation and admission passed");
