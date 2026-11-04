/** Real DO/SQLite + installed Sessions/AI prepareStep; no network/model service. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Sessions } from 'agents/sessions';
import { prepareApprovalContext, approvalNoticeIds } from '../../../cloudflare-think/dsh-base-cloudflare-think-core/src/approval-context.ts';
import { replaceDurableContext } from '../../../cloudflare-think/dsh-base-cloudflare-think-core/src/durable-context.ts';
import { SqliteSessionHostStorage } from '../src/sqlite-storage.ts';
import { buildSessionHistory } from '@dsh-base/session-wire';
const server=createRequire(new URL('../../../build/dsh-base-build-server-dependencies/package.json',import.meta.url));
const {generateText,stepCountIs,jsonSchema,convertToModelMessages}=await import(pathToFileURL(server.resolve('ai')).href);
const {MockLanguageModelV4}=await import(pathToFileURL(server.resolve('ai/test')).href);
registerHooks({resolve(specifier,ctx,next){
  if(specifier==='agents')return {url:'data:text/javascript,export async function getAgentByName(){globalThis.__policyAgentCalls++;throw Error("Policy change must not run an Agent");}',shortCircuit:true};
  return next(specifier,ctx);
}});
const { SessionHostObject } = await import('../src/do.ts');
const db=new DatabaseSync(':memory:');
let failEvent=false;
(globalThis as any).__policyAgentCalls=0;
const storage={sql:{exec(query:string,...bindings:unknown[]){
  if(failEvent&&query.startsWith('INSERT INTO dsh_session_host_events'))throw Error('policy event fault');
  const rows=db.prepare(query).all(...bindings as never[]) as Record<string,unknown>[];
  return {toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator](),rowsWritten:Number(db.prepare('SELECT changes() AS n').get()?.n??0)};
}},transactionSync<T>(fn:()=>T):T{db.exec('SAVEPOINT policy');try{const value=fn();db.exec('RELEASE policy');return value;}catch(error){db.exec('ROLLBACK TO policy; RELEASE policy');throw error;}},async setAlarm(){},async get(){return 3;},async put(){}};
const state={id:{name:'owner:alice:default-v49'},storage};
let owner=new SessionHostObject(state as never,{DshAgent:{} as never});
async function call(method:string,params:Record<string,unknown>={sessionId:'s'}){
  const response=await owner.fetch(new Request('https://host/api/session-host',{method:'POST',body:JSON.stringify({method,params})}));
  const body=await response.json() as any;
  if(!response.ok||body.error)throw Error(body.error?.message??`RPC ${response.status}`);
  return body.result;
}
class ActualSessions extends Sessions {get lifecycle(){return {storage,events:{emit(){}},ready:async()=>undefined} as never;}}
let sessions=new ActualSessions();await sessions.onStart();
let sdk=sessions.session('policy-sdk');
await call('create',{sessionId:'s'});await call('create',{sessionId:'isolated'});
const initial=await call('approvalModelContext');
assert.equal(initial.approval,'ask');assert.deepEqual(initial.notices,[]);
assert.match(initial.context,/Approval prompts are enabled/);
await sdk.appendMessage({id:'real-user',role:'user',parts:[{type:'text',text:'perform two steps'}]});
await call('prompt',{sessionId:'s',requestId:'real-user',text:'perform two steps'});
const beforeHistory=await call('history');
await call('selectPermission',{sessionId:'s',preset:'read-only'});
assert.deepEqual((await call('approvalModelContext')).notices,[],'sandbox-only change has no approval transition');
const beforeFault=await call('approvalModelContext');
failEvent=true;
await assert.rejects(call('selectPermission',{sessionId:'s',preset:'danger-full-access'}),/policy event fault/);
failEvent=false;
assert.deepEqual(await call('approvalModelContext'),beforeFault,'outbox and policy roll back together');

// The installed SDK prepares a second model step after the actual tool changes
// policy. Its prompt must include exactly one official notice and latest context.
const baseline=approvalNoticeIds(await sdk.getHistory());
const captured:any[]=[];
const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
const model=new MockLanguageModelV4({doGenerate:async options=>{
  captured.push(options.prompt);
  return captured.length<3
    ? {content:[{type:'tool-call',toolCallId:'policy-switch',toolName:'switch_policy',input:'{}'}],finishReason:{unified:'tool-calls',raw:'tool_calls'},usage,warnings:[]}
    : {content:[{type:'text',text:'done'}],finishReason:{unified:'stop',raw:'stop'},usage,warnings:[]};
}});
const generated=await generateText({model,messages:await convertToModelMessages(await sdk.getHistory()),stopWhen:stepCountIs(3),
  tools:{switch_policy:{inputSchema:jsonSchema({type:'object',properties:{},additionalProperties:false}),execute:async()=>{
    await call('selectPermission',{sessionId:'s',preset:'danger-full-access'});
    return 'policy committed';
  }}},
  prepareStep:async context=>({messages:await prepareApprovalContext(sdk,await call('approvalModelContext'),baseline,context.messages)}),
});
assert.equal(generated.text,'done');assert.equal(captured.length,3);
const switched=await call('approvalModelContext');
assert.equal(switched.approval,'never');assert.equal(switched.notices.length,1);
const notice=switched.notices[0];assert.equal(notice.source.kind,'user-approval');
const text=notice.content[0].text;
assert.equal(JSON.stringify(captured[0]).includes(text),false);
assert.equal(JSON.stringify(captured[1]).split(text.replaceAll('"','\\"')).length-1,1,'the actual SDK next model prompt contains one transition');
assert.equal(JSON.stringify(captured[2]).split(text.replaceAll('"','\\"')).length-1,1,'the later SDK step still contains the transition exactly once');
assert.match(JSON.stringify(captured[1]),/Approval prompts are disabled/);
assert.ok(captured.flat().every(message=>Object.getOwnPropertySymbols(message).length===0),'private delivery provenance never enters the provider prompt');
assert.equal((globalThis as any).__policyAgentCalls,0,'selection/read never invokes Think or starts an inference');
assert.deepEqual(await call('history'),beforeHistory,'context/outbox do not add user input, turns, steps or queue records');
assert.deepEqual((await call('approvalModelContext',{sessionId:'isolated'})).notices,[]);
const rawBefore=db.prepare('SELECT value FROM dsh_session_host_projections WHERE session_id=?').get('s')?.value;
await call('selectPermission',{sessionId:'s',preset:'danger-full-access'});
assert.equal(db.prepare('SELECT value FROM dsh_session_host_projections WHERE session_id=?').get('s')?.value,rawBefore,'no-op selection does not enqueue or write');

// A waiting approval is still the same real request. The command queues the
// opposite transition atomically without touching its execution state.
db.prepare("UPDATE dsh_session_host_submissions SET status='awaiting-approval' WHERE request_id='real-user'").run();
const receipt=await call('executePermissionCommand',{sessionId:'s',line:'/permission workspace-write',attachments:[],rpcId:'policy-command'});
assert.equal(receipt.result.kind,'success');
assert.deepEqual(await call('executePermissionCommand',{sessionId:'s',line:'/permission workspace-write',attachments:[],rpcId:'policy-command'}),receipt);
assert.equal((await call('approvalModelContext')).notices.length,2);
assert.equal(db.prepare("SELECT status FROM dsh_session_host_submissions WHERE request_id='real-user'").get()?.status,'awaiting-approval');
const failedSession={getHistory:()=>sdk.getHistory(),getMessage:(id:string)=>sdk.getMessage(id),appendMessage:async()=>{throw Error('SDK append fault');}};
await assert.rejects(prepareApprovalContext(failedSession,await call('approvalModelContext'),baseline),/SDK append fault/);
owner=new SessionHostObject(state as never,{DshAgent:{} as never});
sessions=new ActualSessions();await sessions.onStart();sdk=sessions.session('policy-sdk');
const reopenedBaseline=approvalNoticeIds(await sdk.getHistory());
const next=await prepareApprovalContext(sdk,await call('approvalModelContext'),reopenedBaseline);
assert.equal(next.length,2,'only the still-unconsumed transition plus current context is new after restart');
await prepareApprovalContext(sdk,await call('approvalModelContext'),reopenedBaseline);
assert.equal(approvalNoticeIds(await sdk.getHistory()).size,2,'replay stores each official notice once');
await replaceDurableContext(sdk,[]);
assert.equal(approvalNoticeIds(await sdk.getHistory()).size,2,'new input context refresh does not delete policy notices');
assert.equal((await sdk.getHistory()).filter(message=>message.role==='user'&&!(message.metadata as any)?.dshContext).length,1);
const cold=await prepareApprovalContext(sdk,await call('approvalModelContext'),approvalNoticeIds(await sdk.getHistory()));
assert.equal(cold.length,1,'on a new SDK request durable notices are already in its history baseline');
assert.equal((globalThis as any).__policyAgentCalls,0);
const contextBeforeStale=await call('approvalModelContext');
await new SqliteSessionHostStorage({...storage.sql,transactionSync:storage.transactionSync}).putProjections('s',{usage:{outputTokens:1}});
assert.deepEqual(await call('approvalModelContext'),contextBeforeStale,'late statistics projection cannot erase notices or policy');
const forking=await call('history');
const userCursor=buildSessionHistory(forking.records,undefined,forking.turns).find(record=>record.event.type==='user/message')!.event.seq;
const fork=await call('fork',{sessionId:'s',sessionIdNew:'policy-fork',atSeq:userCursor});
assert.deepEqual((await call('approvalModelContext',fork)).notices,[],'fork cannot deliver parent-only pending notifications');
assert.equal((await call('approvalModelContext',fork)).approval,'ask','fork retains effective policy without inventing a change notice');
await assert.rejects(call('approvalModelContext',{sessionId:'missing'}),/Session not found/);
console.log('approval context: official policy text/notices through actual DO, SQLite and SDK prepareStep; atomic failure, no-op, command retry, waiting/executing changes, no wake, session isolation and restart dedup passed');
