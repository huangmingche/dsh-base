import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createOfficialSessionGateway,
  isOfficialEndpointUnavailable,
  SESSION_REMOTE_DESCRIPTOR,
  SESSION_REMOTE_ENDPOINTS,
} from "../src/gateway.ts";

interface SeenRequest {
  readonly method: string;
  readonly payload: unknown;
}

const seen: SeenRequest[] = [];

function envelope(rpcId: unknown, result: unknown): string {
  return JSON.stringify({ type: "server-response", rpcId, result });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const body = JSON.parse(raw) as { type?: string; rpcId?: string; method?: string; payload?: unknown };
    const method = url.pathname.replace(/^\/api\//, "");
    assert.equal(body.type, "client-request");
    assert.equal(body.method, method);
    seen.push({ method, payload: body.payload });
    response.setHeader("content-type", "application/json");
    switch (method) {
      case "session/list":
        response.end(JSON.stringify({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { items: [{ sessionId: "a" }] } } }));
        return;
      case "session/state": {
        const request = (body.payload as { args: { request: { sessionId: string } } }).args.request;
        response.end(request.sessionId === "missing"
          ? JSON.stringify({ type: "server-response", rpcId: body.rpcId, result: { ok: false, error: { code: "session/not-found", message: "session not found", details: {} } } })
          : envelope(body.rpcId, { ok: true, value: { cursor: 0, active: true, running: false, queue: null, pendingInput: [] } }));
        return;
      }
      case "session/projections":
        response.end(envelope(body.rpcId, { ok: true, value: { kind: "sequenced", asOfSeq: 1, values: { usage: { inputTokens: 2 } } } }));
        return;
      case "session/create":
        response.end(envelope(body.rpcId, { ok: true, value: { sessionId: "created" } }));
        return;
      case "session/fork":
        response.end(envelope(body.rpcId, { ok: true, value: { sessionId: "forked" } }));
        return;
      case "session/rename":
        response.end(envelope(body.rpcId, { ok: true, value: { title: "renamed", seq: 3 } }));
        return;
      case "session/selectModel":
        response.end(envelope(body.rpcId, { ok: true, value: { selected: { provider: "deepseek-official", model: "deepseek-flash" } } }));
        return;
      case "session/modelCatalog":
        response.end(envelope(body.rpcId, { ok: true, value: { default: { provider: "deepseek-official", model: "deepseek-flash" }, routableProviders: [], groups: [], failures: [] } }));
        return;
      case "session/cancel":
        response.end(envelope(body.rpcId, { ok: true, value: { accepted: true } }));
        return;
      case "session/prompt":
        response.end(envelope(body.rpcId, { ok: true, value: { accepted: true, submissionId: "sub-1" } }));
        return;
      case "session/updateQueue":
        response.end(envelope(body.rpcId, { ok: true, value: { accepted: true } }));
        return;
      case "session/page":
        response.end(envelope(body.rpcId, {
          ok: true,
          value: {
            records: [{ type: "event", event: { type: "user/message", seq: 1, time: 7, data: {} } }],
            hasMore: false,
          },
        }));
        return;
      default:
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not_found" }));
    }
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (address === null || typeof address === "string") throw new Error("server address missing");
const gateway = createOfficialSessionGateway({ baseUrl: `http://127.0.0.1:${address.port}` });

assert.deepEqual(await gateway.list({}), { ok: true, value: { items: [{ sessionId: "a" }] } });
assert.deepEqual((await gateway.state("a")).ok, true);
assert.deepEqual(await gateway.projections("a"), { ok: true, value: { kind: "sequenced", asOfSeq: 1, values: { usage: { inputTokens: 2 } } } });
assert.deepEqual(await gateway.create({ sessionId: "created" }), { ok: true, value: { sessionId: "created" } });
assert.deepEqual(await gateway.fork({ sessionId: "a" }), { ok: true, value: { sessionId: "forked" } });
assert.deepEqual(await gateway.fork({ sessionId: "a", atSeq: 5, allowMigration: false }), { ok: true, value: { sessionId: "forked" } });
assert.deepEqual(await gateway.rename("a", "renamed"), { ok: true, value: { title: "renamed", seq: 3 } });
assert.deepEqual(await gateway.selectModel({ sessionId: "a", provider: "deepseek-official", model: "deepseek-flash" }), {
  ok: true,
  value: { selected: { provider: "deepseek-official", model: "deepseek-flash" } },
});
assert.deepEqual(await gateway.modelCatalog(), { ok: true, value: { default: { provider: "deepseek-official", model: "deepseek-flash" }, routableProviders: [], groups: [], failures: [] } });
assert.deepEqual(await gateway.cancel("a"), { ok: true, value: { accepted: true } });
assert.deepEqual(await gateway.prompt({
  sessionId: "a",
  requestId: "req-1",
  mode: "queue",
  content: [{ type: "text", text: "hi" }],
  clientTimeZone: "Asia/Shanghai",
}), { ok: true, value: { accepted: true, submissionId: "sub-1" } });
assert.deepEqual(await gateway.updateQueue({
  sessionId: "a",
  itemId: "item-1",
  action: { kind: "edit", content: [{ type: "text", text: "edited" }] },
}), { ok: true, value: { accepted: true } });
assert.deepEqual(await gateway.page({
  sessionId: "a",
  throughSeq: 12,
  beforeSeq: 7,
  maxMessages: 3,
  turnWindow: { minMessages: 2, minTurns: 1 },
}), {
  ok: true,
  value: {
    records: [{ type: "event", event: { type: "user/message", seq: 1, time: 7, data: {} } }],
    hasMore: false,
  },
});

const missing = await gateway.state("missing");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.error.code, "session/not-found");

