import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SessionHost } from "../src/host.ts";
import {
  SqliteSessionHostStorage,
  type SqlCursor,
  type SqlStorage,
} from "../src/sqlite-storage.ts";

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

const sql = new NodeSqlStorage();
const storage = new SqliteSessionHostStorage(sql);
const now = Date.now();
await storage.putSession({
  sessionId: "sql-a",
  title: "SQL Alpha",
  running: false,
  blank: false,
  archived: false,
  createdAt: now - 2000,
  updatedAt: now - 1000,
});
await storage.appendMessages("sql-a", Array.from({ length: 23 }, (_, index) => ({
  id: `m${index + 1}`,
  seq: index + 1,
  role: index % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `message ${index + 1}` }],
})));
await storage.putProjections("sql-a", { usage: { input: 3, output: 1 } });

const host = new SessionHost(storage, [
  { id: "deepseek-official/deepseek-flash", label: "DeepSeek-V4.1-Flash", contextWindow: 1_048_576 },
]);
assert.deepEqual((await host.list({})).sessions.map((row) => row.sessionId), ["sql-a"]);
assert.equal((await host.state({ sessionId: "sql-a" })).title, "SQL Alpha");
const page1 = await host.page({ address: { kind: "session", sessionId: "sql-a" }, limit: 10 });
assert.equal(page1.records.length, 10);
assert.equal(page1.hasMore, true);
assert.equal(page1.before, 14);
const page2 = await host.page({ address: { kind: "session", sessionId: "sql-a" }, before: page1.before, limit: 10 });
assert.equal(page2.records.length, 10);
assert.equal(page2.hasMore, true);
const page3 = await host.page({ address: { kind: "session", sessionId: "sql-a" }, before: page2.before, limit: 10 });
assert.deepEqual(page3.records.map((record) => record.seq), [1, 2, 3]);
assert.deepEqual((await host.projections({ sessionId: "sql-a" })).usage, { input: 3, output: 1 });
const attachment = await host.uploadAttachment({
  sessionId: "sql-a",
  name: "fact.txt",
  mediaType: "text/plain",
  dataBase64: Buffer.from("SQL secret BANANA-42").toString("base64"),
});
assert.equal(attachment.name, "fact.txt");
assert.equal((await host.attachment(attachment.attachmentId)).size, 20);
const attachmentPrompt = await host.prompt({ sessionId: "sql-a", text: "read", attachments: [attachment] });
assert.equal(typeof attachmentPrompt.submissionId, "string");
assert.equal((await host.attachment(attachment.attachmentId)).dataBase64.length > 0, true);
const queued = await host.queue({ sessionId: "sql-a" });
assert.equal(queued.items.length, 1);
assert.equal(queued.items[0]?.text, "read");
await host.editQueueItem({ sessionId: "sql-a", submissionId: attachmentPrompt.submissionId, text: "read edited" });
assert.equal((await host.queue({ sessionId: "sql-a" })).items[0]?.text, "read edited");
await host.updateQueue({ sessionId: "sql-a", itemId: attachmentPrompt.submissionId, action: "remove" });
assert.deepEqual((await host.queue({ sessionId: "sql-a" })).items, []);
await host.rename({ sessionId: "sql-a", title: "SQL Renamed" });
assert.equal((await host.state({ sessionId: "sql-a" })).title, "SQL Renamed");
await host.selectModel({ sessionId: "sql-a", model: "deepseek-official/deepseek-flash" });
assert.equal((await host.state({ sessionId: "sql-a" })).model, "deepseek-official/deepseek-flash");
const created = await host.create({ title: "SQL created", sessionId: "sql-created" });
assert.equal(created.sessionId, "sql-created");
const forked = await host.fork({ sessionId: "sql-a", messageId: "m10", sessionIdNew: "sql-fork" });
assert.equal(forked.sessionId, "sql-fork");
const forkedPage = await host.page({ address: { kind: "session", sessionId: "sql-fork" }, limit: 100 });
assert.equal(forkedPage.records.length, 10);
assert.equal((await host.projections({ sessionId: "sql-fork" })).usage, undefined, "fork cannot claim aggregate usage beyond its event prefix");
console.log("session-host: sqlite create/fork contract passed");

