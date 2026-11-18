import assert from "node:assert/strict";
import { FakeR2, NodeSqlStorage, createFileReadFixture } from "./workspace-file-roundtrip.ts";
import { createDurableObjectSessionHost } from "../src/durable-object.ts";
import type { WireHandler } from "@dsh-base/cloudflare-worker-wire-rpc";
import { SESSION_HOST_STORAGE_ID } from "../src/migration.ts";
import { registerWorkspaceFilesRemoteEndpoints } from "../src/remote-workspace-files.ts";
import { SessionHost } from "../src/host.ts";
import { dispatchSessionHost } from "../src/service.ts";
import { SqliteSessionHostStorage } from "../src/sqlite-storage.ts";
import {
  DEFAULT_BYTE_WINDOW,
  DEFAULT_MEDIA_TYPE,
  DEFAULT_READ_LINES,
  MAX_FILE_BYTES,
  MAX_LIST_ENTRIES,
  MAX_TEXT_BYTES,
  WorkspaceFileError,
  WorkspaceFileStore,
  decodeBase64,
  encodeBase64,
  normalizeWorkspaceRoot,
  workspaceAbsolutePath,
  workspaceRelativePath,
  type WorkspaceFileScope,
} from "../src/workspace-files.ts";

const catalog = [{ id: "test-model", label: "Test Model", contextWindow: 128_000 }];
const sql = new NodeSqlStorage();
const storage = new SqliteSessionHostStorage(sql);
const bucket = new FakeR2();
const sqlAdapter = { exec: (query: string, ...bindings: readonly unknown[]) => sql.exec(query, ...bindings) };
const files = new WorkspaceFileStore(sqlAdapter, bucket, "owner-1");
const host = new SessionHost(storage, catalog, files);
const defaultScope: WorkspaceFileScope = { workspaceId: "default", root: "/" };

/** Run one failing operation and return its stable failure code. */
async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof WorkspaceFileError, `expected WorkspaceFileError, got ${String(error)}`);
    return error.code;
  }
  assert.fail("expected a workspace file failure");
}

/** Decode a wire base64 payload back to byte values. */
function bytesOf(dataBase64: string): number[] {
  return [...Buffer.from(dataBase64, "base64")];
}

// Pure workspace path helpers.
assert.equal(normalizeWorkspaceRoot("/"), "/");
assert.equal(normalizeWorkspaceRoot(""), "/");
assert.equal(normalizeWorkspaceRoot("/workspace-a/"), "/workspace-a");
assert.equal(workspaceAbsolutePath("/", "docs/a.md"), "/docs/a.md");
assert.equal(workspaceAbsolutePath("/workspace-a", "docs/a.md"), "/workspace-a/docs/a.md");
assert.equal(workspaceRelativePath("/", "/docs/a.md"), "docs/a.md");
assert.equal(workspaceRelativePath("/", ""), "");
assert.equal(workspaceRelativePath("/workspace-a", "/workspace-a/docs/a.md"), "docs/a.md");
assert.equal(workspaceRelativePath("/workspace-a", "docs/a.md"), "docs/a.md");
assert.throws(
  () => workspaceRelativePath("/workspace-a", "../escape.md"),
  (error) => error instanceof WorkspaceFileError && error.code === "workspace-file/outside-workspace",
);
assert.throws(
  () => workspaceRelativePath("/", "docs//a.md"),
  (error) => error instanceof WorkspaceFileError && error.code === "gateway/bad-request",
);
assert.deepEqual([...decodeBase64(encodeBase64(Uint8Array.from([0, 1, 254, 255])))], [0, 1, 254, 255]);

// A durable user/assistant history seeds the real transcript file through R2.
await host.create({ sessionId: "wf-default", title: "Files" });
await storage.appendMessages("wf-default", [
  { id: "msg-user", seq: 1, role: "user", parts: [{ type: "text", text: "Show me the workspace" }] },
  { id: "msg-assistant", seq: 2, role: "assistant", parts: [{ type: "text", text: "The workspace is ready." }] },
  { id: "msg-system", seq: 3, role: "system", parts: [{ type: "text", text: "ignored" }] },
]);
const seeded = await host.workspaceFileEnsureTranscript({ sessionId: "wf-default" });
assert.ok(seeded !== undefined);
assert.equal(seeded.absolutePath, "/Conversation.md");
assert.ok(seeded.bytes > 0);
assert.ok(seeded.version.length > 0);
assert.equal(await host.workspaceFileEnsureTranscript({ sessionId: "wf-default" }), undefined);

