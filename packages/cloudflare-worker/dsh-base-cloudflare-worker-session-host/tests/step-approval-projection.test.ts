/** Installed SDK approval/cross-message result transitions + real Sessions/Host SQLite. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SessionHost } from '../src/host.ts';
import { SqliteSessionHostStorage } from '../src/sqlite-storage.ts';
import { projectModelSteps } from '../src/step-projection.ts';
import { buildSessionHistory, SessionWireSequencer } from '@dsh-base/session-wire';
const server=createRequire(new URL('../../../build/dsh-base-build-server-dependencies/package.json',import.meta.url));
const {Sessions}=await import(pathToFileURL(server.resolve('agents/sessions')).href);
const {applyToolUpdate,toolApprovalUpdate,crossMessageToolResultUpdate}=await import(pathToFileURL(server.resolve('agents/chat')).href);
const repairAgents=new Map<string,unknown>();
(globalThis as any).__stepRepairAgents=repairAgents;
registerHooks({resolve(specifier,context,next){
  if(specifier==='agents')return{url:`data:text/javascript,${encodeURIComponent('export async function getAgentByName(_ns,name){const agent=globalThis.__stepRepairAgents.get(name);if(!agent)throw Error("unknown repair agent");return agent;}')}`,shortCircuit:true};
  return next(specifier,context);
}});
const {SessionHostObject}=await import('../src/do.ts');

for(const outcomeKind of ['approved','rejected','tool-error']) {
  const approved=outcomeKind!=='rejected';
  const expectedState=outcomeKind==='rejected'?'output-denied':outcomeKind==='tool-error'?'output-error':'output-available';
  const db=new DatabaseSync(':memory:');
  let failRepairWrite=false;
  const sql={exec(query:string,...bindings:unknown[]){if(failRepairWrite&&bindings.includes('agent.tool-results-repaired')){failRepairWrite=false;throw Error('repair event write lost');}const rows=db.prepare(query).all(...bindings as never[]) as Record<string,unknown>[];return{toArray:()=>rows,[Symbol.iterator]:()=>rows[Symbol.iterator](),rowsWritten:Number(db.prepare('SELECT changes() AS n').get()!.n)};},
    transactionSync<T>(operation:()=>T):T {db.exec('SAVEPOINT step_approval');try{const result=operation();db.exec('RELEASE step_approval');return result;}catch(error){db.exec('ROLLBACK TO step_approval');db.exec('RELEASE step_approval');throw error;}}};
  const state={sql,transactionSync:sql.transactionSync,async get(){return 3;},async put(){}};
  class RealSessions extends Sessions {get lifecycle(){return{storage:state,events:{emit(){}},ready:async()=>undefined};}}
  let sessions=new RealSessions();await sessions.onStart();
  let sdk=sessions.session('session');
  let storage=new SqliteSessionHostStorage(sql),host=new SessionHost(storage,[]);
  await host.create({sessionId:'session'});
  const receipt=await host.prompt({sessionId:'session',requestId:'user',text:'remember with approval'});
  const user={id:'user',role:'user' as const,parts:[{type:'text',text:'remember with approval'}]};
  const tool={type:'tool-remember_fact',toolCallId:'call',state:'approval-requested',input:{fact:'fixture'},approval:{id:'approval'}};
  const oldStep={id:'sdk-initial:0',startedAt:100,endedAt:200,assistantAt:200,requestedModel:'deepseek-v4-pro',responseModel:'provider-actual',chunks:[],parts:[{...tool,state:'input-available',approval:undefined}]};
  const original={id:'original-ui-message',role:'assistant' as const,parts:[tool],metadata:{dshSteps:[oldStep]}};
  await sdk.appendMessage(user as never);await sdk.appendMessage(original as never);
  await host.runSubmission({sessionId:'session',submissionId:receipt.submissionId},async()=>({messages:projectModelSteps(await sdk.getHistory())}));
  const pending=await host.history({sessionId:'session'});
  assert.equal(pending.turns[0]!.status,'awaiting-approval');
  const journal=new SessionWireSequencer(pending.records,{turns:pending.turns});
  assert.equal(journal.records.filter(row=>row.event.type==='tool/result'||row.event.type==='turn/end').length,0,'pending evidence alone never fabricates an outcome');
  const intent=await host.beginApproval({sessionId:'session',toolCallId:'call',decision:approved?'approved':'rejected'});

  let actual=await sdk.getMessage(original.id);
  const decision=applyToolUpdate(actual.parts,toolApprovalUpdate('call',approved));
  assert.ok(decision);actual={...actual,parts:decision.parts};await sdk.updateMessage(actual);
  if(approved){
    const outcome=applyToolUpdate(actual.parts,crossMessageToolResultUpdate('call',outcomeKind==='tool-error'?'output-error':'output-available',{saved:true,fact:'fixture'},outcomeKind==='tool-error'?'actual tool fixture failure':undefined));
    assert.ok(outcome);actual={...actual,parts:outcome.parts};await sdk.updateMessage(actual);
  }
  // The continuation carries prior evidence but a separate UIMessage owns its
  // new text. That repeated frozen evidence must not overwrite the real result.
  const nextStep={id:'sdk-continuation:0',startedAt:300,endedAt:400,assistantAt:400,requestedModel:'deepseek-v4-pro',responseModel:'provider-actual',chunks:[],parts:[{type:'text',text:approved?'Saved':'I did not save it'}]};
  await sdk.appendMessage({id:'continuation-ui-message',role:'assistant',parts:nextStep.parts,metadata:{dshSteps:[oldStep,nextStep]}} as never);
  const projected=projectModelSteps(await sdk.getHistory());
  assert.deepEqual(projected.map(row=>row.id),['user','dsh-sdk-step:sdk-initial:0','dsh-sdk-step:sdk-continuation:0']);
  const result=projected[1]!.parts[0] as any;
  assert.equal(result.state,expectedState);
  if(outcomeKind==='approved')assert.deepEqual(result.output,{saved:true,fact:'fixture'});
  if(outcomeKind==='tool-error')assert.equal(result.errorText,'actual tool fixture failure');
  await host.finishApproval(intent,projected,{status:'completed'});
  const completed=await host.history({sessionId:'session'});
  journal.pushMessages(completed.records,completed.turns);
  const cold=buildSessionHistory(completed.records,undefined,completed.turns);
  assert.deepEqual(journal.records,cold,'late actual result has identical live/cold ownership');
  assert.equal(cold.filter(row=>row.event.type==='tool/result').length,1);
  const toolResult=cold.find(row=>row.event.type==='tool/result')!.event.data as any;
  assert.equal(toolResult.message.isError===true,outcomeKind!=='approved');
  assert.equal(cold.filter(row=>row.event.type==='turn/end').length,1);
  assert.equal((cold.at(-1)!.event.data as any).reason.kind,'completed');
  assert.equal((await host.projections({sessionId:'session'})).sessionStats.steps,2);
  assert.deepEqual(journal.observeLive({requestId:'user',attemptId:'old-live',stepId:oldStep.id,turn:1,step:1,startedAt:100,chunks:[],settledMessages:pending.records}),[],'an old live snapshot cannot reopen or regress a terminal turn');

  sessions=new RealSessions();await sessions.onStart();sdk=sessions.session('session');
  storage=new SqliteSessionHostStorage(sql);host=new SessionHost(storage,[]);
  const replay=projectModelSteps(await sdk.getHistory());
  assert.deepEqual(replay,projected,'SDK restart retains the actual result and repeated metadata');
  await host.syncAgentMessages({sessionId:'session',messages:replay});
  const restarted=await host.history({sessionId:'session'});
  assert.deepEqual(buildSessionHistory(restarted.records,undefined,restarted.turns),cold,'Host restart/replay does not duplicate or regress Steps/results');
  assert.equal((await sdk.getMessage(original.id)).parts[0].state,expectedState,'projection never rewrites SDK evidence');

  const otherUser={id:'another-user',role:'user' as const,parts:[{type:'text',text:'separate request'}]};
  const other={...original,id:'other-message',metadata:{dshSteps:[{...oldStep,id:'another-sdk:0'}]}};
  const isolated=projectModelSteps([...await sdk.getHistory(),otherUser,other]);
  assert.equal((isolated.at(-1)!.parts[0] as any).state,'approval-requested','identical call ids in a different user Turn cannot borrow a terminal result');

  // Reproduce already-deployed damage: the last repeated previousSteps row
  // overwrote the real terminal tool state in Host, while SDK kept its result.
  const damaged=completed.records.map(row=>row.id==='dsh-sdk-step:sdk-initial:0'?{...row,parts:row.parts.map(part=>(part as any)?.toolCallId==='call'?oldStep.parts[0]:part)}:row);
  await storage.replaceMessages('session',damaged);
  const damagedStored=(await host.history({sessionId:'session'})).records;
  assert.equal(await host.needsToolResultReconciliation('session'),true);
  const projectionBeforeRepair=await storage.getProjections('session');
  assert.equal(await host.repairCompletedToolResults('session',[]),0,'missing SDK evidence cannot create a result');
  assert.equal(await host.repairCompletedToolResults('session',replay.map(message=>message.role==='user'?{...message,id:'wrong-request'}:message)),0,'matching row/call under a different SDK request is not accepted');
  const submissionBeforeRepair=(await storage.getSubmission(receipt.submissionId))!;
  await storage.putSubmission({...submissionBeforeRepair,status:'cancelled'});
  assert.equal(await host.repairCompletedToolResults('session',replay),0,'transaction rechecks that the owning request remains completed');
  await storage.putSubmission(submissionBeforeRepair);
  assert.deepEqual((await host.history({sessionId:'session'})).records,damagedStored);
  let agentReads=0,failAgentRead=true;
  repairAgents.set(`owner:repair-${outcomeKind}:session`,{async getMessages(){agentReads++;if(failAgentRead)throw Error('Agent history temporarily unavailable');return sdk.getHistory();}});
  const ownerState={id:{name:`owner:repair-${outcomeKind}:default-v49`},storage:{sql,transactionSync:sql.transactionSync,async setAlarm(){}}};
  const env={DshAgent:{} as never};
  let owner=new SessionHostObject(ownerState,env);
  const read=async()=>{const response=await owner.fetch(new Request('https://host/api/session-host',{method:'POST',body:JSON.stringify({method:'history',params:{sessionId:'session'}})}));return{status:response.status,body:await response.json() as any};};
  assert.equal((await read()).status,503,'unavailable SDK evidence fails the read instead of fabricating success');
  assert.equal(await host.needsToolResultReconciliation('session'),true);
  failAgentRead=false;failRepairWrite=true;
  assert.equal((await read()).status,503);
  assert.deepEqual((await host.history({sessionId:'session'})).records,damagedStored,'a failed repair event rolls back all tool-row changes');
  owner=new SessionHostObject(ownerState,env);
  const repaired=await read();assert.equal(repaired.status,200);
  assert.deepEqual(buildSessionHistory(repaired.body.result.records,undefined,repaired.body.result.turns),cold,'read recovery restores existing completed history from actual SDK results');
  const readsAfterRepair=agentReads;
  owner=new SessionHostObject(ownerState,env);
  assert.equal((await read()).status,200);assert.equal(agentReads,readsAfterRepair,'repaired history reads do not contact or execute the Agent again');
  assert.equal((await storage.listEvents('session',0,1000)).filter(event=>event.type==='agent.tool-results-repaired').length,1);
  assert.equal((await storage.getSubmission(receipt.submissionId))!.status,'completed','read repair never changes execution outcome');
  assert.deepEqual(await storage.getProjections('session'),projectionBeforeRepair,'read repair preserves cumulative accounting and configured projections');
}
console.log('step approval projection: actual SDK allow/deny/error, unique continuation Steps, SQLite restart/replay, user isolation, deployed damage read repair and atomic recovery faults passed');
