/** Actual SQLite before-token step admission; no provider or fabricated assistant. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SessionHost } from '../src/host.ts';
import { SqliteSessionHostStorage, type SqlStorage } from '../src/sqlite-storage.ts';
import { buildSessionHistory } from '@dsh-base/session-wire';
import { withExecutionStatistics } from '../src/execution-stats.ts';
const db = new DatabaseSync(':memory:');
let failEvent = false;
const sql: SqlStorage = {
  exec(query, ...bindings) {
    if (failEvent && query.includes("'execution.step-started'")) { failEvent = false; throw Error('step event lost'); }
    const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
    return { toArray: () => rows };
  },
  transactionSync(operation) { db.exec('BEGIN'); try { const value = operation(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
};
const catalog = [{ id: 'deepseek-v4-pro', label: 'Pro', contextWindow: 1048576 }];
let storage = new SqliteSessionHostStorage(sql), host = new SessionHost(storage, catalog);
await host.create({ sessionId: 'session' });
await host.selectModel({ sessionId: 'session', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'low' });
await host.prompt({ sessionId: 'session', requestId: 'request', text: 'before-token error case' });
const step = { sessionId: 'session', requestId: 'request', sdkRequestId: 'sdk-request', stepId: 'actual-step-1', startedAt: 123 };
await assert.rejects(host.recordStepStart(step), /no matching admitted model request/);
await host.recordModelRequest({ sessionId: 'session', requestId: 'request', sdkRequestId: 'sdk-request', model: 'deepseek-official/deepseek-v4-pro', reasoningEffort: 'low' });
await assert.rejects(host.recordStepStart({ ...step, startedAt: NaN }), /start time/);
const stale = await storage.getProjections('session');
await Promise.all(Array.from({ length: 8 }, () => host.recordStepStart(step)));
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dsh_session_host_execution_steps').get()?.n, 1);
assert.equal((await storage.listEvents('session', 0, 100)).filter(event => event.type === 'execution.step-started').length, 1);
await assert.rejects(host.recordStepStart({ ...step, startedAt: 124 }), /different execution evidence/);
await assert.rejects(host.recordStepStart({ ...step, sdkRequestId: 'unrecorded' }), /no matching admitted model request/);
await storage.putProjections('session', { ...stale, usage: { outputTokens: 0 } });
let snapshot = await storage.transcriptSnapshot('session');
assert.deepEqual(snapshot.executionSteps, { request: [{ id: 'actual-step-1', sdkRequestId: 'sdk-request', startedAt: 123 }] });
assert.equal(snapshot.records.some(record => record.role === 'assistant'), false, 'start evidence never fabricates assistant output');
const before = await storage.projectionSnapshot('session');
failEvent = true;
await assert.rejects(host.recordStepStart({ ...step, stepId: 'rolled-back', startedAt: 150 }), /event lost/);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dsh_session_host_execution_steps').get()?.n, 1);
assert.deepEqual(await storage.projectionSnapshot('session'), before, 'step row, projection, revision and event roll back together');
storage = new SqliteSessionHostStorage(sql); host = new SessionHost(storage, catalog);
snapshot = await storage.transcriptSnapshot('session');
assert.deepEqual(snapshot.executionSteps, { request: [{ id: 'actual-step-1', sdkRequestId: 'sdk-request', startedAt: 123 }] });
await host.cancel({ sessionId: 'session' });
await host.recordStepStart(step); // Already committed evidence may be replayed after cancellation.
await assert.rejects(host.recordStepStart({ ...step, stepId: 'after-cancel', startedAt: 160 }), /no longer active/);
console.log('session-host: before-token step evidence validates frozen request/SDK identity, deduplicates, survives restart/stale writes and rolls back atomically; cancelled inputs reject new steps');

await host.create({sessionId:'failure'});
await host.selectModel({sessionId:'failure',model:'deepseek-official/deepseek-v4-pro',reasoningEffort:'low'});
const receipt=await host.prompt({sessionId:'failure',requestId:'failed-request',text:'provider fails before token'});
let enteredAt=0;
await assert.rejects(host.runSubmission({sessionId:'failure',submissionId:receipt.submissionId},async()=>{
  await host.recordModelRequest({sessionId:'failure',requestId:'failed-request',sdkRequestId:'failed-sdk',model:'deepseek-official/deepseek-v4-pro',reasoningEffort:'low'});
  enteredAt=Date.now();
  await host.recordStepStart({sessionId:'failure',requestId:'failed-request',sdkRequestId:'failed-sdk',stepId:'failed-sdk:0',startedAt:enteredAt});
  throw Error('provider failed before first token');
}),/provider failed/);
storage=new SqliteSessionHostStorage(sql); host=new SessionHost(storage,catalog);
const failed=await host.history({sessionId:'failure'});
assert.equal(failed.records.length,1);
assert.equal(failed.turns[0]?.status,'failed');
assert.deepEqual(failed.turns[0]?.steps,[{id:'failed-sdk:0',startedAt:enteredAt}]);
const journal=buildSessionHistory(failed.records,undefined,failed.turns);
assert.deepEqual(journal.map(record=>record.event.type),['turn/start','user/message','step/start','step/end','turn/end']);
assert.equal(journal[2]?.event.time,enteredAt);
assert.equal(journal[3]?.event.time,failed.turns[0]?.endedAt);
assert.equal((journal.at(-1)?.event.data as any).reason.kind,'error');
assert.equal((await host.projections({sessionId:'failure'})).sessionStats.steps,1,'tokenless failure counts its real entered Step');
assert.equal((await host.projections({sessionId:'failure'})).sessionStats.turns,1);
const failedRaw=await storage.getProjections('failure');
const firstStats=withExecutionStatistics(failedRaw,failed.records);
assert.equal((firstStats.sessionStats as any).steps,1);
assert.deepEqual(withExecutionStatistics(firstStats,failed.records),firstStats,'replay cannot increment Step counts');

// A settled tool Step and its earlier entry are the same Step, not two.
const settled={id:'dsh-sdk-step:failed-sdk:0',role:'assistant',parts:[{type:'tool-read_file',toolCallId:'tool',state:'output-available',input:{},output:'value'},{type:'data-dsh-step',data:{id:'failed-sdk:0',startedAt:enteredAt,endedAt:enteredAt+1}}]};
assert.equal((withExecutionStatistics(failedRaw,[...failed.records,settled]).sessionStats as any).steps,1);
const legacy={id:'legacy',role:'assistant',parts:[{type:'step-start'},{type:'text',text:'first'},{type:'step-start'},{type:'text',text:'second'}]};
assert.equal((withExecutionStatistics(failedRaw,[...failed.records,settled,legacy]).sessionStats as any).steps,3,'legacy partitions remain counted without invented identities');
await storage.appendMessages('failure',[{...settled,seq:2}]);
assert.equal((await host.projections({sessionId:'failure'})).sessionStats.steps,1,'SQL summary also deduplicates entry and settled tools');
await storage.replaceMessages('failure',failed.records);

// Exact seeds retain only entered Steps within their cut, including tokenless
// failure; later source inputs must never leak into fork counters.
const beforeStep=await host.fork({sessionId:'failure',atSeq:journal[1]!.event.seq,sessionIdNew:'before-step'});
const afterStep=await host.fork({sessionId:'failure',atSeq:journal[2]!.event.seq,sessionIdNew:'after-step'});
assert.equal((await host.projections(beforeStep)).sessionStats.steps,0);
assert.equal((await host.projections(afterStep)).sessionStats.steps,1);
assert.equal(Object.hasOwn(await storage.getProjections(afterStep.sessionId),'_dshBaseExecutionSteps'),false);
storage=new SqliteSessionHostStorage(sql);host=new SessionHost(storage,catalog);
assert.equal((await host.projections(afterStep)).sessionStats.steps,1,'fork tokenless Step count survives restart');
const continued=await host.prompt({sessionId:afterStep.sessionId,requestId:'fork-continue',text:'continue'});
await host.runSubmission({sessionId:afterStep.sessionId,submissionId:continued.submissionId},async()=>({messages:[
  ...(await host.history(afterStep)).records,{id:'fork-response',role:'assistant',parts:[{type:'text',text:'continued'}]},
]}));
assert.equal((await host.projections(afterStep)).sessionStats.steps,2,'new Step adds once after the exact inherited seed');
console.log('session-host: real SQLite/Host failed execution without assistant output restores the entered Step and authoritative failure time after restart');
