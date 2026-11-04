import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

// The Worker build resolves workspace packages through Vite aliases; these
// plain-Node tests run without an installed workspace tree. The session bridge
// imports `@dsh-base/session-wire`, so resolve it before the workspace bridge.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dsh-base/session-wire") {
      return {
        url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { SessionHost } = await import("../src/host.ts");
const { SqliteSessionHostStorage } = await import("../src/sqlite-storage.ts");
const { dispatchSessionHost } = await import("../src/service.ts");
const { HostChangeFeed, observeHostWrites, invalidationResponse } = await import('../src/change-feed.ts');
const {
  registerWorkspaceRemoteEndpoints,
  registerWorkspaceStreamEndpoints,
  toWorkspaceBaseline,
  toWorkspaceView,
} = await import("../src/remote-workspace.ts");

interface SqlCursorLike {
  toArray(): Array<Record<string, unknown>>;
}

/** `node:sqlite` executor used by the storage adapter in this test. */
class NodeSqlStorage {
  private readonly db = new DatabaseSync(":memory:");

  exec(query: string, ...bindings: readonly unknown[]): SqlCursorLike {
    const statement = this.db.prepare(query);
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = statement.all(...bindings) as Array<Record<string, unknown>>;
    } catch {
      statement.run(...bindings);
    }
    return { toArray: () => rows };
  }
}

/**
 * Fake Worker binding that serves the one-time migration probe and dispatches
 * `/api/session-host` into a real `SessionHost` over in-memory SQLite.
 */
