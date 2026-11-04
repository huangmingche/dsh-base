import assert from 'node:assert/strict';
import { assertUserTurnSemantics, assertStatsMatchJournal, assertModelExecutionEvidence, findAssistantTextForPrompt } from './acceptance-turn-semantics.mjs';
const event = (type, data) => ({ type: 'event', event: { type, data } });
// Pinned core/session/src/types.ts SessionEventMap and core/session/src/repair.ts:
// tool/result embeds a ToolResultMessage; event.data has no callId field.
const toolResult = (step = 1, sourceCallId = 'call') => event('tool/result', {
 turn:1,step,message:{id:'tool-result-call',role:'tool',toolCallId:'call',source:{kind:'tool',callId:sourceCallId},content:[{type:'text',text:'stored'}]},
});
const events = [
 event('turn/start',{turn:1}),event('step/start',{turn:1,step:1}),
 event('user/message',{id:'user-fixture',role:'user',content:[{type:'text',text:'approval fixture'}],source:{kind:'user',rpcId:'fixture'}}),
 event('tool/call',{turn:1,step:1,callId:'call',name:'remember_fact',arguments:'{}'}),
 toolResult(),event('step/end',{turn:1,step:1}),
 event('step/start',{turn:1,step:2}),event('assistant/message',{turn:1,step:2,message:{id:'assistant-fixture',role:'assistant',source:{kind:'model',provider:'deepseek',model:'fixture'},content:[{type:'text',text:'OK'}]},stream:[]}),
 event('step/end',{turn:1,step:2}),event('turn/end',{turn:1,reason:{kind:'completed'}}),
];
const page = records => ({hasMore:false,records:records.map((record,index)=>({...record,event:{...record.event,seq:index+1}}))});
const expected = {promptNeedle:'approval fixture',toolName:'remember_fact',expectedUserTurns:1,expectedModelSource:{provider:'deepseek',model:'fixture'}};
assert.equal(assertUserTurnSemantics(page(events),expected).completionProcesses,1);
assert.deepEqual(assertStatsMatchJournal({values:{sessionStats:{turns:1,steps:2}}},page(events)),{turns:1,steps:2});
assert.throws(()=>assertStatsMatchJournal({values:{sessionStats:{turns:1,steps:1}}},page(events)),/including continuation/);
assert.throws(()=>assertStatsMatchJournal({values:{sessionStats:{turns:2,steps:2}}},page(events)),/actual logical turns/);
const split = [...events.slice(0,6),event('turn/end',{turn:1,reason:{kind:'completed'}}),event('turn/start',{turn:2}),...events.slice(6).map(record=>({...record,event:{...record.event,data:{...record.event.data,turn:2}}}))];
assert.throws(()=>assertUserTurnSemantics(page(split),expected),/extra turns/);
assert.throws(()=>assertUserTurnSemantics(page([...events,events.at(-1)]),expected),/one final end/);
assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='tool/result'?toolResult(2):record)),expected),/original calling step/);
assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='tool/result'?toolResult(1,'wrong-call'):record)),expected),/identity matches its source/);
assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='tool/result'?event('tool/result',{turn:1,step:1,callId:'call'}):record)),expected),/exactly one result/);
assert.throws(()=>assertUserTurnSemantics(page(events.filter(record=>record.event.type!=='step/end')),expected),/closes once/);
for (const reason of [{kind:'aborted',reason:{kind:'user'}},{kind:'error',error:{code:'UNKNOWN',message:'real failure'}}]) {
 assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='turn/end'?event('turn/end',{turn:1,reason}):record)),expected),/complete rather than fail or cancel/);
}
assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='tool/result'?event('tool/result',{...record.event.data,message:{...record.event.data.message,isError:true}}):record)),expected),/must not return an error/);
for (const source of [{kind:'model',provider:'unknown',model:'unknown'},{kind:'model',provider:'deepseek',model:'deepseek-flash'}]) {
 assert.throws(()=>assertUserTurnSemantics(page(events.map(record=>record.event.type==='assistant/message'?event('assistant/message',{...record.event.data,message:{...record.event.data.message,source}}):record)),expected),/provenance identifies/);
}
console.log('acceptance turn semantics: official same-turn success accepted; split turns, malformed results, duplicate/missing boundaries, cancellations, failures, error tool results and incorrect model provenance rejected');

// Requested ids and actual provider response ids deliberately differ.
const sourcePage = { records: [{ event: { type: 'assistant/message', data: { message: { id: 'dsh-assistant-step:0:sdk-step', source: { kind: 'model', provider: 'deepseek-official', model: 'actual-response-revision' } } } } }] };
const evidence = { records: [{ id: 'sdk-step', parts: [
  { type: 'data-dsh-step', data: { requestedModel: 'deepseek-v4-pro', reasoningEffort: 'low', responseModel: 'actual-response-revision' } },
  { type: 'data-dsh-model-source', data: { requestedModel: 'deepseek-v4-pro', reasoningEffort: 'low', model: 'actual-response-revision' } },
] }] };
const expectedExecution = { provider: 'deepseek-official', requestedModel: 'deepseek-v4-pro', reasoningEffort: 'low' };
assert.equal(assertModelExecutionEvidence(evidence, sourcePage, expectedExecution)[0].responseModel, 'actual-response-revision');
for (const [key, value] of [['requestedModel', 'deepseek-flash'], ['reasoningEffort', 'max'], ['responseModel', 'unknown']]) {
  const bad = structuredClone(evidence); bad.records[0].parts[0].data[key] = value;
  assert.throws(() => assertModelExecutionEvidence(bad, sourcePage, expectedExecution));
}
const echo = structuredClone(sourcePage); echo.records[0].event.data.message.source.model = 'deepseek-v4-pro';
assert.throws(() => assertModelExecutionEvidence(evidence, echo, expectedExecution), /actual response evidence/);
console.log('model provenance: canonical request, frozen effort and distinct actual response verified; echoed request, unknown response and mismatched continuation rejected');

const user=(id,text)=>({id,role:'user',parts:[{type:'text',text}]});
const assistant=(id,parts)=>({id,role:'assistant',parts});
const toolOnly=assistant('tool-step',[{type:'tool-fetch_url',toolCallId:'call',state:'output-available',output:'page'}]);
const reply=assistant('reply-step',[{type:'text',text:'Cloudflare Developer Docs'}]);
const target=user('target','tool-only fixture');
assert.deepEqual(findAssistantTextForPrompt([target,toolOnly,reply],'tool-only fixture'),{requestId:'target',text:'Cloudflare Developer Docs'});
assert.equal(findAssistantTextForPrompt([target,toolOnly],'tool-only fixture'),undefined);
assert.equal(findAssistantTextForPrompt([target,toolOnly,user('next','different question'),reply],'tool-only fixture'),undefined,'a subsequent user turn cannot supply the missing answer');
assert.equal(findAssistantTextForPrompt([target,toolOnly,reply],'absent prompt'),undefined);
assert.deepEqual(findAssistantTextForPrompt([target,toolOnly,assistant('empty',[{type:'text',text:' '}]),reply],'tool-only fixture'),{requestId:'target',text:'Cloudflare Developer Docs'});
console.log('acceptance reply lookup: tool-only Step followed by text, pending tool-only, empty output and next-turn isolation passed');
