#!/usr/bin/env node
/**
 * Acceptance for the deployed Workers-native Session Host HTTP/DO API.
 *
 * Requires the deployed account gate: signs in (or registers) the acceptance
 * account and forwards its Better Auth session cookie, because `/api/session-host`
 * is protected by the Worker auth plugin.
 *
 * Usage: SESSION_HOST_URL=https://... node scripts/acceptance-session-host.mjs
 */
import { remoteAcceptanceConfig, registrationHeaders, mayRegisterAcceptance, waitForHostReadiness } from "./acceptance-config.mjs";
import assert from "node:assert/strict";

const { base, credentials } = remoteAcceptanceConfig();
const endpoint = `${base}/api/session-host`;
const suffix = Date.now().toString(36);
const sourceId = `accept-${suffix}`;
const forkId = `accept-fork-${suffix}`;
const cookieName = "__Secure-better-auth.session_token";

/** Extract the Better Auth session cookie from an auth response. */
function sessionCookieOf(response) {
  const raw = ((response.headers.getSetCookie?.() ?? []).join("; ")) || (response.headers.get("set-cookie") ?? "");
  return raw.match(new RegExp(`${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^=]*=([^;]+)`, "u"))?.[1];
}

/** Sign in, falling back to registering the acceptance account. */
async function authenticate() {
  const signIn = () => fetch(`${base}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  const signUp = () => fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, ...registrationHeaders() },
    body: JSON.stringify({
      username: credentials.username,
      name: credentials.username,
      email: credentials.email,
      password: credentials.password,
    }),
  });
  let response = await signIn();
  if (!response.ok && mayRegisterAcceptance()) response = await signUp();
  assert.ok(response.ok, `account authentication failed: HTTP ${response.status}`);
  const token = sessionCookieOf(response);
  assert.ok(token !== undefined, "authentication returned no session cookie");
  return token;
}

const token = await authenticate();
const authHeaders = () => ({ "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` });

