import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SessionHost } from "../src/host.ts";
import { dispatchSessionHost } from "../src/service.ts";
import { SqliteSessionHostStorage, type SqlCursor, type SqlStorage } from "../src/sqlite-storage.ts";

class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
    const statement = this.db.prepare(query);
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = statement.all(...bindings) as Array<Record<string, unknown>>;
    } catch {
      statement.run(...bindings);
    }
    return { toArray: () => rows };
  }
}

const host = new SessionHost(new SqliteSessionHostStorage(new NodeSqlStorage()), [
  { id: "kimi", label: "Kimi K2.6", contextWindow: 256000 },
]);

const created = await dispatchSessionHost(host, { id: "1", method: "create", params: { sessionId: "svc" } });
assert.deepEqual(created, { id: "1", result: { sessionId: "svc" } });
const listed = await dispatchSessionHost(host, { method: "list" });
assert.equal((listed as { result: { sessions: Array<{ sessionId: string }> } }).result.sessions[0]?.sessionId, "svc");
const renamed = await dispatchSessionHost(host, { method: "rename", params: { sessionId: "svc", title: "Service" } });
assert.equal((renamed as { result: { title: string } }).result.title, "Service");
assert.ok((renamed as { result: { projectionRevision: number } }).result.projectionRevision > 0, "rename acknowledges its durable projection revision");
const missing = await dispatchSessionHost(host, { id: "2", method: "state", params: { sessionId: "nope" } });
assert.deepEqual(missing, { id: "2", error: { code: "not_found", message: "session not found: nope" } });
const prompted = await dispatchSessionHost(host, { method: "prompt", params: { sessionId: "svc", text: "service prompt" } });
assert.equal(typeof (prompted as { result: { submissionId: string } }).result.submissionId, "string");
const unknown = await dispatchSessionHost(host, { method: "nope" });
assert.equal((unknown as { error: { code: string } }).error.code, "unknown_method");
console.log("session-host: service dispatch passed");
