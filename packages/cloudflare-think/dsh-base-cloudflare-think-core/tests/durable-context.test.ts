/** Real installed agents Sessions + SQLite, with Host/network and provider ports isolated. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { replaceDurableContext, type ContextMessage } from "../src/durable-context.ts";

const app = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const server = createRequire(new URL("../../../build/dsh-base-build-server-dependencies/package.json", import.meta.url));
const { Sessions } = await import(pathToFileURL(server.resolve("agents/sessions")).href);
const { transformSync } = app("esbuild");
const db = new DatabaseSync(":memory:");
let failWrite: ((query: string, bindings: unknown[]) => boolean) | undefined;
const storage = {
  sql: { exec(query: string, ...bindings: unknown[]) {
    if (failWrite?.(query, bindings)) { failWrite = undefined; throw new Error("injected context write failure"); }
    const statement = db.prepare(query);
    const rows = statement.all(...bindings as never[]);
    return { [Symbol.iterator]: () => rows[Symbol.iterator](), rowsWritten: Number(db.prepare("SELECT changes() AS changes").get()!.changes) };
  } },
  transactionSync<T>(fn: () => T): T {
    db.exec("SAVEPOINT test_write");
    try { const result = fn(); db.exec("RELEASE test_write"); return result; }
    catch (error) { db.exec("ROLLBACK TO test_write"); db.exec("RELEASE test_write"); throw error; }
  },
  async get() { return 3; }, async put() {},
};
// Only the platform I/O is replaced. Session append/update/delete/history and
// their branch/cache behavior run unchanged from the installed public export.
class TestSessions extends Sessions {
  get lifecycle() { return { storage, events: { emit() {} }, ready: async () => undefined }; }
}
async function reopen(id: string) {
  const capability = new TestSessions();
  await capability.onStart();
  return capability.session(id);
}
const context = (kind: string, text = kind, id = `dsh-context:${kind}`): ContextMessage => ({ id, role: "user", parts: [{ type: "text", text }], metadata: { dshContext: true, kind } });
const user = (id: string) => ({ id, role: "user", parts: [{ type: "text", text: id }] });
let session = await reopen("branch");
await replaceDurableContext(session, [context("working-directory"), context("workspace-instructions", "AGENTS original"), context("time", "1", "time1")]);
await session.appendMessage(user("first-user"));
await session.appendMessage({ ...user("first-answer"), role: "assistant" });

// The production regression: add global instructions after workspace context
// already exists, while also appending a fresh time record. All prior history
// and both instruction blocks must stay on the active branch.
await replaceDurableContext(session, [context("working-directory"), context("time", "2", "time2"), context("global-instructions", "new global"), context("workspace-instructions", "AGENTS changed")]);
await session.appendMessage(user("second-user"));
let history = await session.getHistory();
assert.ok(history.some((message: any) => message.id === "first-user"));
assert.ok(history.some((message: any) => message.id === "first-answer"));
assert.ok(history.some((message: any) => message.metadata?.kind === "global-instructions"));
assert.equal(history.find((message: any) => message.metadata?.kind === "workspace-instructions").parts[0].text, "AGENTS changed");
assert.equal(history.at(-1).id, "second-user");

// A real old-release branch: its workspace row exists but is off the active
// path. Repair must reattach it, not accept an idempotent no-op append.
await session.appendMessage(context("workspace-instructions", "off branch", "stranded"), { parentId: null });
await session.appendMessage(user("active-user"), { parentId: "second-user" });
await replaceDurableContext(session, [context("working-directory"), context("workspace-instructions", "repaired", "stranded")]);
history = await session.getHistory();
assert.ok(history.some((message: any) => message.id === "first-user"));
assert.ok(history.some((message: any) => message.id === "active-user"));
assert.equal(history.at(-1).id, "stranded");
assert.equal(history.some((message: any) => message.metadata?.kind === "global-instructions"), false);

// Removing/emptying instruction files removes their durable rows while
// splicing through to surviving conversation. Reopening tests real SQL state.
session = await reopen("branch");
await replaceDurableContext(session, [context("working-directory")]);
history = await session.getHistory();
assert.equal(history.some((message: any) => message.metadata?.kind === "workspace-instructions"), false);
assert.ok(history.some((message: any) => message.id === "active-user"));
for (let i = 0; i < 25; i++) await replaceDurableContext(session, [context("working-directory"), context("time", String(i), `bounded-time-${i}`)]);
assert.equal((await session.getHistory()).filter((message: any) => message.metadata?.kind === "time").length, 20);
assert.ok((await session.getHistory()).some((message: any) => message.id === "first-answer"));

// Exercise the actual composeAgent admission/refresh methods. Think's provider
// execution is isolated behind a durable submission port; Sessions stays real.
let admissionSession = await reopen("admission");
(globalThis as any).__contextSession = admissionSession;
const submissions = new Map<string, { submissionId: string; accepted: boolean; status: string }>();
let failSubmissionOnce = false;
(globalThis as any).__contextSubmit = async (messages: any[], options: { idempotencyKey: string }) => {
  if (failSubmissionOnce) { failSubmissionOnce = false; throw new Error("admission transport unavailable"); }
  const old = submissions.get(options.idempotencyKey);
  if (old) return { ...old, accepted: false };
  for (const message of messages) await admissionSession.appendMessage(message);
  const result = { submissionId: options.idempotencyKey, accepted: true, status: "completed" };
  submissions.set(options.idempotencyKey, result);
  return result;
};
const fakeThink = `export class Think {
  constructor(ctx, env) { this.ctx=ctx; this.env=env; this.session=globalThis.__contextSession; }
  getMessages() { return this.session.getHistory(); }
  submitMessages(messages, options) { return globalThis.__contextSubmit(messages, options); }
}`;
const dependencies = new Map(["agents/sessions", "ai"].map(name => [name, (name.startsWith("agents") ? server : app).resolve(name)]));
registerHooks({
  resolve(specifier, resolutionContext, nextResolve) {
    if (specifier === "@cloudflare/think") return { url: `data:text/javascript,${encodeURIComponent(fakeThink)}`, shortCircuit: true };
    if (specifier === "agents") return { url: "data:text/javascript,export const callable=()=>target=>target", shortCircuit: true };
    if (dependencies.has(specifier)) return nextResolve(dependencies.get(specifier)!, resolutionContext);
    if (specifier === "@dsh-base/chat-skills") return nextResolve(new URL("../../../boot/dsh-base-chat-skills/src/index.ts", import.meta.url).href, resolutionContext);
    return nextResolve(specifier, resolutionContext);
  },
  load(url, loadContext, nextLoad) {
    if (url.endsWith("/dsh-base-cloudflare-think-core/src/index.ts")) return { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm", target: "es2022", sourcefile: url }).code };
    return nextLoad(url, loadContext);
  },
});
const { composeAgent } = await import("../src/index.ts");
const Agent = composeAgent([]);
const files = new Map<string, string>([["AGENTS.md", "workspace instructions"]]);
let globalText = "", readFailure = false, hostCalls = 0;
const env = { SESSION_HOST_GENERATION: "default-v49", SESSION_HOST: {
  idFromName(name: string) { assert.equal(name, "owner:test:default-v49"); return name; },
  get() { return { async fetch(request: Request) {
    hostCalls++;
    const { method, params } = await request.json() as any;
    if (method === "list") return Response.json({ result: { sessions: [{ sessionId: "s", cwd: "/" }] } });
    if (method === "permissionSnapshot") return Response.json({result:{currentValue:"workspace-write",sandbox:"workspace-write",approval:"ask"}});
    if (method === "settingsDescribe") return Response.json({ result: { values: { "dsh-base:instructions": { text: globalText } } } });
    if (method === "workspaceFileRead") {
      if (readFailure) return Response.json({ error: { code: "workspace-file/unavailable" } }, { status: 503 });
      return files.has(params.path) ? Response.json({ result: { text: files.get(params.path) } }) : Response.json({ error: { code: "workspace-file/not-found" } }, { status: 404 });
    }
    throw new Error(`Unexpected Host method: ${method}`);
  } }; },
} };
const state = { storage, id: { name: "owner:test:s" } };
let agent = new Agent(state as never, env as never);
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r1", text: "first question" });
globalText = "new global instructions";
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r2", text: "second question" });
history = await admissionSession.getHistory();
assert.ok(history.some((message: any) => message.id === "r1"));
assert.ok(history.some((message: any) => message.metadata?.kind === "workspace-instructions"));
assert.ok(history.some((message: any) => message.metadata?.kind === "global-instructions"));
const beforeReplay = JSON.stringify(history), callsBeforeReplay = hostCalls;
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r1", text: "first question" });
assert.equal(JSON.stringify(await admissionSession.getHistory()), beforeReplay);
assert.equal(hostCalls, callsBeforeReplay, "replaying an older admitted input must not refresh or rewrite context");

// Empty and deleted files are authoritative, not an excuse to retain stale text.
files.set("AGENTS.md", ""); globalText = "";
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r3", text: "empty instructions" });
assert.equal((await admissionSession.getHistory()).some((message: any) => ["global-instructions", "workspace-instructions"].includes(message.metadata?.kind)), false);
files.set("AGENTS.md", "restored");
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r4", text: "restored" });
files.delete("AGENTS.md");
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r5", text: "deleted instructions" });
assert.equal((await admissionSession.getHistory()).some((message: any) => message.metadata?.kind === "workspace-instructions"), false);

// Host failures must not admit a model turn with missing instructions.
readFailure = true;
await assert.rejects(agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r6", text: "unavailable" }), /workspaceFileRead failed/);
assert.equal(submissions.has("r6"), false);
readFailure = false; files.set("AGENTS.md", "after recovery");
failWrite = (query, bindings) => query.includes("INSERT INTO cf_agents_session_messages") && bindings.includes("dsh-context:workspace-instructions");
await assert.rejects(agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r6", text: "unavailable" }), /injected context write failure/);
assert.equal(submissions.has("r6"), false);
admissionSession = await reopen("admission"); (globalThis as any).__contextSession = admissionSession;
agent = new Agent(state as never, env as never);
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r6", text: "unavailable" });
history = await admissionSession.getHistory();
assert.equal(history.filter((message: any) => message.id === "r6").length, 1);
assert.equal(history.find((message: any) => message.metadata?.kind === "workspace-instructions").parts[0].text.includes("after recovery"), true);
for (const id of ["r1", "r2", "r3", "r4", "r5"]) assert.ok(history.some((message: any) => message.id === id));

// Crash after the verified context marker, before Think accepts the input.
// Retry reuses that verified snapshot, even if the authoritative files change,
// and never overwrites the failed attempt with a newer instruction version.
files.set("AGENTS.md", "admission snapshot"); failSubmissionOnce = true;
await assert.rejects(agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r7", text: "crash window" }), /admission transport unavailable/);
assert.equal(submissions.has("r7"), false);
const failedSnapshot = JSON.stringify(await admissionSession.getHistory());
files.set("AGENTS.md", "must wait for the next new input");
admissionSession = await reopen("admission"); (globalThis as any).__contextSession = admissionSession;
agent = new Agent(state as never, env as never);
const beforeRetryCalls = hostCalls;
await agent.admitInput({ executionConfig: { model: "deepseek-flash", reasoningEffort: "high" }, requestId: "r7", text: "crash window" });
history = await admissionSession.getHistory();
assert.equal(JSON.stringify(history.slice(0, -1)), failedSnapshot);
assert.equal(hostCalls, beforeRetryCalls);
assert.equal(history.at(-1).id, "r7");
console.log("durable context: real Sessions SQLite branch preservation, stranded-row repair, pruning, restart, replay, empty/deleted instructions and fail-closed Host/SQL/admission fault recovery passed");

// setThinkPlugins must invalidate the cached official prompt registry and remove
// tools/actions together without deleting facts. No model/provider call is made.
const SelectionAgent = composeAgent([
  { name: "fetch", prompt: () => [{ name: "tool:fetch", order: 1600, text: "fetch prompt" }], tools: () => ({ fetch_url: {} }) },
  { name: "memory", prompt: () => [{ name: "tool:memory", order: 1700, text: "memory prompt" }], tools: () => ({ recall_facts: {} }), actions: () => ({ remember_fact: {} }) },
] as never);
const selectionAgent = new SelectionAgent(state as never, env as never);
await selectionAgent.setThinkPlugins({ disabled: ["fetch"] });
let selectionDebug = await selectionAgent.systemPromptDebug();
assert.ok(selectionDebug.text.includes("memory prompt"));
assert.equal(selectionDebug.text.includes("fetch prompt"), false);
assert.equal(selectionDebug.tools.includes("fetch_url"), false);
assert.ok(selectionDebug.tools.includes("recall_facts"));
await selectionAgent.setThinkPlugins({ disabled: [] });
selectionDebug = await selectionAgent.systemPromptDebug();
assert.ok(selectionDebug.text.includes("fetch prompt"));
assert.ok(selectionDebug.tools.includes("fetch_url"));
console.log("think plugin selection: prompt registry cache invalidation and tools/actions projection passed without model calls");
