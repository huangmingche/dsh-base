/** Chat reference discovery contract. */
import assert from "node:assert/strict";
import { fileReferenceCandidates, sessionReferenceCandidates, type ReferenceTransport } from "../src/client/chat-references.ts";

const tree: Record<string, Array<{ name: string; type: "file" | "directory" }>> = {
  "": [
    { name: "notes.md", type: "file" },
    { name: "docs", type: "directory" },
    { name: "AGENTS.md", type: "file" },
  ],
  docs: [
    { name: "guide.md", type: "file" },
    { name: "deep", type: "directory" },
  ],
  "docs/deep": [
    { name: "nested.txt", type: "file" },
  ],
};
const transport: ReferenceTransport = {
  async request(method, params = {}) {
    if (method === "workspaceFileList") return { entries: tree[String(params.path ?? "")] ?? [] };
    if (method === "list") {
      return { sessions: [
        { sessionId: "self", title: "Current", updatedAt: 1 },
        { sessionId: "other", title: "Other acceptance chat", createdAt: 2, cwd: "/" },
        { sessionId: "third", title: "Browser schedule" },
      ] };
    }
    throw new Error(`unexpected method ${method}`);
  },
};
const signal = new AbortController().signal;
const all = await fileReferenceCandidates(transport, "s1", "", signal);
assert.deepEqual(all.map((candidate) => candidate.path), ["AGENTS.md", "docs", "docs/deep", "docs/deep/nested.txt", "docs/guide.md", "notes.md"]);
assert.equal(all.find((candidate) => candidate.path === "docs")?.kind, "directory");
assert.deepEqual((await fileReferenceCandidates(transport, "s1", "notes", signal)).map((candidate) => candidate.path), ["notes.md"]);
assert.deepEqual((await fileReferenceCandidates(transport, "s1", "docs/g", signal)).map((candidate) => candidate.path), ["docs/guide.md"]);
assert.deepEqual((await fileReferenceCandidates(transport, "s1", "docs/", signal)).map((candidate) => candidate.path), ["docs/deep", "docs/deep/nested.txt", "docs/guide.md"]);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(fileReferenceCandidates(transport, "s1", "", aborted.signal), { name: "AbortError" });
const unavailable = Object.assign(new Error("Host offline"), { code: "transport/offline" });
await assert.rejects(fileReferenceCandidates({ request: async () => { throw unavailable; } }, "s1", "", signal), error => error === unavailable);
await assert.rejects(fileReferenceCandidates({ request: async (_method, params) => {
  if (params?.path === "") return { entries: [{ name: "nested", type: "directory" }] };
  throw unavailable;
} }, "s1", "", signal), error => error === unavailable, "a failed later page must not return successful partial results");
const cancelledDuringRead = new AbortController();
await assert.rejects(fileReferenceCandidates({ request: async () => {
  cancelledDuringRead.abort(); return { entries: [{ name: "stale.txt", type: "file" }] };
} }, "s1", "", cancelledDuringRead.signal), { name: "AbortError" });
const sessions = await sessionReferenceCandidates(transport, "self", "");
assert.deepEqual(sessions.map((candidate) => candidate.sessionId), ["other", "third"]);
assert.equal(sessions[0]?.mention, "@[Other acceptance chat](dsh-session:other)");
assert.equal(sessions[0]?.createdAt, 2);
assert.deepEqual((await sessionReferenceCandidates(transport, "self", "schedule")).map((candidate) => candidate.sessionId), ["third"]);
console.log("client session adapter: chat reference discovery passed");
