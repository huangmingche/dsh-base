import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createOfficialWorkspaceGateway,
  WORKSPACE_FOLLOW_ENDPOINT,
  WORKSPACE_REMOTE_DESCRIPTOR,
  WORKSPACE_REMOTE_ENDPOINTS,
} from "../src/workspace-gateway.ts";
import { isOfficialEndpointUnavailable } from "../src/gateway.ts";
import type { WireStreamSocketLike } from "../src/wire-stream.ts";

interface SeenRequest {
  readonly method: string;
  readonly payload: unknown;
}

const seen: SeenRequest[] = [];
const workspace = {
  workspaceId: "ws-1",
  path: "/work/alpha",
  title: "alpha",
  sessionIds: ["s-1"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

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
      case "workspace/create":
        response.end(envelope(body.rpcId, { ok: true, value: { workspace, created: true } }));
        return;
      case "workspace/initializeDefault":
        response.end(envelope(body.rpcId, { ok: true, value: { workspace } }));
        return;
      case "workspace/rename":
        response.end(envelope(body.rpcId, { ok: true, value: { workspace } }));
        return;
      case "workspace/delete":
        response.end(envelope(body.rpcId, { ok: true, value: { deleted: true } }));
        return;
      case "workspace/insertBefore":
        response.end(envelope(body.rpcId, { ok: true, value: { workspaceIds: ["ws-2", "ws-1"] } }));
        return;
      case "workspace/insertSessionBefore":
        response.end(envelope(body.rpcId, { ok: true, value: { workspace } }));
        return;
      case "workspace/archiveSession":
        response.end(envelope(body.rpcId, { ok: true, value: { archivedSessionIds: ["s-1"] } }));
        return;
      case "workspace/unarchiveSession":
        response.end(envelope(body.rpcId, { ok: true, value: { archivedSessionIds: [] } }));
        return;
      case "workspace/pinSession":
        response.end(envelope(body.rpcId, { ok: true, value: { pinnedSessionIds: ["s-1", "s-2"] } }));
        return;
      case "workspace/unpinSession":
        response.end(envelope(body.rpcId, { ok: true, value: { pinnedSessionIds: ["s-2"] } }));
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
const gateway = createOfficialWorkspaceGateway({ baseUrl: `http://127.0.0.1:${address.port}` });

assert.deepEqual(await gateway.create({ path: "/work/alpha" }), {
  ok: true,
  value: { workspace, created: true },
});
assert.deepEqual(await gateway.initializeDefault(), { ok: true, value: { workspace } });
assert.deepEqual(await gateway.rename({ workspaceId: "ws-1", title: "alpha" }), { ok: true, value: { workspace } });
assert.deepEqual(await gateway.delete({ workspaceId: "ws-1" }), { ok: true, value: { deleted: true } });
assert.deepEqual(await gateway.insertBefore({ workspaceId: "ws-1", beforeWorkspaceId: "ws-2" }), {
  ok: true,
  value: { workspaceIds: ["ws-2", "ws-1"] },
});
assert.deepEqual(await gateway.insertBefore({ workspaceId: "ws-1" }), {
  ok: true,
  value: { workspaceIds: ["ws-2", "ws-1"] },
});
assert.deepEqual(await gateway.insertSessionBefore({ workspaceId: "ws-1", sessionId: "s-2", beforeSessionId: "s-1" }), {
  ok: true,
  value: { workspace },
});
assert.deepEqual(await gateway.insertSessionBefore({ workspaceId: "ws-1", sessionId: "s-2" }), {
  ok: true,
  value: { workspace },
});
assert.deepEqual(await gateway.archiveSession({ sessionId: "s-1", stopActivity: true }), {
  ok: true,
  value: { archivedSessionIds: ["s-1"] },
});
assert.deepEqual(await gateway.unarchiveSession({ sessionId: "s-1" }), {
  ok: true,
  value: { archivedSessionIds: [] },
});
assert.deepEqual(await gateway.pinSession({ sessionId: "s-1" }), {
  ok: true,
  value: { pinnedSessionIds: ["s-1", "s-2"] },
});
assert.deepEqual(await gateway.unpinSession({ sessionId: "s-1" }), {
  ok: true,
  value: { pinnedSessionIds: ["s-2"] },
});

assert.equal(seen.length, 12);
assert.deepEqual((seen[0]?.payload as { args: unknown }).args, { request: { path: "/work/alpha" } });
assert.deepEqual((seen[1]?.payload as { args: unknown }).args, {});
assert.deepEqual((seen[2]?.payload as { args: unknown }).args, { request: { workspaceId: "ws-1", title: "alpha" } });
assert.deepEqual((seen[3]?.payload as { args: unknown }).args, { request: { workspaceId: "ws-1" } });
assert.deepEqual((seen[4]?.payload as { args: unknown }).args, {
  request: { workspaceId: "ws-1", beforeWorkspaceId: "ws-2" },
});
assert.deepEqual((seen[5]?.payload as { args: unknown }).args, { request: { workspaceId: "ws-1" } });
assert.deepEqual((seen[6]?.payload as { args: unknown }).args, {
  request: { workspaceId: "ws-1", sessionId: "s-2", beforeSessionId: "s-1" },
});
assert.deepEqual((seen[7]?.payload as { args: unknown }).args, { request: { workspaceId: "ws-1", sessionId: "s-2" } });
assert.deepEqual((seen[8]?.payload as { args: unknown }).args, { request: { sessionId: "s-1", stopActivity: true } });
assert.deepEqual((seen[9]?.payload as { args: unknown }).args, { request: { sessionId: "s-1" } });
assert.deepEqual((seen[10]?.payload as { args: unknown }).args, { request: { sessionId: "s-1" } });
assert.deepEqual((seen[11]?.payload as { args: unknown }).args, { request: { sessionId: "s-1" } });

// A business failure keeps its code and is not classified as unavailable.
const businessServer = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const body = JSON.parse(raw) as { rpcId?: string };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: false, error: { code: "workspace/not-found", message: "Workspace not found", details: {} } },
    }));
  });
});
businessServer.listen(0, "127.0.0.1");
await once(businessServer, "listening");
const businessAddress = businessServer.address();
if (businessAddress === null || typeof businessAddress === "string") throw new Error("business server address missing");
const failing = createOfficialWorkspaceGateway({ baseUrl: `http://127.0.0.1:${businessAddress.port}` });
const failed = await failing.rename({ workspaceId: "missing", title: "x" });
assert.equal(failed.ok, false);
if (!failed.ok) {
  assert.equal(failed.error.code, "workspace/not-found");
  assert.equal(isOfficialEndpointUnavailable(failed.error), false);
}
businessServer.close();