const missingServer = createServer((_request, response) => {
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});
missingServer.listen(0, "127.0.0.1");
await once(missingServer, "listening");
const missingAddress = missingServer.address();
if (missingAddress === null || typeof missingAddress === "string") throw new Error("missing server address");
const unavailable = createOfficialSessionGateway({ baseUrl: `http://127.0.0.1:${missingAddress.port}` });
await assert.rejects(() => unavailable.list({}), (error: unknown) => isOfficialEndpointUnavailable(error));
missingServer.close();
assert.equal(seen.length, 14);
const listPayload = seen[0]?.payload as { args: { _request: unknown } };
assert.deepEqual(listPayload.args, { _request: {} });
const statePayload = seen[1]?.payload as { args: { request: unknown } };
assert.deepEqual(statePayload.args, { request: { sessionId: "a" } });
const selectPayload = seen[7]?.payload as { args: { request: unknown } };
assert.deepEqual(selectPayload.args, { request: { sessionId: "a", provider: "deepseek-official", model: "deepseek-flash" } });
const forkAtSeqPayload = seen[5]?.payload as { args: { request: unknown } };
assert.deepEqual(forkAtSeqPayload.args, { request: { sessionId: "a", atSeq: 5, allowMigration: false } });
const promptPayload = seen[10]?.payload as { args: { request: unknown } };
const updateQueuePayload = seen[11]?.payload as { args: { request: unknown } };
assert.deepEqual(updateQueuePayload.args, {
  request: {
    sessionId: "a",
    itemId: "item-1",
    action: { kind: "edit", content: [{ type: "text", text: "edited" }] },
  },
});
assert.deepEqual(promptPayload.args, {
  request: {
    sessionId: "a",
    requestId: "req-1",
    mode: "queue",
    content: [{ type: "text", text: "hi" }],
    clientTimeZone: "Asia/Shanghai",
  },
});
const pagePayload = seen[12]?.payload as { args: { request: unknown } };
assert.deepEqual(pagePayload.args, {
  request: {
    address: { kind: "session", sessionId: "a" },
    throughSeq: 12,
    beforeSeq: 7,
    maxMessages: 3,
    turnWindow: { minMessages: 2, minTurns: 1 },
  },
});
assert.equal(SESSION_REMOTE_ENDPOINTS.page, "session/page");
assert.equal(SESSION_REMOTE_ENDPOINTS.prompt, "session/prompt");
assert.equal(SESSION_REMOTE_ENDPOINTS.updateQueue, "session/updateQueue");

const connectionCalls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
const connected = createOfficialSessionGateway({
  baseUrl: "http://invalid.local",
  connection: () => ({
    rpc: {
      call: async (channel: string, endpoint: string, payload: unknown) => {
        connectionCalls.push({ channel, endpoint, payload });
        return { ok: true, value: { items: [] } };
      },
    },
  }) as never,
});
assert.deepEqual(await connected.list(), { ok: true, value: { items: [] } });
assert.deepEqual(connectionCalls, [{ channel: "/api", endpoint: "session/list", payload: { args: { _request: {} } } }]);

assert.equal(isOfficialEndpointUnavailable({ status: 404 }), true);
assert.equal(isOfficialEndpointUnavailable({ code: "gateway/endpoint-unavailable" }), true);
assert.equal(isOfficialEndpointUnavailable(new Error("transport failure for /api/session/list: HTTP 405")), true);
assert.equal(isOfficialEndpointUnavailable({ code: "session/not-found" }), false);
assert.deepEqual(SESSION_REMOTE_DESCRIPTOR, { namespace: "session", methods: Object.keys(SESSION_REMOTE_ENDPOINTS) });

server.close();
console.log("session-host: official session gateway passed");