const root = await host.workspaceFileList({ sessionId: "wf-default", path: "" });
assert.equal(root.path, "");
assert.deepEqual(root.entries.map((entry) => entry.name), ["Conversation.md"]);
assert.equal(root.entries[0]?.type, "file");
assert.equal(root.entries[0]?.size, seeded.bytes);
assert.equal(root.truncated, false);
assert.deepEqual(await host.workspaceFileList({ sessionId: "wf-default", path: "/" }), root);

const stat = await host.workspaceFileStat({ sessionId: "wf-default", path: "/Conversation.md" });
assert.equal(stat.absolutePath, "/Conversation.md");
assert.equal(stat.version, seeded.version);
assert.equal(stat.bytes, seeded.bytes);

const read = await host.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md" });
assert.equal(read.absolutePath, "/Conversation.md");
assert.equal(read.version, stat.version);
assert.equal(read.bytes, stat.bytes);
assert.equal(read.offset, 1);
assert.equal(read.lines, 9);
assert.equal(read.eof, true);
assert.ok(read.text.startsWith("# Conversation transcript\n\n## User\n\nShow me the workspace"));
assert.ok(read.text.includes("## Assistant\n\nThe workspace is ready."));
assert.ok(!read.text.includes("ignored"));
const middle = await host.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md", offset: 3, limit: 2 });
assert.equal(middle.offset, 3);
assert.equal(middle.lines, 2);
assert.equal(middle.text, "## User\n");
assert.equal(middle.eof, false);
const last = await host.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md", offset: 9, limit: 5 });
assert.equal(last.lines, 1);
assert.equal(last.text, "The workspace is ready.");
assert.equal(last.eof, true);
const past = await host.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md", offset: 50 });
assert.equal(past.lines, 0);
assert.equal(past.text, "");
assert.equal(past.eof, true);

// A second write creates the nested directory nodes implicitly.
const todo = Buffer.from("first note\n").toString("base64");
const written = await host.workspaceFileWrite({
  sessionId: "wf-default",
  path: "notes/todo.md",
  dataBase64: todo,
  mediaType: "text/markdown",
});
assert.equal(written.absolutePath, "/notes/todo.md");
assert.equal(written.bytes, 11);
assert.deepEqual(
  (await host.workspaceFileList({ sessionId: "wf-default", path: "/" })).entries.map((entry) => [entry.name, entry.type]),
  [["Conversation.md", "file"], ["notes", "directory"]],
);
assert.deepEqual(await host.workspaceFileList({ sessionId: "wf-default", path: "notes" }), {
  path: "notes",
  entries: [{ name: "todo.md", type: "file", size: 11 }],
  truncated: false,
});
assert.equal((await host.workspaceFileRead({ sessionId: "wf-default", path: "notes/todo.md" })).text, "first note");

// Each rewrite is a new immutable version with its own R2 object; the old one stays.
const objectsBefore = bucket.objects.size;
const rewritten = await host.workspaceFileWrite({
  sessionId: "wf-default",
  path: "/notes/todo.md",
  dataBase64: Buffer.from("second note\n").toString("base64"),
  mediaType: "text/markdown",
});
assert.notEqual(rewritten.version, written.version);
assert.equal(rewritten.bytes, 12);
assert.equal(bucket.objects.size, objectsBefore + 1);
for (const key of bucket.objects.keys()) {
  assert.match(key, /^owner\/owner-1\/workspaces\/default\/versions\/[0-9a-f-]{36}$/);
}
const noteVersions = sql.exec(
  "SELECT version_id FROM dsh_session_host_file_versions WHERE workspace_id = ? AND path = ?",
  "default",
  "notes/todo.md",
).toArray();
assert.equal(noteVersions.length, 2);
const firstVersionObject = [...bucket.objects.keys()].find((key) => key.endsWith(written.version));
assert.ok(firstVersionObject !== undefined);
assert.equal(new TextDecoder().decode(bucket.objects.get(firstVersionObject)), "first note\n");
const currentNode = sql.exec(
  "SELECT version_id FROM dsh_session_host_file_nodes WHERE workspace_id = ? AND path = ?",
  "default",
  "notes/todo.md",
).toArray()[0];
assert.equal(currentNode?.version_id, rewritten.version);
assert.equal((await host.workspaceFileRead({ sessionId: "wf-default", path: "notes/todo.md" })).text, "second note");
assert.equal(
  (await host.workspaceFileStat({ sessionId: "wf-default", path: "notes/todo.md" })).version,
  rewritten.version,
);
const storedMediaType = sql.exec(
  "SELECT media_type FROM dsh_session_host_file_versions WHERE version_id = ?",
  written.version,
).toArray()[0]?.media_type;
assert.equal(storedMediaType, "text/markdown");

