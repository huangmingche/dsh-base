/** Real official fork RPC -> Host -> SQLite: unique projected Step ids never leak later SDK parts. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SessionHost } from "../src/host.ts";
import { SqliteSessionHostStorage } from "../src/sqlite-storage.ts";
import { dispatchSessionHost } from "../src/service.ts";
import { registerSessionRemoteEndpoints } from "../src/remote.ts";
import { buildSessionHistory, assistantStepMessageId } from "../../../boot/dsh-base-session-wire/src/index.ts";
const db = new DatabaseSync(":memory:");
const sql = { exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; },
  transactionSync<T>(fn: () => T): T { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
const storage = new SqliteSessionHostStorage(sql);
const host = new SessionHost(storage, []);
const workspace = (await host.workspaceCreate({ path: "/fork-workspace", title: "Fork workspace" })).workspace;
await host.create({ sessionId: "source", workspaceId: workspace.workspaceId });
const receipt = await host.prompt({ sessionId: "source", requestId: "request", text: "tool then answer" });
const sourcePart = { type: "data-dsh-model-source", data: { provider: "deepseek-official", model: "actual-pro-provider-revision", requestedModel: "deepseek-v4-pro", reasoningEffort: "low" } };
const originalParts = [
  { type: "step-start" }, { type: "dynamic-tool", toolName: "fetch_url", toolCallId: "call", state: "output-available", input: { url: "https://example.invalid" }, output: "actual first step result" },
  { type: "step-start" }, { type: "text", text: "future answer must not leak" }, sourcePart,
];
await host.runSubmission({ sessionId: "source", submissionId: receipt.submissionId }, async () => ({ messages: [
  { id: "request", role: "user", parts: [{ type: "text", text: "tool then answer" }] },
  { id: "sdk:message/with%characters", role: "assistant", parts: originalParts },
] }));
await storage.putProjections('source', { ...await storage.getProjections('source'),
  _dshBasePermissionCommands: { 'parent-rpc': { id: 'parent-command' } },
  _dshBaseInputConfigs: { request: { model: 'deepseek-flash', reasoningEffort: 'max' } },
  _dshBaseModelRequest: { model: 'deepseek-flash', reasoningEffort: 'max' },
  _dshBaseExecutionSteps: { 'future-input': [{ id: 'later-step', sdkRequestId: 'later-request', startedAt: 9999 }] },
});
const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<any>>();
registerSessionRemoteEndpoints({ register(method: string, handler: any) { handlers.set(method, handler); return () => {}; } } as never);
const invocation = { request: new Request("https://host/api/session/fork"), env: { SESSION_HOST: {
  idFromName: (name: string) => name, get: () => ({ async fetch(request: Request) {
    if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
    return Response.json(await dispatchSessionHost(host, await request.json()));
  } }),
} }, user: { id: "fork-owner" } };
const official = (request: Record<string, unknown>) => handlers.get("session/fork")!({ args: { request } }, invocation);
const history = await host.history({ sessionId: "source" });
const records = buildSessionHistory(history.records, undefined, history.turns);
const assistants = records.filter(row => row.event.type === "assistant/message");
assert.equal(assistants.length, 2);
assert.notEqual((assistants[0]!.event.data as any).message.id, (assistants[1]!.event.data as any).message.id);
const firstStepEnd = records.find(row => row.event.type === "step/end" && (row.event.data as any).step === 1)!;
const cut = await official({ sessionId: "source", atSeq: firstStepEnd.event.seq });
const cutHistory = await host.history({ sessionId: cut.sessionId });
assert.equal((await storage.listMemberships()).find(row => row.sessionId === cut.sessionId)?.workspaceId, workspace.workspaceId, "fork stays in the original workspace");
assert.equal(cutHistory.records.length, 2);
const forkRaw = await storage.getProjections(cut.sessionId);
for (const key of ['_dshBasePermissionCommands', '_dshBaseInputConfigs', '_dshBaseModelRequest', '_dshBaseExecutionSteps']) assert.equal(Object.hasOwn(forkRaw, key), false, `fork excludes parent runtime receipt ${key}`);
assert.deepEqual((await host.projections({ sessionId: cut.sessionId })).modelSelection.lastUsed, { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }, 'fork records inherited requested model, not actual response version or a later selection');
assert.equal(cutHistory.records[1]!.id, "sdk:message/with%characters");
assert.ok(!JSON.stringify(cutHistory.records).includes("future answer must not leak"));
assert.deepEqual(cutHistory.records[1]!.parts.at(-1), sourcePart, "known provenance survives truncating a later step");
assert.equal(cutHistory.turns[0]!.status, "forked");
const cutWire = buildSessionHistory(cutHistory.records, undefined, cutHistory.turns);
assert.equal(cutWire.filter(row => row.event.type === "assistant/message").length, 1);
assert.equal((cutWire.find(row => row.event.type === "assistant/message")!.event.data as any).message.id, (assistants[0]!.event.data as any).message.id, "first-step projection identity stays stable after truncation");
const direct = await official({ sessionId: "source", messageId: assistantStepMessageId("sdk:message/with%characters", 0) });
assert.ok(!JSON.stringify((await host.history({ sessionId: direct.sessionId })).records).includes("future answer must not leak"));
const full = await official({ sessionId: "source", atSeq: records.at(-1)!.event.seq });
const fullHistory = await host.history({ sessionId: full.sessionId });
assert.deepEqual(fullHistory.records[1]!.parts, originalParts);
assert.equal(fullHistory.turns[0]!.status, "completed");
assert.deepEqual((await host.history({ sessionId: "source" })).records[1]!.parts, originalParts, "fork never mutates the source");
await assert.rejects(official({ sessionId: "source", messageId: assistantStepMessageId("sdk:message/with%characters", 9) }), /invalid_assistant_step/);
const invalid = await dispatchSessionHost(host, { method: "fork", params: { sessionId: "source", messageId: "request", assistantStep: -1 } });
assert.equal("error" in invalid && invalid.error.code, "gateway/bad-request");
console.log("fork step boundary: actual official RPC + SQLite preserves stable unique ids and source, excludes later step content, keeps source immutable");

// Exact cursor cuts preserve official closers and never smuggle a later tool
// result into either the rendered journal or the model's durable context.
for (const eventType of ['assistant/message', 'tool/call'] as const) {
  const boundary = records.find(row => row.event.type === eventType)!;
  const branch = await official({ sessionId: 'source', atSeq: boundary.event.seq });
  const h = await host.history({ sessionId: branch.sessionId });
  assert.ok(h.forkSeed, 'exact inherited journal is durable');
  const projected = buildSessionHistory(h.records, undefined, h.turns, h.forkSeed);
  const marker = projected.findIndex(row => row.event.type === 'session/end-seed');
  assert.equal(marker, boundary.event.seq);
  assert.equal(projected.at(-1)!.event.type, 'turn/end');
  assert.equal((projected.at(-1)!.event.data as any).reason.kind, 'forked');
  const result = projected.find(row => row.event.type === 'tool/result')!;
  assert.equal((result.event.data as any).message.isError, true);
  assert.equal((result.event.data as any).error.code, eventType === 'tool/call' ? 'TOOL_OUTCOME_UNKNOWN' : 'TOOL_NOT_STARTED');
  assert.ok(!JSON.stringify(h.records).includes('actual first step result'), 'model context excludes results beyond the cut');
  assert.ok(!JSON.stringify(projected).includes('actual first step result'), 'official UI excludes results beyond the cut');
  assert.ok(!JSON.stringify(projected).includes('future answer must not leak'));
  const restarted = new SessionHost(new SqliteSessionHostStorage(sql), []);
  const recovered = await restarted.history({ sessionId: branch.sessionId });
  assert.deepEqual(buildSessionHistory(recovered.records, undefined, recovered.turns, recovered.forkSeed), projected, 'restart preserves exact journal, timestamps and closers');
  const prompt = await restarted.prompt({ sessionId: branch.sessionId, requestId: `continuation-${eventType}`, text: 'continue this branch' });
  await restarted.runSubmission({ sessionId: branch.sessionId, submissionId: prompt.submissionId }, async () => ({ messages: [
    ...recovered.records, { id: `continuation-${eventType}`, role: 'user', parts: [{ type: 'text', text: 'continue this branch' }] },
    { id: `reply-${eventType}`, role: 'assistant', parts: [{ type: 'text', text: 'new branch reply' }] },
  ] }));
  const continued = await restarted.history({ sessionId: branch.sessionId });
  const next = buildSessionHistory(continued.records, undefined, continued.turns, continued.forkSeed);
  assert.deepEqual(next.slice(0, projected.length), projected, 'continuation cannot rewrite the inherited prefix');
  assert.equal(next.filter(row => row.event.type === 'turn/start').length, 2);
  assert.equal((next.at(-1)!.event.data as any).turn, 2);
  assert.equal((next.at(-1)!.event.data as any).reason.kind, 'completed');
  const nested = await official({ sessionId: branch.sessionId, atSeq: boundary.event.seq });
  const nestedHistory = await host.history({ sessionId: nested.sessionId });
  assert.ok(!JSON.stringify(nestedHistory.records).includes('new branch reply'), 'forking a fork respects its own inherited cursor');
}

const firstResult = records.find(row => row.event.type === 'tool/result')!;
const afterResult = await official({ sessionId: 'source', atSeq: firstResult.event.seq });
const afterHistory = await host.history({ sessionId: afterResult.sessionId });
const afterWire = buildSessionHistory(afterHistory.records, undefined, afterHistory.turns, afterHistory.forkSeed);
assert.equal(afterWire.filter(row => row.event.type === 'tool/result').length, 1);
assert.ok(JSON.stringify(afterHistory.records).includes('actual first step result'));
assert.ok(!JSON.stringify(afterHistory.records).includes('future answer must not leak'));

await host.create({ sessionId: 'empty-source' });
await assert.rejects(official({ sessionId: 'empty-source' }), /no completed turn/);
const running = await host.prompt({ sessionId: 'source', requestId: 'in-flight', text: 'not completed yet' });
await storage.transitionSubmission(running.submissionId, 'running', 'submission.running', { submissionId: running.submissionId });
const defaultBranch = await official({ sessionId: 'source' });
const defaultHistory = await host.history({ sessionId: defaultBranch.sessionId });
assert.ok(!defaultHistory.records.some(row => row.id === 'in-flight'), 'omitted atSeq inherits only the latest closed-turn prefix');
await assert.rejects(official({ sessionId: 'source', atSeq: 999999 }), /does not exist/);
console.log('exact fork cursors: before/after tool start and result, official unknown-result closure, source immutability, SQLite restart, continuation, nested fork and completed-prefix default');
