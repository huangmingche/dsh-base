import assert from "node:assert/strict";
import { SessionHost } from "../src/host.ts";
import type {
  SessionHostEvent,
  SessionHostStorage,
  SessionHostSubmission,
  SessionMessageRecord,
  SessionRecord,
} from "../src/storage.ts";

class MemoryStorage implements SessionHostStorage {
  readonly sessions = new Map<string, SessionRecord>();
  readonly messages = new Map<string, SessionMessageRecord[]>();
  readonly projections = new Map<string, Record<string, unknown>>();
  readonly events = new Map<string, SessionHostEvent[]>();
  readonly submissions = new Map<string, SessionHostSubmission>();
  readonly attachments = new Map<string, import("../src/storage.ts").SessionHostAttachment>();
  readonly workspaces = new Map<string, import("../src/storage.ts").SessionWorkspaceRecord>();
  readonly memberships = new Map<string, import("../src/storage.ts").SessionWorkspaceMembership>();
  readonly flags = new Map<string, import("../src/storage.ts").SessionWorkspaceFlags>();

  async listSessions(): Promise<readonly SessionRecord[]> {
    return [...this.sessions.values()];
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(sessionId);
  }

  async putSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, record);
  }

  async createSession(record: SessionRecord, placement: import("../src/storage.ts").SessionCreatePlacement): Promise<{ sessionId: string }> {
    let sessionId = record.sessionId;
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      const membership = [...this.memberships.values()].find(row => row.sessionId === sessionId);
      const cwd = membership === undefined ? "/" : this.workspaces.get(membership.workspaceId)?.path ?? "/";
      if (placement.requireLocation && cwd !== placement.cwd) throw new Error("session/conflict");
      const mismatch = placement.requestedWorkspaceId !== undefined && membership?.workspaceId !== placement.requestedWorkspaceId;
      if (!placement.reuseBlankOnly && mismatch) throw new Error("session/conflict");
      if (!placement.reuseBlankOnly || (existing.blank && !existing.running && !existing.archived && !this.flags.get(sessionId)?.archived && !mismatch)) return { sessionId };
      sessionId = crypto.randomUUID();
    }
    this.sessions.set(sessionId, { ...record, sessionId });
    const position = Math.max(-1, ...[...this.memberships.values()].filter(row => row.workspaceId === placement.workspaceId).map(row => row.position)) + 1;
    this.memberships.set(`${placement.workspaceId}:${sessionId}`, { workspaceId: placement.workspaceId, sessionId, position });
    return { sessionId };
  }

  async pageMessages(sessionId: string, beforeSeq: number | undefined, limit: number) {
    const all = [...(this.messages.get(sessionId) ?? [])].sort((left, right) => left.seq - right.seq);
    const end = beforeSeq === undefined ? all.length : all.findIndex((record) => record.seq === beforeSeq);
    if (end < 0) throw new Error("cursor not found");
    const start = Math.max(0, end - limit);
    return { records: all.slice(start, end), hasMore: start > 0 };
  }

  async getProjections(sessionId: string): Promise<Record<string, unknown>> {
    return this.projections.get(sessionId) ?? {};
  }

  async putProjections(sessionId: string, value: Record<string, unknown>): Promise<void> {
    this.projections.set(sessionId, value);
  }

  async readAllMessages(sessionId: string): Promise<readonly SessionMessageRecord[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async appendMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void> {
    this.messages.set(sessionId, [...(this.messages.get(sessionId) ?? []), ...messages]);
  }

  async replaceMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void> {
    this.messages.set(sessionId, [...messages]);
  }

  async nextMessageSeq(sessionId: string): Promise<number> {
    return Math.max(0, ...(this.messages.get(sessionId) ?? []).map((message) => message.seq)) + 1;
  }

  async appendEvent(sessionId: string, type: string, payload: unknown): Promise<SessionHostEvent> {
    const seq = (this.events.get(sessionId)?.at(-1)?.seq ?? 0) + 1;
    const event = { sessionId, seq, type, payload, createdAt: Date.now() };
    this.events.set(sessionId, [...(this.events.get(sessionId) ?? []), event]);
    return event;
  }

  async listEvents(sessionId: string, afterSeq: number, limit: number): Promise<readonly SessionHostEvent[]> {
    return (this.events.get(sessionId) ?? []).filter((event) => event.seq > afterSeq).slice(0, limit);
  }

  async putSubmission(submission: SessionHostSubmission): Promise<void> {
    this.submissions.set(submission.submissionId, submission);
  }

  async putAttachment(attachment: import("../src/storage.ts").SessionHostAttachment): Promise<void> {
    this.attachments.set(attachment.attachmentId, attachment);
  }

  async getAttachment(attachmentId: string) {
    return this.attachments.get(attachmentId);
  }

  async listWorkspaces() {
    return [...this.workspaces.values()].sort((a, b) => a.position - b.position);
  }

  async getWorkspace(workspaceId: string) {
    return this.workspaces.get(workspaceId);
  }

  async putWorkspace(workspace: import("../src/storage.ts").SessionWorkspaceRecord) {
    this.workspaces.set(workspace.workspaceId, workspace);
  }

  async deleteWorkspace(workspaceId: string) {
    this.workspaces.delete(workspaceId);
  }

  async listMemberships() {
    return [...this.memberships.values()];
  }

  async putMembership(workspaceId: string, sessionId: string, position: number) {
    this.memberships.set(`${workspaceId}:${sessionId}`, { workspaceId, sessionId, position });
  }

  async removeMembership(workspaceId: string, sessionId: string) {
    this.memberships.delete(`${workspaceId}:${sessionId}`);
  }

  async deleteWorkspaceMemberships(workspaceId: string) {
    for (const key of [...this.memberships.keys()]) if (key.startsWith(workspaceId + ":")) this.memberships.delete(key);
  }

  async listSessionFlags() {
    return Object.fromEntries(this.flags);
  }

  async putSessionFlags(sessionId: string, flags: import("../src/storage.ts").SessionWorkspaceFlags) {
    this.flags.set(sessionId, flags);
  }

  async getSubmission(submissionId: string): Promise<SessionHostSubmission | undefined> {
    return this.submissions.get(submissionId);
  }

  async listSubmissions(sessionId: string): Promise<readonly SessionHostSubmission[]> {
    return [...this.submissions.values()].filter((submission) => submission.sessionId === sessionId);
  }
}

