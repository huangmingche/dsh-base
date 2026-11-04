/** Real SQLite + production DO transport; no network/model calls. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { SessionHost } from "../src/host.ts";
import { SqliteSessionHostStorage, type SqlStorage } from "../src/sqlite-storage.ts";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "agents") return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName(_ns, name) { const agent=globalThis.__lifecycleAgents.get(name); if (!agent) throw Error("unknown agent"); return agent; }')}`, shortCircuit: true };
  return next(specifier, context);
} });
const { SessionHostObject } = await import("../src/do.ts");
type Message = { id: string; role: string; parts: any[]; metadata?: { dshModelSource: { provider: string; model: string } } };
const agents = new Map<string, any>();
(globalThis as any).__lifecycleAgents = agents;

function fixture(id: string, calls = ["approve-a", "approve-b"], initialSteps = 1, options: { env?: Record<string, unknown>; agent?: Record<string, unknown>; toolOutput?: Record<string, unknown> } = {}) {
  const db = new DatabaseSync(":memory:");
  let faultEvent: string | undefined;
  const sql: SqlStorage = {
    exec(query, ...bindings) {
      if (faultEvent && query.includes("INSERT INTO dsh_session_host_events") && bindings.includes(faultEvent)) {
        faultEvent = undefined; throw new Error("event insert lost");
      }
      const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
    transactionSync(operation) {
      db.exec("BEGIN");
      try { const result = operation(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  const storage = new SqliteSessionHostStorage(sql);
  const host = new SessionHost(storage, []);
  const alarms: number[] = [];
  const state = { id: { name: `owner:${id}:default-v49` }, storage: { sql, transactionSync: sql.transactionSync, async setAlarm(at: number) { alarms.push(at); } } };
  const env = { DshAgent: {} as never, WORKER_VERSION: { id: "lifecycle-test-version" }, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway", ...(options.env ?? {}) };
  let owner = new SessionHostObject(state, env);
  let messages: Message[] = [];
  let modelRuns = 0, continuations = 0, loseResult = false, hold = false;
  let cancelFailure = false;
  let released: (() => void) | undefined;
  let begun: (() => void) | undefined;
  let outcome = "completed";
  let inputStatus = "awaiting-approval";
  const decisions = new Map<string, boolean>();
  const aliases: string[] = [];
  const agent = {
    async ensureHistory(seed: Message[]) { if (!messages.length) messages = [...seed]; },
    async setModel() {}, async setUserCredential() {},
    async admitInput(input: { requestId: string; text: string }) {
      if (!messages.some(message => message.id === input.requestId)) {
        modelRuns++;
        messages.push({ id: input.requestId, role: "user", parts: [{ type: "text", text: input.text }] },
          { id: `tools:${input.requestId}`, role: "assistant", parts: [...Array.from({ length: initialSteps - 1 }, () => [{ type: "step-start" }, { type: "text", text: "intermediate model step" }]).flat(), { type: "step-start" }, ...calls.map(toolCallId => ({ type: "dynamic-tool", toolCallId, toolName: "approve", state: "approval-requested", input: {}, ...(options.toolOutput === undefined ? {} : { output: options.toolOutput }) }))], metadata: { dshModelSource: { provider: "deepseek-official", model: "deepseek-reasoner" } } });
      }
      return { submissionId: input.requestId };
    },
    async waitForSubmission() { return { status: "completed" }; },
    async getMessages() { return messages; },
    async takeTurnStats() { return { llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }; },
    async beginInputContinuation(_requestId: string, _approvalId: string, userMessageId: string) {
      assert.ok(messages.some(message => message.role === "user" && message.id === userMessageId));
      aliases.push(userMessageId);
      return { status: inputStatus };
    },
    async getInputExecution() { return { status: inputStatus, ...(continuations > 0 ? { sdkRequestId: "sdk-continuation" } : {}) }; },
    async getExecutionStats(sdkRequestId: string) { assert.equal(sdkRequestId, "sdk-continuation"); return { sdkRequestId, steps: 1, llmMs: 5, ttftMs: 2, ttftSteps: 1, decodeMs: 3, decodeTokens: 2, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } }; },
    async resolveToolApproval(input: { requestId: string; userMessageId: string; toolCallId: string; approved: boolean }) {
      assert.ok(messages.some(message => message.id === input.userMessageId));
      if (decisions.has(input.toolCallId)) {
        assert.equal(decisions.get(input.toolCallId), input.approved);
        return { resolved: true, status: inputStatus };
      }
      decisions.set(input.toolCallId, input.approved);
      const part = messages.flatMap(message => message.parts).find(part => part.toolCallId === input.toolCallId);
      assert.ok(part); part.state = input.approved ? "output-available" : "output-denied";
      if (messages.some(message => message.parts.some(part => part.state === "approval-requested"))) return { resolved: true, status: "awaiting-approval" };
      continuations++; inputStatus = "running"; begun?.();
      if (hold) await new Promise<void>(resolve => { released = resolve; });
      if (inputStatus !== "cancelled") inputStatus = outcome;
      messages.push({ id: `continued:${input.requestId}`, role: "assistant", parts: [{ type: "text", text: input.approved ? "done" : "Denied, so I did not run that action." }] });
      if (loseResult) { loseResult = false; throw new Error("continuation reply lost"); }
      return { resolved: true, status: inputStatus, ...(inputStatus === "failed" ? { error: "provider refused" } : {}) };
    },
    async pendingApprovals() { return []; },
    async cancelInput() { if (cancelFailure) { cancelFailure = false; throw new Error("cancel lost"); } inputStatus = "cancelled"; released?.(); },
  };
  agents.set(`owner:${id}:s`, agent);
  Object.assign(agent, options.agent ?? {});
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await owner.fetch(new Request("https://host/api/session-host", { method: "POST", body: JSON.stringify({ method, params }) }));
    return { status: response.status, body: await response.json() as any };
  };
  return { db, storage, host, agent, call, alarms, aliases,
    async create() { await call("create", { sessionId: "s" }); },
    async start(requestId = "r1", text = "approve these") {
      const prompt = (await call("prompt", { sessionId: "s", requestId, text })).body.result;
      assert.equal((await call("claim", { sessionId: "s", submissionId: prompt.submissionId })).status, 200);
      return prompt;
    },
    decide(toolCallId: string, decision = "approved") { return call("resolveApproval", { sessionId: "s", toolCallId, decision }); },
    decideExecution(executionId: string, decision = "approved") { return call("resolveApproval", { sessionId: "s", executionId, decision }); },
    async restartAndAlarm() { owner = new SessionHostObject(state, env); await owner.alarm(); },
    counts: () => ({ modelRuns, continuations }),
    setMessages(value: Message[]) { messages = value; },
    inject(event: string) { faultEvent = event; },
    loseResult() { loseResult = true; },
    fail() { outcome = "failed"; },
    failCancel() { cancelFailure = true; },
    hold() { hold = true; return new Promise<void>(resolve => { begun = resolve; }); },
  };
}

// One user input survives two tool approvals and their assistant steps.
{
  const f = fixture("parallel"); await f.create(); const first = await f.start();
  assert.deepEqual((await f.call("runtimeInfo")).body.result, { versionId: "lifecycle-test-version", turnLifecycle: 1 });
  const initial = (await f.call("history", { sessionId: "s" })).body.result;
  assert.equal(initial.turns.length, 1); assert.equal(initial.turns[0].status, "awaiting-approval");
  assert.equal(initial.turns[0].requestId, "r1"); assert.equal(initial.turns[0].userMessageId, "r1");
  assert.deepEqual(initial.records[1].parts.find((part: any) => part.type === "data-dsh-model-source"), { type: "data-dsh-model-source", data: { provider: "deepseek-official", model: "deepseek-reasoner" } });
  assert.equal((await f.host.executionHistory("s")).some(message => message.parts.some((part: any) => part.type === "data-dsh-model-source")), false);
  assert.ok(initial.turns[0].startedAt > 0); assert.equal(initial.turns[0].endedAt, undefined);
  assert.deepEqual((await f.call("page", { address: { kind: "session", sessionId: "s" }, limit: 1 })).body.result.turns, initial.turns);
  assert.equal((await f.call("pendingApprovals", { sessionId: "s" })).body.result.toolApprovals.length, 2);
  const second = (await f.call("prompt", { sessionId: "s", requestId: "r2", text: "queued later" })).body.result;
  assert.deepEqual(await f.host.queuedSubmissions(), []);
  await f.call("claim", { sessionId: "s", submissionId: second.submissionId });
  assert.equal(f.counts().modelRuns, 1);
  await assert.rejects(f.host.updateQueue({ sessionId: "s", itemId: first.submissionId, action: "retry" }), /no longer pending/);
  const before = (await f.storage.getSubmission(first.submissionId))!.status;
  for (const params of [
    { toolCallId: "approve-a" }, { toolCallId: "approve-a", decision: "yes" },
    { toolCallId: "approve-a", executionId: "other", decision: "approved" },
    { toolCallId: "", decision: "approved" }, { toolCallId: 12, decision: "approved" },
    { toolCallId: "unknown", decision: "approved" }, { executionId: "foreign", decision: "approved" },
  ]) assert.equal((await f.call("resolveApproval", { sessionId: "s", ...params })).status, 400);
  assert.equal((await f.storage.getSubmission(first.submissionId))!.status, before);
  // Atomic intent/state rollback: no action is sent when the event write fails.
  f.inject("submission.approval-continuing");
  assert.equal((await f.decide("approve-a")).status, 503);
  assert.equal((await f.storage.getSubmission(first.submissionId))!.status, "awaiting-approval");
  assert.equal(await f.host.approvalContinuation("s", first.submissionId), undefined);
  assert.equal(f.counts().continuations, 0);
  assert.equal((await f.decide("approve-a")).status, 200);
  assert.equal((await f.storage.getSubmission(first.submissionId))!.status, "awaiting-approval");
  assert.equal((await f.decide("approve-a")).status, 200);
  assert.equal((await f.decide("approve-a", "rejected")).status, 409);
  assert.equal(f.counts().continuations, 0);
  assert.equal((await f.decide("approve-b", "rejected")).status, 200);
  const history = await f.host.history({ sessionId: "s" });
  assert.deepEqual(history.turns.map(turn => [turn.requestId, turn.status]), [["r1", "completed"], ["r2", "queued"]]);
  assert.equal(history.turns[0]!.startedAt, initial.turns[0].startedAt);
  assert.ok(history.turns[0]!.endedAt! >= history.turns[0]!.startedAt!);
  assert.deepEqual(history.records.map(message => message.id), ["r1", "tools:r1", "continued:r1", "r2"]);
  assert.equal((await f.call("pendingApprovals", { sessionId: "s" })).body.result.toolApprovals.length, 0);
  assert.deepEqual(await f.host.queuedSubmissions(), [{ sessionId: "s", submissionId: second.submissionId }]);
  assert.equal((await f.decide("approve-b", "rejected")).status, 200);
  assert.equal(f.counts().continuations, 1);
  const statistics = await f.host.projections({ sessionId: "s" });
  assert.equal(statistics.sessionStats.turns, 1); assert.equal(statistics.sessionStats.steps, 2);
  assert.equal(statistics.sessionStats.llmMs, 5); assert.equal(statistics.tokenUsage.outputTokens, 2);
  await f.host.fork({ sessionId: "s", messageId: "tools:r1", sessionIdNew: "cut" });
  assert.equal((await f.host.history({ sessionId: "cut" })).turns[0]!.status, "forked");
  await f.host.fork({ sessionId: "s", messageId: "continued:r1", sessionIdNew: "full" });
  assert.deepEqual((await f.host.history({ sessionId: "full" })).turns[0], history.turns[0]);
}

// Process loss after accepting the decision but before sending any action.
{
  const f = fixture("before-action", ["only"]); await f.create(); const prompt = await f.start();
  await f.host.beginApproval({ sessionId: "s", toolCallId: "only", decision: "approved" });
  assert.equal((await f.storage.getSubmission(prompt.submissionId))!.status, "continuing");
  assert.equal(f.counts().continuations, 0);
  await f.restartAndAlarm();
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "completed");
  assert.deepEqual(f.counts(), { modelRuns: 1, continuations: 1 });
  const statistics = await f.host.projections({ sessionId: "s" });
  assert.equal(statistics.sessionStats.steps, 2); assert.equal(statistics.sessionStats.turns, 1);
  assert.equal(statistics.sessionStats.llmMs, 5); assert.equal(statistics.tokenUsage.outputTokens, 2);
}

// Concurrent retries share the per-Session writer; a different Session cannot
// use the same tool id to authorize another Session's action.
{
  const f = fixture("racing", ["only"]); await f.create(); await f.start();
  await f.host.create({ sessionId: "other" });
  agents.set("owner:racing:other", { async getMessages() { return []; }, async pendingApprovals() { return []; } });
  assert.equal((await f.call("resolveApproval", { sessionId: "other", toolCallId: "only", decision: "approved" })).status, 400);
  assert.equal((await f.storage.listSubmissions("other")).length, 0);
  // The unchanged official Allow once seam and older deployed clients use
  // allowed-once; it is the same durable decision as the canonical spelling.
  const responses = await Promise.all([f.decide("only", "allowed-once"), f.decide("only")]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(f.counts(), { modelRuns: 1, continuations: 1 });
  assert.equal((await f.decide("only", "allowed-once")).status, 200);
  assert.equal((await f.decide("only", "rejected")).status, 409);
}

// A lost continuation response and a lost terminal SQLite write are recovered
// from the exact durable decision, without repeating the initial model input.
for (const fault of ["rpc", "sql"] as const) {
  const f = fixture(`recover-${fault}`, ["only"]); await f.create(); const prompt = await f.start();
  if (fault === "rpc") f.loseResult(); else f.inject("submission.completed");
  assert.equal((await f.decide("only")).status, 503);
  assert.equal((await f.storage.getSubmission(prompt.submissionId))!.status, "continuing");
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "running");
  assert.ok(await f.host.approvalContinuation("s", prompt.submissionId));
  await f.restartAndAlarm();
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "completed");
  assert.deepEqual(f.counts(), { modelRuns: 1, continuations: 1 });
  const statistics = await f.host.projections({ sessionId: "s" });
  assert.equal(statistics.sessionStats.steps, 2); assert.equal(statistics.sessionStats.turns, 1);
  assert.equal(statistics.sessionStats.llmMs, 5); assert.equal(statistics.tokenUsage.outputTokens, 2);
}

// Multiple persisted SDK step-start groups inside one assistant message count
// separately even without an approval continuation.
{
  const f = fixture("multi-step", [], 2); await f.create(); await f.start();
  const projection = await f.host.projections({ sessionId: "s" });
  assert.equal(projection.sessionStats.turns, 1); assert.equal(projection.sessionStats.steps, 2);
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "completed");
}

// Cancellation wins a late continuation result; terminal history cannot expose
// an approval card, even if a stale Agent transcript retains requested parts.
{
  const f = fixture("cancel", ["only"]); await f.create(); await f.start();
  const started = f.hold(); const deciding = f.decide("only"); await started;
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "running");
  assert.equal((await f.call("cancel", { sessionId: "s" })).status, 200);
  await deciding;
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "cancelled");
  f.setMessages([{ id: "r1", role: "user", parts: [{ type: "text", text: "approve these" }] }, { id: "stale", role: "assistant", parts: [{ state: "approval-requested", toolCallId: "only" }] }]);
  assert.equal((await f.call("pendingApprovals", { sessionId: "s" })).body.result.toolApprovals.length, 0);
  assert.equal((await f.decide("only")).status, 400);
}
{
  const f = fixture("failed", ["only"]); await f.create(); await f.start(); f.fail();
  assert.equal((await f.decide("only")).status, 200);
  const turn = (await f.host.history({ sessionId: "s" })).turns[0]!;
  assert.equal(turn.status, "failed"); assert.equal(turn.error, "provider refused");
  assert.equal((await f.call("pendingApprovals", { sessionId: "s" })).body.result.toolApprovals.length, 0);
}
{
  const f = fixture("archive-waiting", ["only"]); await f.create(); await f.start();
  assert.equal((await f.call("workspaceArchive", { sessionId: "s" })).body.error.code, "workspace/session-active");
  f.failCancel();
  assert.equal((await f.call("workspaceArchive", { sessionId: "s", stopActivity: true })).status, 503);
  assert.equal((await f.call("pendingApprovals", { sessionId: "s" })).body.result.toolApprovals.length, 0);
  assert.equal((await f.host.queuedSubmissions()).length, 1);
  await f.restartAndAlarm();
  assert.equal((await f.host.history({ sessionId: "s" })).turns[0]!.status, "cancelled");
  assert.equal((await f.host.state({ sessionId: "s" })).archived, true);
  assert.deepEqual(f.counts(), { modelRuns: 1, continuations: 0 });
}

// Unique legacy random ids are explicitly passed to Think; ambiguous repeated
// text and imported history never receive invented successful outcomes.
{
  const f = fixture("legacy", ["only"]); await f.create(); const prompt = await f.start();
  const records = (await f.host.history({ sessionId: "s" })).records.map(record => ({ ...record, id: record.id === "r1" ? "legacy-user" : record.id }));
  await f.storage.replaceMessages("s", records);
  f.setMessages(records.map(record => ({ ...record, parts: [...record.parts] })));
  await f.storage.putSubmission({ ...(await f.storage.getSubmission(prompt.submissionId))!, status: "completed" });
  assert.equal((await f.host.state({ sessionId: "s" })).running, true);
  assert.equal((await f.decide("only")).status, 200);
  assert.equal(f.aliases.at(-1), "legacy-user");
  assert.deepEqual((await f.host.history({ sessionId: "s" })).turns.map(turn => [turn.requestId, turn.userMessageId, turn.status]), [["r1", "legacy-user", "completed"]]);
  await f.host.create({ sessionId: "unknown" });
  await f.storage.appendMessages("unknown", [{ id: "unknown-user", seq: 1, role: "user", parts: [] }, { id: "unknown-answer", seq: 2, role: "assistant", parts: [{ type: "text", text: "looks completed" }] }]);
  assert.deepEqual((await f.host.history({ sessionId: "unknown" })).turns, [{ requestId: "unknown-user", userMessageId: "unknown-user", status: "unknown" }]);
  await f.host.create({ sessionId: "ambiguous" });
  for (const id of ["a", "b"]) await f.host.prompt({ sessionId: "ambiguous", requestId: id, text: "same" });
  await f.storage.replaceMessages("ambiguous", ["old-a", "old-b"].map((id, index) => ({ id, seq: index + 1, role: "user", parts: [{ type: "text", text: "same" }] })));
  for (const row of await f.storage.listSubmissions("ambiguous")) await f.storage.putSubmission({ ...row, status: "completed" });
  await f.storage.putSession({ ...(await f.storage.getSession("ambiguous"))!, running: false });
  assert.deepEqual((await f.host.history({ sessionId: "ambiguous" })).turns.map(turn => turn.status), ["unknown", "unknown"]);
}
console.log("session-host: authoritative turns, parallel approvals, negative authorization, atomic intent/terminal faults, restart, cancellation, fork and legacy identity passed");

// A live policy change to never denies existing parallel requests after restart.
{
  const f = fixture('never-policy', ['first','second']); await f.create(); await f.start();
  assert.equal((await f.call('selectPermission',{sessionId:'s',preset:'danger-full-access'})).status,200);
  await f.restartAndAlarm();
  assert.equal((await f.host.history({sessionId:'s'})).turns[0]!.status,'awaiting-approval');
  await f.restartAndAlarm();
  assert.equal((await f.host.history({sessionId:'s'})).turns[0]!.status,'completed');
  const tools=(await f.agent.getMessages()).flatMap(message=>message.parts).filter(part=>part.toolCallId);
  assert.ok(tools.every(part=>part.state==='output-denied'));
  assert.equal(f.counts().continuations,1);
  assert.equal((await f.call('pendingApprovals',{sessionId:'s'})).body.result.toolApprovals.length,0);
}
console.log('session-host: persisted never policy rejects pending parallel approvals across restart, then completes one continuation');

// Missing historical execution configuration does not become an endless alarm loop.
{
  const f=fixture('missing-config',['only']); await f.create(); await f.start();
  f.agent.beginInputContinuation=async()=>{throw new Error('input_configuration_unavailable');};
  const failed=await f.decide('only');
  assert.equal(failed.status,409); assert.equal(failed.body.error.code,'session/input-configuration-unavailable');
  assert.equal((await f.host.history({sessionId:'s'})).turns[0]!.status,'awaiting-approval');
  assert.deepEqual(await f.host.queuedSubmissions(),[]);
  await f.call('selectPermission',{sessionId:'s',preset:'danger-full-access'});
  await f.restartAndAlarm();
  assert.equal(f.counts().continuations,0);
  assert.equal((await f.call('pendingApprovals',{sessionId:'s'})).body.result.toolApprovals.length,1);
}
console.log('session-host: legacy configuration gaps retain the approval and cancel path without blind retry or model switching');

// Zero-model approval continuation: disabled memory must reject a pending
// remember_fact approval; enabled memory follows the normal continuation path.
{
  const memoryState = { revision: 1, overrides: { "@dsh-base/cloudflare-think-memory": { disabled: true } } };
  const pluginControl = { idFromName: (name: string) => name, get: () => ({ async fetch() { return Response.json(memoryState) } }) };
  let thinkSelection: string[] | undefined;
  const f = fixture("memory-disabled", ["call-memory"], 1, { env: { PluginControl: pluginControl }, toolOutput: { status: "paused", executionId: "exec-memory" }, agent: {
    setThinkPlugins(input: { disabled?: readonly string[] }) { thinkSelection = [...(input.disabled ?? [])]; return { disabled: thinkSelection } },
    pendingApprovals() { return [{ executionId: "exec-memory", source: "action", descriptor: { action: "remember_fact", summary: "Save a durable memory" } }] },
  } });
  await f.create(); await f.start();
  const rejected = await f.decideExecution("exec-memory");
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, "session/approval-capability-disabled");
  assert.deepEqual(thinkSelection, ["memory"]);
}
{
  const memoryState = { revision: 1, overrides: { "@dsh-base/cloudflare-think-memory": { disabled: false } } };
  const pluginControl = { idFromName: (name: string) => name, get: () => ({ async fetch() { return Response.json(memoryState) } }) };
  const f = fixture("memory-enabled", ["call-memory"], 1, { env: { PluginControl: pluginControl }, agent: {
    setThinkPlugins() { return { disabled: [] } },
    pendingApprovals() { return [{ executionId: "exec-memory", source: "action", descriptor: { action: "remember_fact", summary: "Save a durable memory" } }] },
  } });
  await f.create(); await f.start();
  const allowed = await f.call("resolveApproval", { sessionId: "s", executionId: "exec-memory", decision: "approved" });
  assert.notEqual(allowed.status, 409, "enabled memory approval is not capability-rejected");
}
console.log("approval continuation: disabled memory refuses pending remember_fact with zero model; enabled memory is not capability-blocked");
