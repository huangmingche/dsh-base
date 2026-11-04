import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import {
  cutSessionPage,
  forkMessageIdFor,
  toOfficialModelCatalog,
  toOfficialProjections,
  toOfficialSelection,
  toOfficialState,
  toOfficialSummary,
} from "../src/remote-mapping.ts";

// The Worker build resolves workspace packages through Vite aliases; these
// plain-Node tests run without an installed workspace tree.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dsh-base/session-wire") {
      return {
        url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { registerSessionRemoteEndpoints } = await import("../src/remote.ts");

const registered: string[] = [];
const disposed: string[] = [];
const handlers = new Map<string, (payload: unknown, invocation: unknown) => unknown>();
const wireRpc = {
  register(method: string, _handler: unknown) {
    registered.push(method);
    handlers.set(method, _handler as (payload: unknown, invocation: unknown) => unknown);
    return () => { disposed.push(method); };
  },
};
const dispose = registerSessionRemoteEndpoints(wireRpc as never);
assert.deepEqual([...registered].sort(), [
  "session/cancel",
  "session/create",
  "session/fork",
  "session/list",
  "session/modelCatalog",
  "session/page",
  "session/projections",
  "session/prompt",
  "session/rename",
  "session/selectModel",
  "session/state",
  "session/updateQueue",
]);
dispose();
assert.equal(disposed.length, registered.length);
await assert.rejects(async () => handlers.get("session/selectModel")!({ args: { request: { sessionId: "test", model: "deepseek-flash", reasoningEffort: "unsupported" } } }, {}),
  (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "gateway/bad-request",
  "unknown effort is rejected before any Host mutation");

const journal = [
  { type: "turn/start", seq: 1 },
  { type: "step/start", seq: 2 },
  { type: "user/message", seq: 3 },
  { type: "assistant/message", seq: 4 },
  { type: "step/end", seq: 5 },
  { type: "turn/end", seq: 6 },
  { type: "turn/start", seq: 7 },
  { type: "step/start", seq: 8 },
  { type: "user/message", seq: 9 },
  { type: "assistant/message", seq: 10 },
  { type: "step/end", seq: 11 },
  { type: "turn/end", seq: 12 },
].map(({ type, seq }) => ({
  type: "event" as const,
  event: { type, seq, time: 0, data: {} },
}));

assert.deepEqual(cutSessionPage(journal, { throughSeq: -1 }), { records: [], hasMore: false });
const full = cutSessionPage(journal, {});
assert.equal(full.records.length, journal.length);
assert.equal(full.hasMore, false);
const through = cutSessionPage(journal, { throughSeq: 10 });
assert.deepEqual(through.records.map((record) => record.event.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.equal(through.hasMore, false);
const older = cutSessionPage(journal, { throughSeq: 12, beforeSeq: 7 });
assert.deepEqual(older.records.map((record) => record.event.seq), [1, 2, 3, 4, 5, 6]);
assert.equal(older.hasMore, false);
const limited = cutSessionPage(journal, { maxMessages: 2 });
assert.deepEqual(limited.records.map((record) => record.event.seq), [9, 10, 11, 12]);
assert.equal(limited.hasMore, true);
const turnCut = cutSessionPage(journal, { turnWindow: { minMessages: 1, minTurns: 1 } });
assert.deepEqual(turnCut.records.map((record) => record.event.seq), [7, 8, 9, 10, 11, 12]);
assert.equal(turnCut.hasMore, true);
const twoTurns = cutSessionPage(journal, { turnWindow: { minMessages: 1, minTurns: 2 } });
assert.equal(twoTurns.records.length, journal.length);
assert.equal(twoTurns.hasMore, false);

assert.deepEqual(toOfficialSummary({
  sessionId: "s1",
  title: "Hello",
  displayTitle: "Hello",
  running: true,
  blank: false,
  updatedAt: 42,
  cwd: "/work",
  workspaceId: "w1",
}), {
  agentAvailable: true,
  sessionId: "s1",
  updatedAt: 42,
  running: true,
  blank: false,
  cwd: "/work",
  workspaceId: "w1",
  projections: { kind: "cached", values: { title: "Hello", agentPreset: "dsh-base-think" } },
});
assert.deepEqual(toOfficialState({ running: true }), { cursor: 0, active: true, running: true, queue: null, pendingInput: [] });
const projections = toOfficialProjections({ _dshBaseProjectionRevision: 12, usage: { inputTokens: 3 } });
assert.equal(projections.kind, "sequenced");
assert.equal(projections.asOfSeq, 12);
assert.deepEqual(projections.values.usage, { inputTokens: 3 });
assert.equal((projections.values.imageLimits as { maxImagesPerMessage: number }).maxImagesPerMessage, 0);
assert.deepEqual(toOfficialState({ running: true }, [
  { submissionId: "sub-1", requestId: "req-1", text: "hello", createdAt: 1 },
]), {
  cursor: 0,
  active: true,
  running: true,
  queue: [{ id: "sub-1", placement: "queued", rpcId: "req-1", content: [{ type: "text", text: "hello" }] }],
  pendingInput: [],
});

const projectionRecords = [
  { type: "event", event: { type: "turn/start", seq: 1, time: 0, data: { turn: 1 } } },
  { type: "event", event: { type: "user/message", seq: 2, time: 0, data: { id: "m-user" } } },
  { type: "event", event: { type: "assistant/message", seq: 3, time: 0, data: { message: { id: "m-assistant" } } } },
] as never;
assert.equal(forkMessageIdFor(projectionRecords, 1), undefined);
assert.equal(forkMessageIdFor(projectionRecords, 2), "m-user");
assert.equal(forkMessageIdFor(projectionRecords, 3), "m-assistant");
assert.equal(forkMessageIdFor(projectionRecords, 99), "m-assistant");

const catalog = toOfficialModelCatalog([{ id: "deepseek-official/deepseek-flash" }]);
assert.deepEqual(catalog.default, { provider: "deepseek-official", model: "deepseek-official/deepseek-flash" });
assert.deepEqual(catalog.routableProviders, ["deepseek-official"]);
assert.equal(catalog.groups.length, 2);
assert.equal(catalog.groups[0]?.id, "deepseek-official");
assert.equal(catalog.groups[1]?.id, "cloudflare-ai-gateway");

assert.equal(catalog.groups[0]?.models.find((model) => model.id === "deepseek-official/deepseek-flash")?.unavailable, undefined);
assert.ok(catalog.groups[1]?.models.every(model => model.unavailable === true), "gateway group is unavailable without platform");
assert.equal(catalog.groups[0]?.models[0]?.reasoning?.unavailable, undefined);
assert.equal(catalog.groups[0]?.models[0]?.reasoning?.defaultEffort, "high");
assert.equal(catalog.groups[0]?.models[0]?.reasoning?.efforts.length, 4);
assert.deepEqual(toOfficialSelection({ provider: "deepseek-official", model: "deepseek-official/deepseek-flash" }, "deepseek-official/deepseek-flash"), {
  selected: { provider: "deepseek-official", model: "deepseek-official/deepseek-flash" },
});
const both = toOfficialModelCatalog([{ id: "deepseek-official/deepseek-flash" }, { id: "cloudflare-ai-gateway/deepseek-flash" }]);
assert.deepEqual(both.routableProviders, ["deepseek-official", "cloudflare-ai-gateway"]);
assert.deepEqual(both.default, { provider: "cloudflare-ai-gateway", model: "cloudflare-ai-gateway/deepseek-flash" });
assert.deepEqual(both.groups.map(group => group.id), ["deepseek-official", "cloudflare-ai-gateway"]);
assert.equal(both.groups[1]?.models.every(model => model.unavailable === undefined), true);
assert.deepEqual(toOfficialSelection({ model: "cloudflare-ai-gateway/deepseek-flash" }, "cloudflare-ai-gateway/deepseek-flash"), {
  selected: { provider: "cloudflare-ai-gateway", model: "cloudflare-ai-gateway/deepseek-flash" },
});
assert.deepEqual(toOfficialSelection({ model: "deepseek-flash" }, "deepseek-flash").selected.provider, "legacy", "old bare projections retain a compatibility marker and are not offered as a catalog group");
const custom = toOfficialModelCatalog([{ id: "deepseek-official/owner-model", label: "Owner Model" }], { deepseek: [{ id: "owner-model", label: "Owner Model" }], gateway: [] });
assert.deepEqual(custom.default, { provider: "deepseek-official", model: "deepseek-official/owner-model" });
assert.deepEqual(custom.groups[0]?.models.map(model => model.id), ["deepseek-official/owner-model"]);
assert.deepEqual(custom.groups[1]?.models, []);
const empty = toOfficialModelCatalog([], { deepseek: [], gateway: [] });
assert.deepEqual(empty.groups.map(group => group.models.length), [0, 0]);
assert.equal(empty.default.model, "", "an explicitly empty directory does not restore Flash");
console.log("session-host: official RPC bridge mapping and page cut passed");
