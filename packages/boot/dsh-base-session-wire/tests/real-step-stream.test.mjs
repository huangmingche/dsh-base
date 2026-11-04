import assert from 'node:assert/strict';
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts';
import { toolDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/tool.ts';
import { turnProcessDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/turn-process.ts';
import { SessionWireSequencer, SessionLiveFrameSequencer, buildSessionHistory } from '../src/index.ts';
import { projectModelSteps } from '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/step-projection.ts';

const collector = {target:'chat', create() { const nodes = new Map(); return {empty:{nodes:[]}, replace(input) {nodes.clear(); for (const n of input.nodes) nodes.set(n.key,n); return {nodes:[...nodes.values()]};}, apply(input) {for (const n of input.upserts) nodes.set(n.key,n); return {nodes:[...nodes.values()]};} }; }};
const assembler = new ConversationNodeAssembler({entries:()=>[turnProcessDefinition, toolDefinition],fallbackEntry:()=>undefined},{entries:()=>[collector]});
assembler.activateTarget('chat');
const user = {id:'request',role:'user',parts:[{type:'text',text:'read'}]};
const running = [{requestId:'request',status:'running',startedAt:1000}];
const journal = new SessionWireSequencer([user],{turns:running});
const frames = new SessionLiveFrameSequencer();
let cursor = 0, transient = 0;
const append = records => {for (const r of records) {cursor=r.event.seq; transient=0; assembler.append(r); frames.accept(r);} };
append(journal.records);
assert.equal(journal.records.filter(r=>r.event.type==='step/start').length,0,'admission does not fabricate a model start time');
const live = {requestId:'request',attemptId:'sdk:first',turn:1,step:1,startedAt:1100,chunks:[
  {type:'tool-call-delta',index:0,id:'call',name:'read_file',text:'',time:1120},
  {type:'tool-call-delta',index:0,id:'call',text:'{"path":"a"}',time:1130},
]};
append(journal.observeLive(live));
for (const {frame} of frames.observe(live)) if(frame.type==='chunk') assembler.append({type:'transient',event:{type:'assistant/live-chunk',seq:cursor+1-1/(++transient+1),time:frame.time,data:{attemptId:live.attemptId,turn:1,step:1,chunk:frame.chunk}}});
assembler.flush();
const preparing = assembler.snapshot('chat').nodes.find(n=>n.kind==='tool-call');
assert.ok(preparing, 'unchanged official tool node appears before assistant settlement');
assert.equal(preparing.data.root.phase,'preparing');
assert.equal(preparing.data.root.name,'read_file');
assert.equal(journal.records.filter(r=>r.event.type==='tool/call').length,0,'preview does not invent a journal call');
const first = {id:'sdk:0',startedAt:1100,endedAt:1250,requestedModel:'deepseek-v4-pro',responseModel:'provider-pro-actual',chunks:live.chunks,
  toolCallTimes:[{callId:'call',time:1140}],toolTimings:[{callId:'call',startedAt:1140,endedAt:1240}],parts:[{type:'tool-read_file',toolName:'read_file',toolCallId:'call',input:{path:'a'},state:'output-available',output:'value'}]};
const second = {id:'sdk:1',startedAt:1300,endedAt:1400,requestedModel:'deepseek-v4-pro',responseModel:'provider-pro-actual',chunks:[{type:'text-delta',index:0,text:'OK',time:1350}],parts:[{type:'text',text:'OK'}]};
const raw = {id:'sdk-ui-message',role:'assistant',parts:[{type:'step-start'},...first.parts,{type:'step-start'},...second.parts],metadata:{dshSteps:[first,second]}};
const rows = projectModelSteps([raw]);
append(journal.observeLive({...live,settledMessages:[rows[0]]}));
const nextLive = {...live,attemptId:'sdk:second',step:2,startedAt:1300,settledMessages:[rows[0]],chunks:second.chunks};
append(journal.observeLive(nextLive));
append(journal.observeLive({...nextLive,settledMessages:rows}));
const completed=[{...running[0],status:'completed',endedAt:1450}];
append(journal.pushMessages([user,...rows],completed));
assembler.flush();
assert.equal(assembler.snapshot('chat').nodes.filter(n=>n.kind==='tool-call').length,1);
assert.equal(journal.records.filter(r=>r.event.type==='assistant/message').length,2);
assert.equal(journal.records.filter(r=>r.event.type==='turn/end').length,1);
assert.deepEqual(journal.records.filter(r=>r.event.type==='step/start').map(r=>r.event.time),[1100,1300]);
assert.deepEqual(journal.records.filter(r=>r.event.type==='step/end').map(r=>r.event.time),[1250,1400]);
assert.equal(journal.records.find(r=>r.event.type==='tool/call').event.time,1140);
assert.equal(journal.records.find(r=>r.event.type==='tool/result').event.time,1240);
assert.deepEqual(journal.records,buildSessionHistory([user,...rows],undefined,completed),'actual live/cold histories retain exact ids, ordering and times');
const approvedRaw={...raw,parts:raw.parts.map(p=>p.toolCallId==='call'?{...p,state:'output-denied'}:p)};
assert.equal(projectModelSteps([approvedRaw])[0].parts[0].state,'output-denied','later approval state is retained on original step');
console.log('official live tools: pre-settlement preparing card, real SDK step evidence, exact timing, late approval and live/reload identity passed');

// Approval execution may finish long after the original model produced the call.
const approvalStep={...first,assistantAt:1250,toolCallTimes:[{callId:'call',time:1140}],toolTimings:[],parts:[{...first.parts[0],state:'approval-requested',output:undefined}]};
const pendingRow=projectModelSteps([{...raw,parts:approvalStep.parts,metadata:{dshSteps:[approvalStep]}}])[0];
const approvalJournal=new SessionWireSequencer([user,pendingRow],{turns:[{...running[0],status:'awaiting-approval'}]});
const lateStep={...approvalStep,endedAt:2000,toolTimings:[{callId:'call',startedAt:1900,endedAt:2000}]};
const lateRow=projectModelSteps([{...raw,parts:first.parts,metadata:{dshSteps:[lateStep]}}])[0];
approvalJournal.observeLive({...live,attemptId:'approval-continuation',startedAt:undefined,chunks:[],tools:[{callId:'call',name:'read_file',state:'done',output:'value',startedAt:1900,endedAt:2000}]});
approvalJournal.pushMessages([user,lateRow],[{...running[0],status:'completed',endedAt:2100}]);
assert.deepEqual(approvalJournal.records,buildSessionHistory([user,lateRow],undefined,[{...running[0],status:'completed',endedAt:2100}]));
assert.equal(approvalJournal.records.find(r=>r.event.type==='step/end').event.time,2000);
assert.equal(approvalJournal.records.find(r=>r.event.type==='assistant/message').event.time,1250);
console.log('official approval time: late tool completion extends original Step without rewriting the committed assistant timestamp');

const reattached=new SessionWireSequencer([user,rows[0]],{turns:running});
assert.deepEqual(reattached.observeLive({...live,stepId:first.id,settledMessages:[rows[0]]}),[],'reattaching to an already settled real step cannot open a phantom next step');

// Entered Steps remain durable when the provider fails before the first token.
for (const status of ['failed','cancelled']) {
  const entered={...running[0],steps:[{id:'failed-sdk:0',startedAt:1600}]};
  const failureJournal=new SessionWireSequencer([user],{turns:running});
  failureJournal.pushMessages([user],[entered]);
  failureJournal.observeLive({requestId:'request',attemptId:'failed-attempt',stepId:'failed-sdk:0',startedAt:1600,turn:1,step:1,chunks:[]});
  const terminal={...entered,status,error:'provider rejected before tokens',endedAt:1700};
  failureJournal.pushMessages([user],[terminal]);
  assert.deepEqual(failureJournal.records,buildSessionHistory([user],undefined,[terminal]));
  assert.deepEqual(failureJournal.records.map(r=>[r.event.type,r.event.time]),[
    ['turn/start',1000],['user/message',1000],['step/start',1600],['step/end',1700],['turn/end',1700],
  ]);
  assert.equal(failureJournal.records.at(-1).event.data.reason.kind,status==='failed'?'error':'aborted');
  const coldAssembler=new ConversationNodeAssembler({entries:()=>[turnProcessDefinition,toolDefinition],fallbackEntry:()=>undefined},{entries:()=>[collector]});
  coldAssembler.activateTarget('chat');
  for(const record of failureJournal.records)coldAssembler.append(record);
  coldAssembler.flush();
  assert.ok(coldAssembler.snapshot('chat').nodes.length>0,'actual pinned assembler accepts the tokenless failed Step');
}
const secondFailure={...running[0],status:'failed',error:'second call failed',endedAt:1500,steps:[{id:first.id,startedAt:1100},{id:'sdk:1-failed',startedAt:1300}]};
const twoStepFailure=new SessionWireSequencer([user,rows[0]],{turns:[{...secondFailure,status:'running'}]});
twoStepFailure.observeLive({...nextLive,stepId:'sdk:1-failed',chunks:[]});
twoStepFailure.pushMessages([user,rows[0]],[secondFailure]);
assert.deepEqual(twoStepFailure.records,buildSessionHistory([user,rows[0]],undefined,[secondFailure]));
assert.deepEqual(twoStepFailure.records.filter(r=>r.event.type==='step/start').map(r=>r.event.time),[1100,1300]);
assert.deepEqual(twoStepFailure.records.filter(r=>r.event.type==='step/end').map(r=>r.event.time),[1250,1500]);
assert.equal(twoStepFailure.records.filter(r=>r.event.type==='assistant/message').length,1);
console.log('official failed-step recovery: actual entered start, tokenless failure/cancel, next-step failure and cold/live journal identity');
