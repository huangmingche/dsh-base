import assert from "node:assert/strict";
import { rejectCrossOriginRequest } from "../src/request-origin.ts";

const origin = "https://app.example.test";
const foreign = "https://foreign.example.test";
for (const path of ["/api/session/prompt", "/api/auth/sign-up/email", "/api/plugin-control", "/agents/dsh-agent/owner:example:session"]) {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(rejectCrossOriginRequest(new Request(origin + path, { method, headers: { origin: foreign } }))?.status, 403);
    assert.equal(rejectCrossOriginRequest(new Request(origin + path, { method, headers: { origin } })), undefined);
  }
}
for (const path of ["/api/remote.mux", "/api/agent-live", "/api/session-host/live-stream", "/agents/dsh-agent/owner:example:session"]) {
  assert.equal(rejectCrossOriginRequest(new Request(origin + path, { headers: { upgrade: "websocket", origin: foreign } }))?.status, 403);
  assert.equal(rejectCrossOriginRequest(new Request(origin + path, { headers: { upgrade: "websocket", origin } })), undefined);
}
assert.equal(rejectCrossOriginRequest(new Request(origin + "/api/session/prompt", { method: "POST", headers: { origin: "null", "content-type": "text/plain" }, body: "{}" }))?.status, 403);
assert.equal(rejectCrossOriginRequest(new Request(origin, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))?.status, 403);
assert.equal(rejectCrossOriginRequest(new Request(origin, { method: "POST" })), undefined);
assert.equal(rejectCrossOriginRequest(new Request(origin, { headers: { origin: foreign } })), undefined);
assert.equal(rejectCrossOriginRequest(new Request(origin, { method: "OPTIONS", headers: { origin: foreign } })), undefined);
console.log("request origin policy: mutations and WebSocket upgrades reject foreign origins");
