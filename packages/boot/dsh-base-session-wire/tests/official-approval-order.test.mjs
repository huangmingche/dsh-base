/** Actual pinned Conversation assembler and turn-process definition, no surrogate validator. */
import assert from "node:assert/strict";
import { ConversationNodeAssembler } from "@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts";
import { turnProcessDefinition } from "@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/turn-process.ts";
import { buildSessionHistory, SessionWireSequencer, SessionLiveFrameSequencer } from "../src/index.ts";

// A collector reads actual official materialized nodes and timeline without
// substituting its event matching, location index or turn-process definition.
const collector = { target: "chat", create() { const nodes = new Map(); return {
  empty: { nodes: [], timeline: undefined },
  replace(input) { nodes.clear(); for (const node of input.nodes) nodes.set(node.key, node); return { nodes: [...nodes.values()], timeline: input.timeline }; },
  apply(input) { for (const node of input.upserts) nodes.set(node.key, node); return { nodes: [...nodes.values()], timeline: input.timeline }; },
}; } };
const assembler = () => { const instance = new ConversationNodeAssembler({ entries: () => [turnProcessDefinition], fallbackEntry: () => undefined }, { entries: () => [collector] }); instance.activateTarget("chat"); return instance; };
const record = (seq, type, data) => ({ type: "event", event: { seq, time: seq, type, data } });
const broken = assembler();
broken.append(record(1, "tool/call", { turn: 2, step: 1, callId: "call", name: "remember_fact", arguments: "{}" }));
assert.throws(() => broken.append(record(2, "turn/start", { turn: 2 })), /received an update before its start Match/, "the real official assembler reproduces the production failure");

const user = { id: "request", role: "user", parts: [{ type: "text", text: "remember" }] };
const pending = { id: "tool-message", role: "assistant", parts: [{ type: "tool-remember_fact", toolCallId: "call", toolName: "remember_fact", input: { fact: "value" }, state: "approval-requested" }] };
const done = { ...pending, parts: [{ ...pending.parts[0], state: "output-available", output: { saved: true } }] };
const answer = { id: "answer", role: "assistant", parts: [{ type: "text", text: "OK" }] };

for (const liveFirst of [true, false]) {
  const journal = new SessionWireSequencer([user, pending], { turns: [{ requestId: user.id, status: "awaiting-approval" }] });
  const contexts = assembler();
  const frames = new SessionLiveFrameSequencer();
  contexts.replaceWindow(journal.records, false);
  contexts.flush();
  assert.equal(contexts.openTurn(), 1);
  assert.equal(contexts.snapshot("chat").nodes.length, 1);
  assert.equal(contexts.snapshot("chat").timeline.turns.get(1).status, "open");
  for (const entry of journal.records) frames.accept(entry);
  let cursor = journal.cursor;
  let active;
  let transient = 0;
  const applyFrames = (values) => {
    for (const { frame } of values) {
      if (frame.type === "start") { active = frame; transient = 0; }
      if (frame.type === "chunk") {
        assert.ok(active, "live chunk has its stream start");
        contexts.append({ type: "transient", event: { type: "assistant/live-chunk", seq: cursor + 1 - 1 / (++transient + 1), time: Date.now(),
          data: { attemptId: active.attemptId, turn: active.turn, step: active.step, chunk: frame.chunk } } });
      }
      if (frame.type === "end") active = undefined;
    }
  };
  const append = (entries) => {
    for (const entry of entries) {
      cursor = entry.event.seq; transient = 0;
      contexts.append(entry);
      applyFrames(frames.accept(entry));
    }
  };
  const live = { attemptId: "continued", turn: 28, step: 35, chunks: [{ type: "text-delta", index: 0, text: "OK" }],
    tools: [{ callId: "call", name: "remember_fact", state: "done", output: { saved: true } }] };
  // The fast Agent socket precedes the slower Host journal. No Context update
  // can escape until turn/start and step/start have actually been consumed.
  assert.deepEqual(frames.observe(live), []);
  if (liveFirst) {
    append(journal.observeLive(live));
    applyFrames(frames.observe(live));
  }
  append(journal.pushMessages([user, done, answer], [{ requestId: user.id, status: "completed" }]));
  assert.equal(journal.pushMessages([user, done, answer], [{ requestId: user.id, status: "completed" }]).length, 0);
  if (liveFirst) assert.deepEqual(frames.observe(live), []);
  const events = journal.records.map(r => r.event);
  assert.equal(events.filter(e => e.type === "user/message").length, 1);
  assert.equal(events.filter(e => e.type === "tool/call").length, 1);
  assert.equal(events.filter(e => e.type === "tool/result").length, 1);
  assert.deepEqual(events.map(e => e.seq), events.map((_, index) => index + 1));
  assert.equal(events.find(e => e.type === "tool/result").data.turn, events.find(e => e.type === "tool/call").data.turn);
  assert.equal(contexts.openTurn(), undefined);
  contexts.flush();
  const actual = contexts.snapshot("chat");
  assert.equal(actual.nodes.length, 1, "one official process node for one admitted prompt");
  assert.deepEqual(actual.timeline.turnOrder, [1]);
  assert.equal(actual.timeline.turns.get(1).steps.length, 2);
  assert.equal(actual.timeline.turns.get(1).status, "closed");
  const reloaded = assembler();
  reloaded.replaceWindow(buildSessionHistory([user, done, answer], undefined, [{ requestId: user.id, status: "completed" }]), false);
  assert.equal(reloaded.openTurn(), undefined);
}
console.log("official assembler: reproduced prior approval failure; live-first/durable-first continuation, same-id tool result, replay and reload pass");

// Explicitly unknown legacy/truncated outcomes remain open; later inputs are
// still materialized, and the official index accepts them without fake endings.
const old = { id: "old", role: "user", parts: [{ type: "text", text: "old" }] };
const legacyRecords = buildSessionHistory([old, { ...answer, id: "old-answer" }, user, done, answer], undefined,
  [{ requestId: old.id, status: "unknown" }, { requestId: user.id, status: "completed" }]);
const legacy = assembler(); legacy.replaceWindow(legacyRecords, false); legacy.flush();
assert.deepEqual(legacy.snapshot("chat").timeline.turnOrder, [1, 2]);
assert.equal(legacy.snapshot("chat").nodes.length, 2);
assert.equal(legacy.snapshot("chat").timeline.turns.get(1).status, "open");
assert.equal(legacy.snapshot("chat").timeline.turns.get(2).status, "closed");
assert.equal(legacyRecords.filter(r => r.event.type === "user/message").length, 2);
assert.equal(legacyRecords.filter(r => r.event.type === "turn/end").length, 1);
console.log("official assembler: one approval Turn / two Steps / one process node; unknown legacy keeps subsequent inputs visible without invented completion");