// A new Think instance receives SDK-only history. Its first sync must retain
// durable Host provenance while accepting fresh tool results and newer evidence.
{
  const sql = new NodeSqlStorage();
  const storage = new SqliteSessionHostStorage(sql);
  const step = { type: "data-dsh-step", data: { stepId: "step-1", startedAt: 100, finishedAt: 120 } };
  const source = { type: "data-dsh-model-source", data: { requestedModel: "deepseek-v4-pro", responseModel: "provider-revision", effort: "high" } };
  await storage.appendMessages("metadata", [{ id: "answer", seq: 1, role: "assistant", parts: [
    { type: "dynamic-tool", toolCallId: "call-1", toolName: "read_file", state: "input-available", input: { path: "a" } }, step, source,
  ] }]);
  const result = { type: "dynamic-tool", toolCallId: "call-1", toolName: "read_file", state: "output-available", input: { path: "a" }, output: "fresh contents" };
  await storage.syncMessages("metadata", [{ id: "answer", role: "assistant", parts: [result] }]);
  assert.deepEqual((await storage.readAllMessages("metadata"))[0]?.parts, [result, step, source]);
  const newerStep = { ...step, data: { ...step.data, finishedAt: 130 } };
  const newerSource = { ...source, data: { ...source.data, responseModel: "corrected-revision" } };
  await storage.syncMessages("metadata", [{ id: "answer", role: "assistant", parts: [result, newerStep, newerSource] }]);
  assert.deepEqual((await storage.readAllMessages("metadata"))[0]?.parts, [result, newerStep, newerSource]);
  assert.deepEqual((await new SqliteSessionHostStorage(sql).readAllMessages("metadata"))[0]?.parts, [result, newerStep, newerSource]);
  console.log("session-host: fresh Agent sync preserves Host evidence and accepts newer tool results");
}

// Production transaction semantics: an INSERT failure rolls back a preceding
// DELETE, and admission cannot leave a user message without its durable queue.
{
  const db = new DatabaseSync(":memory:");
  let fault: "none" | "message" | "submission" = "none";
  const sql: SqlStorage = {
    exec(query, ...bindings) {
      if ((fault === "message" && query.includes("INSERT INTO dsh_session_host_messages"))
        || (fault === "submission" && query.includes("INSERT INTO dsh_session_host_submissions"))) throw new Error("injected write failure");
      const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
    transactionSync(operation) {
      db.exec("BEGIN");
      try { const result = operation(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  const storage = new SqliteSessionHostStorage(sql);
  const host = new SessionHost(storage, []);
  await host.create({ sessionId: "atomic" });
  const prompts = await Promise.all(Array.from({ length: 6 }, () => host.prompt({ sessionId: "atomic", text: "once", requestId: "once" })));
  assert.equal(new Set(prompts.map((row) => row.submissionId)).size, 1);
  assert.equal((await storage.readAllMessages("atomic")).length, 1);
  assert.equal((await storage.listSubmissions("atomic")).length, 1);
  const before = await storage.readAllMessages("atomic");
  fault = "message";
  await assert.rejects(storage.replaceMessages("atomic", [{ id: "replacement", seq: 1, role: "assistant", parts: [] }]), /injected write failure/);
  assert.deepEqual(await storage.readAllMessages("atomic"), before);
  fault = "submission";
  await assert.rejects(host.prompt({ sessionId: "atomic", text: "must roll back", requestId: "rollback" }), /injected write failure/);
  assert.deepEqual(await storage.readAllMessages("atomic"), before);
  fault = "none";
  const merged = await storage.syncMessages("atomic", [{ id: "answer", role: "assistant", parts: [{ type: "text", text: "answer" }] }]);
  assert.deepEqual(merged.map((row) => row.id), ["answer", "once"]);
  console.log("session-host: atomic prompt deduplication and transcript rollback passed");
}