function createFakeWorker() {
  const changes = new HostChangeFeed();
  let stateReads = 0;
  let failStateRead = false;
  const host = new SessionHost(new SqliteSessionHostStorage(observeHostWrites(new NodeSqlStorage(), changes)), [
    { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", contextWindow: 128_000 },
  ]);
  const stub = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/api/session-host/migrate/status") return Response.json({ migrated: true });
      if (url.pathname === "/api/session-host/migrate/export") return Response.json({ tables: {} });
      if (url.pathname === "/api/session-host/changes") return invalidationResponse(changes, request.signal);
      if (url.pathname === "/api/session-host") {
        const body = await request.json() as { method?: unknown; params?: unknown };
        if (body.method === 'workspaceState') {
          stateReads++;
          if (failStateRead) return Response.json({ error: { code: 'invalid_request', message: 'workspace state unavailable' } });
        }
        return Response.json(await dispatchSessionHost(host, body as never));
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  };
  const namespace = {
    idFromName(name: string): string { return name; },
    get(_id: unknown): typeof stub { return stub; },
  };
  return { host, changes, reads: () => stateReads, fail: () => { failStateRead = true; }, env: { SESSION_HOST: namespace } };
}

const worker = createFakeWorker();
const { host, env } = worker;
const invocation = {
  request: new Request("https://session-host/api/workspace", { method: "POST" }),
  env,
  user: { id: "test-owner" },
  method: "workspace/create",
  rpcId: "rpc-1",
};
const streamInvocation = {
  ...invocation,
  method: "workspace/follow",
  rpcId: "stream-1",
};

// --- registration inventory -------------------------------------------------

const handlers = new Map<string, (payload: unknown, context: unknown) => Promise<unknown>>();
const streams = new Map<string, (payload: unknown, context: unknown) => AsyncIterable<unknown>>();
const wireRpc = {
  register(method: string, handler: (payload: unknown, context: unknown) => Promise<unknown>) {
    handlers.set(method, handler);
    return () => { handlers.delete(method); };
  },
};
const wireStream = {
  register(endpoint: string, handler: (payload: unknown, context: unknown) => AsyncIterable<unknown>) {
    streams.set(endpoint, handler);
    return () => { streams.delete(endpoint); };
  },
};
const disposeUnary = registerWorkspaceRemoteEndpoints(wireRpc as never);
const disposeStream = registerWorkspaceStreamEndpoints(wireStream as never);

assert.deepEqual([...handlers.keys()].sort(), [
  "workspace/archiveSession",
  "workspace/create",
  "workspace/delete",
  "workspace/initializeDefault",
  "workspace/insertBefore",
  "workspace/insertSessionBefore",
  "workspace/pinSession",
  "workspace/rename",
  "workspace/unarchiveSession",
  "workspace/unpinSession",
]);
assert.deepEqual([...streams.keys()], ["workspace/follow"]);

/** Invoke one registered unary endpoint with its official `{ args }` payload. */
async function call(endpoint: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const handler = handlers.get(endpoint);
  assert.ok(handler !== undefined, `${endpoint} is registered`);
  return await handler({ args }, invocation) as Record<string, unknown>;
}

/** Assert one endpoint rejects with a stable Remote failure code. */
async function rejects(endpoint: string, payload: unknown, code: string): Promise<void> {
  const handler = handlers.get(endpoint);
  assert.ok(handler !== undefined, `${endpoint} is registered`);
  await assert.rejects(
    () => Promise.resolve(handler(payload, invocation)),
    (error: unknown) => (error as { code?: unknown }).code === code,
  );
}

// --- payload validation -----------------------------------------------------

await rejects("workspace/create", {}, "gateway/arguments-invalid");
await rejects("workspace/create", { args: { request: {} } }, "gateway/bad-request");
await rejects("workspace/rename", { args: { request: { workspaceId: "" } } }, "gateway/bad-request");
await rejects("workspace/delete", { args: { request: {} } }, "gateway/bad-request");
await rejects("workspace/insertBefore", { args: { request: {} } }, "gateway/bad-request");
await rejects("workspace/archiveSession", { args: { request: { sessionId: "s1", stopActivity: "yes" } } }, "gateway/bad-request");
await rejects("workspace/insertSessionBefore", { args: { request: { workspaceId: "w", sessionId: "s", beforeSessionId: 7 } } }, "gateway/bad-request");

// --- create / initializeDefault / rename ------------------------------------

const created = await call("workspace/create", { request: { path: "/work/alpha" } });
const alpha = created.workspace as Record<string, unknown>;
assert.equal(created.created, true);
assert.equal(alpha.path, "/work/alpha");
assert.equal(alpha.title, "alpha");
assert.deepEqual(alpha.sessionIds, []);
assert.equal(typeof alpha.workspaceId, "string");
assert.equal(Number.isNaN(Date.parse(String(alpha.createdAt))), false);
assert.equal(Number.isNaN(Date.parse(String(alpha.updatedAt))), false);

const idempotent = await call("workspace/create", { request: { path: "/work/alpha" } });
assert.equal(idempotent.created, false);
assert.equal((idempotent.workspace as Record<string, unknown>).workspaceId, alpha.workspaceId);

const beta = (await call("workspace/create", { request: { path: "/work/beta" } })).workspace as Record<string, unknown>;
const initialized = await call("workspace/initializeDefault");
assert.equal((initialized.workspace as Record<string, unknown>).workspaceId, "default");

const renamed = await call("workspace/rename", {
  request: { workspaceId: beta.workspaceId, title: "Beta Renamed" },
});
assert.equal((renamed.workspace as Record<string, unknown>).title, "Beta Renamed");
await rejects("workspace/rename", { args: { request: { workspaceId: "missing", title: "X" } } }, "workspace/not-found");

// --- order mutations --------------------------------------------------------

const movedFirst = await call("workspace/insertBefore", {
  request: { workspaceId: beta.workspaceId, beforeWorkspaceId: "default" },
});
assert.deepEqual((movedFirst.workspaceIds as string[]).slice(0, 2), [beta.workspaceId, "default"]);
const appended = await call("workspace/insertBefore", {
  request: { workspaceId: beta.workspaceId },
});
assert.equal((appended.workspaceIds as string[]).at(-1), beta.workspaceId);
await rejects("workspace/insertBefore", { args: { request: { workspaceId: "missing" } } }, "workspace/not-found");

await host.create({ sessionId: "s1" });
await host.create({ sessionId: "s2" });
const sessionOrder = await call("workspace/insertSessionBefore", {
  request: { workspaceId: "default", sessionId: "s2", beforeSessionId: "s1" },
});
assert.deepEqual((sessionOrder.workspace as Record<string, unknown>).sessionIds, ["s2", "s1"]);
await rejects(
  "workspace/insertSessionBefore",
  { args: { request: { workspaceId: "default", sessionId: "s3" } } },
  "workspace/move-invalid",
);
await rejects(
  "workspace/insertSessionBefore",
  { args: { request: { workspaceId: "missing", sessionId: "s1" } } },
  "workspace/not-found",
);

// --- archive / unarchive / pin ---------------------------------------------

const archived = await call("workspace/archiveSession", {
  request: { sessionId: "s1", stopActivity: true },
});
assert.deepEqual(archived.archivedSessionIds, ["s1"]);
await rejects("workspace/archiveSession", { args: { request: { sessionId: "missing" } } }, "session/not-found");

const pinnedFirst = await call("workspace/pinSession", { request: { sessionId: "s2" } });
assert.deepEqual(pinnedFirst.pinnedSessionIds, ["s2"]);
await rejects("workspace/pinSession", { args: { request: { sessionId: "s1" } } }, "gateway/bad-request");

const unarchived = await call("workspace/unarchiveSession", { request: { sessionId: "s1" } });
assert.deepEqual(unarchived.archivedSessionIds, []);
const idempotentUnarchive = await call("workspace/unarchiveSession", { request: { sessionId: "missing" } });
assert.deepEqual(idempotentUnarchive.archivedSessionIds, []);

const pinnedSecond = await call("workspace/pinSession", { request: { sessionId: "s1" } });
assert.deepEqual(pinnedSecond.pinnedSessionIds, ["s1", "s2"]);
const unpinned = await call("workspace/unpinSession", { request: { sessionId: "s2" } });
assert.deepEqual(unpinned.pinnedSessionIds, ["s1"]);
const repinned = await call("workspace/pinSession", { request: { sessionId: "s2" } });
assert.deepEqual(repinned.pinnedSessionIds, ["s2", "s1"]);
const idempotentUnpin = await call("workspace/unpinSession", { request: { sessionId: "missing" } });
assert.deepEqual(idempotentUnpin.pinnedSessionIds, ["s2", "s1"]);

// --- delete -----------------------------------------------------------------

const deleted = await call("workspace/delete", { request: { workspaceId: beta.workspaceId } });
assert.deepEqual(deleted, { deleted: true });
await rejects("workspace/delete", { args: { request: { workspaceId: beta.workspaceId } } }, "workspace/not-found");

// --- mapping helpers --------------------------------------------------------

const baselineValue = await host.workspaceState();
const baseline = toWorkspaceBaseline(baselineValue, "test/baseline");
assert.deepEqual(baseline.items.map((item) => item.workspaceId), ["default", alpha.workspaceId]);
assert.deepEqual(baseline.pinnedSessionIds, ["s2", "s1"]);
assert.deepEqual(toWorkspaceView(baseline.items[0], "test/view"), baseline.items[0]);
assert.throws(
  () => toWorkspaceView({ ...baseline.items[0], createdAt: "yesterday" }, "test/view"),
  (error: unknown) => (error as { code?: unknown }).code === "gateway/result-invalid",
);

// --- follow stream ----------------------------------------------------------

const controller = new AbortController();
const streamHandler = streams.get("workspace/follow");
assert.ok(streamHandler !== undefined, "workspace/follow is registered");
const source = await streamHandler(
  { args: {} },
  {
    ...streamInvocation,
    request: new Request("https://session-host/api/workspace/follow", { signal: controller.signal }),
  },
);
const iterator = source[Symbol.asyncIterator]();
const first = await iterator.next();
const baselineFrame = first.value as { type: string; value: { items: Array<{ workspaceId: string }>; pinnedSessionIds: string[] } };
assert.equal(baselineFrame.type, "baseline");
assert.deepEqual(baselineFrame.value.items.map((item) => item.workspaceId), ["default", alpha.workspaceId]);
assert.deepEqual(baselineFrame.value.pinnedSessionIds, ["s2", "s1"]);

const unpinForStream = call("workspace/unpinSession", { request: { sessionId: "s1" } });
const second = await iterator.next();
const replaceFrame = second.value as { type: string; value: { pinnedSessionIds: string[] } };
assert.equal(replaceFrame.type, "replace");
assert.deepEqual(replaceFrame.value.pinnedSessionIds, ["s2"]);
await unpinForStream;

controller.abort();
const ended = await iterator.next();
assert.equal(ended.done, true);

// Reconnection reads current durable state; identical notifications do not
// produce extra UI frames, and idle time does not poll workspaceState.
const reconnectAbort = new AbortController();
const reconnect = (await streamHandler({ args: {} }, { ...streamInvocation, request: new Request('https://session-host/api/workspace/follow', { signal: reconnectAbort.signal }) }))[Symbol.asyncIterator]();
assert.deepEqual((await reconnect.next()).value, replaceFrame.type === 'replace' ? { type: 'baseline', value: replaceFrame.value } : undefined);
let delivered = false;
const waiting = reconnect.next().then(value => { delivered = true; return value; });
await new Promise(resolve => setTimeout(resolve, 10));
worker.changes.publish(['sessions']);
await new Promise(resolve => setTimeout(resolve, 10));
const readsAfterDuplicate = worker.reads();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(worker.reads(), readsAfterDuplicate, 'idle follow must not poll the Host');
assert.equal(delivered, false, 'identical state notifications cannot publish duplicate replace frames');
worker.fail();
worker.changes.publish(['sessions']);
await assert.rejects(waiting, (error: unknown) => (error as { code?: unknown }).code === 'gateway/bad-request', 'post-baseline errors must reach the carrier');
await reconnect.return?.();
const readsAfterClose = worker.reads();
worker.changes.publish(['sessions']);
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(worker.reads(), readsAfterClose, 'closed generation released its subscription');

// A generation that cannot read its baseline fails explicitly.
const failingEnv = {
  SESSION_HOST: {
    idFromName(name: string): string { return name; },
    get(_id: unknown) {
      return {
        async fetch(request: Request): Promise<Response> {
          const url = new URL(request.url);
          if (url.pathname === "/api/session-host/migrate/status") return Response.json({ migrated: true });
          if (url.pathname === '/api/session-host/changes') return invalidationResponse(new HostChangeFeed(), request.signal);
          return Response.json({ error: { code: "invalid_request", message: "workspace state unavailable" } });
        },
      };
    },
  },
};
const failingHandler = streams.get("workspace/follow");
assert.ok(failingHandler !== undefined, "workspace/follow is registered");
const failingSource = await failingHandler(
  { args: {} },
  {
    ...streamInvocation,
    env: failingEnv,
    request: new Request("https://session-host/api/workspace/follow"),
  },
);
await assert.rejects(
  () => failingSource[Symbol.asyncIterator]().next(),
  (error: unknown) => (error as { code?: unknown }).code === "gateway/bad-request",
);

// --- disposal ---------------------------------------------------------------

disposeUnary();
disposeStream();
assert.equal(handlers.size, 0);
assert.equal(streams.size, 0);

console.log("session-host: official workspace RPC bridge and follow stream passed");
