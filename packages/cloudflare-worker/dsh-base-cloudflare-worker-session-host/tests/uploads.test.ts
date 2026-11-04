/** Real SQLite, R2 port, unchanged official upload handler, RPC and Think read seam. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "agents") return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName() { return globalThis.__uploadAgent; }')}`, shortCircuit: true };
  if (specifier === "@dsh-base/session-wire") return { url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { SessionHostObject } = await import("../src/do.ts");
const { handleSessionHostRequest } = await import("../src/worker-http.ts");
const { registerSessionRemoteEndpoints } = await import("../src/remote.ts");
const { registerUploadRemoteEndpoints } = await import("../src/remote-uploads.ts");
const { readUploadedFile, uploadedFileContext } = await import("../../../cloudflare-think/dsh-base-cloudflare-think-core/src/uploaded-files.ts");
const { buildSessionHistory } = await import("../../../boot/dsh-base-session-wire/src/index.ts");
const { MAX_UPLOAD_BYTES, UPLOAD_TTL_MS, base64Bytes } = await import("../src/uploads.ts");
const db = new DatabaseSync(":memory:");
let failPrompt = false, failPut = false, failForkReceipt = false, failDelete = false, failReceiptDelete = false;
let onDelete: (() => Promise<void>) | undefined;
const objects = new Map<string, Uint8Array>();
const bucket = {
  async put(key: string, value: Uint8Array) { if (key.includes("/attachments/")) assert.ok(db.prepare("SELECT object_key FROM dsh_session_host_upload_gc WHERE object_key = ?").get(key), "durable GC intent precedes every attachment R2 write"); if (failPut) throw new Error("injected R2 outage"); objects.set(key, value.slice()); },
  async get(key: string) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) } : null; },
  async delete(key: string) { if (failDelete) throw new Error("injected R2 deletion failure"); if (onDelete) { const hook = onDelete; onDelete = undefined; await hook(); } objects.delete(key); },
};
const state = { id: { name: "owner:alice:default-v49" }, storage: {
  sql: { exec(query: string, ...bindings: unknown[]) {
    if (failReceiptDelete && query.startsWith("DELETE FROM dsh_session_host_uploads WHERE receipt_id")) { failReceiptDelete = false; throw new Error("injected receipt deletion failure"); }
    if (failForkReceipt && query.startsWith("INSERT INTO dsh_session_host_uploads")) { failForkReceipt = false; throw new Error("injected fork receipt failure"); }
    if (failPrompt && query.startsWith("INSERT INTO dsh_session_host_submissions")) { failPrompt = false; throw new Error("injected prompt transaction failure"); }
    const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } },
  transactionSync<T>(operation: () => T): T { db.exec("BEGIN"); try { const value = operation(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } },
  async setAlarm() {},
} };
let owner = new SessionHostObject(state, { FILES: bucket, DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
const hostCall = async (method: string, params: Record<string, unknown> = {}) => {
  const response = await owner.fetch(new Request("https://host/api/session-host", { method: "POST", body: JSON.stringify({ method, params }) }));
  return await response.json() as { result?: any; error?: any };
};
const stub = { async fetch(request: Request) {
  if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
  return owner.fetch(request);
} };
const seenOwners: string[] = [];
const env = { SESSION_HOST: { idFromName: (name: string) => { seenOwners.push(name); return name; }, get: () => stub } };
const invocation = { request: new Request("https://host/api/fileUploads/upload"), env, user: { id: "alice" } };
const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<any>>();
const rpc = { register(method: string, handler: any) { handlers.set(method, handler); return () => handlers.delete(method); } };
registerSessionRemoteEndpoints(rpc as never); registerUploadRemoteEndpoints(rpc as never);
const call = (method: string, args: Record<string, unknown>) => handlers.get(method)!({ args }, invocation);
const raw = async (sessionId: string, data: Uint8Array | string, suffix = "", signal?: AbortSignal) => {
  const response = await handleSessionHostRequest(new Request(`https://host/api/session-host/upload-file?sessionId=${sessionId}&name=notes.txt${suffix}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: data, signal }), env, "alice");
  assert.ok(response); return { response, body: await response.json() as any };
};
await hostCall("create", { sessionId: "s" }); await hostCall("create", { sessionId: "other" });
assert.deepEqual(await hostCall("updateQueue", { sessionId: "other", itemId: "unused", action: "clear" }), { result: null });
const uploaded = (await raw("s", "test document 内容\n" )).body;
assert.equal(uploaded.ok, true); assert.match(uploaded.value.file.attachmentId, /^sha256:[a-f0-9]{64}$/); assert.equal(uploaded.value.file.bytes, new TextEncoder().encode("test document 内容\n").length);
assert.ok(seenOwners.every(name => name === "owner:alice:default-v49"));
const receiptId = uploaded.value.receiptId;
assert.equal((await hostCall("uploadedFileRead", { sessionId: "s", receiptId })).error.details.reason, "FILE_NOT_ADMITTED");
await assert.rejects(call("session/prompt", { request: { sessionId: "other", requestId: "foreign", content: [{ type: "file", receiptId }] } }), (error: any) => error.details.reason === "FILE_NOT_STAGED");
failPrompt = true;
await assert.rejects(call("session/prompt", { request: { sessionId: "s", requestId: "r1", content: [{ type: "file", receiptId }] } }));
assert.equal(db.prepare("SELECT request_id FROM dsh_session_host_uploads WHERE receipt_id = ?").get(receiptId)?.request_id, null, "failed prompt must roll back receipt binding");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_messages WHERE session_id = 's'").get()?.n, 0);
const request = { sessionId: "s", requestId: "r1", content: [{ type: "file", receiptId }] };
const accepted = await call("session/prompt", { request });
assert.equal(accepted.accepted, true);
assert.deepEqual(await call("session/prompt", { request }), accepted, "lost-response replay returns the same submission");
await assert.rejects(call("session/prompt", { request: { ...request, requestId: "r2" } }), (error: any) => error.details.reason === "FILE_NOT_STAGED");
owner = new SessionHostObject(state, { FILES: bucket, DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
const read = await readUploadedFile(stub, "s", receiptId);
assert.equal(read.content, "test document 内容\n");
await assert.rejects(readUploadedFile(stub, "other", receiptId));
assert.match(await uploadedFileContext([{ receiptId, file: uploaded.value.file }], id => readUploadedFile(stub, "s", id)), /test document 内容/);
await assert.rejects(uploadedFileContext([{ receiptId, file: { ...uploaded.value.file, bytes: 999 } }], id => readUploadedFile(stub, "s", id)), /does not match/);
let claimFiles: unknown;
(globalThis as any).__uploadAgent = {
  async ensureHistory() {}, async setUserCredential() {}, async setModel() {},
  async admitInput(input: any) { claimFiles = input.uploadedFiles; return { submissionId: input.requestId, status: "completed" }; },
  async waitForSubmission() { return { status: "completed" }; },
  async getMessages() { return [{ id: "r1", role: "user", parts: [{ type: "text", text: "expanded private execution context" }] }, { id: "a1", role: "assistant", parts: [{ type: "text", text: "done" }] }]; },
  async takeTurnStats() { return { turns: 0, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }; },
};
const claimed = await hostCall("claim", { sessionId: "s", submissionId: accepted.submissionId });
assert.equal(claimed.error, undefined, JSON.stringify(claimed));
assert.deepEqual(claimFiles, [{ receiptId, file: uploaded.value.file }]);
const history = (await hostCall("history", { sessionId: "s" })).result;
const wire = buildSessionHistory(history.messages ?? history.records ?? history);
assert.ok(JSON.stringify(wire).includes(uploaded.value.file.attachmentId), "file survives Think settlement and official history projection");
assert.ok(!JSON.stringify(wire).includes("expanded private execution context"));
failForkReceipt = true;
assert.ok((await hostCall("fork", { sessionId: "s", sessionIdNew: "fork-retry" })).error);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_sessions WHERE session_id = 'fork-retry'").get()?.n, 0, "failed file fork leaves no half-created Session");
assert.ok((await hostCall("fork", { sessionId: "s", sessionIdNew: "fork-retry" })).result);
assert.ok((await hostCall("fork", { sessionId: "s", sessionIdNew: "fork-retry" })).error, "fork never overwrites an existing Session");
const forkReceipt = String(db.prepare("SELECT receipt_id FROM dsh_session_host_uploads WHERE session_id = 'fork-retry'").get()?.receipt_id);
assert.notEqual(forkReceipt, receiptId);
assert.equal((await readUploadedFile(stub, "fork-retry", forkReceipt)).content, "test document 内容\n");
await assert.rejects(readUploadedFile(stub, "fork-retry", receiptId));
let seeded: unknown;
(globalThis as any).__uploadAgent.ensureHistory = async (messages: unknown) => { seeded = messages; };
const forkPrompt = (await hostCall("prompt", { sessionId: "fork-retry", requestId: "fork-next", text: "read the earlier file" })).result;
await hostCall("claim", { sessionId: "fork-retry", submissionId: forkPrompt.submissionId });
assert.match(JSON.stringify(seeded), new RegExp(forkReceipt));
assert.ok(!JSON.stringify(seeded).includes('"type":"file"'), "execution seeds translate display file references into readable context");
const encoded = await call("fileUploads/upload", { sessionId: "s", request: { data: btoa("rpc upload"), name: "../CON.txt" } });
assert.equal(encoded.file.name, "_CON.txt");
const race = await Promise.allSettled(["race-a", "race-b"].map(requestId => call("session/prompt", { request: { sessionId: "s", requestId, content: [{ type: "file", receiptId: encoded.receiptId }] } })));
assert.equal(race.filter(value => value.status === "fulfilled").length, 1);
assert.equal((await raw("s", "fake image", "&mediaType=image/png")).body.error.details.reason, "IMAGE_PROCESSOR_UNAVAILABLE");
assert.equal((await hostCall("uploadAttachment", { sessionId: "s", name: "image.png", mediaType: "image/png", dataBase64: btoa("fake") })).error.details.reason, "IMAGE_PROCESSOR_UNAVAILABLE");
await assert.rejects(call("session/prompt", { request: { sessionId: "s", requestId: "inline-image", content: [{ type: "image", data: btoa("fake"), mediaType: "image/png" }] } }), (error: any) => error.details.reason === "IMAGE_PROCESSOR_UNAVAILABLE");
assert.equal((await call("session/projections", { request: { sessionId: "s" } })).values.imageLimits.maxImagesPerMessage, 0);
const beforeFailure = db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_uploads").get()?.n;
failPut = true; assert.equal((await raw("s", "lost")).body.ok, false); failPut = false;
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_uploads").get()?.n, beforeFailure);
const cancelled = new AbortController(); cancelled.abort();
assert.equal((await raw("s", "cancelled", "", cancelled.signal)).body.ok, false);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_uploads").get()?.n, beforeFailure);
assert.equal((await raw("s", new Uint8Array(MAX_UPLOAD_BYTES + 1))).body.error.details.reason, "FILE_TOO_LARGE");
assert.throws(() => base64Bytes("Zh=="), /canonical base64/);
const objectKey = String(db.prepare("SELECT object_key FROM dsh_session_host_uploads WHERE receipt_id = ?").get(receiptId)?.object_key);
objects.set(objectKey, new TextEncoder().encode("corrupt"));
await assert.rejects(readUploadedFile(stub, "s", receiptId), /integrity/);
console.log("session-host: official upload/RPC, R2 faults, receipt scope/rollback/race/replay/restart, Think file reads, history and disabled images passed");

// Abandoned uploads expire independently of browser state and never touch admitted history.
const cleanup = async (olderThanMs = 0) => {
  const response = await hostCall("maintenanceRun", { kind: "cleanupFiles", olderThanMs });
  assert.equal(response.result.run.status, "ok", JSON.stringify(response));
  return response.result.run.detail.attachments;
};
const receiptRow = (id: string) => db.prepare("SELECT * FROM dsh_session_host_uploads WHERE receipt_id = ?").get(id);
const expire = (id: string) => db.prepare("UPDATE dsh_session_host_uploads SET created_at = ? WHERE receipt_id = ?").run(Date.now() - UPLOAD_TTL_MS - 1000, id);
const fresh = (await raw("s", "fresh retained file")).body.value;
await cleanup(0);
assert.ok(receiptRow(fresh.receiptId), "manual cleanup cannot lower the safe 24-hour TTL");
const stale = (await raw("s", "expired retry file")).body.value;
const staleKey = String(receiptRow(stale.receiptId)?.object_key);
expire(stale.receiptId);
failDelete = true;
const failedCleanup = await cleanup();
assert.equal(failedCleanup.failed, 1);
assert.ok(receiptRow(stale.receiptId), "failed R2 deletion keeps its metadata");
assert.ok(objects.has(staleKey));
await assert.rejects(call("session/prompt", { request: { sessionId: "s", requestId: "expired", content: [{ type: "file", receiptId: stale.receiptId }] } }), (error: any) => error.details.reason === "FILE_NOT_STAGED");
failDelete = false;
owner = new SessionHostObject(state, { FILES: bucket, DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
let concurrentUpload: any;
onDelete = async () => {
  await assert.rejects(call("session/prompt", { request: { sessionId: "s", requestId: "expiry-race", content: [{ type: "file", receiptId: stale.receiptId }] } }));
  concurrentUpload = (await raw("s", "expired retry file")).body.value;
};
await cleanup();
assert.equal(receiptRow(stale.receiptId), undefined);
assert.equal(objects.has(staleKey), false);
assert.ok(objects.has(String(receiptRow(concurrentUpload.receiptId)?.object_key)), "equal-byte concurrent re-upload uses its own object");
assert.ok(receiptRow(receiptId)); assert.ok(receiptRow(forkReceipt));
// A legacy shared object key stays alive while either admitted/fork reference exists.
const sharedId = crypto.randomUUID();
db.prepare("INSERT INTO dsh_session_host_uploads (receipt_id, session_id, attachment_id, name, bytes, object_key, request_id, created_at) SELECT ?, session_id, attachment_id, name, bytes, object_key, NULL, ? FROM dsh_session_host_uploads WHERE receipt_id = ?").run(sharedId, Date.now() - UPLOAD_TTL_MS - 1000, forkReceipt);
const sharedKey = String(receiptRow(sharedId)?.object_key);
await cleanup();
assert.equal(receiptRow(sharedId), undefined); assert.ok(objects.has(sharedKey)); assert.ok(receiptRow(forkReceipt));
// The durable intent exists before the write, and covers R2-success/SQL-failure.
const beforeOrphan = objects.size;
failForkReceipt = true;
assert.equal((await raw("s", "sql failed immediate cleanup")).body.ok, false);
assert.equal(objects.size, beforeOrphan, "SQL admission failure attempts immediate object cleanup");
failDelete = true; failForkReceipt = true;
assert.equal((await raw("s", "sql failed retained intent")).body.ok, false);
failDelete = false;
const pendingIntent = db.prepare("SELECT * FROM dsh_session_host_upload_gc").get();
assert.ok(pendingIntent); assert.ok(objects.has(String(pendingIntent.object_key)));
db.prepare("UPDATE dsh_session_host_upload_gc SET created_at = ?").run(Date.now() - UPLOAD_TTL_MS - 1000);
owner = new SessionHostObject(state, { FILES: bucket, DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" });
await cleanup();
assert.equal(objects.has(String(pendingIntent.object_key)), false);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dsh_session_host_upload_gc").get()?.n, 0);
// A crash between deleting bytes and removing SQL metadata is also replay-safe.
const sqlRetry = (await raw("s", "metadata retry")).body.value; expire(sqlRetry.receiptId);
failReceiptDelete = true;
assert.equal((await cleanup()).failed, 1); assert.ok(receiptRow(sqlRetry.receiptId));
assert.equal((await cleanup()).failed, 0); assert.equal(receiptRow(sqlRetry.receiptId), undefined);
for (let i = 0; i < 54; i += 1) { const staged = (await raw("s", `bounded-${i}`)).body.value; expire(staged.receiptId); }
const bounded = await cleanup();
assert.equal(bounded.examined, 50); assert.equal(bounded.deletedReceipts, 50); assert.equal(bounded.hasMore, true);
const cleanupSchedule = (await hostCall("maintenanceList")).result.schedules.find((row: any) => row.kind === "cleanupFiles");
assert.ok(cleanupSchedule.nextAt <= Date.now() + 5000, "remaining batches are scheduled promptly rather than waiting an hour");
assert.equal((await cleanup()).deletedReceipts, 4);
assert.ok(receiptRow(fresh.receiptId)); assert.ok(receiptRow(receiptId)); assert.ok(receiptRow(forkReceipt));
console.log("session-host: 24h upload expiry, bounded GC, R2/SQL failures, durable orphan intents, restart and fork/concurrent-upload preservation passed");

// Real production DO + SQLite/R2: model-action writes use current session policy;
// user editing and authenticated internal effects remain separate capabilities.
{
  const secured = new SessionHostObject(state, {FILES:bucket,AUTH_SECRET:'local-test-internal-secret'} as never);
  const request = async(method:string,params:Record<string,unknown>,internal=false) => {
    const response=await secured.fetch(new Request('https://host/api/session-host',{method:'POST',headers:internal?{'x-dsh-internal-token':'local-test-internal-secret'}:{},body:JSON.stringify({method,params})}));
    return {status:response.status,body:await response.json() as any};
  };
  await request('create',{sessionId:'policy-r2'});
  await request('selectPermission',{sessionId:'policy-r2',preset:'read-only'});
  const write={sessionId:'policy-r2',path:'permission-probe.txt',dataBase64:btoa('real protected bytes')};
  const before=objects.size;
  assert.equal((await request('workspaceFileWriteFromAgent',write)).status,403);
  assert.equal(objects.size,before);
  assert.equal((await request('recordModelRequest',{sessionId:'policy-r2',requestId:'forged',sdkRequestId:'forged',model:'deepseek-flash'})).status,403);
  assert.equal((await request('recordStepStart',{sessionId:'policy-r2',requestId:'forged',sdkRequestId:'forged',stepId:'forged:0',startedAt:1})).status,403);
  assert.equal((await request('workspaceFileWriteFromAgent',write,true)).body.error.code,'permission/denied');
  assert.equal(objects.size,before);
  assert.ok((await request('workspaceFileWrite',write)).body.result,'user file editing is not an agent sandbox action');
  await request('selectPermission',{sessionId:'policy-r2',preset:'workspace-write'});
  assert.ok((await request('workspaceFileWriteFromAgent',{...write,dataBase64:btoa('allowed model bytes')},true)).body.result);
  assert.equal((await request('workspaceFileRead',{sessionId:'policy-r2',path:write.path})).body.result.text,'allowed model bytes');
  await request('selectPermission',{sessionId:'policy-r2',preset:'read-only'});
  assert.equal((await request('workspaceFileWriteFromAgent',write,true)).body.error.code,'permission/denied','effects reread policy instead of a cached admission grant');
}
console.log('session-host: actual R2 model-effect gate, user edits, current session policy and internal evidence forgery rejection passed');
