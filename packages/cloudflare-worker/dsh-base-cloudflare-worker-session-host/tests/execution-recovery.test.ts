/** Exercise the real DO claim transport against a durable execution port. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "agents") return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName() { return globalThis.__testAgent; }')}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SessionHostObject } = await import("../src/do.ts");
const db = new DatabaseSync(":memory:");
let failCompletionOnce = false;
let failArchiveOnce = false;
let failCancelOnce = false;
const state = {
  id: { name: "owner:test:default-v49" },
  storage: {
    sql: { exec(query: string, ...bindings: unknown[]) {
      if (failArchiveOnce && query.startsWith("UPDATE dsh_session_host_sessions SET archived = 1")) { failArchiveOnce = false; throw new Error("archive write failed"); }
      if (failCompletionOnce && query.startsWith("UPDATE dsh_session_host_submissions SET status") && bindings.includes("completed")) { failCompletionOnce = false; throw new Error("completion write lost"); }
      const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    } },
    transactionSync<T>(operation: () => T): T {
      db.exec("BEGIN");
      try { const result = operation(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async setAlarm(_at: number) {},
  },
};
let messages: Array<{ id: string; role: string; parts: unknown[]; metadata?: { usage: Record<string, number> } }> = [];
const submissions = new Map<string, { status: string }>();
let modelRuns = 0;
const credentialWrites: Array<string | null> = [];
let lostResponse = true;
let hold = false;
let started: () => void = () => undefined;
let release: (() => void) | undefined;
const agent = {
  async ensureHistory(seed: typeof messages) { if (messages.length === 0) messages = [...seed]; },
  async setModel() {}, async setUserCredential(value: string | null) { credentialWrites.push(value); },
  async admitInput(input: { requestId: string; text: string }) {
    if (!submissions.has(input.requestId)) {
      modelRuns += 1;
      submissions.set(input.requestId, { status: hold ? "running" : "completed" });
      messages.push({ id: input.requestId, role: "user", parts: [{ type: "text", text: input.text }] });
      if (!hold) messages.push({ id: `answer:${input.requestId}`, role: "assistant", parts: [{ type: "text", text: "done" }], metadata: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
    }
    started();
    return { submissionId: input.requestId, status: submissions.get(input.requestId)!.status };
  },
  async waitForSubmission(id: string) {
    if (lostResponse) { lostResponse = false; throw new Error("response lost after execution"); }
    if (submissions.get(id)?.status === "running") await new Promise<void>((resolve) => { release = resolve; });
    return submissions.get(id);
  },
  async getMessages() { return messages; },
  async takeTurnStats() { return { turns: 0, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }; },
  async cancelInput(id: string) { if (failCancelOnce) { failCancelOnce = false; throw new Error("cancel transport lost"); } submissions.set(id, { status: "aborted" }); release?.(); },
};
(globalThis as unknown as { __testAgent: typeof agent }).__testAgent = agent;
let owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
const call = async (method: string, params: Record<string, unknown> = {}) => {
  const response = await owner.fetch(new Request("https://host/api/session-host", { method: "POST", body: JSON.stringify({ method, params }) }));
  return { status: response.status, body: await response.json() as { result?: any; error?: { code: string; details?: any } } };
};
const claim = (sessionId: string, submissionId: string) => owner.fetch(new Request("https://host/api/session-host/claim", { method: "POST", body: JSON.stringify({ sessionId, submissionId }) }));
await call("create", { sessionId: "s" });
const admitted = (await call("prompt", { sessionId: "s", text: "hello", requestId: "r1" })).body.result;
assert.equal((await claim("s", admitted.submissionId)).status, 500);
assert.equal((await call("state", { sessionId: "s" })).body.result.running, true);
// New owner process, same database and durable Agent history.
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
assert.equal((await call("claim", { sessionId: "s", submissionId: admitted.submissionId })).status, 200);
assert.equal(modelRuns, 1);
assert.equal((await call("history", { sessionId: "s" })).body.result.records.length, 2);
assert.equal((await call("state", { sessionId: "s" })).body.result.running, false);

// Two transports racing for one input share execution; actual cancellation
// reaches the Agent before the Host returns success.
hold = true;
const next = (await call("prompt", { sessionId: "s", text: "stop me", requestId: "r2" })).body.result;
const begun = new Promise<void>((resolve) => { started = resolve; });
const firstClaim = claim("s", next.submissionId);
await begun;
const duplicateClaim = call("claim", { sessionId: "s", submissionId: next.submissionId });
assert.equal((await call("cancel", { sessionId: "s" })).status, 200);
assert.equal((await firstClaim).status, 200);
assert.equal((await duplicateClaim).status, 200);
assert.equal(modelRuns, 2);
assert.equal(submissions.get("r2")?.status, "aborted");
assert.equal((await call("state", { sessionId: "s" })).body.result.running, false);
console.log("session-host: DO restart, idempotent claim, dual transports and agent cancellation passed");

// A crash after projections commit but before the completion row must not
// charge the same token usage twice when the durable result is replayed.
hold = false;
const third = (await call("prompt", { sessionId: "s", text: "again", requestId: "r3" })).body.result;
failCompletionOnce = true;
assert.equal((await claim("s", third.submissionId)).status, 500);
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
assert.equal((await claim("s", third.submissionId)).status, 200);
assert.equal((await call("projections", { sessionId: "s" })).body.result.tokenUsage.uncachedInputTokens, 20);
assert.equal(modelRuns, 3);
console.log("session-host: replayed completion does not duplicate usage projections");

// Archive admission shares the prompt transaction boundary. Without explicit
// stopActivity, active turns/tasks reject with the official activity details.
await call("create", { sessionId: "archive" });
const task = (await call("scheduleCreate", { request: { title: "Reminder", prompt: "remind", timing: { kind: "after", after_seconds: 3600 }, target: { kind: "session", sessionId: "archive" } } })).body.result;
assert.ok(task?.id);
const archiveInput = (await call("prompt", { sessionId: "archive", text: "queued", requestId: "archive-r1" })).body.result;
let archiveResult = await call("workspaceArchive", { sessionId: "archive" });
assert.equal(archiveResult.body.error?.code, "workspace/session-active");
assert.deepEqual(archiveResult.body.error?.details.activity.map((row: { kind: string }) => row.kind), ["turn", "schedule"]);
assert.equal((await call("state", { sessionId: "archive" })).body.result.archived, false);

// A failed local archive write rolls back flags and schedule removals.
failArchiveOnce = true;
archiveResult = await call("workspaceArchive", { sessionId: "archive", stopActivity: true });
assert.ok(archiveResult.body.error);
assert.equal((await call("state", { sessionId: "archive" })).body.result.archived, false);
assert.equal((await call("scheduleView", { id: task.id })).body.result.status, "active");

// Cancellation failure leaves the archive durable and the old request pending,
// so a new owner process can finish stopping it without starting a model call.
failCancelOnce = true;
archiveResult = await call("workspaceArchive", { sessionId: "archive", stopActivity: true });
assert.equal(archiveResult.status, 503);
assert.equal((await call("state", { sessionId: "archive" })).body.result.archived, true);
assert.equal((await call("scheduleView", { id: task.id })).body.result.code, "schedule_not_found");
assert.equal((await call("prompt", { sessionId: "archive", text: "too late", requestId: "archive-r2" })).body.error?.code, "session/archived");
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
assert.equal((await claim("archive", archiveInput.submissionId)).status, 200);
assert.equal(submissions.get("archive-r1")?.status, "aborted");
assert.equal(modelRuns, 3);
assert.equal((await call("state", { sessionId: "archive" })).body.result.running, false);
assert.equal((await call("workspaceArchive", { sessionId: "archive", stopActivity: true })).status, 200);

// Even a stale writer cannot undo the archive persisted in workspace flags.
const { SqliteSessionHostStorage } = await import("../src/sqlite-storage.ts");
const storage = new SqliteSessionHostStorage(state.storage.sql);
const archived = await storage.getSession("archive");
await storage.putSession({ ...archived!, archived: false, running: true });
assert.equal((await storage.getSession("archive"))!.archived, true);
await assert.rejects(storage.admitSubmission({ submissionId: "late", sessionId: "archive", requestId: "late", text: "late", status: "queued", createdAt: 1, updatedAt: 1 }, [], "late"), /archived/);

// The actual Think model/tool gate rejects archived, malformed and unavailable
// authority responses; it must never swallow them as context-injection errors.
const { assertSessionActive } = await import("../../../cloudflare-think/dsh-base-cloudflare-think-core/src/session-activity.ts");
const gate = (body: unknown, status = 200) => assertSessionActive({ async fetch() { return Response.json(body, { status }); } }, "archive");
await gate({ result: { archived: false } });
await assert.rejects(gate({ result: { archived: true } }), /archived/);
await assert.rejects(gate({ result: {} }), /unavailable/);
await assert.rejects(gate({ error: "offline" }, 503), /unavailable/);
console.log("session-host: atomic archive admission, stop failure recovery, late prompt and Think step gates passed");

// A stored BYOK decryption failure is not an unset credential. Never switch
// provider/account implicitly, and retain the request for recovery after repair.
const secret = btoa("x".repeat(32));
owner = new SessionHostObject(state, { DshAgent: {} as never, CREDENTIALS_KEY: secret });
await call("create", { sessionId: "byok" });
await call("credentialsSet", { ref: "DEEPSEEK_OFFICIAL_API_KEY", value: "test-owner-key" });
const ciphertext = db.prepare("SELECT ciphertext FROM dsh_session_host_credentials WHERE ref = ?").get("DEEPSEEK_OFFICIAL_API_KEY")!.ciphertext;
db.prepare("UPDATE dsh_session_host_credentials SET ciphertext = ? WHERE ref = ?").run("broken-ciphertext", "DEEPSEEK_OFFICIAL_API_KEY");
const credentialInput = (await call("prompt", { sessionId: "byok", text: "use my key", requestId: "byok-r1" })).body.result;
const priorCredentialWrites = credentialWrites.length;
assert.equal((await claim("byok", credentialInput.submissionId)).status, 500);
assert.equal(credentialWrites.length, priorCredentialWrites);
assert.equal(modelRuns, 3);
assert.equal((await call("state", { sessionId: "byok" })).body.result.running, true);
db.prepare("UPDATE dsh_session_host_credentials SET ciphertext = ? WHERE ref = ?").run(ciphertext, "DEEPSEEK_OFFICIAL_API_KEY");
owner = new SessionHostObject(state, { DshAgent: {} as never, CREDENTIALS_KEY: secret });
assert.equal((await claim("byok", credentialInput.submissionId)).status, 200);
assert.equal(credentialWrites.at(-1), "test-owner-key");
assert.equal(modelRuns, 4);
console.log("session-host: failed BYOK read blocks provider selection and resumes after repair");