async function call(method, params = {}, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ method, params }),
    signal,
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function stream(path, signal) {
  const response = await fetch(`${endpoint}${path}`, {
    headers: { accept: "text/event-stream", origin: base, cookie: `${cookieName}=${token}` },
    signal,
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  return response;
}

let previousOwnerSettings;
let cleanupCredential = false;
let officialSequence = 0;
const modelEvidence = [];
const failureEvidence = [];
async function hostResult(method, params = {}) {
  const response = await call(method, params);
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(response.body.error, undefined, `${method}: unexpected Host failure`);
  assert.ok(Object.hasOwn(response.body, "result"), `${method}: missing result`);
  return response.body.result;
}
try {
const created = await call("create", { sessionId: sourceId, title: "Acceptance" });
assert.equal(created.status, 200);
assert.deepEqual(created.body.result, { sessionId: sourceId });
await waitForHostReadiness(call, sourceId);
previousOwnerSettings = structuredClone((await hostResult("settingsDescribe")).values);
await hostResult("settingsMutate", { ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }] });
await hostResult("selectPermission", { sessionId: sourceId, preset: "workspace-write" });
assert.deepEqual(await hostResult("permissionSnapshot", { sessionId: sourceId }), { currentValue: "workspace-write", sandbox: "workspace-write", approval: "ask" });

const listed = await call("list");
assert.equal(listed.status, 200);
assert.ok(listed.body.result.sessions.some((session) => session.sessionId === sourceId));

// Session and Workspace ids are first-class: generated ids are UUIDs, list rows
// carry both identities, and a Workspace-scoped Session reports its workspace.
const idSession = await call("create", { title: "ID acceptance" });
assert.equal(idSession.status, 200);
const generatedSessionId = idSession.body.result.sessionId;
assert.match(generatedSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const idList = await call("list");
const idRow = idList.body.result.sessions.find((session) => session.sessionId === generatedSessionId);
assert.ok(idRow !== undefined, "generated Session missing from list");
assert.equal(typeof idRow.workspaceId, "string");
assert.equal(typeof idRow.cwd, "string");
const workspaceState = await call("workspaceState");
assert.equal(workspaceState.status, 200);
assert.ok(workspaceState.body.result.items.every((workspace) => typeof workspace.workspaceId === "string"));
const workspace = await call("workspaceCreate", { path: `/acceptance-${suffix}`, title: "ID workspace" });
assert.equal(workspace.status, 200);
assert.match(workspace.body.result.workspace.workspaceId, /^ws_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const scoped = await call("create", { title: "Workspace-scoped acceptance", workspaceId: workspace.body.result.workspace.workspaceId });
assert.equal(scoped.status, 200);
const scopedRow = (await call("list")).body.result.sessions.find((session) => session.sessionId === scoped.body.result.sessionId);
assert.equal(scopedRow.workspaceId, workspace.body.result.workspace.workspaceId);

const state = await call("state", { sessionId: sourceId });
assert.equal(state.body.result.title, "Acceptance");

const model = "deepseek-flash";
const selected = await call("selectModel", { sessionId: sourceId, model, reasoningEffort: "off" });
assert.equal(selected.status, 200);
assert.deepEqual(selected.body.result, { model, reasoningEffort: "off" });

const attachment = await call("uploadAttachment", {
  sessionId: sourceId,
  name: "fact.txt",
  mediaType: "text/plain",
  dataBase64: Buffer.from("The secret code is BANANA-42.").toString("base64"),
});
assert.equal(attachment.status, 200);
assert.ok(attachment.body.result.attachmentId.startsWith("att_"));

const prompted = await call("prompt", {
  sessionId: sourceId,
  text: "What is the secret code? Reply with only the code.",
  attachments: [{ attachmentId: attachment.body.result.attachmentId }],
});
assert.equal(prompted.status, 200);
assert.equal(typeof prompted.body.result.submissionId, "string");
const promptedPage = await call("page", { address: { kind: "session", sessionId: sourceId }, limit: 10 });
assert.equal(promptedPage.body.result.records.length, 1);
assert.equal(promptedPage.body.result.records[0].role, "user");
assert.equal((await call("state", { sessionId: sourceId })).body.result.running, true);

const claimed = await call("claim", { sessionId: sourceId, submissionId: prompted.body.result.submissionId });
assert.equal(claimed.status, 200);
// The Durable Object alarm may claim the queued submission first; the client
// claim is then an idempotent observation. Wait for the turn to settle either way.
let settled = false;
const settleDeadline = Date.now() + 90_000;
while (Date.now() < settleDeadline) {
  const state = (await call("state", { sessionId: sourceId })).body.result;
  const page = await call("page", { address: { kind: "session", sessionId: sourceId }, limit: 20 });
  if (state.running === false && (page.body.result.records ?? []).some((record) => record.role === "assistant")) {
    settled = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(settled, "claimed turn never settled");
assert.equal((await call("state", { sessionId: sourceId })).body.result.model, model);

const claimedPage = await call("page", { address: { kind: "session", sessionId: sourceId }, limit: 20 });
assert.equal(claimedPage.body.result.records.length, 2);
assert.equal(claimedPage.body.result.records[0].role, "user");
assert.equal(claimedPage.body.result.records[1].role, "assistant");
const assistantText = claimedPage.body.result.records[1].parts
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("");
assert.ok(assistantText.length > 0);
assert.match(assistantText, /BANANA-42/);

const projections = await call("projections", { sessionId: sourceId });
assert.ok((projections.body.result.usage?.inputTokens ?? 0) > 0, "usage projection was not recorded");
assert.ok(projections.body.result.tokenUsage !== undefined, "derived tokenUsage projection is missing");
assert.deepEqual(projections.body.result.modelSelection.lastUsed, { provider: "deepseek-official", model, reasoningEffort: "off" });
for (const record of claimedPage.body.result.records.filter(record => record.role === "assistant")) {
  const provenance = record.parts.find(part => part.type === "data-dsh-model-source")?.data;
  assert.ok(provenance && typeof provenance.model === "string", "completed step has no actual response-model evidence");
  assert.equal(provenance.requestedModel, model);
  assert.equal(provenance.reasoningEffort, "off");
  modelEvidence.push({ requestedModel: provenance.requestedModel, reasoningEffort: provenance.reasoningEffort, responseModel: provenance.model });
}

const cancelled = await call("cancel", { sessionId: sourceId });
assert.equal(cancelled.status, 200);
assert.equal((await call("state", { sessionId: sourceId })).body.result.running, false);

// A rename acknowledges the same durable projection clock consumed by the
// official controller; it must not invent a chat cursor or omit the revision.
const beforeRename = await hostResult("projections", { sessionId: sourceId });
assert.ok(Number.isSafeInteger(beforeRename._dshBaseProjectionRevision) && beforeRename._dshBaseProjectionRevision >= 0);
const renamed = await hostResult("rename", { sessionId: sourceId, title: "Acceptance renamed via Host" });
assert.ok(Number.isSafeInteger(renamed.projectionRevision) && renamed.projectionRevision > beforeRename._dshBaseProjectionRevision,
  "Host rename must acknowledge an advanced durable projection revision");
const afterRawRename = await hostResult("projections", { sessionId: sourceId });
assert.deepEqual(renamed, { title: "Acceptance renamed via Host", projectionRevision: afterRawRename._dshBaseProjectionRevision });
assert.equal(afterRawRename.title, renamed.title);
assert.equal((await hostResult("state", { sessionId: sourceId })).title, renamed.title);

const officialRenamed = await officialRpc("session/rename", { request: { sessionId: sourceId, title: "Acceptance renamed" } });
assert.ok(Number.isSafeInteger(officialRenamed.seq) && officialRenamed.seq > renamed.projectionRevision,
  "official rename seq must advance the same Host projection clock");
const afterOfficialRename = await hostResult("projections", { sessionId: sourceId });
assert.deepEqual(officialRenamed, { title: "Acceptance renamed", seq: afterOfficialRename._dshBaseProjectionRevision });
assert.equal(afterOfficialRename.title, officialRenamed.title);
assert.equal((await hostResult("state", { sessionId: sourceId })).title, officialRenamed.title);

const forked = await call("fork", { sessionId: sourceId, sessionIdNew: forkId });
assert.deepEqual(forked.body.result, { sessionId: forkId });
const forkState = await call("state", { sessionId: forkId });
assert.equal(forkState.body.result.title, "Acceptance renamed (fork)");

// Alarm-driven claim: queue a prompt and never call claim from the client. The
// Durable Object alarm must run the turn so a closed composer cannot lose it.
const alarmId = `accept-alarm-${suffix}`;
await call("create", { sessionId: alarmId, title: "Alarm acceptance" });
await call("selectModel", { sessionId: alarmId, model, reasoningEffort: "off" });
const alarmPrompt = await call("prompt", { sessionId: alarmId, text: "Reply with the word ALARM." });
assert.equal(alarmPrompt.status, 200);
let alarmAssistant;
const alarmDeadline = Date.now() + 90_000;
while (Date.now() < alarmDeadline) {
  const alarmPage = await call("page", { address: { kind: "session", sessionId: alarmId }, limit: 20 });
  const records = alarmPage.body.result.records ?? [];
  alarmAssistant = records.find((record) => record.role === "assistant");
  if (alarmAssistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(alarmAssistant !== undefined, "alarm never ran the queued submission");
assert.equal((await call("state", { sessionId: alarmId })).body.result.running, false);

// Official `session/prompt` bridge: the prompt arrives through the official
// envelope and the alarm (not a custom claim) must run the turn.
const rpcId = `accept-rpc-${suffix}`;
const rpcSessionId = `accept-rpc-session-${suffix}`;
await call("create", { sessionId: rpcSessionId, title: "Official prompt acceptance" });
await call("selectModel", { sessionId: rpcSessionId, model, reasoningEffort: "off" });
const promptEnvelope = {
  type: "client-request",
  rpcId,
  method: "session/prompt",
  payload: { args: { request: {
    sessionId: rpcSessionId,
    requestId: `req-${suffix}`,
    mode: "queue",
    content: [{ type: "text", text: "Reply with the word RECEIPT." }],
  } } },
};
const officialPrompt = await fetch(`${base}/api/session/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` },
  body: JSON.stringify(promptEnvelope),
});
const officialBody = await officialPrompt.json();
assert.equal(officialPrompt.status, 200, `session/prompt HTTP ${officialPrompt.status}`);
assert.equal(officialBody.rpcId, rpcId);
assert.equal(officialBody.result.ok, true, JSON.stringify(officialBody));
assert.equal(officialBody.result.value.accepted, true);
let officialAssistant;
const officialDeadline = Date.now() + 90_000;
while (Date.now() < officialDeadline) {
  const officialPage = await call("page", { address: { kind: "session", sessionId: rpcSessionId }, limit: 20 });
  const records = officialPage.body.result.records ?? [];
  officialAssistant = records.find((record) => record.role === "assistant");
  if (officialAssistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(officialAssistant !== undefined, "official session/prompt never produced a turn");

// Official session queue: two durable prompts without a browser claim must be
// visible in `session/state.queue`, editable and removable through
// `session/updateQueue`, then run by the alarm fallback.
const queueSessionId = `accept-queue-${suffix}`;
await call("create", { sessionId: queueSessionId, title: "Queue acceptance" });
await call("selectModel", { sessionId: queueSessionId, model, reasoningEffort: "off" });
const queuePromptA = await officialRpc("session/prompt", { request: {
  sessionId: queueSessionId,
  requestId: `queue-a-${suffix}`,
  mode: "queue",
  content: [{ type: "text", text: "queue item one" }],
} });
assert.equal(queuePromptA.accepted, true);
await officialRpc("session/prompt", { request: {
  sessionId: queueSessionId,
  requestId: `queue-b-${suffix}`,
  mode: "queue",
  content: [{ type: "text", text: "queue item two" }],
} });
const queueState = await officialRpc("session/state", { request: { sessionId: queueSessionId } });
assert.ok(Array.isArray(queueState.queue) && queueState.queue.length >= 1, "official queue is empty");
const queuedItem = queueState.queue.find((item) => item.placement === "queued");
assert.ok(queuedItem !== undefined, "official queue has no queued placement");
await officialRpc("session/updateQueue", { request: {
  sessionId: queueSessionId,
  itemId: queuedItem.id,
  action: { kind: "edit", content: [{ type: "text", text: "queue item edited" }] },
} });
const editedQueue = await officialRpc("session/state", { request: { sessionId: queueSessionId } });
const editedItem = editedQueue.queue.find((item) => item.id === queuedItem.id);
assert.equal(editedItem?.content[0]?.text, "queue item edited");
await officialRpc("session/updateQueue", { request: {
  sessionId: queueSessionId,
  itemId: queuedItem.id,
  action: { kind: "remove" },
} });
const removedQueue = await officialRpc("session/state", { request: { sessionId: queueSessionId } });
assert.ok(!removedQueue.queue.some((item) => item.id === queuedItem.id), "queue item was not removed");
const queueDeadline = Date.now() + 90_000;
let queueAssistant;
while (Date.now() < queueDeadline) {
  const queuePage = await call("page", { address: { kind: "session", sessionId: queueSessionId }, limit: 20 });
  queueAssistant = queuePage.body.result.records.find((record) => record.role === "assistant");
  if (queueAssistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(queueAssistant !== undefined, "queued prompt never ran after the alarm claim");

// Fork an actual inclusive official cursor, not a guessed message offset. The
// inherited prefix and official forked closers must survive a fresh HTTP read.
const sourceWire = await officialRpc("session/page", { request: { address: { kind: "session", sessionId: sourceId }, maxMessages: 100 } });
const userBoundary = sourceWire.records.find(row => row.event.type === "user/message");
assert.ok(userBoundary, "source official journal has no user boundary");
const forkAtSeq = userBoundary.event.seq;
const forkRpc = await fetch(`${base}/api/session/fork`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` },
  body: JSON.stringify({
    type: "client-request",
    rpcId: `fork-${suffix}`,
    method: "session/fork",
    payload: { args: { request: { sessionId: sourceId, atSeq: forkAtSeq } } },
  }),
});
const forkBody = await forkRpc.json();
assert.equal(forkRpc.status, 200, `session/fork HTTP ${forkRpc.status}`);
assert.equal(forkBody.result.ok, true, JSON.stringify(forkBody));
const atSeqForkId = forkBody.result.value.sessionId;
const atSeqForkPage = await call("page", { address: { kind: "session", sessionId: atSeqForkId }, limit: 20 });
assert.equal(atSeqForkPage.body.result.records.length, 1, "atSeq fork should keep only the user message");
assert.equal(atSeqForkPage.body.result.records[0].role, "user");
const forkWire = await officialRpc("session/page", { request: { address: { kind: "session", sessionId: atSeqForkId }, maxMessages: 100 } });
const prefix = sourceWire.records.filter(row => row.event.seq <= forkAtSeq);
assert.deepEqual(forkWire.records.slice(0, prefix.length), prefix, "fork rewrote the exact inherited prefix");
assert.equal(forkWire.records[prefix.length].event.type, "session/end-seed");
assert.equal(forkWire.records.at(-1).event.type, "turn/end");
assert.equal(forkWire.records.at(-1).event.data.reason.kind, "forked");
assert.equal(forkWire.records.filter(row => row.event.type === "assistant/message").length, 0, "fork inherited a future assistant");
assert.deepEqual((await officialRpc("session/page", { request: { address: { kind: "session", sessionId: atSeqForkId }, maxMessages: 100 } })).records, forkWire.records);

// Official workspace namespace: unary registry mutations through the Worker bridge.
async function officialRpc(method, args) {
  const rpcId = `${method}-${suffix}-${++officialSequence}`;
  const response = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${method} HTTP ${response.status}`);
  assert.equal(body.rpcId, rpcId);
  assert.equal(body.result.ok, true, `${method}: ${JSON.stringify(body)}`);
  return body.result.value;
}

const defaultWorkspace = await officialRpc("workspace/initializeDefault", {});
assert.equal(typeof defaultWorkspace.workspace.workspaceId, "string");
const workspacePath = `/logical/accept-${suffix}`;
const createdWorkspace = await officialRpc("workspace/create", { request: { path: workspacePath } });
const workspaceId = createdWorkspace.workspace.workspaceId;
assert.equal(createdWorkspace.workspace.path, workspacePath);
const renamedWorkspace = await officialRpc("workspace/rename", {
  request: { workspaceId, title: `Acceptance workspace ${suffix}` },
});
assert.equal(renamedWorkspace.workspace.title, `Acceptance workspace ${suffix}`);
const workspaceOrder = await officialRpc("workspace/insertBefore", { request: { workspaceId } });
assert.ok(workspaceOrder.workspaceIds.includes(workspaceId));
const pinned = await officialRpc("workspace/pinSession", { request: { sessionId: sourceId } });
assert.ok(pinned.pinnedSessionIds.includes(sourceId));
const unpinned = await officialRpc("workspace/unpinSession", { request: { sessionId: sourceId } });
assert.ok(!unpinned.pinnedSessionIds.includes(sourceId));
const permissionCatalog = await officialRpc("permissionPresets/catalog", {});
assert.deepEqual(permissionCatalog.options.map((option) => option.value), [
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
assert.equal(permissionCatalog.defaultPreset, "workspace-write");
const permissionCommands = await officialRpc("commands/list", { sessionId: sourceId });
assert.equal(permissionCommands.find(command => command.name === "permission")?.definitionId, "@deepseek-ai/dsh-permission-presets");
const commandRpcId = `permission-command-${suffix}`;
const commandRequest = async (line, rpcId = commandRpcId) => {
  const response = await fetch(`${base}/api/commands/execute`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ type: "client-request", rpcId, method: "commands/execute", payload: { args: { sessionId: sourceId, line, attachments: [] } } }) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.rpcId, rpcId); return body.result;
};
const beforeCommandUsers = (await hostResult("history", { sessionId: sourceId })).records.filter(record => record.role === "user").length;
const executedCommand = await commandRequest("/permission read-only");
assert.equal(executedCommand.ok, true); assert.match(executedCommand.value.commandId, /^cmd-/);
assert.deepEqual(executedCommand.value.result, { kind: "success", text: "preset read-only" });
assert.deepEqual(await commandRequest("/permission read-only"), executedCommand, "command retry did not return its durable receipt");
const commandConflict = await commandRequest("/permission workspace-write");
assert.equal(commandConflict.ok, false); assert.equal(commandConflict.error.code, "session/command-conflict");
const commandFailure = await commandRequest("/permission invented", `permission-invalid-${suffix}`);
assert.equal(commandFailure.ok, false); assert.equal(commandFailure.error.code, "command/failed");
assert.match(commandFailure.error.details.commandId, /^cmd-/); assert.match(commandFailure.error.message, /unknown preset/);
assert.equal((await hostResult("history", { sessionId: sourceId })).records.filter(record => record.role === "user").length, beforeCommandUsers, "permission command accidentally admitted a model input");

await hostResult("selectPermission", { sessionId: sourceId, preset: "read-only" });
assert.deepEqual(await hostResult("permissionSnapshot", { sessionId: sourceId }), { currentValue: "read-only", sandbox: "read-only", approval: "ask" });
assert.equal((await hostResult("permissionSnapshot", { sessionId: generatedSessionId })).currentValue, "workspace-write", "session permission leaked into another session");
assert.deepEqual((await hostResult("projections", { sessionId: sourceId })).permissions, { currentValue: "read-only" });
const forbiddenPath = `forbidden-agent-${suffix}.txt`;
const forgedAgent = await call("workspaceFileWriteFromAgent", { sessionId: sourceId, path: forbiddenPath, dataBase64: Buffer.from("must not be written").toString("base64") });
assert.equal(forgedAgent.status, 403, "public request impersonated a model file operation");
assert.equal(forgedAgent.body.error, "unauthorized");
const forgedStep = await call("recordStepStart", {sessionId:sourceId,requestId:"forged",sdkRequestId:"forged",stepId:"forged:0",startedAt:1});
assert.equal(forgedStep.status,403,"public request forged model Step execution evidence");
assert.equal(forgedStep.body.error,"unauthorized");
assert.equal((await call("workspaceFileStat", { sessionId: sourceId, path: forbiddenPath })).body.error?.code, "workspace-file/not-found");
const invalidPermission = await call("selectPermission", { sessionId: sourceId, preset: "invented" });
assert.equal(invalidPermission.status, 400);
assert.equal((await hostResult("permissionSnapshot", { sessionId: sourceId })).currentValue, "read-only", "rejected permission selection mutated the session");
await hostResult("selectPermission", { sessionId: sourceId, preset: "workspace-write" });
assert.equal((await hostResult("permissionSnapshot", { sessionId: forkId })).currentValue, "workspace-write", "fork lost the source permission");
const archived = await officialRpc("workspace/archiveSession", { request: { sessionId: forkId } });
assert.ok(archived.archivedSessionIds.includes(forkId));
const unarchived = await officialRpc("workspace/unarchiveSession", { request: { sessionId: forkId } });
assert.ok(!unarchived.archivedSessionIds.includes(forkId));

// Official workspaceFiles RPCs: the Host seeds a real R2-backed transcript and
// serves list/stat/read/readBytes through the bridge (no synthetic file).
const fileList = await officialRpc("workspaceFiles/list", { workspaceFileScope: sourceId, path: "" });
assert.ok(fileList.entries.some((entry) => entry.name === "Conversation.md"), "seeded Conversation.md missing from workspace files");
const fileStat = await officialRpc("workspaceFiles/stat", { workspaceFileScope: sourceId, path: "Conversation.md" });
assert.equal(fileStat.absolutePath, "/Conversation.md");
assert.ok(fileStat.bytes > 0, "Conversation.md has no bytes");
const fileRead = await officialRpc("workspaceFiles/read", {
  workspaceFileScope: sourceId,
  path: "Conversation.md",
  range: { offset: 1, limit: 50 },
});
assert.ok(fileRead.text.length > 0, "Conversation.md read returned no text");
const fileBytes = await officialRpc("workspaceFiles/readBytes", {
  workspaceFileScope: sourceId,
  path: "Conversation.md",
  options: { range: { offset: 0, length: 64 } },
});
assert.ok(typeof fileBytes.dataBase64 === "string" && fileBytes.dataBase64.length > 0, "Conversation.md bytes missing");

// Human-in-the-loop approval: an approval-gated Think tool call parks the turn
// with an `approval-requested` transcript part; resolveApproval applies the
// decision and the resumed continuation settles the transcript.
const approvalSessionId = `accept-approval-${suffix}`;
await call("create", { sessionId: approvalSessionId, title: "Approval acceptance" });
await call("selectModel", { sessionId: approvalSessionId, model, reasoningEffort: "off" });
await officialRpc("session/prompt", { request: {
  sessionId: approvalSessionId,
  requestId: `approval-${suffix}`,
  mode: "queue",
  content: [{ type: "text", text: "请务必调用 remember_fact 工具记住：我的名字是 AcceptanceBot。保存完成后只回复 OK。" }],
} });
let approvalToolCall;
const approvalDeadline = Date.now() + 120_000;
while (Date.now() < approvalDeadline) {
  const page = await call("page", { address: { kind: "session", sessionId: approvalSessionId }, limit: 20 });
  for (const record of page.body.result?.records ?? []) {
    for (const part of record.parts ?? []) {
      if (part.state === "approval-requested" && typeof part.toolCallId === "string") {
        approvalToolCall = { toolCallId: part.toolCallId, toolName: part.toolName };
      }
    }
  }
  if (approvalToolCall !== undefined) break;
  const pending = await call("pendingApprovals", { sessionId: approvalSessionId });
  const approvals = pending.body.approvals ?? pending.body.result?.approvals ?? [];
  if (approvals.length > 0) {
    approvalToolCall = { executionId: approvals[0].executionId, toolName: approvals[0].descriptor?.action };
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(approvalToolCall !== undefined, "approval-gated tool call never parked the turn");
assert.equal(typeof (approvalToolCall.toolCallId ?? approvalToolCall.executionId), "string");
const beforeApproval = await call("history", { sessionId: approvalSessionId });
assert.equal(beforeApproval.body.result.turns.length, 1, "one user input must own the pending approval");
assert.ok(["running", "awaiting-approval"].includes(beforeApproval.body.result.turns[0].status), "pending approval must not be terminal");
assert.equal((await call("state", { sessionId: approvalSessionId })).body.result.running, true, "waiting for approval remains active");
const resolve = await call("resolveApproval", {
  sessionId: approvalSessionId,
  ...(approvalToolCall.toolCallId === undefined ? {} : { toolCallId: approvalToolCall.toolCallId }),
  ...(approvalToolCall.executionId === undefined ? {} : { executionId: approvalToolCall.executionId }),
  decision: "allowed-once", // Exact value sent by the official Allow once seam.
});
assert.equal(resolve.status, 200, `resolveApproval HTTP ${resolve.status}`);
assert.equal(resolve.body.accepted ?? resolve.body.result?.accepted, true, `resolveApproval: ${JSON.stringify(resolve.body)}`);
const approvalTurnDeadline = Date.now() + 120_000;
let approvalSettled = false;
while (Date.now() < approvalTurnDeadline) {
  const page = await call("page", { address: { kind: "session", sessionId: approvalSessionId }, limit: 20 });
  const records = page.body.result?.records ?? [];
  const turns = page.body.result?.turns ?? [];
  assert.equal(turns.length, 1, "approval continuation must remain one user turn");
  assert.ok(!["failed", "cancelled"].includes(turns[0].status), `approval turn terminated unsuccessfully: ${JSON.stringify(turns[0])}`);
  const assistant = records.filter((record) => record.role === "assistant");
  const text = assistant.flatMap((record) => (record.parts ?? []).filter((part) => part.type === "text").map((part) => part.text)).join(" ");
  const unsettled = assistant.some((record) => (record.parts ?? []).some((part) => part.state === "approval-requested"));
  const successfulTool = assistant.flatMap(record => record.parts ?? []).some(part => part.toolCallId === approvalToolCall.toolCallId && part.state === "output-available" && part.output?.ok !== false && part.output?.status !== "error");
  if (turns[0].status === "completed" && !unsettled && text.includes("OK") && (approvalToolCall.toolCallId === undefined || successfulTool)) {
    approvalSettled = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(approvalSettled, "approved tool call never settled the transcript");
assert.equal((await call("state", { sessionId: approvalSessionId })).body.result.running, false, "completed approval turn must be idle");
const pendingAfterApproval = (await call("pendingApprovals", { sessionId: approvalSessionId })).body.result;
assert.equal(pendingAfterApproval.toolApprovals.length + pendingAfterApproval.approvals.length, 0, "completed input retained an actionable approval");

// Durable Host settings document: describe, mutate against a revision, and
// reject a stale write instead of silently overwriting.
const settingsBefore = await call("settingsDescribe", {});
assert.equal(settingsBefore.body.result?.writable, true);
const settingsRevision = settingsBefore.body.result.revision;
const settingsWrite = await call("settingsMutate", {
  ns: "permission",
  ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }],
  expectedRevision: settingsRevision,
});
assert.equal(settingsWrite.status, 200);
assert.equal(settingsWrite.body.result?.values?.permission?.defaultPreset, "read-only");
const settingsAfter = await call("settingsDescribe", {});
assert.equal(settingsAfter.body.result?.values?.permission?.defaultPreset, "read-only");
assert.equal(settingsAfter.body.result?.revision, settingsRevision + 1);
assert.equal((await officialRpc("permissionPresets/catalog", {})).defaultPreset, "read-only", "catalog did not read updated owner settings");
const permissionNewId = `accept-permission-default-${suffix}`;
await hostResult("create", { sessionId: permissionNewId });
assert.equal((await hostResult("permissionSnapshot", { sessionId: permissionNewId })).currentValue, "read-only");
assert.equal((await hostResult("permissionSnapshot", { sessionId: sourceId })).currentValue, "workspace-write", "new default rewrote an existing session");
const staleWrite = await call("settingsMutate", {
  ns: "permission",
  ops: [{ op: "set", path: ["defaultPreset"], value: "danger-full-access" }],
  expectedRevision: settingsRevision,
});
assert.equal(staleWrite.status, 400);
assert.equal(staleWrite.body.error?.code, "settings/conflict");
await hostResult("settingsMutate", { ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }] });
assert.equal((await hostResult("permissionSnapshot", { sessionId: permissionNewId })).currentValue, "read-only", "later default rewrote its earlier new session");

// Encrypted credentials: describe → set → describe → unset, with the secret
// value never returned by the read path.
const credentialRef = "DEEPSEEK_OFFICIAL_API_KEY";
const credentialsBefore = await call("credentialsDescribe", { refs: [credentialRef] });
assert.equal(credentialsBefore.body.result?.writable, true);
assert.equal(credentialsBefore.body.result?.entries?.[credentialRef]?.configured, false);
cleanupCredential = true;
const credentialWrite = await call("credentialsSet", { ref: credentialRef, value: "acceptance-secret-value" });
assert.equal(credentialWrite.status, 200, `credentialsSet HTTP ${credentialWrite.status}`);
const credentialsAfter = await call("credentialsDescribe", { refs: [credentialRef] });
assert.equal(credentialsAfter.body.result?.entries?.[credentialRef]?.configured, true);
assert.ok(!JSON.stringify(credentialsAfter.body).includes("acceptance-secret-value"), "credential value leaked through describe");
const credentialUnset = await call("credentialsUnset", { ref: credentialRef });
assert.equal(credentialUnset.status, 200);
assert.equal((await call("credentialsDescribe", { refs: [credentialRef] })).body.result?.entries?.[credentialRef]?.configured, false);

// BYOK runtime: an invalid stored key must reach the model runtime and fail the
// turn; removing it falls back to the platform AI Gateway.
await call("credentialsSet", { ref: "DEEPSEEK_OFFICIAL_API_KEY", value: "invalid-byok-key" });
const byokSessionId = `accept-byok-${suffix}`;
await call("create", { sessionId: byokSessionId, title: "BYOK acceptance" });
await call("selectModel", { sessionId: byokSessionId, model, reasoningEffort: "off" });
await officialRpc("session/prompt", { request: {
  sessionId: byokSessionId,
  requestId: `byok-${suffix}`,
  mode: "queue",
  content: [{ type: "text", text: "BYOK invalid key probe." }],
} });
let byokFailed = false;
const byokDeadline = Date.now() + 120_000;
while (Date.now() < byokDeadline) {
  const state = await call("state", { sessionId: byokSessionId });
  const history = await hostResult("history", { sessionId: byokSessionId });
  const assistant = history.records.find((record) => record.role === "assistant");
  const input = history.turns.find(turn => turn.requestId === `byok-${suffix}`);
  if (state.body.result?.running === false && assistant === undefined && input?.status === "failed") { byokFailed = true; break; }
  if (assistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(byokFailed, "invalid BYOK key did not fail the turn (credential may not reach the runtime)");
// This already-required provider failure exercises entry before the first token.
// A real failed model Step remains durable without inventing an assistant reply.
const failedHistory = await hostResult("history", { sessionId: byokSessionId });
assert.equal(failedHistory.records.filter(record => record.role === "user").length, 1);
assert.equal(failedHistory.records.filter(record => record.role === "assistant").length, 0);
assert.equal(failedHistory.turns.length, 1);
const failedTurn = failedHistory.turns[0];
assert.equal(failedTurn.requestId, `byok-${suffix}`);
assert.equal(failedTurn.status, "failed");
assert.ok(Array.isArray(failedTurn.steps) && failedTurn.steps.length > 0, "before-token failure lost actual model Step entry evidence");
assert.ok(failedTurn.steps.every(step => typeof step.id === "string" && step.id.length > 0 && Number.isFinite(step.startedAt) && step.startedAt > 0));
assert.equal(new Set(failedTurn.steps.map(step => step.id)).size, failedTurn.steps.length, "replayed model entry duplicated a Step");
assert.ok(Number.isFinite(failedTurn.endedAt) && failedTurn.steps.every(step => step.startedAt <= failedTurn.endedAt));
const failedWire = await officialRpc("session/page", { request: { address: { kind: "session", sessionId: byokSessionId }, maxMessages: 100 } });
assert.equal(failedWire.hasMore, false);
const failedEvents = failedWire.records.map(row => row.event);
const failedStarts = failedEvents.filter(event => event.type === "step/start");
assert.deepEqual(failedStarts.map(event => event.time), failedTurn.steps.map(step => step.startedAt), "wire Step starts must preserve real durable entry times");
assert.equal(failedEvents.filter(event => event.type === "assistant/message").length, 0, "failure wire history fabricated an assistant response");
assert.equal(failedEvents.filter(event => event.type === "turn/start").length, 1);
for (const start of failedStarts) assert.equal(failedEvents.filter(event => event.type === "step/end" && event.data.step === start.data.step).length, 1);
const failedEnds = failedEvents.filter(event => event.type === "turn/end");
assert.equal(failedEnds.length, 1);
assert.equal(failedEnds[0].data.reason.kind, "error");
assert.equal(failedEnds[0].time, failedTurn.endedAt);
const failedProjections = await hostResult("projections", { sessionId: byokSessionId });
assert.equal(failedProjections.sessionStats.turns, 1);
assert.equal(failedProjections.sessionStats.steps, failedStarts.length);
assert.deepEqual(failedProjections.modelSelection.lastUsed, { provider: "deepseek-official", model, reasoningEffort: "off" }, "lastUsed records the actual attempted request even when the provider rejects before output");
const failedOfficialProjections = await officialRpc("session/projections", { request: { sessionId: byokSessionId } });
assert.equal(failedOfficialProjections.values.sessionStats.steps, failedStarts.length);
assert.equal(failedOfficialProjections.values.sessionStats.turns, 1);
assert.deepEqual(await hostResult("history", { sessionId: byokSessionId }), failedHistory, "reloading failure history changed entered Step evidence");
assert.deepEqual((await officialRpc("session/page", { request: { address: { kind: "session", sessionId: byokSessionId }, maxMessages: 100 } })).records, failedWire.records);
assert.deepEqual((await hostResult("projections", { sessionId: byokSessionId })).sessionStats, failedProjections.sessionStats, "replay or reload incremented failed Step counts");
failureEvidence.push({ requestId: failedTurn.requestId, status: failedTurn.status, steps: failedTurn.steps, endedAt: failedTurn.endedAt, wireSteps: failedStarts.length, lastUsed: failedProjections.modelSelection.lastUsed, assistantMessages: 0, errorCode: failedEnds[0].data.reason.error?.code });
await call("credentialsUnset", { ref: "DEEPSEEK_OFFICIAL_API_KEY" });
const platformSessionId = `accept-platform-${suffix}`;
await call("create", { sessionId: platformSessionId, title: "Platform fallback acceptance" });
await call("selectModel", { sessionId: platformSessionId, model, reasoningEffort: "off" });
const platformPrompt = await officialRpc("session/prompt", { request: {
  sessionId: platformSessionId,
  requestId: `platform-${suffix}`,
  mode: "queue",
  content: [{ type: "text", text: "Reply with the word PLATFORM." }],
} });
assert.equal(platformPrompt.accepted, true);
let platformAssistant;
const platformDeadline = Date.now() + 120_000;
while (Date.now() < platformDeadline) {
  const page = await call("page", { address: { kind: "session", sessionId: platformSessionId }, limit: 10 });
  platformAssistant = (page.body.result?.records ?? []).find((record) => record.role === "assistant");
  if (platformAssistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(platformAssistant !== undefined, "platform gateway fallback did not answer after clearing BYOK");

// Models discovery endpoint: without a stored BYOK key it refuses with the
// official discovery code instead of inventing models.
const discovery = await call("llmDiscoverModels", { settingsNs: "llm-deepseek" });
assert.equal(discovery.status, 400);
assert.equal(discovery.body.error?.code, "llm/model-discovery-rejected");

// Host tasks: create an after-schedule that targets a new reserved Session;
// the alarm engine must deliver it, create/insert the Session, run the turn,
// and record delivery history.
const scheduleLimits = await officialRpc("schedule/deliveryLimits", {});
assert.equal(typeof scheduleLimits.newSessionIntervalSeconds, "number");
const scheduleCreated = await officialRpc("schedule/create", { request: {
  title: `Acceptance schedule ${suffix}`,
  prompt: "Reply with the word SCHEDULE_OK.",
  timing: { kind: "after", after_seconds: 8 },
  target: { kind: "new_once" },
} });
assert.equal(typeof scheduleCreated.id, "string");
assert.equal(scheduleCreated.status, "active");
const scheduleDeadline = Date.now() + 150_000;
let scheduleDelivered;
while (Date.now() < scheduleDeadline) {
  const viewed = await officialRpc("schedule/view", { request: { id: scheduleCreated.id } });
  if (viewed.lastDelivery !== undefined) { scheduleDelivered = viewed; break; }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.ok(scheduleDelivered !== undefined, "scheduled task never delivered");
assert.equal(scheduleDelivered.status, "ended");
assert.equal(scheduleDelivered.lastDelivery.messageId.length > 0, true);
const scheduledSessionId = scheduleDelivered.target.sessionId;
const scheduleHistory = await officialRpc("schedule/history", { request: { id: scheduleCreated.id, limit: 10 } });
assert.ok(Array.isArray(scheduleHistory.records) && scheduleHistory.records.length >= 1, "schedule delivery history is empty");
let scheduledAssistant;
const scheduledTurnDeadline = Date.now() + 120_000;
while (Date.now() < scheduledTurnDeadline) {
  const scheduledPage = await call("page", { address: { kind: "session", sessionId: scheduledSessionId }, limit: 20 });
  scheduledAssistant = (scheduledPage.body.result?.records ?? []).find((record) => record.role === "assistant");
  if (scheduledAssistant !== undefined) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.ok(scheduledAssistant !== undefined, "scheduled turn produced no assistant reply");
const scheduleCatalog = await officialRpc("schedule/catalog", {});
assert.ok(scheduleCatalog.some((entry) => entry.id === scheduleCreated.id));
const scheduleList = await officialRpc("schedule/list", { request: {} });
assert.ok(scheduleList.items.some((entry) => entry.id === scheduleCreated.id));
const removedInactive = await officialRpc("schedule/deleteInactive", {});
assert.ok(removedInactive.deleted >= 1);
assert.deepEqual((await officialRpc("schedule/view", { request: { id: scheduleCreated.id } })).code, "schedule_not_found");

// Durable maintenance jobs: registrations are seeded, a manual run prunes the
// superseded immutable workspace version (and leaves the latest readable), and
// the run journal records the outcome.
const maintenanceList = await call("maintenanceList");
assert.deepEqual(maintenanceList.body.result?.schedules?.map((schedule) => schedule.kind).sort(), [
  "cleanupFiles",
  "pruneSchedules",
  "recoverSubmissions",
]);
assert.equal(typeof maintenanceList.body.result?.nextDueAtMs, "number");
const pruneBase64 = (value) => Buffer.from(value, "utf8").toString("base64");
await call("workspaceFileWrite", { sessionId: sourceId, path: "prune-target.txt", dataBase64: pruneBase64("version-one") });
await call("workspaceFileWrite", { sessionId: sourceId, path: "prune-target.txt", dataBase64: pruneBase64("version-two") });
const cleanupRun = await call("maintenanceRun", { kind: "cleanupFiles", olderThanMs: 0 });
assert.equal(cleanupRun.body.result?.run?.status, "ok");
assert.ok((cleanupRun.body.result?.run?.detail?.deletedVersions ?? 0) >= 1, "cleanupFiles pruned no superseded version");
const prunedRead = await call("workspaceFileRead", { sessionId: sourceId, path: "prune-target.txt" });
assert.equal(prunedRead.body.result?.text, "version-two");
const schedulePrune = await call("maintenanceRun", { kind: "pruneSchedules", olderThanMs: 0 });
assert.equal(schedulePrune.body.result?.run?.status, "ok");
const maintenanceHistory = await call("maintenanceHistory", { limit: 10 });
assert.ok((maintenanceHistory.body.result?.length ?? 0) >= 2, "maintenance run journal is empty");

// Official `settings` Remote: durable namespace views, revision CAS, stale
// write conflict, and the explicit unavailable native document editor.
const settingsRemote = await officialRpc("settings/describe", {});
assert.equal(settingsRemote.writable, true);
const permissionView = settingsRemote.namespaces.find((view) => view.ns === "permission");
assert.ok(permissionView !== undefined, "settings/describe has no permission namespace");
const settingsRemoteRevision = permissionView.revision;
const settingsRemoteWrite = await officialRpc("settings/mutate", {
  ns: "permission",
  ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }],
  expectedRevision: settingsRemoteRevision,
});
assert.equal(settingsRemoteWrite.value?.defaultPreset, "read-only");
const officialRequest = async (method, args) => {
  const rpcId = `${method}-raw-${suffix}-${++officialSequence}`;
  const response = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
  });
  return (await response.json()).result;
};
const settingsRemoteStale = await officialRequest("settings/mutate", {
  ns: "permission",
  ops: [{ op: "set", path: ["defaultPreset"], value: "danger-full-access" }],
  expectedRevision: settingsRemoteRevision,
});
assert.equal(settingsRemoteStale.ok, false);
assert.equal(settingsRemoteStale.error?.code, "settings/conflict");
const capabilityCatalog = await officialRpc("session/modelCatalog", {});
const flash = capabilityCatalog.groups.flatMap(group => group.models).find(option => option.id === "deepseek-flash");
assert.ok(flash && flash.unavailable !== true, "deployment acceptance requires a configured real provider");
assert.notEqual(flash.reasoning?.unavailable, true);
assert.deepEqual(flash.reasoning.efforts.map(option => option.id), ["off", "low", "high", "max"]);
assert.ok(capabilityCatalog.groups.flatMap(group => group.models).some(option => option.id === "deepseek-v4-pro"), "canonical Pro model is absent");
for (const reasoningEffort of ["off", "low", "high", "max"]) {
  const effortAttempt = await officialRequest("session/selectModel", { request: { sessionId: generatedSessionId, provider: "deepseek-official", model, reasoningEffort } });
  assert.equal(effortAttempt.ok, true);
  assert.deepEqual(effortAttempt.value.selected, { provider: "deepseek-official", model, reasoningEffort });
  assert.equal((await hostResult("state", { sessionId: generatedSessionId })).reasoningEffort, reasoningEffort);
  assert.equal((await hostResult("projections", { sessionId: generatedSessionId })).modelSelection.next.reasoningEffort, reasoningEffort);
}
const badEffort = await officialRequest("session/selectModel", { request: { sessionId: generatedSessionId, model, reasoningEffort: "ultra" } });
assert.equal(badEffort.ok, false); assert.equal(badEffort.error.code, "gateway/bad-request");
assert.equal((await hostResult("state", { sessionId: generatedSessionId })).reasoningEffort, "max");
assert.equal(projections.body.result.imageLimits?.maxImagesPerMessage, 0);
const settingsDocument = await officialRequest("settings/openSettingsDocument", {});
assert.equal(settingsDocument.ok, false);

// Daily wall-clock timing: the Host computes the next committed UTC instant
// from the local time/zone; create, verify the instant, then delete through edit.
const dailyTarget = new Date(Date.now() + 150_000);
const dailyHH = String(dailyTarget.getUTCHours()).padStart(2, "0");
const dailyMM = String(dailyTarget.getUTCMinutes()).padStart(2, "0");
const dailyCreated = await officialRpc("schedule/create", { request: {
  title: `Acceptance daily ${suffix}`,
  prompt: "Daily acceptance.",
  timing: { kind: "daily", daily: { time: `${dailyHH}:${dailyMM}:00`, time_zone: "UTC" } },
  target: { kind: "new" },
} });
assert.equal(dailyCreated.kind, "daily");
assert.equal(dailyCreated.timeZone, "UTC");
const dailyAt = Date.parse(dailyCreated.scheduledAt);
assert.ok(Number.isFinite(dailyAt) && dailyAt > Date.now() + 30_000, `daily next occurrence is not in the near future: ${dailyCreated.scheduledAt}`);
const dailyDeleted = await officialRpc("schedule/edit", { request: { id: dailyCreated.id, action: "delete" } });
assert.equal(dailyDeleted.deleted, true);
assert.equal((await officialRpc("schedule/view", { request: { id: dailyCreated.id } })).code, "schedule_not_found");

// Official system-prompt registry: a fresh Agent renders the official DSH
// identity, the deployment persona, model identity, and tool guidance through
// the official section ordering/interpolation rules.
const systemPromptResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId }),
  signal: AbortSignal.timeout(120_000),
});
assert.equal(systemPromptResponse.status, 200, `system prompt HTTP ${systemPromptResponse.status}`);
const systemPrompt = await systemPromptResponse.json();
assert.equal(typeof systemPrompt.text, "string");
assert.equal(systemPrompt.error, undefined, `official prompt registry failed: ${systemPrompt.error}`);
assert.match(systemPrompt.text, /You are an AI agent powered by DeepSeek Harness\./u);
assert.match(systemPrompt.text, /You are dsh-base/u);
assert.match(systemPrompt.text, /model id deepseek-flash/u);
assert.match(systemPrompt.text, /untrusted page content/u);
assert.match(systemPrompt.text, /Cloudflare Workers/u);
// Working directory and workspace instruction files are read from the Session
// Host workspace through the internal binding, and the official presentation
// waterfall runs once per assembly.
await call("workspaceFileWrite", {
  sessionId: sourceId,
  path: "AGENTS.md",
  dataBase64: Buffer.from("# Acceptance workspace instructions\nAlways include the marker AGENTS_ACCEPTANCE in answers.", "utf8").toString("base64"),
});
const writtenInstructions = await call("workspaceFileRead", { sessionId: sourceId, path: "AGENTS.md", offset: 1, limit: 20 });
assert.match(writtenInstructions.body.result?.text ?? "", /AGENTS_ACCEPTANCE/u, "AGENTS.md write was not readable through the Host");
const contextualPromptResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId }),
  signal: AbortSignal.timeout(120_000),
});
assert.equal(contextualPromptResponse.status, 200);
const contextualPrompt = await contextualPromptResponse.json();
assert.equal(contextualPrompt.error, undefined, `official prompt registry failed: ${contextualPrompt.error}`);
assert.ok(Array.isArray(contextualPrompt.context), "durable context debug is missing");
assert.ok(!contextualPrompt.text.includes("AGENTS_ACCEPTANCE"), "instructions leaked into the system prompt");
// Context snapshots are durable user-role messages; one real turn must inject
// them, and the Host transcript must hide them from the conversation UI.
// Seed the user-global instruction chain and the browser time zone through the
// existing durable settings document (the adapter writes the zone the same way).
await call("settingsMutate", { ns: "dsh-base:instructions", ops: [{ op: "set", path: ["text"], value: "Global acceptance instructions with GLOBAL_ACCEPTANCE." }] });
await call("settingsMutate", { ns: "dsh-base:client", ops: [{ op: "set", path: ["timeZone"], value: "Asia/Shanghai" }] });
const contextProbe = await call("prompt", { sessionId: sourceId, text: "Context snapshot probe", requestId: `ctx-probe-${suffix}` });
assert.equal(contextProbe.status, 200);
await call("claim", { sessionId: sourceId, submissionId: contextProbe.body.result.submissionId });
let contextSettled = false;
const contextDeadline = Date.now() + 120_000;
while (Date.now() < contextDeadline) {
  const stateNow = await call("state", { sessionId: sourceId });
  if (stateNow.body.result?.running === false) { contextSettled = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(contextSettled, "context probe turn never settled");
const durablePromptResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId }),
  signal: AbortSignal.timeout(120_000),
});
const durablePrompt = await durablePromptResponse.json();
assert.equal(durablePrompt.error, undefined);
assert.equal(durablePrompt.contextInjectionError, undefined, `context injection failed: ${durablePrompt.contextInjectionError}`);
const contextKinds = durablePrompt.context.map((entry) => entry.kind);
assert.ok(contextKinds.includes("working-directory"), "no durable working-directory context");
assert.ok(contextKinds.includes("time"), "no durable time context");
const instructionContext = durablePrompt.context.find((entry) => entry.kind === "workspace-instructions");
assert.ok(instructionContext !== undefined, `no durable workspace-instructions context; debug=${JSON.stringify({ contexts: contextKinds, workspaceInstructionsLength: durablePrompt.workspaceInstructionsLength, lastRefreshError: durablePrompt.lastRefreshError, workspaceReadLog: durablePrompt.workspaceReadLog, contextInjectionError: durablePrompt.contextInjectionError })}`);
assert.match(instructionContext.text, /AGENTS_ACCEPTANCE/u);
const globalContext = durablePrompt.context.find((entry) => entry.kind === "global-instructions");
assert.ok(globalContext !== undefined, "no durable user-global instructions context");
assert.match(globalContext.text, /GLOBAL_ACCEPTANCE/u);
// Time snapshots retain earlier instants; the timezone changed immediately
// before this probe, so assert its newest snapshot rather than the old UTC one.
const timeContext = durablePrompt.context.findLast((entry) => entry.kind === "time");
assert.match(timeContext.text, /Asia\/Shanghai/u);
assert.match(timeContext.text, /Elapsed since the previous time snapshot|Current time:/u);
assert.doesNotMatch(durablePrompt.text, /\n{3,}/u);
assert.ok((durablePrompt.waterfallRuns ?? 0) >= 1, "official presentation waterfall did not run");
// Composer skill injection remains usable under a real session read-only
// filesystem policy. It does not authorize unavailable dynamic delegation.
await call("settingsMutate", { ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }] });
assert.equal((await hostResult("permissionSnapshot", { sessionId: sourceId })).currentValue, "workspace-write", "changing a default affected an existing session");
await hostResult("selectPermission", { sessionId: sourceId, preset: "read-only" });
const skillProbePrompt = await call("prompt", { sessionId: sourceId, text: "/web-fetch Summarize https://example.com in one sentence.", requestId: `skill-probe-${suffix}` });
await call("claim", { sessionId: sourceId, submissionId: skillProbePrompt.body.result.submissionId });
let skillSettled = false;
const skillDeadline = Date.now() + 120_000;
while (Date.now() < skillDeadline) {
  const stateNow = await call("state", { sessionId: sourceId });
  if (stateNow.body.result?.running === false) { skillSettled = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(skillSettled, "skill probe turn never settled");
const skillPromptResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId }),
  signal: AbortSignal.timeout(120_000),
});
const skillPrompt = await skillPromptResponse.json();
const skillContext = skillPrompt.context.find((entry) => entry.kind === "skill");
assert.ok(skillContext !== undefined, "no durable skill context");
assert.match(skillContext.text, /Skill: web-fetch/u);
assert.ok(!skillPrompt.tools.includes("delegate_task"), "unavailable delegation tool was exposed");
await call("settingsMutate", { ns: "permission", ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }] });
assert.equal((await hostResult("permissionSnapshot", { sessionId: sourceId })).currentValue, "read-only");
await hostResult("selectPermission", { sessionId: sourceId, preset: "workspace-write" });
const restoredPromptResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId }),
  signal: AbortSignal.timeout(120_000),
});
const restoredPrompt = await restoredPromptResponse.json();
assert.ok(!restoredPrompt.tools.includes("delegate_task"), "changing owner settings must not enable unavailable delegation");
assert.match(restoredPrompt.text, /Subagent delegation is unavailable/u);
// Owner fixture settings are restored exactly in finally, including on failure.
const transcriptAfterContext = await call("page", { address: { kind: "session", sessionId: sourceId }, limit: 100 });
const transcriptRecords = transcriptAfterContext.body.result?.records ?? [];
assert.ok(!transcriptRecords.some((record) => String(record.id ?? "").startsWith("dsh-context:")), "context snapshot leaked into the Host transcript");

