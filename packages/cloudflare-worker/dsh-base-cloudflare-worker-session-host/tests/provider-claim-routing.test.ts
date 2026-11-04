/** Claim-time provider isolation and legacy compatibility over the real DO transport. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { CredentialStore } from "../src/credential-store.ts";
import { InputExecutionLedger } from "../../../cloudflare-think/dsh-base-cloudflare-think-core/src/input-execution.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "agents") return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName() { return globalThis.__providerTestAgent; }')}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SessionHostObject } = await import("../src/do.ts");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE IF NOT EXISTS dsh_agent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
const sql = { exec(query: string, ...bindings: unknown[]) {
  const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[];
  return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
} };
const state = { id: { name: "owner:provider:default-v49" }, storage: {
  sql,
  transactionSync<T>(operation: () => T): T { db.exec("BEGIN"); try { const result = operation(); db.exec("COMMIT"); return result } catch (error) { db.exec("ROLLBACK"); throw error } },
  async setAlarm(_at: number) {},
} };
const ledger = new InputExecutionLedger(state.storage as never);
const credentialsSeen: Array<string | null> = [];
const baseURLsSeen: Array<string | null> = [];
const admittedModels: string[] = [];
let runs = 0;
const agent = {
  async ensureHistory(_seed: unknown[]) {},
  async setModel() {},
  async setUserCredential(value: string | null) { credentialsSeen.push(value) },
  async setDeepSeekBaseURL(value: string | null) { baseURLsSeen.push(value) },
  async freezeExecutionModel(requestId: string, model: string) { return { model: ledger.freezeModel(requestId, model)?.model ?? model } },
  async uploadAttachment() { return { id: "a" } },
  async admitInput(input: { requestId: string; executionConfig?: { model: string } }) { runs += 1; if (input.executionConfig !== undefined) admittedModels.push(input.executionConfig.model); return { submissionId: input.requestId, status: "completed" } },
  async waitForSubmission(id: string) { return { status: "completed", submissionId: id } },
  async getMessages() { return [] },
  async takeTurnStats() { return { turns: 0, steps: 0, llmMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 } },
  async getInputExecution() { return { status: "completed" } },
};
(globalThis as unknown as { __providerTestAgent: typeof agent }).__providerTestAgent = agent;
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const wrongSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const credentials = new CredentialStore(sql, secret);
let owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: wrongSecret } as never);
const call = async (method: string, params: Record<string, unknown> = {}) => owner.fetch(new Request("https://host/api/session-host", { method: "POST", body: JSON.stringify({ method, params }) }));
const claim = (sessionId: string, submissionId: string) => owner.fetch(new Request("https://host/api/session-host/claim", { method: "POST", body: JSON.stringify({ sessionId, submissionId }) }));
async function submit(sessionId: string, model: string): Promise<string> {
  assert.equal((await call("create", { sessionId })).status, 200);
  assert.equal((await call("selectModel", { sessionId, model })).status, 200, `select ${model}`);
  const prompt = await call("prompt", { sessionId, requestId: "submission", text: "hello" });
  assert.equal(prompt.status, 200);
  const body = await prompt.json() as { result?: { submissionId?: string } };
  assert.ok(body.result?.submissionId);
  return body.result.submissionId;
}
async function submitLegacy(sessionId: string): Promise<string> {
  assert.equal((await call("create", { sessionId })).status, 200);
  const requestId = `${sessionId}-request`;
  const prompt = await call("prompt", { sessionId, requestId, text: "hello" });
  assert.equal(prompt.status, 200);
  const body = await prompt.json() as { result?: { submissionId?: string } };
  db.prepare("UPDATE dsh_session_host_input_configs SET model = 'deepseek-flash' WHERE session_id = ? AND request_id = ?").run(sessionId, requestId);
  ledger.configure(requestId, { model: "deepseek-flash" });
  return body.result!.submissionId!;
}
async function submitWithFrozen( sessionId: string, hostModel: string, ledgerModel: string): Promise<string> {
  assert.equal((await call("create", { sessionId })).status, 200);
  const requestId = `${sessionId}-request`;
  const prompt = await call("prompt", { sessionId, requestId, text: "hello" });
  assert.equal(prompt.status, 200);
  const body = await prompt.json() as { result?: { submissionId?: string } };
  db.prepare("UPDATE dsh_session_host_input_configs SET model = ? WHERE session_id = ? AND request_id = ?").run(hostModel, sessionId, requestId);
  ledger.configure(requestId, { model: ledgerModel });
  return body.result!.submissionId!;
}
const gatewaySubmission = await submit("gateway", "cloudflare-ai-gateway/deepseek-flash");
assert.equal((await claim("gateway", gatewaySubmission)).status, 200, "Gateway claim must not depend on the owner key");
assert.deepEqual(credentialsSeen, [null], "Gateway claim never injects or decrypts the owner key");
assert.equal(runs, 1);
assert.equal((await call("selectModel", { sessionId: "legacy", model: "deepseek-flash" })).status, 409, "new bare selection is rejected");
const legacySubmission = await submitLegacy("legacy");
assert.equal((await claim("legacy", legacySubmission)).status, 200, "legacy bare no-key selection keeps platform compatibility");
assert.equal(admittedModels.at(-1), "cloudflare-ai-gateway/deepseek-flash");
assert.equal(String(db.prepare("SELECT model FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?").get("legacy", "legacy-request")!.model), "cloudflare-ai-gateway/deepseek-flash", "legacy platform routing is frozen");
assert.equal(ledger.configuration("legacy-request")?.model, "cloudflare-ai-gateway/deepseek-flash", "Think ledger is synchronized");
await credentials.set("DEEPSEEK_OFFICIAL_API_KEY", "owner-private-value");
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: secret } as never);
const byokLegacy = await submitLegacy("legacy-byok");
assert.equal((await claim("legacy-byok", byokLegacy)).status, 200);
assert.equal(admittedModels.at(-1), "deepseek-official/deepseek-flash");
assert.equal(String(db.prepare("SELECT model FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?").get("legacy-byok", "legacy-byok-request")!.model), "deepseek-official/deepseek-flash", "legacy BYOK routing is frozen as explicit DeepSeek");
assert.equal(String(db.prepare("SELECT model FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?").get("legacy", "legacy-request")!.model), "cloudflare-ai-gateway/deepseek-flash", "adding a key does not rewrite an already frozen legacy route");
// Host freeze succeeded previously but Think ledger remained bare: next ordinary
// claim must repair the ledger even though the Host input is already explicit.
const interrupted = await submitWithFrozen("interrupted", "cloudflare-ai-gateway/deepseek-flash", "deepseek-flash");
assert.equal((await claim("interrupted", interrupted)).status, 200);
assert.equal(ledger.configuration("interrupted-request")?.model, "cloudflare-ai-gateway/deepseek-flash", "ordinary claim repairs the interrupted Think ledger");
assert.equal(admittedModels.at(-1), "cloudflare-ai-gateway/deepseek-flash");
// Same-value idempotence with an explicit frozen ledger.
const explicitSame = await submitWithFrozen("explicit-same", "deepseek-official/deepseek-flash", "deepseek-official/deepseek-flash");
assert.equal((await claim("explicit-same", explicitSame)).status, 200);
assert.equal(ledger.configuration("explicit-same-request")?.model, "deepseek-official/deepseek-flash");
// Conflicting explicit ledger routes must fail closed, never execute inconsistency.
const conflicting = await submitWithFrozen("conflict", "cloudflare-ai-gateway/deepseek-flash", "deepseek-official/deepseek-flash");
const runsBeforeConflict = runs;
assert.equal((await claim("conflict", conflicting)).status, 500, "conflicting frozen explicit routes are rejected");
assert.equal(runs, runsBeforeConflict, "conflicting ledger route never executes");
// Broken key is fail-closed, never platform fallback.
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: wrongSecret } as never);
const brokenLegacy = await submitLegacy("legacy-broken");
const runsBeforeBroken = runs;
assert.equal((await claim("legacy-broken", brokenLegacy)).status, 500, "legacy read/decrypt failure must not fall back to Gateway");
assert.equal(runs, runsBeforeBroken, "broken legacy key never starts model execution");
// New session default is the explicit Gateway model when platform is enabled.
assert.equal((await call("create", { sessionId: "default" })).status, 200);
const defaultPrompt = await call("prompt", { sessionId: "default", requestId: "submission", text: "hello" });
assert.equal(defaultPrompt.status, 200);
const defaultBody = await defaultPrompt.json() as { result?: { submissionId?: string } };
assert.equal((await claim("default", defaultBody.result!.submissionId!)).status, 200);
assert.equal(admittedModels.at(-1), "cloudflare-ai-gateway/deepseek-flash", "new sessions default to explicit Gateway when available");
assert.equal(credentialsSeen[0], null); assert.ok(credentialsSeen.includes("owner-private-value"));
// Restart and retry the same durable input with a no-op Agent result.
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: wrongSecret } as never);
assert.equal((await claim("gateway", gatewaySubmission)).status, 200, "Gateway restart/replay does not read the owner key");
assert.deepEqual(credentialsSeen.slice(-1), [null]);
// Original DeepSeek settings are execution inputs: custom endpoint plus a
// custom catalog model reach the direct provider and owner credential.
owner = new SessionHostObject(state, { DshAgent: {} as never, CREDENTIALS_KEY: secret } as never);
assert.equal((await call("settingsUpdate", { ns: "llm-deepseek", patch: { baseURL: "https://owner.example/v1", models: [{ id: "owner-model", name: "Owner Model", contextWindow: 123 }] } })).status, 200);
const ownerSubmission = await submit("owner", "deepseek-official/owner-model");
assert.equal((await claim("owner", ownerSubmission)).status, 200);
assert.equal(credentialsSeen.at(-1), "owner-private-value");
assert.equal(baseURLsSeen.at(-1), "https://owner.example/v1");
// Explicitly empty owner directory: no valid default, no claim execution.
owner = new SessionHostObject(state, { DshAgent: {} as never, CREDENTIALS_KEY: secret } as never);
assert.equal((await call("settingsUpdate", { ns: "llm-deepseek", patch: { models: [] } })).status, 200);
assert.equal((await call("create", { sessionId: "empty" })).status, 200);
const emptyPrompt = await call("prompt", { sessionId: "empty", requestId: "submission", text: "hello" });
if (emptyPrompt.status === 200) {
  const emptyBody = await emptyPrompt.json() as { result?: { submissionId?: string } };
  const emptyClaim = await claim("empty", emptyBody.result!.submissionId!);
  assert.notEqual(emptyClaim.status, 200, "empty directory must not invent a default model");
}
const beforeEmptyRuns = runs;
assert.notEqual((await call("selectModel", { sessionId: "empty", model: "deepseek-official/deepseek-flash" })).status, 200, "a model absent from the empty directory is rejected");
assert.equal(runs, beforeEmptyRuns);
// Explicit DeepSeek selected while key exists, then key deleted: fail closed.
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: secret } as never);
assert.equal((await call("settingsUpdate", { ns: "llm-deepseek", patch: { models: [{ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", contextWindow: 1048576 }] } })).status, 200);
const deleteKeySession = await submit("delete-key", "deepseek-official/deepseek-flash");
await credentials.unset("DEEPSEEK_OFFICIAL_API_KEY");
const beforeDeleteRuns = runs;
owner = new SessionHostObject(state, { DshAgent: {} as never, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "explicit-gateway", CREDENTIALS_KEY: secret } as never);
assert.equal((await claim("delete-key", deleteKeySession)).status, 500, "deleted key makes frozen explicit DeepSeek fail closed");
assert.equal(runs, beforeDeleteRuns, "deleted explicit DeepSeek key never starts Gateway execution");
// Real Think ledger freeze is idempotent for the same route, upgrades legacy
// bare once, and refuses overwriting an already explicit provider.
ledger.configure("freeze-test", { model: "deepseek-flash", reasoningEffort: "high" });
assert.equal(ledger.freezeModel("freeze-test", "deepseek-official/deepseek-flash")?.model, "deepseek-official/deepseek-flash");
assert.equal(ledger.freezeModel("freeze-test", "deepseek-official/deepseek-flash")?.model, "deepseek-official/deepseek-flash");
assert.throws(() => ledger.freezeModel("freeze-test", "cloudflare-ai-gateway/deepseek-flash"), /input_provider_conflict/);
assert.equal(ledger.freezeModel("missing-config", "deepseek-official/deepseek-flash"), undefined);
db.close();
console.log("provider claim routing: broken owner key cannot block explicit Gateway, legacy platform selection stays compatible across restart, no DeepSeek credential injection on Gateway");
