/** Exercise the actual DO response through the actual strict browser transport. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { createSessionHostClient, SessionHostClientError } from "../../../client/dsh-base-client-session-host/src/index.ts";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "agents") return { url: `data:text/javascript,${encodeURIComponent('export async function getAgentByName() { return globalThis.__liveTestAgent; }')}`, shortCircuit: true };
  return next(specifier, context);
} });
const { SessionHostObject } = await import("../src/do.ts");
const db = new DatabaseSync(":memory:");
const state = { id: { name: "owner:test:default-v49" }, storage: {
  sql: { exec(query: string, ...bindings: unknown[]) {
    const rows = db.prepare(query).all(...bindings as never[]);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } },
  transactionSync<T>(operation: () => T): T { db.exec("BEGIN"); try { const result = operation(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
  async setAlarm() {},
} };
let value: unknown;
let fail = false;
(globalThis as unknown as { __liveTestAgent: unknown }).__liveTestAgent = {
  async getLiveAttempt() { if (fail) throw new Error("live transport interrupted"); return value; },
};
const owner = new SessionHostObject(state, { DshAgent: {} as never });
const client = createSessionHostClient({ baseUrl: "https://host", fetch: ((input, init) => owner.fetch(new Request(input, init))) as typeof fetch });
const post = () => owner.fetch(new Request("https://host/api/session-host", { method: "POST", body: JSON.stringify({ method: "live", params: { sessionId: "s" } }) }));

assert.deepEqual(await (await post()).json(), { result: { live: null } }, "idle POST has an explicit successful result");
assert.deepEqual(await client.live("s"), { live: null }, "cold WebSocket startup probe must not throw missing-result");
value = { attemptId: "attempt", turn: 1, step: 1, revision: 1, chunks: [{ type: "text-delta", index: 0, text: "hello" }] };
assert.deepEqual(await client.live("s"), { live: value });
const raw = await owner.fetch(new Request("https://host/api/session-host/live?sessionId=s"));
assert.deepEqual(await raw.json(), { live: value }, "GET/live keeps its distinct raw protocol");

fail = true;
const failure = await post();
assert.equal(failure.status, 503);
assert.deepEqual(await failure.json(), { error: { code: "session/live-unavailable", message: "live transport interrupted" } });
await assert.rejects(client.live("s"), error => error instanceof SessionHostClientError && error.code === "session/live-unavailable");

// Exercise the pushed-snapshot branch without reaching the failed Agent getter.
const pushedOwner = new SessionHostObject(state, { DshAgent: {} as never, AUTH_SECRET: "test-only-live-secret" } as never);
const pushed = await pushedOwner.fetch(new Request("https://host/api/session-host/internal/live?sessionId=s", {
  method: "POST", headers: { "x-dsh-live-token": "test-only-live-secret", "content-type": "application/json" }, body: JSON.stringify({ live: value }),
}));
assert.equal(pushed.status, 200);
const pushedClient = createSessionHostClient({ baseUrl: "https://host", fetch: ((input, init) => pushedOwner.fetch(new Request(input, init))) as typeof fetch });
assert.deepEqual(await pushedClient.live("s"), { live: value });
const rawPush = await pushedOwner.fetch(new Request("https://host/api/session-host/live-push?sessionId=s"));
assert.deepEqual(await rawPush.json(), { live: value }, "internal live-push remains raw");
// Streaming observes pushed state without blocked Agent RPC or a poll timer.
const streamAbort = new AbortController();
const liveResponse = await pushedOwner.fetch(new Request('https://host/api/session-host/live-events?sessionId=s', { signal: streamAbort.signal }));
const reader = liveResponse.body!.getReader();
const decode = (bytes: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(bytes).split('data: ')[1]!.trim());
assert.deepEqual(decode((await reader.read()).value), { live: value });
const nextRead = reader.read();
const updated = { ...(value as object), revision: 2, chunks: [{ type: 'text-delta', index: 0, text: 'second' }] };
await pushedOwner.fetch(new Request('https://host/api/session-host/internal/live?sessionId=s', {
  method: 'POST', headers: { 'x-dsh-live-token': 'test-only-live-secret', 'content-type': 'application/json' }, body: JSON.stringify({ live: updated }),
}));
assert.deepEqual(decode((await nextRead).value), { live: updated });
const pendingRead = reader.read();
await reader.cancel();
assert.equal((await pendingRead).done, true, 'body cancellation releases a blocked subscription');
streamAbort.abort();
db.close();
console.log("live transport: real DO + strict client idle/active/pushed/error POST envelopes; raw GET protocols retained");