// Byte windows round-trip base64 and report EOF at the last byte.
const binary = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const dataWritten = await host.workspaceFileWrite({
  sessionId: "wf-default",
  path: "data.bin",
  dataBase64: Buffer.from(binary).toString("base64"),
});
assert.equal(
  sql.exec("SELECT media_type FROM dsh_session_host_file_versions WHERE version_id = ?", dataWritten.version).toArray()[0]?.media_type,
  DEFAULT_MEDIA_TYPE,
);
const window = await host.workspaceFileReadBytes({ sessionId: "wf-default", path: "/data.bin", offset: 2, length: 4 });
assert.equal(window.bytes, 10);
assert.equal(window.offset, 2);
assert.equal(window.eof, false);
assert.equal(window.version, dataWritten.version);
assert.deepEqual(bytesOf(window.dataBase64), [2, 3, 4, 5]);
const tail = await host.workspaceFileReadBytes({ sessionId: "wf-default", path: "data.bin", offset: 8 });
assert.deepEqual(bytesOf(tail.dataBase64), [8, 9]);
assert.equal(tail.eof, true);
const whole = await host.workspaceFileReadBytes({ sessionId: "wf-default", path: "data.bin" });
assert.equal(whole.offset, 0);
assert.equal(whole.eof, true);
assert.deepEqual(bytesOf(whole.dataBase64), [...binary]);
const emptyWindow = await host.workspaceFileReadBytes({ sessionId: "wf-default", path: "data.bin", offset: 100 });
assert.deepEqual(bytesOf(emptyWindow.dataBase64), []);
assert.equal(emptyWindow.eof, true);

// Exercise complete reads and explicit ranges through the browser gateway, RPC, owner DO and R2.
const largeBytes = new Uint8Array(DEFAULT_BYTE_WINDOW + 37);
largeBytes.fill(0x52, 0, DEFAULT_BYTE_WINDOW);
largeBytes.fill(0xaf, DEFAULT_BYTE_WINDOW);
const preview = await createFileReadFixture(largeBytes);
const complete = await preview.read();
assert.ok(complete.ok);
assert.deepEqual(complete.value.data, largeBytes);
assert.deepEqual([complete.value.offset, complete.value.bytes, complete.value.eof], [0, largeBytes.length, true]);
const firstPage = await preview.read({ range: {} });
assert.ok(firstPage.ok);
assert.deepEqual(firstPage.value.data, largeBytes.subarray(0, DEFAULT_BYTE_WINDOW));
assert.deepEqual([firstPage.value.bytes, firstPage.value.eof], [largeBytes.length, false]);
const tailPage = await preview.read({ range: { offset: DEFAULT_BYTE_WINDOW } });
assert.ok(tailPage.ok);
assert.deepEqual(tailPage.value.data, largeBytes.subarray(DEFAULT_BYTE_WINDOW));
assert.equal(tailPage.value.eof, true);
assert.equal(tailPage.value.version, complete.value.version);
const excessiveWindow = await preview.read({ range: { length: DEFAULT_BYTE_WINDOW + 1 } });
assert.equal(!excessiveWindow.ok && excessiveWindow.error.code, "workspace-file/too-large");
const forbidden = await preview.read({}, "other-owner");
assert.equal(!forbidden.ok && forbidden.error.code, "workspace-file/not-found");

// A pre-existing oversized entry is readable in bounded windows; full reads reject before fetching R2.
const oversizedScope = { workspaceId: "oversized", root: "/" };
await files.write(oversizedScope, "archived.bin", binary);
sql.exec(
  "UPDATE dsh_session_host_file_nodes SET size = ? WHERE workspace_id = ? AND path = ?",
  MAX_FILE_BYTES + 1, oversizedScope.workspaceId, "archived.bin",
);
assert.equal(await failureCode(() => files.readBytes(oversizedScope, "archived.bin")), "workspace-file/too-large");
const archivedHead = await files.readBytes(oversizedScope, "archived.bin", { offset: 0, length: 2 });
assert.deepEqual(archivedHead.data, binary.subarray(0, 2));
assert.equal(archivedHead.eof, false);