const storage = new MemoryStorage();
const now = Date.now();
storage.sessions.set("a", {
  sessionId: "a", title: "Alpha", running: false, blank: false, archived: false,
  createdAt: now - 3000, updatedAt: now - 2000,
});
storage.sessions.set("b", {
  sessionId: "b", title: "Beta", running: true, blank: false, archived: false,
  createdAt: now - 2000, updatedAt: now - 1000,
});
storage.messages.set("a", Array.from({ length: 45 }, (_, index) => ({
  id: `m${index + 1}`, seq: index + 1, role: index % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `message ${index + 1}` }],
})));
storage.projections.set("a", { usage: { input: 10, output: 2 } });
const host = new SessionHost(storage, [
  { id: "deepseek-official/deepseek-flash", label: "DeepSeek-V4.1-Flash", contextWindow: 1_048_576 },
]);

const first = await host.list({});
assert.deepEqual(first.sessions.map((row) => row.sessionId), ["b", "a"]);
assert.equal(first.cursor, undefined);

const page1 = await host.page({ address: { kind: "session", sessionId: "a" }, limit: 20 });
assert.equal(page1.records.length, 20);
assert.equal(page1.hasMore, true);
assert.equal(page1.before, 26);

const page2 = await host.page({ address: { kind: "session", sessionId: "a" }, before: page1.before, limit: 20 });
assert.equal(page2.records.length, 20);
assert.equal(page2.hasMore, true);

const page3 = await host.page({ address: { kind: "session", sessionId: "a" }, before: page2.before, limit: 20 });
assert.deepEqual(page3.records.map((record) => record.seq), [1, 2, 3, 4, 5]);
assert.equal(page3.hasMore, false);

assert.deepEqual(await host.state({ sessionId: "a" }), {
  sessionId: "a", title: "Alpha", running: false, archived: false,
});
assert.deepEqual((await host.projections({ sessionId: "a" })).usage, { input: 10, output: 2 });
assert.deepEqual(await host.rename({ sessionId: "a", title: "Renamed" }), { title: "Renamed" });
assert.equal((await storage.getSession("a"))?.title, "Renamed");
assert.deepEqual(await host.selectModel({ sessionId: "a", model: "deepseek-official/deepseek-flash" }), { model: "deepseek-official/deepseek-flash", reasoningEffort: "high" });
assert.equal((await storage.getSession("a"))?.model, "deepseek-official/deepseek-flash");
await assert.rejects(host.selectModel({ sessionId: "a", model: "missing" }), /Legacy bare|unknown model/);

const created = await host.create({ title: "Created", sessionId: "created" });
assert.equal(created.sessionId, "created");
assert.equal((await host.state({ sessionId: "created" })).title, "Created");

const fork = await host.fork({ sessionId: "a", messageId: "m20", sessionIdNew: "fork" });
assert.equal(fork.sessionId, "fork");
assert.equal((await host.state({ sessionId: "fork" })).title, "Renamed (fork)");
const forkedPage = await host.page({ address: { kind: "session", sessionId: "fork" }, limit: 100 });
assert.equal(forkedPage.records.length, 20);
assert.equal((await host.projections({ sessionId: "fork" })).usage, undefined, "aggregate usage beyond an exact fork cursor must not be inherited");

const prompt = await host.prompt({ sessionId: "created", text: "hello from the official contract" });
assert.equal(typeof prompt.requestId, "string");
assert.equal(typeof prompt.submissionId, "string");
const promptedPage = await host.page({ address: { kind: "session", sessionId: "created" }, limit: 10 });
assert.equal(promptedPage.records.length, 1);
assert.equal(promptedPage.records[0]?.role, "user");
assert.equal((await host.state({ sessionId: "created" })).running, true);
assert.equal((await storage.listSubmissions("created"))[0]?.status, "queued");
assert.equal((await storage.listEvents("created", 0, 10))[0]?.type, "submission.queued");

