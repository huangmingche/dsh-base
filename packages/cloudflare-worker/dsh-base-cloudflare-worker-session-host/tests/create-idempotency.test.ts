/** Official blank reuse and raw retry invariants through real SQLite and RPC. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@dsh-base/session-wire") return { url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SessionHost } = await import("../src/host.ts");
const { SqliteSessionHostStorage } = await import("../src/sqlite-storage.ts");
const { dispatchSessionHost } = await import("../src/service.ts");
const { registerSessionRemoteEndpoints } = await import("../src/remote.ts");
const db = new DatabaseSync(":memory:");
let failPlacement = false;
const sql = {
  exec(query: string, ...bindings: unknown[]) {
    if (failPlacement && query.startsWith("INSERT INTO dsh_session_host_workspace_sessions")) throw new Error("placement fault");
    const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
    return { toArray: () => rows };
  },
  transactionSync<T>(operation: () => T): T {
    db.exec("BEGIN");
    try { const value = operation(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  },
};
const catalog = [{ id: "deepseek-flash", label: "Flash" }, { id: "deepseek-v4-pro", label: "Pro" }];
let storage = new SqliteSessionHostStorage(sql);
let host = new SessionHost(storage, catalog);
const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<any>>();
registerSessionRemoteEndpoints({ register(method: string, handler: any) { handlers.set(method, handler); return () => {}; } } as never);
const invocation = { request: new Request("https://host/api/session/create"), env: { SESSION_HOST: {
  idFromName: (name: string) => name, get: () => ({ async fetch(request: Request) {
    if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
    return Response.json(await dispatchSessionHost(host, await request.json()));
  } }),
} }, user: { id: "create-owner" } };
const official = (request: Record<string, unknown>) => handlers.get("session/create")!({ args: { request } }, invocation);
const unchanged = async (id: string) => ({
  record: await storage.getSession(id), history: await storage.readAllMessages(id),
  queue: await storage.listSubmissions(id), projections: await storage.getProjections(id),
  membership: (await storage.listMemberships()).filter(row => row.sessionId === id),
  flags: (await storage.listSessionFlags())[id], events: await storage.listEvents(id, 0, 100),
});

await host.create({ sessionId: "named", title: "Initial" });
await host.selectModel({ sessionId: "named", model: "deepseek-official/deepseek-v4-pro" });
await host.rename({ sessionId: "named", title: "Renamed before first send" });
const blank = await unchanged("named");
const savedModelProjection = { lastUsed: null, next: { provider: "deepseek-official", model: "deepseek-official/deepseek-v4-pro", reasoningEffort: "high" } };
assert.deepEqual((await host.projections({ sessionId: "named" })).modelSelection, savedModelProjection);
const officialProjection = await handlers.get("session/projections")!({ args: { request: { sessionId: "named" } } }, invocation);
assert.deepEqual(officialProjection.values.modelSelection, savedModelProjection, "raw Host and official unary expose the same durable model fold");
const reused = await Promise.all(Array.from({ length: 6 }, () => official({ sessionId: "named", workspaceId: "default" })));
assert.ok(reused.every(result => result.sessionId === "named"));
assert.deepEqual(await unchanged("named"), blank, "official composer create must preserve a blank Session's Pro/title/timestamps/placement");
assert.equal((await storage.listMemberships()).filter(row => row.sessionId === "named").length, 1);

const creates = await Promise.all(Array.from({ length: 6 }, (_, index) => host.create({ sessionId: "concurrent", title: `candidate ${index}` })));
assert.ok(creates.every(result => result.sessionId === "concurrent"));
assert.equal((await storage.listSessions()).filter(row => row.sessionId === "concurrent").length, 1);
assert.equal((await storage.listMemberships()).filter(row => row.sessionId === "concurrent").length, 1);

// Preserve real admitted history, queue, running state and projections even
// when legacy clients retry create with different title/default arguments.
await host.prompt({ sessionId: "named", requestId: "first", text: "original question" });
await storage.appendMessages("named", [{ id: "answer", seq: 2, role: "assistant", parts: [{ type: "text", text: "original answer" }] }]);
await storage.putProjections("named", { usage: { input: 10, output: 3 } });
const active = await unchanged("named");
await Promise.all(Array.from({ length: 4 }, () => host.create({ sessionId: "named", title: "must not overwrite", workspaceId: "default" })));
assert.deepEqual(await unchanged("named"), active);
const minted = await official({ sessionId: "named", workspaceId: "default" });
assert.notEqual(minted.sessionId, "named");
assert.equal((await storage.getSession(minted.sessionId))?.blank, true);
assert.deepEqual(await unchanged("named"), active, "official create must return a real fresh Session without mutating its active source");

await host.create({ sessionId: "archived" });
await host.workspaceSetFlags({ sessionId: "archived", archived: true });
const archived = await unchanged("archived");
assert.notEqual((await official({ sessionId: "archived", workspaceId: "default" })).sessionId, "archived");
assert.deepEqual(await unchanged("archived"), archived);

const other = (await host.workspaceCreate({ path: "/other" })).workspace;
for (const create of [() => official({ sessionId: "named", workspaceId: other.workspaceId }), () => host.create({ sessionId: "named", cwd: "/other" }), () => official({ sessionId: "named", cwd: "/unregistered" })]) {
  await assert.rejects(create(), (error: any) => error.code === "session/conflict");
  assert.deepEqual(await unchanged("named"), active);
}
// Two registered workspace identities can share a legacy path: official reuse
// requires membership as well as cwd, and must mint rather than move the source.
await storage.putWorkspace({ workspaceId: "same-path", path: "/", title: "Legacy", position: 9, createdAt: 1, updatedAt: 1 });
const movedHint = await official({ sessionId: "concurrent", workspaceId: "same-path" });
assert.notEqual(movedHint.sessionId, "concurrent");
assert.equal((await storage.listMemberships()).find(row => row.sessionId === "concurrent")?.workspaceId, "default");
assert.equal((await storage.listMemberships()).find(row => row.sessionId === movedHint.sessionId)?.workspaceId, "same-path");

const countBefore = (await storage.listSessions()).length;
await assert.rejects(official({ sessionId: "bad", workspaceId: "default", cwd: "/" }), (error: any) => error.code === "gateway/bad-request");
await assert.rejects(official({ sessionId: "bad", workspaceId: "missing" }), (error: any) => error.code === "workspace/not-found");
await assert.rejects(official({ sessionId: "bad", cwd: "/unregistered" }), (error: any) => error.code === "gateway/endpoint-unavailable");
const invalid = await dispatchSessionHost(host, { method: "create", params: { sessionId: 42 } });
assert.equal("error" in invalid && invalid.error.code, "gateway/bad-request");
assert.equal((await storage.listSessions()).length, countBefore);
assert.equal((await host.workspaceState()).items.some(row => row.path === "/unregistered"), false);

// No published half-session after its placement write fails. Retry after a
// fresh storage/Host instance preserves atomic identity and placement.
failPlacement = true;
await assert.rejects(host.create({ sessionId: "fault-window", workspaceId: other.workspaceId }), /placement fault/);
assert.equal(await storage.getSession("fault-window"), undefined);
failPlacement = false;
storage = new SqliteSessionHostStorage(sql); host = new SessionHost(storage, catalog);
await host.create({ sessionId: "fault-window", workspaceId: other.workspaceId });
const afterRecovery = await unchanged("fault-window");
assert.equal(afterRecovery.membership[0]?.workspaceId, other.workspaceId);
await host.create({ sessionId: "fault-window" });
assert.deepEqual(await unchanged("fault-window"), afterRecovery);
console.log("session create: real SQLite atomic/racing retries preserve model/title/history/queue/state/timestamps; official blank reuse, fresh-id policy, placement conflicts and failure rollback passed");
