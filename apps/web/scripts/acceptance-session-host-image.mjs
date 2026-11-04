#!/usr/bin/env node
/** Verify the deployment's explicit image-unavailable contract without spending model tokens. */
import { remoteAcceptanceConfig, registrationHeaders, mayRegisterAcceptance, waitForHostReadiness } from "./acceptance-config.mjs";
import assert from "node:assert/strict";

const { base, credentials } = remoteAcceptanceConfig();
const endpoint = `${base}/api/session-host`;
const suffix = Date.now().toString(36);
const sessionId = `accept-image-${suffix}`;
const cookieName = "__Secure-better-auth.session_token";
const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";

function sessionCookieOf(response) {
  const raw = ((response.headers.getSetCookie?.() ?? []).join("; ")) || (response.headers.get("set-cookie") ?? "");
  return raw.match(new RegExp(`${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^=]*=([^;]+)`, "u"))?.[1];
}

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

async function call(method, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` },
    body: JSON.stringify({ method, params }),
  });
  const body = await response.json();
  if (body.error !== undefined) { const error = new Error(`${method}: ${body.error.code} ${body.error.message ?? ""}`); Object.assign(error, body.error); throw error; }
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.ok(Object.hasOwn(body, "result"), `${method}: missing successful result`);
  return body.result;
}

await call("create", { sessionId, title: "Image acceptance" });
await waitForHostReadiness(async (method, params, signal) => {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` }, body: JSON.stringify({ method, params }), signal });
  return { status: response.status, body: await response.json() };
}, sessionId);
assert.deepEqual(await call("selectModel", { sessionId, model: "deepseek-flash", reasoningEffort: "off" }), { model: "deepseek-flash", reasoningEffort: "off" });
await call("selectPermission", { sessionId, preset: "read-only" });
assert.deepEqual(await call("permissionSnapshot", { sessionId }), { currentValue: "read-only", sandbox: "read-only", approval: "ask" });
const projections = await call("projections", { sessionId });
assert.deepEqual(projections.modelSelection.next, { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "off" });
assert.equal(projections.modelSelection.lastUsed, null, "selecting a model must not fabricate a completed model request");
assert.equal(projections.imageLimits.maxImagesPerMessage, 0);
assert.ok(projections.imageLimits.mediaTypes.includes("image/png"));
await assert.rejects(call("uploadAttachment", { sessionId, name: "red.png", mediaType: "image/png", dataBase64: RED_PNG }), error => error.details?.reason === "IMAGE_PROCESSOR_UNAVAILABLE");
const raw = await fetch(`${base}/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=red.png&mediaType=image/png`, {
  method: "POST", headers: { "content-type": "application/octet-stream", origin: base, cookie: `${cookieName}=${token}` }, body: Buffer.from(RED_PNG, "base64"),
});
assert.equal(raw.status, 200);
const result = await raw.json();
assert.equal(result.ok, false);
assert.equal(result.error.details.reason, "IMAGE_PROCESSOR_UNAVAILABLE");
const page = await call("page", { address: { kind: "session", sessionId }, limit: 20 });
assert.equal(page.records.length, 0);
assert.deepEqual((await call("history", { sessionId })).turns, [], "rejected images must not admit an input");
assert.equal((await call("state", { sessionId })).running, false);
console.log(JSON.stringify({ ok: true, sessionId, imageNormalization: "unavailable", rawUploadRejected: true, legacyUploadRejected: true, modelCalls: 0, requestedModel: projections.modelSelection.next, lastUsed: projections.modelSelection.lastUsed, permission: projections.permissions }, null, 2));