const abort = new AbortController();
const followed: SessionHostEvent[] = [];
for await (const event of host.follow({ address: { kind: "session", sessionId: "created" }, signal: abort.signal })) {
  followed.push(event);
  if (followed.length === 1) abort.abort();
}
assert.equal(followed[0]?.type, "submission.queued");

const controlAbort = new AbortController();
const controlFrames: unknown[] = [];
for await (const frame of host.control(controlAbort.signal)) {
  controlFrames.push(frame);
  controlAbort.abort();
}
assert.equal((controlFrames[0] as { type: string }).type, "sessions.snapshot");
assert.ok(((controlFrames[0] as { sessions: unknown[] }).sessions.length) >= 1);

const attachment = await host.uploadAttachment({
  sessionId: "created",
  name: "fact.txt",
  mediaType: "text/plain",
  dataBase64: Buffer.from("The secret code is BANANA-42.").toString("base64"),
});
assert.equal(attachment.name, "fact.txt");
assert.equal(attachment.size, 29);
const attachmentPrompt = await host.prompt({
  sessionId: "created",
  text: "What is the secret code?",
  attachments: [attachment],
});
assert.equal(typeof attachmentPrompt.submissionId, "string");
const attachmentSubmission = (await storage.listSubmissions("created")).at(-1);
assert.equal(attachmentSubmission?.attachments?.[0]?.attachmentId, attachment.attachmentId);
assert.equal((await host.attachment(attachment.attachmentId)).dataBase64.length > 0, true);

await host.cancel({ sessionId: "created" });
assert.equal((await host.state({ sessionId: "created" })).running, false);
assert.equal((await storage.listSubmissions("created"))[0]?.status, "cancelled");
assert.equal((await storage.listEvents("created", 0, 10)).at(-1)?.type, "submission.cancelled");
console.log("session-host: read/create/fork/prompt/cancel/follow contract passed");

{
// A retry after a lost admission response keeps one queue item and one message.
await host.create({ sessionId: "recovery", title: "Recovery" });
const first = await host.prompt({ sessionId: "recovery", text: "first", requestId: "request-1" });
const duplicate = await host.prompt({ sessionId: "recovery", text: "first", requestId: "request-1" });
assert.deepEqual(first, duplicate);
assert.equal((await storage.readAllMessages("recovery")).length, 1);
assert.equal((await host.executionHistory("recovery")).length, 0);
const message = (id: string, role: string, text: string) => ({ id, role, parts: [{ type: "text", text }] });

// Browsing state cannot time out a real long-running execution.
const firstRow = (await storage.getSubmission(first.submissionId))!;
await storage.putSubmission({ ...firstRow, status: "running", updatedAt: Date.now() - 600_000 });
assert.equal((await host.state({ sessionId: "recovery" })).running, true);
await host.list({});
assert.equal((await storage.getSubmission(first.submissionId))?.status, "running");

// A transport loss preserves the running request for idempotent agent replay.
await assert.rejects(host.runSubmission({ sessionId: "recovery", submissionId: first.submissionId, resume: true }, async (submission) => {
  assert.equal(submission.requestId, "request-1");
  throw new Error("RPC response lost after durable agent execution");
}), /RPC response lost/);
assert.equal((await storage.getSubmission(first.submissionId))?.status, "running");
assert.equal((await host.queuedSubmissions()).some((row) => row.submissionId === first.submissionId), true);

// A recovered final transcript cannot erase an input queued during execution.
let secondId = "";
await host.runSubmission({ sessionId: "recovery", submissionId: first.submissionId, resume: true }, async (submission) => {
  assert.equal(submission.requestId, "request-1");
  const second = await host.prompt({ sessionId: "recovery", text: "second", requestId: "request-2" });
  secondId = second.submissionId;
  return { messages: [message("request-1", "user", "first"), message("answer-1", "assistant", "done")] };
});
assert.deepEqual((await storage.readAllMessages("recovery")).map((row) => row.id), ["request-1", "answer-1", "request-2"]);
assert.equal((await host.state({ sessionId: "recovery" })).running, true);
assert.deepEqual((await host.executionHistory("recovery")).map((row) => row.id), ["request-1", "answer-1"]);
await host.syncAgentMessages({ sessionId: "recovery", messages: [message("request-1", "user", "first"), message("answer-1", "assistant", "approved")] });
assert.equal((await storage.readAllMessages("recovery")).at(-1)?.id, "request-2");

// Late completion cannot undo the user's cancellation.
const cancelled = await host.runSubmission({ sessionId: "recovery", submissionId: secondId, resume: true }, async () => {
  await host.cancel({ sessionId: "recovery" });
  return { messages: [message("request-1", "user", "first"), message("answer-1", "assistant", "done"), message("request-2", "user", "second")] };
});
assert.equal(cancelled.status, "cancelled");
assert.equal((await storage.getSubmission(secondId))?.status, "cancelled");
assert.equal((await host.state({ sessionId: "recovery" })).running, false);
console.log("session-host: execution authority, durable resume, queue preservation and cancellation passed");
}
