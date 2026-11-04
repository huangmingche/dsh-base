/** Actual composed hooks + SQLite/Sessions and installed SDK tool-decision transition; no model/network. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { InputExecutionLedger } from "../src/input-execution.ts";
const app = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const server = createRequire(new URL("../../../build/dsh-base-build-server-dependencies/package.json", import.meta.url));
const { Sessions } = await import(pathToFileURL(server.resolve("agents/sessions")).href);
const { toolApprovalUpdate, applyToolUpdate } = await import(pathToFileURL(server.resolve("agents/chat")).href);
const { transformSync } = app("esbuild");
const db = new DatabaseSync(":memory:");
const storage = { sql: { exec(query: string, ...bindings: unknown[]) {
  const rows = db.prepare(query).all(...bindings as never[]);
  return { [Symbol.iterator]: () => rows[Symbol.iterator](), rowsWritten: Number(db.prepare("SELECT changes() AS changes").get()!.changes) };
} }, async get() { return 3; }, async put() {}, transactionSync<T>(fn: () => T): T {
  db.exec("SAVEPOINT test_write"); try { const result = fn(); db.exec("RELEASE test_write"); return result; } catch (error) { db.exec("ROLLBACK TO test_write"); db.exec("RELEASE test_write"); throw error; }
} };
class TestSessions extends Sessions { get lifecycle() { return { storage, events: { emit() {} }, ready: async () => undefined }; } }
const sessions = new TestSessions(); await sessions.onStart();
let session = sessions.session("approval-actual");
(globalThis as any).__executionSession = session;
let calls = 0;
let outcome: "completed" | "error" | "aborted" | "lost-after-commit" | "interrupted" = "completed";
let sdkId = "";
(globalThis as any).__continueExecution = async (agent: any) => {
  calls += 1; sdkId = `sdk-continuation-${calls}`;
  await agent.beforeTurn({ requestId: sdkId, continuation: true });
  if (outcome === "interrupted") throw new Error("durable execution transport interrupted");
  const current = await session.getHistory();
  for (const message of current) {
    const parts = message.parts.map((part: any) => part.state === "approval-responded" ? { ...part, state: "output-available", output: "saved" } : part);
    if (JSON.stringify(parts) !== JSON.stringify(message.parts)) await session.updateMessage({ ...message, parts });
  }
  const message = { id: `answer-${calls}`, role: "assistant", parts: [{ type: "text", text: "OK" }] };
  await session.appendMessage(message);
  const status = outcome === "lost-after-commit" ? "completed" : outcome;
  const result = { message, requestId: sdkId, continuation: true, status, ...(status === "error" ? { error: "real provider failure" } : {}) };
  await agent.onChatResponse(result);
  if (outcome === "lost-after-commit") throw new Error("RPC response lost after commit");
  return result;
};
(globalThis as any).__applyExecutionApproval = async (callId: string, approved: boolean) => {
  for (const message of await session.getHistory()) {
    const updated = applyToolUpdate(message.parts, toolApprovalUpdate(callId, approved));
    if (updated) await session.updateMessage({ ...message, parts: updated.parts });
  }
};
const fakeThink = `export class Think {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.session=globalThis.__executionSession;}
  getMessages(){return this.session.getHistory();}
  pendingApprovals(){return Promise.resolve([]);}
  _applyToolApproval(id,approved){return globalThis.__applyExecutionApproval(id,approved);}
  continueLastTurn(){return globalThis.__continueExecution(this);}
  listSubmissions(){return Promise.resolve([]);}
  cancelChat(){}
  authorizeAction(){return true;}
}`;
const dependencies = new Map(["agents/sessions", "ai"].map(name => [name, (name.startsWith("agents") ? server : app).resolve(name)]));
registerHooks({
  resolve(specifier, ctx, next) {
    if (specifier === "@cloudflare/think") return { url: `data:text/javascript,${encodeURIComponent(fakeThink)}`, shortCircuit: true };
    if (specifier === "agents") return { url: "data:text/javascript,export const callable=()=>target=>target", shortCircuit: true };
    if (dependencies.has(specifier)) return next(dependencies.get(specifier)!, ctx);
    if (specifier === "@dsh-base/chat-skills") return next(new URL("../../../boot/dsh-base-chat-skills/src/index.ts", import.meta.url).href, ctx);
    return next(specifier, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith("/dsh-base-cloudflare-think-core/src/index.ts")) return { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm", target: "es2022" }).code };
    return next(url, ctx);
  },
});
const { composeAgent } = await import("../src/index.ts");
const Agent = composeAgent([]);
const reopen = () => new Agent({ storage } as never, {} as never);
let agent = reopen();
async function prepare(id: string, count = 1) {
  session = sessions.session(id); (globalThis as any).__executionSession = session; agent = reopen();
  await session.appendMessage({ id, role: "user", parts: [{ type: "text", text: id }] });
  new InputExecutionLedger(storage).configure(id, { model: "deepseek-flash", reasoningEffort: "high" });
  await agent.beforeTurn({ requestId: `sdk-initial-${id}` });
  const message = { id: `tools-${id}`, role: "assistant", parts: Array.from({ length: count }, (_, i) => ({ type: "tool-remember_fact", toolCallId: `${id}-c${i}`, state: "approval-requested", input: { fact: id }, approval: { id: `${id}-a${i}` } })) };
  await session.appendMessage(message);
  await agent.onChatResponse({ message, requestId: `sdk-initial-${id}`, continuation: false, status: "completed" } as never);
  assert.equal((await agent.getInputExecution(id))!.status, "awaiting-approval");
  return { requestId: id, toolCallId: `${id}-c0`, approved: true };
}
let input = await prepare("approve");
let result = await agent.resolveToolApproval(input); assert.equal(result.status, "completed");
const once = calls;
assert.equal((await agent.resolveToolApproval(input)).status, "completed");
agent = reopen(); assert.equal((await agent.resolveToolApproval(input)).status, "completed");
assert.equal(calls, once, "duplicate decision and Agent restart never repeat inference");
await assert.rejects(agent.resolveToolApproval({ ...input, approved: false }), /approval_decision_conflict/);

input = await prepare("reject"); const beforeReject = calls;
result = await agent.resolveToolApproval({ ...input, approved: false });
assert.equal(result.status, "completed"); assert.equal(calls, beforeReject + 1, "denied tool still continues for explanation");
assert.equal((await session.getHistory()).find((m: any) => m.id === "tools-reject").parts[0].state, "output-denied");

input = await prepare("parallel", 2); const beforeParallel = calls;
assert.equal((await agent.resolveToolApproval(input)).status, "awaiting-approval");
assert.equal(calls, beforeParallel);
assert.equal((await agent.resolveToolApproval({ ...input, toolCallId: "parallel-c1" })).status, "completed");
assert.equal(calls, beforeParallel + 1, "all sibling decisions share one continuation");

input = await prepare("failure"); outcome = "error";
assert.equal((await agent.resolveToolApproval(input)).status, "failed");
assert.equal((await agent.getInputExecution(input.requestId))!.error, "real provider failure");
input = await prepare("abort"); outcome = "aborted";
assert.equal((await agent.resolveToolApproval(input)).status, "cancelled");

input = await prepare("lost"); outcome = "lost-after-commit";
await assert.rejects(agent.resolveToolApproval(input), /RPC response lost/);
const afterLost = calls; agent = reopen();
assert.equal((await agent.resolveToolApproval(input)).status, "completed"); assert.equal(calls, afterLost);

input = await prepare("recover"); outcome = "interrupted";
await assert.rejects(agent.resolveToolApproval(input), /transport interrupted/);
const recoveringSdk = sdkId, beforeRecovery = calls; agent = reopen();
assert.equal((await agent.resolveToolApproval(input)).status, "running"); assert.equal(calls, beforeRecovery);
// A stale initial hook cannot settle the newer continuation.
await agent.onChatResponse({ requestId: "sdk-initial-recover", status: "completed", message: { id: "old", parts: [] } } as never);
assert.equal((await agent.getInputExecution(input.requestId))!.status, "running");
await agent.onChatResponse({ requestId: recoveringSdk, status: "error", error: "recovery exhausted", message: { id: "partial", parts: [] } } as never);
assert.equal((await agent.resolveToolApproval(input)).status, "failed");

input = await prepare("prepared"); outcome = "completed";
await agent.beginInputContinuation(input.requestId, input.toolCallId); agent = reopen();
assert.equal((await agent.resolveToolApproval(input)).status, "completed", "crash before SDK admission retains prepared retry");
input = await prepare("cancel"); await agent.cancelInput(input.requestId);
assert.equal((await agent.resolveToolApproval(input)).status, "cancelled");

// Latest real applied user, not a later synthetic time context, owns live chunks.
await session.appendMessage({ id: "time-context", role: "user", parts: [{ type: "text", text: "time" }], metadata: { dshContext: true } });
await agent.beforeTurn({ requestId: "cancelled-sdk" }).then(() => assert.fail("cancelled input must not start"), error => assert.match(String(error), /input_cancelled/));
const ledger = new InputExecutionLedger(storage);
ledger.set("live", { status: "running" });
ledger.configure("live", { model: "deepseek-flash", reasoningEffort: "high" });
await session.appendMessage({ id: "live", role: "user", parts: [{ type: "text", text: "live" }] });
await session.appendMessage({ id: "time-context-2", role: "user", parts: [{ type: "text", text: "time" }], metadata: { dshContext: true } });
await agent.beforeTurn({ requestId: "live-sdk" });
(agent as any).liveAttemptId = "live-attempt";
assert.equal((await agent.getLiveAttempt())!.requestId, "live");
console.log("Think input execution: real SQLite + Sessions + SDK approval transition; logical identity, parallel allow/deny, failure/cancel, hook replay, lost replies and restart idempotency passed");

// A legacy admission uses an explicit Host-proven alias, never text guessing.
input = await prepare("legacy-message"); outcome = "completed";
const aliasedInput = { requestId: "canonical-legacy", userMessageId: "legacy-message", toolCallId: input.toolCallId, approved: true };
await agent.beginInputContinuation(aliasedInput.requestId, aliasedInput.toolCallId, aliasedInput.userMessageId);
assert.equal((await agent.resolveToolApproval(aliasedInput)).status, "completed");
assert.equal((await agent.getInputExecution("canonical-legacy"))!.status, "completed");
assert.equal(ledger.canonicalRequestId("legacy-message"), "canonical-legacy");
await assert.rejects(agent.beginInputContinuation("different-request", "another", "legacy-message"), /input_identity_conflict/);
console.log("Think input execution: legacy userMessageId/requestId alias stays durable and conflicting aliases refuse");

// Requested configuration is immutable; returned provider model is independent evidence.
await session.appendMessage({ id: 'source-user', role: 'user', parts: [{ type: 'text', text: 'source' }] });
ledger.configure('source-user', { model: 'deepseek-v4-pro', reasoningEffort: 'max' });
const actualModel = { modelId: 'deepseek-v4-pro' };
const config = await agent.beforeTurn({ requestId: "source-pro-sdk", model: actualModel });
actualModel.modelId = 'another-requested-alias';
assert.deepEqual(config!.messageMetadata!({ part: { type: 'start' } } as never), { dshModelSource: { provider: 'legacy', model: 'unknown', requestedModel: 'deepseek-v4-pro', reasoningEffort: 'max' }, dshSteps: [] });
await agent.setModel('deepseek-flash');
assert.equal(agent.reasoningEffort(), 'max');
(agent as any).stepStartedAt = 100;
agent.onChunk({ chunk: { type: 'tool-input-start', id: 'early-tool', toolName: 'read_file' } });
agent.onChunk({ chunk: { type: 'tool-input-delta', id: 'early-tool', delta: '{"path":' } });
assert.equal((agent as any).liveChunks.at(-1)?.text, '{"path":');
agent.onStepEnd({ text: 'actual output', response: { modelId: 'provider-response-pro-20261110' }, usage: { outputTokens: 3 } });
const metadata = config!.messageMetadata!({ part: { type: 'finish', totalUsage: { inputTokens: 2, outputTokens: 3 } } } as never) as any;
assert.equal(metadata.dshModelSource.model, 'provider-response-pro-20261110');
assert.equal(metadata.dshModelSource.requestedModel, 'deepseek-v4-pro');
assert.equal(metadata.dshSteps[0].startedAt, 100);
assert.equal(metadata.dshSteps[0].parts[0].text, 'actual output');
assert.equal(metadata.dshSteps[0].chunks[0].type, 'tool-call-delta');
assert.equal(metadata.usage.inputTokens, 2);
console.log('Think source provenance: immutable request, distinct actual response model, step timestamps and tool argument evidence');

// Actual step hook accounting survives a destructive legacy read, replayed
// response hook and Agent restart. Each SDK execution is a durable snapshot.
(agent as any).stepStartedAt = Date.now() - 8;
(agent as any).firstTokenAt = Date.now() - 5;
agent.onStepEnd({ usage: { outputTokens: 3 } });
await agent.onChatResponse({ requestId: "source-pro-sdk", status: "completed", message: { id: "stats-message", role: "assistant", parts: [], metadata } } as never);
const statistics = await agent.getExecutionStats("source-pro-sdk");
assert.equal(statistics!.steps, 2); assert.ok(statistics!.llmMs >= 8); assert.equal(statistics!.decodeTokens, 3);
assert.equal(statistics!.usage!.inputTokens, 2);
await agent.takeTurnStats();
await agent.onChatResponse({ requestId: "source-pro-sdk", status: "completed", message: { id: "stats-message", parts: [] } } as never);
assert.deepEqual(await agent.getExecutionStats("source-pro-sdk"), statistics);
agent = reopen(); assert.deepEqual(await agent.getExecutionStats("source-pro-sdk"), statistics);
console.log("Think execution statistics: actual step hook, durable per-SDK snapshot, response replay and restart are idempotent");

// The real authorization hook reevaluates policy at effect time; never is denial.
let policy='ask';
const policyAgent = new Agent({storage,id:{name:'owner:alice:policy'}} as never,{SESSION_HOST_GENERATION:'default-v49',SESSION_HOST:{idFromName:(name:string)=>name,get:()=>({fetch:async()=>Response.json({result:{approval:policy}})})}} as never);
assert.equal(await policyAgent.authorizeAction({kind:'approval-gated'} as never),true);
policy='never';
assert.deepEqual(await policyAgent.authorizeAction({kind:'approval-gated'} as never),{allowed:false,reason:'permission/denied: approval-disabled'});
assert.deepEqual(await policyAgent.authorizeAction({kind:'durable-pause'} as never),{allowed:false,reason:'permission/denied: approval-disabled'});
assert.equal(await policyAgent.authorizeAction({kind:'server'} as never),true);
await session.appendMessage({id:'old-without-configuration',role:'user',parts:[{type:'text',text:'legacy'}]});
await assert.rejects(agent.beginInputContinuation('old-without-configuration','old-call'),/input_configuration_unavailable/);
assert.equal(ledger.configuration('old-without-configuration'),undefined,'legacy selection is never invented from current picker');
console.log('Think permission: current ask/never gate and missing immutable legacy configuration fail closed');

// A resumed tool extends its original step using durable hook times, even after restart.
await session.appendMessage({id:'timing-user',role:'user',parts:[{type:'text',text:'late tool'}]});
await session.appendMessage({id:'timing-assistant',role:'assistant',parts:[{type:'tool-read',toolCallId:'late-tool',state:'approval-requested',input:{}}],metadata:{dshSteps:[{id:'timing-sdk:0',startedAt:100,endedAt:200,assistantAt:200,requestedModel:'deepseek-flash',chunks:[],parts:[{type:'tool-read',toolCallId:'late-tool',state:'input-available',input:{}}]}]}});
(agent as any).liveRequestId='timing-user';
const realNow=Date.now;
try {
  Date.now=()=>1900; await agent.beforeToolCall({toolCallId:'late-tool',toolName:'read',input:{}});
  Date.now=()=>2000; agent.afterToolCall({toolCallId:'late-tool',success:true,output:'ok'});
} finally {Date.now=realNow;}
agent=reopen();
const measured=(await agent.getMessages()).find(message=>message.id==='timing-assistant')!.metadata as any;
assert.equal(measured.dshSteps[0].startedAt,100);
assert.equal(measured.dshSteps[0].assistantAt,200);
assert.equal(measured.dshSteps[0].endedAt,2000);
assert.deepEqual(measured.dshSteps[0].toolTimings,[{callId:'late-tool',startedAt:1900,endedAt:2000}]);
console.log('Think timing: real tool hooks survive restart and extend the original approval Step');

// The composed beforeStep hook must persist entry before any live/model work.
await session.appendMessage({id:'before-token-user',role:'user',parts:[{type:'text',text:'fail before token'}]});
ledger.configure('before-token-user',{model:'deepseek-v4-pro',reasoningEffort:'low'});
const stepCalls: any[]=[];
const order:string[]=[];
let rejectStep=true;
let executionPolicy:any={approval:'ask',context:'test current approval context',notices:[]};
const executionEnv={AUTH_SECRET:'test-only-internal',SESSION_HOST_GENERATION:'default-v49',SESSION_HOST:{idFromName:(name:string)=>name,get:()=>({fetch:async(request:Request)=>{
  const body=await request.json() as any;
  order.push(body.method);
  if(body.method==='state')return Response.json({result:{archived:false}});
  if(body.method==='approvalModelContext')return Response.json({result:executionPolicy});
  if(body.method==='recordModelRequest'||body.method==='recordStepStart')assert.equal(request.headers.get('x-dsh-internal-token'),'test-only-internal');
  if(body.method==='recordStepStart'){
    stepCalls.push(body.params);
    if(rejectStep)return Response.json({error:'durable step write failed'},{status:503});
  }
  return Response.json({result:null});
}})}};
const stepAgent=()=>{
  const instance=new Agent({storage,id:{name:'owner:alice:before-token'}} as never,executionEnv as never);
  (instance as any).broadcastLive=()=>order.push('live');
  (instance as any).scheduleLivePush=()=>undefined;
  return instance;
};
let tokenless=stepAgent();
await tokenless.beforeTurn({requestId:'before-token-sdk'});
try {
  Date.now=()=>8000;
  order.length=0;
  await assert.rejects(tokenless.beforeStep(),/recordStepStart failed/);
  assert.deepEqual(order,['state','recordStepStart'],'unacknowledged durable start cannot broadcast or enter inference');
  tokenless=stepAgent(); await tokenless.beforeTurn({requestId:'before-token-sdk'});
  rejectStep=false; Date.now=()=>9000; order.length=0;
  await tokenless.beforeStep();
  assert.deepEqual(order,['state','recordStepStart','live','approvalModelContext']);
  assert.deepEqual(stepCalls[1],stepCalls[0],'Agent restart/retry preserves the original Step clock and identity');
  assert.equal(stepCalls[1].startedAt,8000);
  assert.equal(stepCalls[1].stepId,'before-token-sdk:0');
  await tokenless.onChatResponse({requestId:'before-token-sdk',status:'error',error:'provider rejected before tokens'} as never);
} finally {Date.now=realNow;}
assert.equal((await stepAgent().getInputExecution('before-token-user'))?.status,'failed');
assert.equal((await session.getHistory()).some((message:any)=>message.role==='assistant'&&message.id==='before-token-sdk'),false);
console.log('Think failed-step entry: durable start precedes broadcast, failed writes stop work, and restart preserves identity before a tokenless provider error');

// The real composed hook passes the official producer's context to the actual
// next step, while its durable non-human messages cannot own a new input.
const {createPermissionRuntime}=await import('@dsh-base/cloudflare-worker-permissions/runtime');
const permissionRuntime=await createPermissionRuntime();
try {
  const initialPolicy=permissionRuntime.initializeSession('before-token',null);
  const changedPolicy=permissionRuntime.selectPreset('before-token',initialPolicy.events,'danger-full-access');
  executionPolicy={approval:'never',context:await permissionRuntime.modelContext('before-token',changedPolicy.events),notices:changedPolicy.notices};
  await session.appendMessage({id:'policy-user',role:'user',parts:[{type:'text',text:'real human input'}]});
  ledger.configure('policy-user',{model:'deepseek-flash',reasoningEffort:'high'});
  const policyAgent=stepAgent();await policyAgent.beforeTurn({requestId:'policy-sdk'});
  const next=await policyAgent.beforeStep({messages:[{role:'user',content:'real human input'}]});
  assert.equal((next?.messages?.at(-1) as any)?.content,executionPolicy.context);
  assert.equal((next?.messages?.at(-2) as any)?.content,changedPolicy.notices[0].content[0].text);
  assert.equal((await session.getHistory()).filter((message:any)=>message.metadata?.kind==='approval-policy-notice').length,1);
  const resumed=stepAgent();await resumed.beforeTurn({requestId:'policy-sdk-resume'});
  assert.equal((resumed as any).liveRequestId,'policy-user','policy injection never becomes the human execution request');
  const replay=await resumed.beforeStep({messages:[]});
  assert.equal(replay?.messages?.length,1,'the prior durable notice is already in the new SDK baseline');
  executionPolicy=null;
  await assert.rejects(resumed.beforeStep({messages:[]}),/Invalid approval model context/,'invalid authoritative context cannot be silently ignored');
} finally {await permissionRuntime.dispose();}
console.log('Think approval context: composed beforeStep reads official policy, stores a non-human notice once, preserves real request identity and fails closed on invalid context');