// Host event pipeline for official retry/compaction nodes: append an
// `llm/retry` event and observe it through the session follow stream.
await call("appendSessionEvent", {
  sessionId: sourceId,
  type: "llm/retry",
  payload: { retryId: `acceptance-retry-${suffix}`, turn: 1, step: 1, provider: "deepseek", mode: "normal", policyKey: "default", retry: 1, maxRetries: 2, delayMs: 0, failure: { kind: "transient", message: "acceptance retry" } },
});
const retryController = new AbortController();
const retryResponse = await stream(`/follow?sessionId=${encodeURIComponent(sourceId)}&after=0`, retryController.signal);
const retryReader = retryResponse.body.getReader();
let retrySeen = false;
for (let read = 0; read < 20 && !retrySeen; read += 1) {
  const chunk = await Promise.race([
    retryReader.read(),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 2_000)),
  ]);
  if (chunk === undefined || chunk.done) break;
  retrySeen = new TextDecoder().decode(chunk.value).includes("llm/retry");
}
retryController.abort();
await retryReader.cancel().catch(() => {});
assert.ok(retrySeen, "llm/retry event never reached the follow stream");

// Manual compaction: exercises the configured Think compaction function and
// the official compaction/* session events consumed by transcript nodes.
const compactionResponse = await fetch(`${base}/api/system-prompt`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({ sessionId: sourceId, compact: true }),
  signal: AbortSignal.timeout(180_000),
});
assert.equal(compactionResponse.status, 200, `compaction HTTP ${compactionResponse.status}`);
const compaction = await compactionResponse.json();
assert.equal(typeof compaction.compacted, "boolean");
const compactionController = new AbortController();
const compactionStreamResponse = await stream(`/follow?sessionId=${encodeURIComponent(sourceId)}&after=0`, compactionController.signal);
const compactionReader = compactionStreamResponse.body.getReader();
let compactionStartSeen = false;
let compactionEndSeen = false;
for (let read = 0; read < 30 && !(compactionStartSeen && compactionEndSeen); read += 1) {
  const chunk = await Promise.race([
    compactionReader.read(),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 2_000)),
  ]);
  if (chunk === undefined || chunk.done) break;
  const text = new TextDecoder().decode(chunk.value);
  if (text.includes("compaction/start")) compactionStartSeen = true;
  if (text.includes("compaction/end")) compactionEndSeen = true;
}
compactionController.abort();
await compactionReader.cancel().catch(() => {});
assert.ok(compactionStartSeen, "compaction/start event never reached the follow stream");
assert.ok(compactionEndSeen, "compaction/end event never reached the follow stream");

