/** Durable Object session host contract over a node:sqlite stand-in for DO storage. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionHostObject } from "../dist/persistence.js";

const worker = (await import("../dist/worker.js")).default;

/** The DO storage face the adapter consumes, backed by node:sqlite for tests. */
function doStorage(location = ":memory:") {
  const db = new DatabaseSync(location);
  return {
    sql: {
      exec(query, ...bindings) {
        // Row-returning statements go through prepare; DDL and multi-statement
        // scripts go through exec, matching the DO storage contract.
        if (/^\s*SELECT\b/iu.test(query) || (/^\s*PRAGMA\b/iu.test(query) && !query.includes("="))) {
          const statement = db.prepare(query);
          return {
            one: () => statement.get(...bindings),
            toArray: () => statement.all(...bindings),
          };
        }
        if (bindings.length > 0) {
          db.prepare(query).run(...bindings);
        } else {
          db.exec(query);
        }
        return { one: () => undefined, toArray: () => [] };
      },
    },
    transactionSync(body) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = body();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}

const message = (id, role, text, source) => ({ id, role, content: [{ type: "text", text }], source });
const oneTurn = () => [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
  { type: "user/message", seq: 1, time: 2, data: message("u1", "user", "hi", { kind: "user" }), surfaceOp: "append" },
  { type: "step/start", seq: 2, time: 3, data: { turn: 1, step: 1 } },
  { type: "assistant/message", seq: 3, time: 4, data: { turn: 1, step: 1, message: message("a1", "assistant", "hello", { kind: "model", provider: "mock", model: "mock" }) }, surfaceOp: "append" },
  { type: "step/end", seq: 4, time: 5, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 5, time: 6, data: { turn: 1, reason: { kind: "completed" } } },
];

const call = async (host, method, params = {}) => {
  const response = await host.fetch(new Request("https://do.test/api/session-host", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  }));
  return { status: response.status, body: await response.json() };
};

test("create, list, state and page answer over DO storage", async () => {
  const host = new SessionHostObject({ storage: doStorage() }, {});
  const created = await call(host, "create", { sessionId: "s1", cwd: "/work" });
  assert.deepEqual(created, { status: 200, body: { result: { sessionId: "s1" } } });
  const appended = await call(host, "append", { sessionId: "s1", events: oneTurn() });
  assert.deepEqual(appended.body.result, { sessionId: "s1", appended: 6 });
  const listed = await call(host, "list");
  assert.equal(listed.body.result.sessions.length, 1);
  assert.equal(listed.body.result.sessions[0].sessionId, "s1");
  assert.equal(listed.body.result.sessions[0].cwd, "/work");
  const state = await call(host, "state", { sessionId: "s1" });
  assert.equal(state.body.result.sessionId, "s1");
  assert.equal(state.body.result.events, 6);
  assert.equal(state.body.result.lastSeq, 5);
  const page = await call(host, "page", { sessionId: "s1", fromSeq: 0, limit: 3 });
  assert.deepEqual(page.body.result.events.map((row) => row.seq), [0, 1, 2]);
  assert.equal(page.body.result.nextSeq, 3);
});

test("sessions survive a host restart over the same database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-do-"));
  const file = join(directory, "sessions.db");
  try {
    const first = new SessionHostObject({ storage: doStorage(file) }, {});
    assert.equal((await call(first, "create", { sessionId: "persisted" })).status, 200);
    assert.equal((await call(first, "append", { sessionId: "persisted", events: oneTurn() })).status, 200);
    const second = new SessionHostObject({ storage: doStorage(file) }, {});
    const listed = await call(second, "list");
    assert.deepEqual(listed.body.result.sessions.map((row) => row.sessionId), ["persisted"]);
    const state = await call(second, "state", { sessionId: "persisted" });
    assert.equal(state.status, 200);
    assert.equal(state.body.result.events, 6, "the appended log survives the restart");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bad requests, unknown methods and the unwired model fail explicitly", async () => {
  const host = new SessionHostObject({ storage: doStorage() }, {});
  assert.equal((await call(host, "create", {})).status, 400);
  assert.equal((await call(host, "nope")).status, 404);
  const prompt = await call(host, "prompt", { sessionId: "s1", text: "hi" });
  assert.equal(prompt.status, 501);
  assert.equal(prompt.body.error.code, "model_not_configured");
});

test("the worker forwards /api/session-host to the SESSION_HOST binding", async () => {
  const host = new SessionHostObject({ storage: doStorage() }, {});
  const binding = { idFromName: (name) => name, get: () => host };
  const env = { SESSION_HOST: binding };
  const request = (body) => new Request("https://surface.test/api/session-host", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const created = await worker.fetch(request({ sessionId: "w1", method: "create" }), env);
  assert.equal(created.status, 200);
  const appended = await worker.fetch(request({ sessionId: "w1", method: "append", params: { events: oneTurn() } }), env);
  assert.equal(appended.status, 200);
  const listed = await worker.fetch(request({ sessionId: "w1", method: "list" }), env);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).result.sessions.length, 1);
  const missing = await worker.fetch(request({ sessionId: "w1", method: "prompt", params: { text: "hi" } }), env);
  assert.equal(missing.status, 501, "the unwired model fails explicitly through the worker");
});

test("prompt performs one real provider call and stores the turn", async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.authorization, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "resp", model: "deepseek-chat", choices: [{ message: { content: "BANANA-42" } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const host = new SessionHostObject({ storage: doStorage() }, { DEEPSEEK_API_KEY: "test-key", fetch: stub });
  await call(host, "create", { sessionId: "p1" });
  await call(host, "append", { sessionId: "p1", events: oneTurn() });
  const prompted = await call(host, "prompt", { sessionId: "p1", text: "What is the code?" });
  assert.equal(prompted.status, 200);
  assert.equal(prompted.body.result.text, "BANANA-42");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/chat\/completions$/u);
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.equal(calls[0].body.messages.at(-1).content, "What is the code?");
  const page = await call(host, "page", { sessionId: "p1", fromSeq: 6 });
  assert.deepEqual(page.body.result.events.map((row) => row.type), ["turn/start", "user/message", "step/start", "assistant/message", "step/end", "turn/end"]);
});

test("prompt without a key is 501 and a provider failure is 502 without a fake answer", async () => {
  const noKey = new SessionHostObject({ storage: doStorage() }, {});
  await call(noKey, "create", { sessionId: "n1" });
  assert.equal((await call(noKey, "prompt", { sessionId: "n1", text: "hi" })).status, 501);

  const failing = new SessionHostObject({ storage: doStorage() }, { DEEPSEEK_API_KEY: "k", fetch: async () => new Response("nope", { status: 500 }) });
  await call(failing, "create", { sessionId: "n2" });
  await call(failing, "append", { sessionId: "n2", events: oneTurn() });
  const failed = await call(failing, "prompt", { sessionId: "n2", text: "hi" });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error.code, "model_error");
  const page = await call(failing, "page", { sessionId: "n2", fromSeq: 6 });
  assert.deepEqual(page.body.result.events.map((row) => row.type), ["turn/start", "user/message", "turn/end"]);
  assert.equal(page.body.result.events.at(-1).data.reason.kind, "error");
});
