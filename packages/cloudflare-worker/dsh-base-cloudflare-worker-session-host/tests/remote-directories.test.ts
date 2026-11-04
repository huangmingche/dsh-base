/** Real SQLite + official RPC test for owner logical directory browsing. */
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
const { registerDirectoryPickerRemoteEndpoints } = await import("../src/remote-directories.ts");
const { registerSessionRemoteEndpoints } = await import("../src/remote.ts");
const db = new DatabaseSync(":memory:");
const sql = {
  exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; },
  transactionSync<T>(operation: () => T): T { db.exec("BEGIN"); try { const result = operation(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
};
let host = new SessionHost(new SqliteSessionHostStorage(sql), []);
const stub = { async fetch(request: Request) {
  if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
  return Response.json(await dispatchSessionHost(host, await request.json()));
} };
const invocation = { request: new Request("https://host/api/directoryPicker/list"), env: { SESSION_HOST: { idFromName: (name: string) => name, get: () => stub } }, user: { id: "directory-owner" } };
const handlers = new Map<string, (payload: unknown, invocation: unknown) => Promise<any>>();
const rpc = { register(method: string, handler: any) { handlers.set(method, handler); return () => handlers.delete(method); } };
const dispose = registerDirectoryPickerRemoteEndpoints(rpc as never);
registerSessionRemoteEndpoints(rpc as never);
const call = (method: string, args: Record<string, unknown> = {}, context: unknown = invocation) => handlers.get(method)!({ args }, context);
const rejects = (method: string, args: Record<string, unknown>, code: string) => assert.rejects(call(method, args), (error: any) => error.code === code);

assert.deepEqual(await call("directoryPicker/list"), { path: "/", home: "/", crumbs: [{ name: "/", path: "/", hidden: false }], entries: [], truncated: false });
// An old Workspace row is browsable without a backfill or altering its identity.
db.prepare("INSERT INTO dsh_session_host_workspaces VALUES (?, ?, ?, ?, ?, ?)").run("legacy", "Legacy", "/legacy/nested", 1, 1, 1);
assert.equal((await call("directoryPicker/list")).entries[0].path, "/legacy");
assert.deepEqual((await call("directoryPicker/list", { path: "/legacy/nested/../nested/" })).crumbs.map((row: any) => row.path), ["/", "/legacy", "/legacy/nested"]);
const before = (await host.workspaceState()).items.length;
assert.equal(await call("directoryPicker/createDirectory", { path: "/legacy", name: "new folder" }), "/legacy/new folder");
assert.equal((await host.workspaceState()).items.length, before, "creating a directory must not register a sidebar Workspace");
assert.equal(await call("directoryPicker/createDirectory", { path: "/legacy/new folder", name: ".hidden" }), "/legacy/new folder/.hidden");
host = new SessionHost(new SqliteSessionHostStorage(sql), []);
const listing = await call("directoryPicker/list", { path: "/legacy/new folder" });
assert.deepEqual(listing.entries, [{ name: ".hidden", path: "/legacy/new folder/.hidden", hidden: true }]);
assert.equal(listing.home, "/");
assert.equal(listing.truncated, false);
const concurrent = await Promise.allSettled([call("directoryPicker/createDirectory", { path: "/", name: "race" }), call("directoryPicker/createDirectory", { path: "/", name: "race" })]);
assert.equal(concurrent.filter(row => row.status === "fulfilled").length, 1);
assert.equal((concurrent.find(row => row.status === "rejected") as PromiseRejectedResult).reason.code, "directory-picker/exists");
await rejects("directoryPicker/list", { path: "/missing" }, "directory-picker/unreadable");
await rejects("directoryPicker/list", { path: "relative" }, "directory-picker/unreadable");
await rejects("directoryPicker/list", { path: 42 }, "gateway/bad-request");
await rejects("directoryPicker/createDirectory", { path: "/missing", name: "child" }, "directory-picker/create-failed");
for (const name of ["", " ", ".", "..", "a/b", "a\\b", "a\u0000b"]) await rejects("directoryPicker/createDirectory", { path: "/", name }, "gateway/bad-request");
await assert.rejects(call("directoryPicker/createDirectory", { path: "/", name: "race" }), (error: any) => error.details.path === "/race");
await assert.rejects(call("directoryPicker/pick"), (error: any) => error.code === "directory-picker/unavailable" && error.details.capability === "browse");
const aborted = new AbortController(); aborted.abort();
await assert.rejects(call("directoryPicker/list", {}, { ...invocation, request: new Request("https://host/api/directoryPicker/list", { signal: aborted.signal }) }), (error: any) => error.code === "gateway/cancelled");

const chosen = await host.workspaceCreate({ path: "/legacy/new folder" });
assert.equal(chosen.created, true);
await host.workspaceDelete({ workspaceId: chosen.workspace.workspaceId });
assert.equal((await call("directoryPicker/list", { path: "/legacy/new folder" })).path, "/legacy/new folder");
const created = await call("session/create", { request: { sessionId: "think-session", agentPreset: "dsh-base-think" } });
assert.equal(created.agentPreset, "dsh-base-think");
const defaulted = await call("session/create", { request: { sessionId: "default-think" } });
assert.equal(defaulted.agentPreset, "dsh-base-think");
for (const agentPreset of ["standard", "ptc", "minimal", "cordis", "custom-invented"]) {
  await rejects("session/create", { request: { sessionId: `reject-${agentPreset}`, agentPreset } }, "gateway/endpoint-unavailable");
  assert.equal((await host.list({})).sessions.some(row => row.sessionId === `reject-${agentPreset}`), false);
}
dispose();
assert.equal(handlers.has("directoryPicker/list"), false);
console.log("session-host: durable logical directories, official RPC errors, concurrency, native unavailability and fixed preset admission passed");
