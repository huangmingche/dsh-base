#!/usr/bin/env node
/** Deployed official upload → receipt → prompt → Think read → durable history acceptance.
 * Makes one idempotent model submission. Importing configuration never selects a target.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { remoteAcceptanceConfig, registrationHeaders, mayRegisterAcceptance, waitForHostReadiness } from "./acceptance-config.mjs";

if (process.argv.includes("--help")) {
  console.log("DSH_ACCEPTANCE_CONFIG=/private/isolated-account.json node apps/web/scripts/acceptance-file-upload.mjs\nUses an explicit HTTPS target and private acceptance credentials. Makes one real model submission and writes a redacted .artifacts/acceptance/file-upload-*.json report. Optional DSH_ACCEPTANCE_REGISTER=true uses AUTH_REGISTRATION_TOKEN for operator-only signup.");
  process.exit(0);
}

const { base, credentials } = remoteAcceptanceConfig();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const sessionId = `accept-file-${suffix}`;
const otherSessionId = `accept-file-scope-${suffix}`;
const requestId = `file-proof-${randomUUID()}`;
const proof = `DSH_FILE_${randomBytes(20).toString("hex")}`;
const prefix = Buffer.from("This acceptance file contains padding. Its final PROOF_TOKEN line starts at byte 70000. Read that offset when the preview is truncated.\n");
const bytes = Buffer.concat([prefix, Buffer.alloc(70000 - prefix.byteLength, 32), Buffer.from(`\nPROOF_TOKEN=${proof}\n`)]);
const expectedHash = createHash("sha256").update(bytes).digest("hex");
const artifact = resolve(root, ".artifacts/acceptance", `file-upload-${suffix}.json`);
const evidence = { kind: "deployed-file-upload", base, startedAt: new Date().toISOString(), status: "running", phase: "initialize", sessionId, otherSessionId, requestId, file: { name: "proof.txt", bytes: bytes.byteLength, attachmentId: `sha256:${expectedHash}` }, checks: [], requests: [] };
mkdirSync(dirname(artifact), { recursive: true, mode: 0o700 });
let cookie = "";
let created = false;
const secrets = [credentials.username, credentials.email, credentials.password, process.env.AUTH_REGISTRATION_TOKEN].filter(value => typeof value === "string" && value !== "");
const redact = value => {
  let text = JSON.stringify(value, null, 2);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text;
};
const save = () => writeFileSync(artifact, `${redact(evidence)}\n`, { mode: 0o600 });
const phase = name => { evidence.phase = name; save(); };
const passed = (name, detail = {}) => { evidence.checks.push({ name, ...detail }); save(); };
const headers = (contentType = "application/json") => ({ "content-type": contentType, origin: base, ...(cookie ? { cookie } : {}) });

async function jsonRequest(path, init, label, timeoutMs = 30_000) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body;
  try { body = await response.json(); } catch { throw new Error(`${label}: HTTP ${response.status} returned non-JSON data`); }
  const failure = body?.result?.ok === false ? body.result.error : body?.error;
  evidence.requests.push({ label, path: path.split("?", 1)[0], status: response.status, ms: Date.now() - started, ...(failure && typeof failure === "object" ? { code: failure.code, reason: failure.details?.reason } : {}) });
  save();
  return { response, body };
}

async function authenticate() {
  const signIn = () => fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: headers(), body: JSON.stringify({ username: credentials.username, password: credentials.password }), signal: AbortSignal.timeout(30_000) });
  let response = await signIn();
  if (!response.ok && mayRegisterAcceptance()) {
    assert.ok(typeof credentials.email === "string", "operator registration requires a private acceptance email");
    assert.ok(process.env.AUTH_REGISTRATION_TOKEN?.length >= 32, "operator registration requires AUTH_REGISTRATION_TOKEN");
    response = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { ...headers(), ...registrationHeaders() }, body: JSON.stringify({ ...credentials, name: "File upload acceptance" }), signal: AbortSignal.timeout(30_000) });
  }
  // Never capture authentication response bodies or headers in the evidence file.
  assert.equal(response.ok, true, `acceptance authentication failed: HTTP ${response.status}`);
  const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const match = setCookies.join("; ").match(/(?:^|[,;]\s*)(__Secure-better-auth\.session_token(?:\.[^=;\s]+)?|better-auth\.session_token(?:\.[^=;\s]+)?)=([^;]+)/u);
  assert.ok(match, "authentication returned no session cookie");
  cookie = `${match[1]}=${match[2]}`;
  secrets.push(cookie, match[2]);
  await response.body?.cancel();
}

async function hostResult(method, params = {}, expectError = false) {
  const { response, body } = await jsonRequest("/api/session-host", { method: "POST", headers: headers(), body: JSON.stringify({ method, params }) }, `host:${method}`);
  if (expectError) { assert.ok(body.error && typeof body.error === "object", `${method}: expected a Host failure`); return body.error; }
  assert.equal(response.ok, true, `${method}: HTTP ${response.status}`);
  assert.equal(body.error, undefined, `${method}: ${body.error?.code ?? "Host failure"}`);
  assert.ok(Object.hasOwn(body, "result"), `${method}: successful Host result is missing`);
  return body.result;
}

async function rpc(method, args, expectError = false) {
  const rpcId = randomUUID();
  const { response, body } = await jsonRequest(`/api/${method}`, { method: "POST", headers: headers(), body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }) }, `rpc:${method}`);
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body.rpcId, rpcId, `${method}: reply identity mismatch`);
  assert.equal(body.result?.ok, !expectError, `${method}: unexpected Remote result`);
  if (expectError) { assert.ok(body.result.error); return body.result.error; }
  assert.ok(Object.hasOwn(body.result, "value"), `${method}: successful Remote value is missing`);
  return body.result.value;
}

const userFiles = page => (page?.records ?? []).flatMap(record => record.event?.type === "user/message" ? (record.event.data?.content ?? []).filter(part => part.type === "file").map(part => part.attachment) : []);
async function verifyBytes(receiptId) {
  const chunks = [];
  let offset = 0;
  for (let index = 0; index < 3; index += 1) {
    const page = await hostResult("uploadedFileRead", { sessionId, receiptId, offset, limit: 65536 });
    assert.equal(page.offset, offset);
    assert.equal(page.attachment.attachmentId, `sha256:${expectedHash}`);
    assert.ok(page.encoding === "utf-8" || page.encoding === "base64");
    chunks.push(Buffer.from(page.content, page.encoding === "utf-8" ? "utf8" : "base64"));
    if (page.nextOffset === undefined) break;
    assert.ok(page.nextOffset > offset && page.nextOffset <= bytes.byteLength, "invalid attachment continuation offset");
    offset = page.nextOffset;
  }
  const actual = Buffer.concat(chunks);
  assert.deepEqual(actual, bytes, "read-back bytes differ from the uploaded file");
  assert.equal(createHash("sha256").update(actual).digest("hex"), expectedHash);
}

try {
  phase("authenticate"); await authenticate();
  passed("private acceptance account authenticated");
  phase("create_sessions");
  // Canonical fixed composition from @dsh-base/agent-presets. Official ids are
  // real identities and are rejected, never silently aliased.
  assert.equal((await rpc("session/create", { request: { sessionId, title: "File upload acceptance", agentPreset: "dsh-base-think" } })).sessionId, sessionId); created = true;
  const rejectedPreset = await rpc("session/create", { request: { sessionId: `rejected-${randomUUID()}`, agentPreset: "standard" } }, true);
  assert.equal(rejectedPreset.code, "gateway/endpoint-unavailable");
  assert.equal((await rpc("session/create", { request: { sessionId: otherSessionId, title: "Receipt scope rejection" } })).sessionId, otherSessionId);
  phase("host_readiness");
  await waitForHostReadiness(async (method, params) => {
    const { response, body } = await jsonRequest("/api/session-host", { method: "POST", headers: headers(), body: JSON.stringify({ method, params }) }, `readiness:${method}`);
    return { status: response.status, body };
  }, sessionId);
  const selection = await rpc("session/selectModel", { request: { sessionId, provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "off" } });
  assert.deepEqual(selection.selected, { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "off" });
  await hostResult("selectPermission", { sessionId, preset: "read-only" });
  assert.deepEqual(await hostResult("permissionSnapshot", { sessionId }), { currentValue: "read-only", sandbox: "read-only", approval: "ask" });
  evidence.requestedModel = selection.selected;
  passed("explicit canonical model, effort and per-session read-only policy configured without changing owner defaults");
  phase("raw_upload");
  const uploaded = await jsonRequest(`/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=proof.txt`, { method: "POST", headers: headers("application/octet-stream"), body: bytes }, "raw:file-upload");
  assert.equal(uploaded.response.status, 200); assert.equal(uploaded.body.ok, true);
  const { receiptId, file } = uploaded.body.value;
  assert.equal(typeof receiptId, "string"); assert.ok(receiptId.length > 0);
  assert.deepEqual(file, evidence.file);
  evidence.receiptId = receiptId;
  passed("raw bytes persisted with SHA-256 file reference");
  phase("receipt_scope");
  assert.equal((await hostResult("uploadedFileRead", { sessionId, receiptId }, true)).details?.reason, "FILE_NOT_ADMITTED");
  const denied = await rpc("session/prompt", { request: { sessionId: otherSessionId, requestId: `foreign-${randomUUID()}`, content: [{ type: "text", text: "Do not run: foreign receipt." }, { type: "file", receiptId }] } }, true);
  assert.equal(denied.code, "session/attachment-invalid"); assert.equal(denied.details?.reason, "FILE_NOT_STAGED");
  assert.equal((await hostResult("history", { sessionId: otherSessionId })).records.length, 0);
  passed("unadmitted read and cross-Session receipt rejected without a turn");
  phase("official_prompt");
  const request = { sessionId, requestId, mode: "queue", content: [{ type: "text", text: "Read the attached proof.txt. Its PROOF_TOKEN is beyond the preview, starting at byte 70000. Use read_uploaded_file at offset 70000 to read it, then reply only with the exact PROOF_TOKEN value. Do not guess." }, { type: "file", receiptId }] };
  const accepted = await rpc("session/prompt", { request });
  assert.equal(accepted.accepted, true); assert.equal(typeof accepted.submissionId, "string");
  const replay = await rpc("session/prompt", { request });
  assert.equal(replay.submissionId, accepted.submissionId);
  evidence.submissionId = accepted.submissionId;
  passed("official file+text prompt admitted and requestId replay reused one submission");
  phase("claim_and_model_read");
  // Claim's documented response is the passive state, unlike unary {result} methods.
  const claimed = await jsonRequest("/api/session-host/claim", { method: "POST", headers: headers(), body: JSON.stringify({ sessionId, submissionId: accepted.submissionId }) }, "host:claim", 180_000);
  assert.equal(claimed.response.ok, true, `claim HTTP ${claimed.response.status}`); assert.equal(claimed.body.error, undefined);
  const deadline = Date.now() + 120_000;
  let history;
  while (Date.now() < deadline) {
    history = await hostResult("history", { sessionId });
    const state = await hostResult("state", { sessionId });
    if (!state.running && history.records.some(record => record.role === "assistant")) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const assistant = (history?.records ?? []).filter(record => record.role === "assistant").flatMap(record => (record.parts ?? []).filter(part => part.type === "text").map(part => part.text)).join("\n");
  assert.ok(assistant.includes(proof), "model did not return the unpredictable token located beyond the initial file preview");
  const readCalls = history.records.filter(record => record.role === "assistant").flatMap(record => record.parts ?? []).filter(part => typeof part.toolCallId === "string" && (part.toolName === "read_uploaded_file" || part.type === "tool-read_uploaded_file"));
  assert.ok(readCalls.length > 0, "durable history contains no uploaded-file read tool call");
  const users = history.records.filter(record => record.role === "user");
  assert.equal(users.length, 1, "requestId replay caused duplicate admitted prompts");
  assert.ok(users[0].parts.some(part => part.type === "file" && part.attachment?.attachmentId === file.attachmentId));
  assert.ok(!JSON.stringify(users[0]).includes(proof), "display history leaked the model's expanded file context");
  const state = await hostResult("state", { sessionId }); assert.equal(state.running, false);
  const projections = await hostResult("projections", { sessionId });
  assert.ok(projections.usage?.inputTokens > 0, "completed model turn recorded no usage");
  assert.deepEqual(projections.modelSelection.lastUsed, evidence.requestedModel);
  assert.deepEqual(projections.permissions, { currentValue: "read-only" });
  const responseModels = history.records.filter(record => record.role === "assistant").map(record => record.parts.find(part => part.type === "data-dsh-model-source")?.data);
  assert.ok(responseModels.length > 0 && responseModels.every(source => source && typeof source.model === "string"), "durable model steps lost response provenance");
  for (const source of responseModels) {
    assert.equal(source.requestedModel, "deepseek-flash");
    assert.equal(source.reasoningEffort, "off");
  }
  evidence.model = { requested: evidence.requestedModel, responses: responseModels.map(source => ({ provider: source.provider, responseModel: source.model, requestedModel: source.requestedModel, reasoningEffort: source.reasoningEffort })), output: assistant.slice(-1000), usage: projections.usage, readToolRecorded: true, readToolCalls: readCalls.length };
  passed("real model read beyond the 64 KiB preview and returned the random token");
  phase("reload_and_bytes");
  const pageRequest = { request: { address: { kind: "session", sessionId }, maxMessages: 100 } };
  const firstPage = await rpc("session/page", pageRequest);
  assert.ok(userFiles(firstPage).some(value => value.attachmentId === file.attachmentId));
  await authenticate(); // A fresh authenticated HTTP client reloads durable data; no browser/DO eviction is claimed.
  const reloadedPage = await rpc("session/page", pageRequest);
  assert.deepEqual(userFiles(reloadedPage), userFiles(firstPage));
  assert.deepEqual(await hostResult("permissionSnapshot", { sessionId }), { currentValue: "read-only", sandbox: "read-only", approval: "ask" });
  assert.deepEqual((await hostResult("projections", { sessionId })).modelSelection.lastUsed, evidence.requestedModel);
  await verifyBytes(receiptId);
  assert.equal((await hostResult("uploadedFileRead", { sessionId: otherSessionId, receiptId }, true)).details?.reason, "FILE_NOT_STAGED");
  passed("fresh-auth official page reload retained file refs and paged read-back matched every byte");
  phase("images_unavailable");
  assert.equal(projections.imageLimits?.maxImagesPerMessage, 0);
  assert.ok(projections.imageLimits.mediaTypes.includes("image/png"));
  const image = await jsonRequest(`/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=probe.png&mediaType=image/png`, { method: "POST", headers: headers("application/octet-stream"), body: Buffer.from([137, 80, 78, 71]) }, "raw:image-unavailable");
  assert.equal(image.response.status, 200); assert.equal(image.body.ok, false); assert.equal(image.body.error.details?.reason, "IMAGE_PROCESSOR_UNAVAILABLE");
  passed("official image limits and server rejection agree");
  evidence.status = "passed"; evidence.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ ok: true, sessionId, modelSubmissions: 1, checks: evidence.checks.length, artifact }, null, 2));
} catch (error) {
  evidence.status = "failed"; evidence.finishedAt = new Date().toISOString();
  evidence.error = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
  // Preserve the dedicated Session's state after failure; never dump auth bodies or credentials.
  if (created && cookie) {
    try { evidence.failureState = await hostResult("state", { sessionId }); } catch { /* Original evidence remains sufficient. */ }
    try { evidence.failureHistory = await hostResult("history", { sessionId }); } catch { /* No secondary error replaces the primary failure. */ }
  }
  save();
  console.error(JSON.stringify({ ok: false, phase: evidence.phase, artifact }));
  process.exitCode = 1;
}