// Public sitemap/robots: localized entries, reciprocal hreflang, x-default,
// noindex on the sitemap itself, HEAD support, and crawler disallow rules.
const sitemapResponse = await fetch(`${base}/sitemap.xml`, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(30_000) });
assert.equal(sitemapResponse.status, 200);
assert.match(sitemapResponse.headers.get("content-type") ?? "", /application\/xml/u);
assert.equal(sitemapResponse.headers.get("x-robots-tag"), "noindex");
assert.match(sitemapResponse.headers.get("cache-control") ?? "", /s-maxage=86400/u);
const sitemapText = await sitemapResponse.text();
assert.match(sitemapText, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/u);
assert.equal((sitemapText.match(/<url>/gu) ?? []).length, 2);
assert.ok(sitemapText.includes(`<loc>${base}/</loc>`));
assert.ok(sitemapText.includes(`<loc>${base}/zh-CN</loc>`));
assert.equal((sitemapText.match(/hreflang="en"/gu) ?? []).length, 2);
assert.equal((sitemapText.match(/hreflang="zh-CN"/gu) ?? []).length, 2);
assert.equal((sitemapText.match(/hreflang="x-default"/gu) ?? []).length, 2);
assert.ok(!sitemapText.includes("/login"), "login must not be advertised in the sitemap");
const robotsText = await (await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(30_000) })).text();
assert.match(robotsText, /^User-agent: \*/u);
assert.match(robotsText, /Disallow: \/api\//u);
assert.match(robotsText, /Disallow: \/zh-CN\/api\//u);
assert.match(robotsText, /Disallow: \/login/u);
assert.match(robotsText, new RegExp(`Sitemap: ${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\/sitemap\\.xml`, "u"));
const sitemapHead = await fetch(`${base}/sitemap.xml`, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
assert.equal(sitemapHead.status, 200);
assert.equal(await sitemapHead.text(), "");

// Public site config: deployment label only, cacheable, no secret fields.
const siteConfigResponse = await fetch(`${base}/api/site-config`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
assert.equal(siteConfigResponse.status, 200);
const siteConfig = await siteConfigResponse.json();
assert.equal(typeof siteConfig.environmentLabel, "string");
assert.ok(siteConfig.environmentLabel.length > 0);
assert.equal(typeof siteConfig.brand?.name, "string");
assert.ok(siteConfig.brand.name.length > 0);
if (process.env.DSH_EXPECT_ENVIRONMENT_LABEL) assert.equal(siteConfig.environmentLabel, process.env.DSH_EXPECT_ENVIRONMENT_LABEL);
if (process.env.DSH_EXPECT_BRAND) assert.equal(siteConfig.brand.name, process.env.DSH_EXPECT_BRAND);
assert.equal(new URL(siteConfig.links?.docs).protocol, "https:");
assert.equal(Object.keys(siteConfig).includes("AUTH_SECRET"), false);
assert.match(siteConfigResponse.headers.get("cache-control") ?? "", /public/u);

const followController = new AbortController();
const followResponse = await stream(`/follow?sessionId=${encodeURIComponent(sourceId)}&after=0`, followController.signal);
const followReader = followResponse.body.getReader();
const followChunk = new TextDecoder().decode((await followReader.read()).value);
assert.match(followChunk, /event: session/);
assert.match(followChunk, /submission\.(queued|completed)/);
followController.abort();
await followReader.cancel().catch(() => {});

const controlController = new AbortController();
const controlResponse = await stream("/control", controlController.signal);
const controlReader = controlResponse.body.getReader();
const controlChunk = new TextDecoder().decode((await controlReader.read()).value);
assert.match(controlChunk, /sessions\.snapshot/);
controlController.abort();
await controlReader.cancel().catch(() => {});

const missing = await call("state", { sessionId: `missing-${suffix}` });
assert.equal(missing.status, 400);
assert.equal(missing.body.error.code, "not_found");

// Test hygiene: blank probe Sessions otherwise crowd the sidebar's loaded page
// and make real Workspace groups look empty for the next run.
try {
  const cleanupRows = [];
  let cleanupCursor;
  for (let page = 0; page < 500; page += 1) {
    const pageResult = await call("list", cleanupCursor === undefined ? {} : { cursor: cleanupCursor });
    if (pageResult.status !== 200) break;
    cleanupRows.push(...pageResult.body.result.sessions);
    cleanupCursor = pageResult.body.result.cursor;
    if (cleanupCursor === undefined) break;
  }
  for (const row of cleanupRows) {
    if ((row.sessionId.endsWith(suffix) || row.sessionId === generatedSessionId || row.sessionId === scoped.body.result.sessionId) && row.blank === true && row.archived !== true) await call("workspaceSetFlags", { sessionId: row.sessionId, archived: true });
  }
  if (workspace?.body?.result?.workspace?.workspaceId !== undefined) {
    await call("workspaceDelete", { workspaceId: workspace.body.result.workspace.workspaceId });
  }
} catch {
  // Cleanup is best-effort; it must not hide the acceptance result.
}

} finally {
  if (cleanupCredential) await hostResult("credentialsUnset", { ref: "DEEPSEEK_OFFICIAL_API_KEY" });
  if (previousOwnerSettings !== undefined) {
    for (const ns of ["permission", "dsh-base:instructions", "dsh-base:client"]) {
      const original = previousOwnerSettings[ns];
      await hostResult("settingsMutate", { ns, ops: [original === undefined ? { op: "unset", path: [] } : { op: "set", path: [], value: original }] });
    }
  }
}
console.log(JSON.stringify({
  ok: true,
  endpoint,
  sourceId,
  forkId,
  modelEvidence,
  failureEvidence,
  checked: ["login", "create", "list", "state", "selectModel", "upload_attachment", "prompt", "page", "claim_think", "alarm_claim", "official_prompt", "official_queue", "official_approval", "official_fork_atseq", "official_workspace", "official_permission_catalog", "permission_durable_command_receipt", "real_effort_persistence", "permission_session_isolation", "permission_default_not_retroactive", "public_agent_write_rejected", "truthful_image_subagent_availability", "official_workspace_files", "host_settings", "host_credentials", "byok_runtime", "llm_discovery", "official_schedule", "official_schedule_daily", "official_settings_remote", "official_system_prompt", "maintenance_jobs", "retry_event_pipeline", "compaction_events", "site_config", "sitemap_robots", "session_workspace_ids", "usage_projection", "cancel", "follow_sse", "control_sse", "rename", "official_rename_projection_revision", "fork", "not_found"],
}, null, 2));
