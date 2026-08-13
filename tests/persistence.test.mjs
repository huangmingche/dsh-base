/** Storage-semantics contract for the forked rc.6 session persistence over the SqliteLike boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { SqliteSessionPersistence, nodeSqlite, createSessionHostContext } from "../dist/persistence.js";

const header = (id) => ({ version: 0, id, createdAt: 1000 });
const message = (id, role, text, source) => ({ id, role, content: [{ type: "text", text }], source });
/** The upstream contract's well-formed one-turn log (session-persistence/tests/contract.ts). */
const transcript = () => [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  { type: "user/message", seq: 1, time: 2, data: message("one-turn-user", "user", "hi", { kind: "user" }), surfaceOp: "append" },
  { type: "step/start", seq: 2, time: 3, data: { turn: 1, step: 1 } },
  { type: "assistant/message", seq: 3, time: 4, data: { turn: 1, step: 1, message: message("one-turn-assistant", "assistant", "hello", { kind: "model", provider: "mock", model: "mock" }) }, surfaceOp: "append" },
  { type: "step/end", seq: 4, time: 5, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 5, time: 6, data: { turn: 1, reason: { kind: "completed" } } },
];
const event = (seq, type, data) => ({ seq, type, time: 100 + seq, data });

async function store() {
  const db = nodeSqlite();
  const ctx = await createSessionHostContext();
  const persistence = new SqliteSessionPersistence(ctx, {}, db);
  await persistence.ready;
  return { db, persistence };
}

test("create + append materializes the session and preserves the log", async () => {
  const { persistence } = await store();
  await persistence.create(header("s1"));
  await persistence.append("s1", transcript());
  const listed = await persistence.list();
  assert.deepEqual(listed.map((row) => row.id), ["s1"]);
  const inspected = await persistence.inspect("s1");
  assert.deepEqual(inspected.events.map((row) => row.seq), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(inspected.events.map((row) => row.type), ["turn/start", "user/message", "step/start", "assistant/message", "step/end", "turn/end"]);
});

test("a failed append leaves the stored log and revision untouched", async () => {
  const { persistence } = await store();
  await persistence.create(header("s2"));
  await persistence.append("s2", transcript());
  const before = await persistence.listSnapshots();
  await assert.rejects(persistence.append("s2", [event(5, "step/end", { turn: 1, step: 1 })]));
  const after = await persistence.listSnapshots();
  assert.deepEqual(after.map((row) => row.revision), before.map((row) => row.revision));
  const inspected = await persistence.inspect("s2");
  assert.deepEqual(inspected.events.map((row) => row.seq), [0, 1, 2, 3, 4, 5]);
});

test("revision increases monotonically per append", async () => {
  const { persistence } = await store();
  await persistence.create(header("s3"));
  await persistence.append("s3", transcript());
  const first = (await persistence.listSnapshots())[0].revision;
  await persistence.append("s3", [
    { type: "turn/start", seq: 6, time: 7, data: { turn: 2 } },
    { type: "turn/end", seq: 7, time: 8, data: { turn: 2, reason: { kind: "completed" } } },
  ]);
  const second = (await persistence.listSnapshots())[0].revision;
  assert.notEqual(first, second);
});

test("a torn tail is cut on load and the committed prefix survives", async () => {
  const { db, persistence } = await store();
  await persistence.create(header("s4"));
  await persistence.append("s4", transcript());
  db.prepare("INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)")
    .run("s4", 6, "user/message", 7, "{not-json");
  const loaded = await persistence.load("s4");
  assert.deepEqual(loaded.events.map((row) => row.seq), [0, 1, 2, 3, 4, 5]);
  const remaining = db.prepare("SELECT seq FROM events WHERE session_id = ? ORDER BY seq").all("s4");
  assert.deepEqual(remaining.map((row) => row.seq), [0, 1, 2, 3, 4, 5], "load must delete the torn row");
});

test("an incompatible schema version fails closed", async () => {
  const db = nodeSqlite();
  db.exec("PRAGMA user_version = 14");
  const ctx = await createSessionHostContext();
  const persistence = new SqliteSessionPersistence(ctx, {}, db);
  await assert.rejects(persistence.ready, /schema version 14/u);
});
