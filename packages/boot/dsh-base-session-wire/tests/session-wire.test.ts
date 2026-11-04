/** Logical user Turns, real lifecycle finalization and deterministic incremental/cold journals. */
import assert from "node:assert/strict";
import { buildSessionHistory, deriveSessionProjections, SessionWireSequencer, SessionLiveFrameSequencer, textOf, assistantStepMessageId, assistantStepMessageSource, type SessionTurnState, type SessionWireRecord } from "../src/index.ts";
const user = (id: string, text = id) => ({ id, role: "user", parts: [{ type: "text", text }] });
const assistant = (id: string, text: string) => ({ id, role: "assistant", parts: [{ type: "text", text }] });
const state = (requestId: string, status: SessionTurnState["status"], error?: string): SessionTurnState => ({ requestId, status, ...(error ? { error } : {}) });
const events = (records: readonly SessionWireRecord[]) => records.map(({ event: { type, seq, data, surfaceOp } }) => ({ type, seq, data: clean(data), surfaceOp }));
function clean(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (key, item) => key === "time0" ? 0 : item)); }
const types = (records: readonly SessionWireRecord[]) => records.map(r => r.event.type);
const prompt = user("approval-request", "remember");
const pending = { id: "tool-message", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-remember_fact", toolCallId: "call", toolName: "remember_fact", state: "approval-requested", input: { fact: "value" } }] };
const done = { ...pending, parts: [{ type: "step-start" }, { ...pending.parts[1]!, state: "output-available", output: { saved: true } }] };
const answer = assistant("answer", "OK");
const resumed = { attemptId: "resumed", requestId: prompt.id, turn: 17, step: 23, chunks: [{ type: "text-delta", index: 0, text: "OK" }], tools: [{ callId: "call", name: "remember_fact", state: "done" as const, output: { saved: true } }] };
const completed = [state(prompt.id, "completed")];
for (const liveFirst of [true, false]) {
  const journal = new SessionWireSequencer([prompt, pending], { turns: [state(prompt.id, "awaiting-approval")] });
  assert.deepEqual(types(journal.records), ["turn/start", "user/message", "step/start", "assistant/message", "tool/call"]);
  const frames = new SessionLiveFrameSequencer();
  for (const record of journal.records) frames.accept(record);
  assert.deepEqual(frames.observe(resumed), [], "continuation tokens cannot land in the pending tool Step");
  if (liveFirst) {
    const next = journal.observeLive(resumed);
    assert.deepEqual(types(next), ["tool/result", "step/end", "step/start"]);
    for (const record of next) frames.accept(record);
    const liveFrames = frames.observe(resumed) as Array<{ frame: { type: string; turn?: number; step?: number } }>;
    assert.deepEqual(liveFrames.map(f => f.frame.type), ["start", "chunk"]);
    assert.equal(liveFrames[0]!.frame.turn, 1); assert.equal(liveFrames[0]!.frame.step, 2);
    assert.deepEqual(journal.observeLive(resumed), []);
  }
  const suffix = journal.pushMessages([prompt, done, answer], completed);
  for (const record of suffix) frames.accept(record);
  assert.deepEqual(journal.pushMessages([prompt, done, answer], completed), []);
  assert.deepEqual(journal.observeLive(resumed), [], "settled snapshots cannot reopen a Turn");
  assert.deepEqual(frames.observe(resumed), []);
  assert.deepEqual(types(journal.records), ["turn/start", "user/message", "step/start", "assistant/message", "tool/call", "tool/result", "step/end", "step/start", "assistant/message", "step/end", "turn/end"]);
  assert.deepEqual(journal.records.filter(r => r.event.type === "assistant/message").map(r => clean(r.event.data)), buildSessionHistory([prompt, done, answer], undefined, completed).filter(r => r.event.type === "assistant/message").map(r => clean(r.event.data)), "same assistant ids/content after reload");
  assert.deepEqual(events(journal.records), events(buildSessionHistory([prompt, done, answer], undefined, completed)), "live-first and durable-first reconstruct identical dense sequences");
}

// Explicit lifecycle closes text-only, tool-only, empty, cancelled and failed executions.
for (const status of ["running", "awaiting-approval", "completed", "cancelled", "failed"] as const) {
  const journal = new SessionWireSequencer([prompt, answer], { turns: [state(prompt.id, status, "real failure")] });
  const endings = journal.records.filter(r => r.event.type === "turn/end");
  assert.equal(endings.length, status === "running" || status === "awaiting-approval" ? 0 : 1);
  if (endings.length) assert.equal((endings[0]!.event.data as { reason: { kind: string } }).reason.kind, status === "cancelled" ? "aborted" : status === "failed" ? "error" : "completed");
}
for (const rows of [[prompt, done], [prompt], [prompt, assistant("empty", "")]]) {
  const records = buildSessionHistory(rows, undefined, completed);
  assert.equal(types(records).filter(t => t === "turn/end").length, 1, "tool-only/empty terminal uses Host completion, not text inference");
}
assert.ok(!types(buildSessionHistory([prompt, answer])).includes("turn/end"), "unknown lifecycle never fabricates completion");
assert.ok(!types(buildSessionHistory([prompt, pending], undefined, completed)).includes("turn/end"), "stale completed cannot override pending approval evidence");
for (const status of ["cancelled", "failed"] as const) assert.ok(types(buildSessionHistory([prompt, pending], undefined, [state(prompt.id, status)])).includes("turn/end"));

// A queued second input must wait behind the first reply, even if the inbox row arrived earlier.
const second = user("second", "remember");
const queue = new SessionWireSequencer([prompt, pending, second], { turns: [state(prompt.id, "awaiting-approval"), state(second.id, "queued")] });
assert.equal(types(queue.records).filter(t => t === "user/message").length, 1);
const finalRows = [prompt, done, answer, second, assistant("answer-2", "again")];
const finalStates = [...completed, state(second.id, "completed")];
queue.pushMessages(finalRows, finalStates);
assert.equal(types(queue.records).filter(t => t === "turn/start").length, 2);
assert.equal(types(queue.records).filter(t => t === "user/message").length, 2, "identical text with different request identity is not deduplicated");
assert.deepEqual(events(queue.records), events(buildSessionHistory(finalRows, undefined, finalStates)));
assert.deepEqual(queue.observeLive(resumed), [], "old request cannot update another Turn");

// Multiple AI SDK step-start groups in a single assistant row are distinct steps in one Turn.
const combined = { id: "multi-step", role: "assistant", parts: [...done.parts, { type: "step-start" }, { type: "text", text: "OK" }] };
const grouped = buildSessionHistory([prompt, combined], undefined, completed);
assert.equal(types(grouped).filter(t => t === "turn/start").length, 1);
assert.equal(types(grouped).filter(t => t === "step/start").length, 2);
assert.deepEqual(grouped.filter(r => r.event.type === "assistant/message").map(r => (r.event.data as { step: number }).step), [1, 2]);

// Parallel calls have a canonical call-batch/result-batch order independent of result arrival.
const parallel = { id: "parallel", role: "assistant", parts: [1, 2].map(n => ({ type: "tool-test", toolCallId: `c${n}`, state: "approval-requested" })) };
const parallelDone = { ...parallel, parts: parallel.parts.map(part => ({ ...part, state: "output-available", output: part.toolCallId })) };
const parallelJournal = new SessionWireSequencer([prompt, parallel], { turns: [state(prompt.id, "awaiting-approval")] });
assert.deepEqual(parallelJournal.observeLive({ ...resumed, chunks: [], tools: [{ callId: "c2", name: "test", state: "done", output: "c2" }] }), []);
parallelJournal.observeLive({ ...resumed, chunks: [], tools: [{ callId: "c1", name: "test", state: "done", output: "c1" }] });
parallelJournal.pushMessages([prompt, parallelDone], completed);
assert.deepEqual(events(parallelJournal.records), events(buildSessionHistory([prompt, parallelDone], undefined, completed)));

const correlated = buildSessionHistory([prompt], () => "rpc-1", [state(prompt.id, "running")]);
assert.equal((correlated.find(record => record.event.type === "user/message")!.event.data as { source: { rpcId: string } }).source.rpcId, prompt.id, "authoritative request identity wins over a text-based client fallback");
const aliased = new SessionWireSequencer([user("legacy-user")], { turns: [{ requestId: "actual-request", userMessageId: "legacy-user", status: "running" }] });
const aliasedFrames = new SessionLiveFrameSequencer();
for (const record of aliased.records) aliasedFrames.accept(record);
for (const record of aliased.observeLive({ ...resumed, requestId: "actual-request", startedAt: 2000 })) aliasedFrames.accept(record);
assert.equal(aliasedFrames.observe({ ...resumed, requestId: "actual-request" }).length, 2, "legacy message id uses its canonical request for live matching");
assert.deepEqual(aliasedFrames.observe({ ...resumed, attemptId: "wrong", requestId: "wrong-request" }), []);
assert.equal(textOf({ parts: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
const projections = deriveSessionProjections({ usage: { inputTokens: 5000, outputTokens: 10, cacheReadTokens: 100 } }, { model: "deepseek-flash" });
assert.deepEqual(projections.modelSelection, { lastUsed: null, next: { provider: "legacy", model: "deepseek-flash" } });
assert.deepEqual(deriveSessionProjections({}, { model: "deepseek-v4-pro" }).modelSelection,
  { lastUsed: null, next: { provider: "legacy", model: "deepseek-v4-pro" } }, "cold Pro projection preserves the legacy compatibility marker for a bare old model");
assert.deepEqual(deriveSessionProjections({}, {}).modelSelection, { lastUsed: null, next: null }, "unknown execution history is not inferred from a default model");
assert.deepEqual(deriveSessionProjections({ modelSelection: projections.modelSelection }, {}).modelSelection, projections.modelSelection, "normalization preserves an already normalized durable projection");
assert.deepEqual(projections.tokenUsage, { uncachedInputTokens: 4900, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 0 });
console.log("session-wire: logical user Turns, multi-step approval, lifecycle completion/cancel/error, queued identities, parallel results and deterministic live/reload passed");

const timed = buildSessionHistory([prompt, answer], undefined, [{ requestId: prompt.id, status: "completed", startedAt: 1000, endedAt: 8500 }]);
assert.equal(timed.find(r => r.event.type === "turn/start")!.event.time, 1000);
assert.equal(timed.find(r => r.event.type === "turn/end")!.event.time, 8500);
const forked = buildSessionHistory([prompt, pending], undefined, [{ requestId: prompt.id, status: "forked", startedAt: 1000, endedAt: 3500 }]);
assert.deepEqual((forked.at(-1)!.event.data as { reason: unknown }).reason, { kind: "forked" });

for (const toolState of ["output-denied", "output-error"] as const) {
  const failedTool = { ...pending, parts: [{ ...pending.parts[1]!, state: toolState, errorText: "denied" }] };
  const result = buildSessionHistory([prompt, failedTool, answer], undefined, completed).find(r => r.event.type === "tool/result")!;
  assert.equal((result.event.data as { message: { isError?: boolean } }).message.isError, true);
}
const pro = { ...answer, parts: [...answer.parts, { type: "data-dsh-model-source", data: { provider: "deepseek-official", model: "deepseek-reasoner" } }] };
const proMessage = buildSessionHistory([prompt, pro], undefined, completed).find(r => r.event.type === "assistant/message")!.event.data as { message: { source: unknown; content: unknown[] } };
assert.deepEqual(proMessage.message.source, { kind: "model", provider: "deepseek-official", model: "deepseek-reasoner" });
assert.deepEqual(proMessage.message.content, [{ type: "text", text: "OK" }], "source metadata is not visual message content");
assert.deepEqual((buildSessionHistory([prompt, answer], undefined, completed).find(r => r.event.type === "assistant/message")!.event.data as { message: { source: unknown } }).message.source, { kind: "model", provider: "unknown", model: "unknown" });

const stepIdentities = grouped.filter(r => r.event.type === "assistant/message").map(r => (r.event.data as { message: { id: string } }).message.id);
assert.equal(new Set(stepIdentities).size, 2, "each official assistant step has its own immutable message identity");
assert.deepEqual(assistantStepMessageSource(stepIdentities[0]!), { messageId: "multi-step", assistantStep: 0 });
const growing = new SessionWireSequencer([prompt, { ...combined, parts: done.parts }], { turns: [state(prompt.id, "running")] });
const firstId = (growing.records.find(r => r.event.type === "assistant/message")!.event.data as { message: { id: string } }).message.id;
growing.pushMessages([prompt, combined], completed);
assert.equal((growing.records.find(r => r.event.type === "assistant/message")!.event.data as { message: { id: string } }).message.id, firstId);
assert.equal(firstId, assistantStepMessageId("multi-step", 0));
assert.deepEqual(events(growing.records), events(grouped));