// A missing route is fallback-eligible.
const missingServer = createServer((_request, response) => {
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});
missingServer.listen(0, "127.0.0.1");
await once(missingServer, "listening");
const missingAddress = missingServer.address();
if (missingAddress === null || typeof missingAddress === "string") throw new Error("missing server address");
const unavailable = createOfficialWorkspaceGateway({ baseUrl: `http://127.0.0.1:${missingAddress.port}` });
await assert.rejects(() => unavailable.create({ path: "/w" }), (error: unknown) => isOfficialEndpointUnavailable(error));
missingServer.close();

// The Connection carrier carries the same official envelope on the same channel.
const connectionCalls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
const connected = createOfficialWorkspaceGateway({
  baseUrl: "http://invalid.local",
  connection: () => ({
    rpc: {
      call: async (channel: string, endpoint: string, payload: unknown) => {
        connectionCalls.push({ channel, endpoint, payload });
        return { ok: true, value: { workspaceIds: [] } };
      },
    },
  }) as never,
});
assert.deepEqual(await connected.insertBefore({ workspaceId: "ws-1" }), { ok: true, value: { workspaceIds: [] } });
assert.deepEqual(connectionCalls, [{
  channel: "/api",
  endpoint: "workspace/insertBefore",
  payload: { args: { request: { workspaceId: "ws-1" } } },
}]);

// Follow opens the official mux endpoint with the empty official args payload.
class FakeSocket implements WireStreamSocketLike {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    queueMicrotask(() => this.emit("open", {}));
  }

  send(data: string): void {
    this.sent.push(data);
    const frame = JSON.parse(data) as { type?: string; streamId?: string };
    if (frame.type === "open" && frame.streamId !== undefined) {
      const value = {
        type: "baseline",
        value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
      };
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({ type: "item", streamId: frame.streamId, value }),
      }));
    }
  }

  close(): void {}

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const socket = new FakeSocket();
const followGateway = createOfficialWorkspaceGateway({
  baseUrl: "https://example.workers.dev",
  socketFactory: () => socket,
});
const controller = new AbortController();
const frames: unknown[] = [];
for await (const frame of followGateway.follow(controller.signal)) {
  frames.push(frame);
  controller.abort();
}
assert.deepEqual(frames, [{
  type: "baseline",
  value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
}]);
const openFrame = JSON.parse(socket.sent[0] ?? "{}") as {
  type?: string;
  endpoint?: string;
  payload?: unknown;
};
assert.equal(openFrame.type, "open");
assert.equal(openFrame.endpoint, "workspace/follow");
assert.deepEqual(openFrame.payload, { args: {} });
assert.equal(JSON.parse(socket.sent.at(-1) ?? "{}").type, "cancel");

assert.equal(WORKSPACE_FOLLOW_ENDPOINT, "workspace/follow");
assert.equal(WORKSPACE_REMOTE_ENDPOINTS.create, "workspace/create");
assert.equal(WORKSPACE_REMOTE_ENDPOINTS.insertSessionBefore, "workspace/insertSessionBefore");
assert.deepEqual(WORKSPACE_REMOTE_DESCRIPTOR, {
  namespace: "workspace",
  methods: Object.keys(WORKSPACE_REMOTE_ENDPOINTS),
  stream: "workspace/follow",
});

server.close();
console.log("session-host: official workspace gateway passed");
