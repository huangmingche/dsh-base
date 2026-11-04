/** Offline harness contract test. fetch is replaced completely; no deployment is contacted. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const temporary = mkdtempSync(join(tmpdir(), "dsh-file-acceptance-"));
const script = fileURLToPath(new URL("../acceptance-file-upload.mjs", import.meta.url));
const preload = join(temporary, "fetch.mjs");
writeFileSync(preload, `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
let source, other, bytes, file, request, admitted = false, completed = false, modelRuns = 0;
const receiptId = 'offline-receipt';
const error = reason => ({ code: 'session/attachment-invalid', message: reason, details: { reason } });
const ok = value => Response.json(value);
const records = () => completed ? [{id:request.requestId,role:'user',parts:[request.content[0],{type:'file',attachment:file}]},{id:'reply',role:'assistant',parts:[{type:'tool-read_uploaded_file',toolCallId:'read-1',input:{receiptId,offset:70000},state:'output-available'},{type:'text',text:bytes.toString().match(/PROOF_TOKEN=(\\S+)/u)[1]}]}] : [];
globalThis.fetch = async (input, init={}) => {
  const url = new URL(input);
  assert.equal(url.origin,'https://offline-acceptance.invalid');
  if(url.pathname.startsWith('/api/auth/')) return Response.json({ok:true},{headers:{'set-cookie':'__Secure-better-auth.session_token=offline-cookie; HttpOnly; Secure'}});
  assert.match(init.headers.cookie,/offline-cookie/u);
  if(url.pathname === '/api/session/uploadFileBinary') {
    if(url.searchParams.has('mediaType'))return ok({ok:false,error:error('IMAGE_PROCESSOR_UNAVAILABLE')});
    if(process.env.DSH_MOCK_FAILURE === 'http') return Response.json({}, {status:503});
    bytes=Buffer.from(init.body); file={name:'proof.txt',bytes:bytes.length,attachmentId:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
    return ok({ok:true,value:{receiptId,file}});
  }
  const body=JSON.parse(init.body);
  if(url.pathname === '/api/session-host/claim') { assert.equal(body.sessionId,source); completed=true; modelRuns++; assert.equal(modelRuns,1); return ok({running:false}); }
  if(url.pathname === '/api/session-host') {
    const p=body.params;
    if(body.method==='state')return ok({result:{running:false}});
    if(body.method==='history')return ok({result:{records:p.sessionId===source?records():[]}});
    if(body.method==='projections')return ok({result:{usage:{inputTokens:100,outputTokens:8},imageLimits:{maxImagesPerMessage:0,mediaTypes:['image/png']}}});
    if(body.method==='uploadedFileRead') {
      if(p.sessionId!==source)return Response.json({error:error('FILE_NOT_STAGED')},{status:400});
      if(!admitted)return Response.json({error:error('FILE_NOT_ADMITTED')},{status:400});
      const offset=p.offset??0, limit=p.limit??65536, content=bytes.subarray(offset,offset+limit);
      return ok({result:{attachment:file,offset,encoding:'utf-8',content:content.toString(),...(offset+content.length<bytes.length?{nextOffset:offset+content.length}:{})}});
    }
    throw new Error('Unexpected Host request '+body.method);
  }
  assert.equal(body.type,'client-request'); assert.equal(body.method,url.pathname.slice(5)); assert.ok(body.payload.args);
  const p=body.payload.args.request;
  let value;
  if(body.method==='session/create') { if(!source)source=p.sessionId;else other=p.sessionId;value={sessionId:p.sessionId}; }
  else if(body.method==='session/selectModel')value={model:p.model};
  else if(body.method==='session/prompt') {
    if(p.sessionId===other)return ok({rpcId:body.rpcId,result:{ok:false,error:error('FILE_NOT_STAGED')}});
    if(admitted)assert.equal(p.requestId,request.requestId);
    request=p;admitted=true;value={accepted:true,submissionId:'offline-submission'};
  }
  else if(body.method==='session/page')value={records:records().filter(row=>row.role==='user').map(row=>({type:'event',event:{type:'user/message',data:{id:row.id,content:row.parts}}})),hasMore:false};
  else throw new Error('Unexpected RPC '+body.method);
  return ok({rpcId:body.rpcId,result:{ok:true,value}});
};
`);
try {
  for (const failure of ["", "http"]) {
    const run = spawnSync(process.execPath, ["--import", preload, script], { encoding: "utf8", env: { PATH: process.env.PATH, DSH_BASE_URL: "https://offline-acceptance.invalid", DSH_ACCEPTANCE_USERNAME: "accept_offline_private", DSH_ACCEPTANCE_PASSWORD: "offline-private-password", DSH_MOCK_FAILURE: failure } });
    const summary = JSON.parse((failure ? run.stderr : run.stdout).trim());
    const output = resolve(summary.artifact);
    try {
      const reportText = readFileSync(output, "utf8"), report = JSON.parse(reportText);
      assert.equal(run.status, failure ? 1 : 0, run.stderr);
      assert.equal(report.status, failure ? "failed" : "passed");
      assert.equal(report.base, "https://offline-acceptance.invalid");
      assert.ok(!reportText.includes("offline-private-password"));
      assert.ok(!reportText.includes("offline-cookie"));
      assert.ok(!reportText.includes("accept_offline_private"));
      if (failure) assert.equal(report.phase, "raw_upload");
      else { assert.equal(summary.modelSubmissions, 1); assert.ok(report.model.readToolCalls > 0); assert.equal(report.checks.length, 7); }
    } finally { rmSync(output, { force: true }); }
  }
  console.log("file-upload acceptance: offline official envelopes, one submission/replay, read-back, fresh auth, scoped/image rejection and redacted failure evidence passed");
} finally { rmSync(temporary, { recursive: true, force: true }); }
