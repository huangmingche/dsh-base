import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createDurableObjectSessionHost } from "../src/durable-object.ts";
import { SessionHost } from "../src/host.ts";
import { dispatchSessionHost } from "../src/service.ts";
import { SqliteSessionHostStorage, type SqlCursor, type SqlStorage } from "../src/sqlite-storage.ts";
import {
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
  type R2BucketLike,
  type WorkspaceFileScope,
} from "../src/workspace-files.ts";

class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");

  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
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

class FakeR2 implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    const buffer = new ArrayBuffer(stored.byteLength);
    new Uint8Array(buffer).set(stored);
    return { arrayBuffer: async () => buffer };
  }

  async put(key: string, value: Uint8Array): Promise<unknown> {
    this.objects.set(key, Uint8Array.from(value));
    return { key };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

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