// Stable failure codes.
assert.equal(
  await failureCode(() => host.workspaceFileStat({ sessionId: "wf-default", path: "../escape.md" })),
  "workspace-file/outside-workspace",
);
assert.equal(
  await failureCode(() => host.workspaceFileStat({ sessionId: "wf-default", path: "missing.md" })),
  "workspace-file/not-found",
);
assert.equal(
  await failureCode(() => host.workspaceFileList({ sessionId: "wf-default", path: "missing" })),
  "workspace-file/not-found",
);
assert.equal(
  await failureCode(() => host.workspaceFileList({ sessionId: "wf-default", path: "Conversation.md" })),
  "workspace-file/not-directory",
);
assert.equal(
  await failureCode(() => host.workspaceFileRead({ sessionId: "wf-default", path: "notes" })),
  "workspace-file/not-regular-file",
);
assert.equal(
  await failureCode(() => host.workspaceFileStat({ sessionId: "wf-default", path: "notes" })),
  "workspace-file/not-regular-file",
);
assert.equal(
  await failureCode(() => host.workspaceFileWrite({ sessionId: "wf-default", path: "notes", dataBase64: "aGk=" })),
  "workspace-file/not-regular-file",
);
assert.equal(
  await failureCode(() => host.workspaceFileStat({ sessionId: "wf-default", path: "a//b.md" })),
  "gateway/bad-request",
);
assert.equal(
  await failureCode(() => host.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md", limit: DEFAULT_READ_LINES + 1 })),
  "gateway/bad-request",
);
assert.equal(
  await failureCode(() => host.workspaceFileReadBytes({ sessionId: "wf-default", path: "data.bin", offset: -1 })),
  "gateway/bad-request",
);
const nul = Uint8Array.from([0x61, 0x00, 0x62]);
await host.workspaceFileWrite({ sessionId: "wf-default", path: "binary.txt", dataBase64: Buffer.from(nul).toString("base64") });
assert.equal(
  await failureCode(() => host.workspaceFileRead({ sessionId: "wf-default", path: "binary.txt" })),
  "workspace-file/not-text",
);
assert.equal(
  await failureCode(() => files.write(defaultScope, "too-big.bin", new Uint8Array(MAX_FILE_BYTES + 1))),
  "workspace-file/too-large",
);
await files.write(defaultScope, "big.txt", new Uint8Array(MAX_TEXT_BYTES + 1).fill(0x61), "text/plain");
assert.equal(
  await failureCode(() => host.workspaceFileRead({ sessionId: "wf-default", path: "big.txt" })),
  "workspace-file/too-large",
);
await assert.rejects(
  () => host.workspaceFileStat({ sessionId: "missing-session", path: "Conversation.md" }),
  /session not found/,
);

// A listing above the entry cap reports truncation.
for (let index = 0; index < MAX_LIST_ENTRIES + 1; index += 1) {
  sql.exec(
    "INSERT INTO dsh_session_host_file_nodes (workspace_id, path, parent_path, name, kind, size, version_id, media_type, created_at, updated_at) VALUES (?, ?, '', ?, 'file', 0, NULL, NULL, 0, 0)",
    "bulk",
    `entry-${index}.md`,
    `entry-${index}.md`,
  );
}
const bulk = files.list({ workspaceId: "bulk", root: "/bulk" }, "");
assert.equal(bulk.entries.length, MAX_LIST_ENTRIES);
assert.equal(bulk.truncated, true);
const options = { query: "entry-", includeHidden: false, respectGitignore: true, excludedPaths: [] as string[] };
const bulkSearch = files.search({ workspaceId: "bulk", root: "/bulk" }, options);
assert.equal(bulkSearch.incomplete, true);
assert.equal(bulkSearch.truncated, true);
assert.equal(bulkSearch.matches.length, 512);

// Only visible files consume the search budget, even if excluded trees sort first.
const scanScope = { workspaceId: "scan-filters", root: "/" };
for (const path of ["dist/.ignore", ".cache/.rgignore", ".git/.ignore", "src/needle.ts"]) {
  await files.write(scanScope, path, new Uint8Array());
}
for (let index = 0; index < MAX_LIST_ENTRIES; index++) {
  const directory = ["dist", ".cache", ".git"][index % 3]!;
  const name = `entry-${index}`;
  sql.exec(
    "INSERT INTO dsh_session_host_file_nodes (workspace_id, path, parent_path, name, kind, size, created_at, updated_at) VALUES (?, ?, ?, ?, 'file', 0, 0, 0)",
    scanScope.workspaceId, `${directory}/${name}`, directory, name,
  );
}
const needle = { ...options, query: "needle", excludedPaths: ["dist"] };
const onlyNeedle = { matches: [{ path: "src/needle.ts", type: "file" }], truncated: false, incomplete: false };
assert.deepEqual(files.search(scanScope, { ...needle, respectGitignore: false }), onlyNeedle);
assert.deepEqual(files.search(scanScope, needle), onlyNeedle, "ignore files outside the search tree do not affect the result");
assert.throws(() => files.search(scanScope, { ...needle, includeHidden: true }), { code: "workspace-file/search-failed" });
assert.throws(() => files.search(scanScope, { ...needle, excludedPaths: [] }), { code: "workspace-file/search-failed" });
await files.write(scanScope, "src/nested/.ignore", new Uint8Array());
assert.deepEqual(files.search(scanScope, { ...needle, excludedPaths: ["dist", "src/nested"] }), onlyNeedle);
assert.throws(() => files.search(scanScope, { ...needle, excludedPaths: ["dist", ".ignore"] }), { code: "workspace-file/search-failed" },
  "hiding the .ignore filename alone still leaves its directory's native rules active");

// The cap uses full file-path order: "z-hit-other.txt" sorts before "z-hit/hit.txt".
const bulkScope = { workspaceId: "bulk", root: "/bulk" };
sql.exec("DELETE FROM dsh_session_host_file_nodes WHERE workspace_id = ? AND name IN ('entry-0.md', 'entry-1.md')", bulkScope.workspaceId);
await files.write(bulkScope, "z-hit-other.txt", new Uint8Array());
const lastFile = [{ path: "z-hit-other.txt", type: "file" }];
assert.deepEqual(files.search(bulkScope, { ...options, query: "hit" }), { matches: lastFile, truncated: false, incomplete: false });
await files.write(bulkScope, "z-hit/hit.txt", new Uint8Array());
assert.deepEqual(files.search(bulkScope, { ...options, query: "hit" }), { matches: lastFile, truncated: false, incomplete: true });

const gitScope = { workspaceId: "git-rules", root: "/" };
for (const path of ["app/config/.gitignore", "src/needle.ts"]) await files.write(gitScope, path, new Uint8Array());
assert.deepEqual(files.search(gitScope, needle), onlyNeedle, ".gitignore takes effect only inside a repository");
await files.write(gitScope, "app/.git/HEAD", new Uint8Array());
assert.throws(() => files.search(gitScope, needle), { code: "workspace-file/search-failed" });
const skipConfig = { ...needle, excludedPaths: ["app/config"] };
assert.deepEqual(files.search(gitScope, skipConfig), onlyNeedle);
await files.write(gitScope, "app/.git/info/exclude", new Uint8Array());
assert.throws(() => files.search(gitScope, skipConfig), { code: "workspace-file/search-failed" });
assert.deepEqual(files.search(gitScope, { ...needle, excludedPaths: ["app"] }), onlyNeedle);

// A non-root workspace rejects absolute paths outside it.
const created = await host.workspaceCreate({ path: "/workspace-files", title: "Files workspace" });
await host.create({ sessionId: "wf-sub", workspaceId: created.workspace.workspaceId });
const seededSub = await host.workspaceFileEnsureTranscript({ sessionId: "wf-sub" });
assert.ok(seededSub !== undefined);
assert.equal(seededSub.absolutePath, "/workspace-files/Conversation.md");
const subStat = await host.workspaceFileStat({ sessionId: "wf-sub", path: "/workspace-files/Conversation.md" });
assert.equal(subStat.absolutePath, "/workspace-files/Conversation.md");
assert.equal(
  await failureCode(() => host.workspaceFileStat({ sessionId: "wf-sub", path: "/etc/passwd" })),
  "workspace-file/outside-workspace",
);
assert.equal(
  await failureCode(() => host.workspaceFileWrite({ sessionId: "wf-sub", path: "/root.txt", dataBase64: "aGk=" })),
  "workspace-file/outside-workspace",
);
const emptyTranscript = await host.workspaceFileRead({ sessionId: "wf-sub", path: "Conversation.md" });
assert.equal(emptyTranscript.text, "# Conversation transcript");
assert.equal(emptyTranscript.lines, 1);
assert.equal(emptyTranscript.eof, true);

// The service transport preserves the store's failure codes and parses params defensively.
const search = async (sessionId: string, query: string, filters: Partial<typeof options> = {}) =>
  host.workspaceFileSearch(sessionId, { ...options, query, ...filters });
for (const path of ["Topic.txt", "notes/Topic/Plans.md", ".private/Topic.md", ".git/Topic.md", "literal[1]/Topic.md"]) {
  await host.workspaceFileWrite({ sessionId: "wf-sub", path, dataBase64: "b2s=" });
}
const scoped = await search("wf-sub", "tOpIC", { excludedPaths: ["literal[1]"] });
assert.deepEqual(scoped, {
  matches: [{ path: "Topic.txt", type: "file" }, { path: "notes/Topic", type: "directory" }],
  truncated: false, incomplete: false,
});
assert.deepEqual((await search("wf-sub", "notes/topic/plans")).matches, [{ path: "notes/Topic/Plans.md", type: "file" }]);
assert.deepEqual((await search("wf-sub", "plans", { excludedPaths: ["notes/Topic"] })).matches, []);
assert.deepEqual((await search("wf-default", "tOpIC")).matches, [], "search uses the workspace of the supplied owner session");
assert.deepEqual((await search("wf-sub", ".md", { includeHidden: true })).matches.filter(entry => entry.path.startsWith(".")),
  [{ path: ".private/Topic.md", type: "file" }], "VCS metadata stays excluded even when ordinary dotfiles are visible");
// Through the official RPC and Worker router, two owners can use even the same
// Session id without sharing a file index or reading the other owner's R2 keys.
const secondSql = new NodeSqlStorage();
const secondOwner = createDurableObjectSessionHost(secondSql, catalog, undefined, new WorkspaceFileStore(secondSql, bucket, "owner-2"));
await secondOwner.create({ sessionId: "wf-sub" });
await secondOwner.workspaceFileWrite({ sessionId: "wf-sub", path: "Second-owner.md", dataBase64: "b2s=" });
const ownerHosts = new Map([
  [`owner:owner-1:${SESSION_HOST_STORAGE_ID}`, host],
  [`owner:owner-2:${SESSION_HOST_STORAGE_ID}`, secondOwner],
]);
const env = { SESSION_HOST: {
  idFromName: (id: string) => id,
  get: (id: string) => ({ async fetch(request: Request) {
    const selected = ownerHosts.get(id);
    assert.ok(selected, "the Worker must route to a real authenticated owner");
    if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
    return Response.json(await dispatchSessionHost(selected, await request.json()));
  } }),
} };
const fileMethods = new Map<string, WireHandler>();
const dispose = registerWorkspaceFilesRemoteEndpoints({ register(method, handler) {
  fileMethods.set(method, handler);
  return () => { fileMethods.delete(method); };
} });
const method = "workspaceFiles/search";
async function remoteSearch(owner: string, query: string, sessionId = "wf-sub") {
  return await fileMethods.get(method)!({ args: { workspaceFileScope: sessionId, request: { ...options, query, ownerId: "owner-1" } } }, {
    user: { id: owner }, request: new Request("https://session-host/api/wire-rpc"), rpcId: "search", env, method,
  });
}
assert.deepEqual(await remoteSearch("owner-2", "Topic"), { matches: [], truncated: false, incomplete: false });
assert.deepEqual(await remoteSearch("owner-2", "Second-owner"), { matches: [{ path: "Second-owner.md", type: "file" }], truncated: false, incomplete: false });
assert.deepEqual(await remoteSearch("owner-1", "Second-owner"), { matches: [], truncated: false, incomplete: false });
await assert.rejects(remoteSearch("owner-2", "Conversation", "wf-default"), { code: "session/not-found" });
dispose();
await host.workspaceFileWrite({ sessionId: "wf-sub", path: ".ignore", dataBase64: "VG9waWMudHh0" });
await assert.rejects(search("wf-sub", "Topic.txt"), { code: "workspace-file/search-failed" });
assert.deepEqual((await search("wf-sub", "topic.txt", { respectGitignore: false })).matches, [{ path: "Topic.txt", type: "file" }]);
const invalidSearch = await dispatchSessionHost(host, { method: "workspaceFileSearch", params: { sessionId: "wf-sub", ...options, query: "  " } });
assert.equal("error" in invalidSearch && invalidSearch.error.code, "gateway/bad-request");
const listedResponse = await dispatchSessionHost(host, { id: "wf-list", method: "workspaceFileList", params: { sessionId: "wf-default", path: "" } });
assert.equal((listedResponse as { id?: string }).id, "wf-list");
assert.ok((listedResponse as { result: { entries: Array<{ name: string }> } }).result.entries.some((entry) => entry.name === "Conversation.md"));
const missingResponse = await dispatchSessionHost(host, { method: "workspaceFileStat", params: { sessionId: "wf-default", path: "missing.md" } });
assert.equal((missingResponse as { error: { code: string } }).error.code, "workspace-file/not-found");
const outsideResponse = await dispatchSessionHost(host, { method: "workspaceFileStat", params: { sessionId: "wf-default", path: "../outside" } });
assert.equal((outsideResponse as { error: { code: string } }).error.code, "workspace-file/outside-workspace");
const badParams = await dispatchSessionHost(host, { method: "workspaceFileList", params: {} });
assert.equal((badParams as { error: { code: string } }).error.code, "gateway/bad-request");
const readResponse = await dispatchSessionHost(host, {
  method: "workspaceFileRead",
  params: { sessionId: "wf-default", path: "Conversation.md", offset: 1, limit: 2 },
});
assert.equal((readResponse as { result: { lines: number } }).result.lines, 2);
const bytesResponse = await dispatchSessionHost(host, {
  method: "workspaceFileReadBytes",
  params: { sessionId: "wf-default", path: "data.bin", offset: "2", length: "4" },
});
assert.equal((bytesResponse as { result: { offset: number } }).result.offset, 2);
assert.deepEqual(bytesOf((bytesResponse as { result: { dataBase64: string } }).result.dataBase64), [2, 3, 4, 5]);
const writeResponse = await dispatchSessionHost(host, {
  method: "workspaceFileWrite",
  params: { sessionId: "wf-default", path: "service.txt", dataBase64: Buffer.from("via service\n").toString("base64") },
});
assert.equal((writeResponse as { result: { absolutePath: string } }).result.absolutePath, "/service.txt");
const invalidWrite = await dispatchSessionHost(host, {
  method: "workspaceFileWrite",
  params: { sessionId: "wf-default", path: "bad.txt", dataBase64: "!!!" },
});
assert.equal((invalidWrite as { error: { code: string } }).error.code, "gateway/bad-request");
const ensuredResponse = await dispatchSessionHost(host, { method: "workspaceFileEnsureTranscript", params: { sessionId: "wf-default" } });
assert.equal("result" in ensuredResponse ? ensuredResponse.result : "missing", undefined);

// Durable Object factory wiring: with a store files resolve; without one they report unavailable.
const doHost = createDurableObjectSessionHost(
  sql,
  catalog,
  undefined,
  new WorkspaceFileStore(sqlAdapter, bucket, "owner-1"),
);
assert.equal((await doHost.workspaceFileStat({ sessionId: "wf-default", path: "Conversation.md" })).absolutePath, "/Conversation.md");
const doHostWithoutFiles = createDurableObjectSessionHost(sql, catalog);
assert.equal(
  await failureCode(() => doHostWithoutFiles.workspaceFileList({ sessionId: "wf-default", path: "" })),
  "workspace-file/unavailable",
);

// A deployment without the FILES binding and a store without a bucket both report unavailable.
const noBucketFiles = new WorkspaceFileStore(sqlAdapter, undefined, "owner-1");
const noBucketHost = new SessionHost(storage, catalog, noBucketFiles);
assert.equal(
  await failureCode(() => noBucketHost.workspaceFileWrite({ sessionId: "wf-default", path: "unavailable.txt", dataBase64: "aGk=" })),
  "workspace-file/unavailable",
);
assert.equal(
  await failureCode(() => noBucketHost.workspaceFileRead({ sessionId: "wf-default", path: "Conversation.md" })),
  "workspace-file/unavailable",
);
const noStoreHost = new SessionHost(storage, catalog);
assert.equal(
  await failureCode(() => noStoreHost.workspaceFileList({ sessionId: "wf-default", path: "" })),
  "workspace-file/unavailable",
);

console.log("session-host: workspace files passed");
