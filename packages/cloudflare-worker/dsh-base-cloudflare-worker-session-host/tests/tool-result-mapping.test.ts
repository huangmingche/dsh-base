/** Durable tool-result projection contract. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { toolResultValueFor } from "../src/tool-result-mapping.ts";

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

const { registerToolResultStreamEndpoints } = await import("../src/remote-streams.ts");
const captured: Array<(payload: unknown, invocation: unknown) => AsyncIterable<unknown>> = [];
const wireStream = {
  register(_method: string, handler: (payload: unknown, invocation: unknown) => AsyncIterable<unknown>) {
    captured.push(handler);
    return () => undefined;
  },
};
const dispose = registerToolResultStreamEndpoints(wireStream as never);
assert.equal(captured.length, 1);
dispose();
await assert.rejects(async () => {
  for await (const _value of captured[0]!({ args: {} }, { request: { signal: new AbortController().signal } })) { /* invalid */ }
}, /sessionId/);

const records = [
  { event: { type: "turn/start", seq: 1, data: {} } },
  { event: { type: "tool/result", seq: 2, data: { message: { content: [{ type: "text", text: "{\"ok\":true,\"count\":3}" }] } } } },
  { event: { type: "tool/result", seq: 3, data: { message: { content: [{ type: "text", text: "plain output" }] } } } },
  { event: { type: "assistant/message", seq: 4, data: { message: { content: [{ type: "text", text: "x" }] } } } },
];
assert.deepEqual(toolResultValueFor(records, 2), { available: true, value: { ok: true, count: 3 } });
assert.deepEqual(toolResultValueFor(records, 3), { available: true, value: "plain output" });
assert.deepEqual(toolResultValueFor(records, 1), { available: false });
assert.deepEqual(toolResultValueFor(records, 4), { available: false });
assert.deepEqual(toolResultValueFor(records, 99), { available: false });
console.log("session-host: tool result projection passed");
