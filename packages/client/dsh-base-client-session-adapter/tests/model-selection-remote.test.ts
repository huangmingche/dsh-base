import assert from "node:assert/strict";
import { createModelSelectionRemote } from "../src/client/model-selection-remote.ts";

const calls: unknown[] = [], projections: unknown[] = [];
for (const reasoningEffort of [undefined, "off", "low", "high", "max"]) {
  const selected = { provider: "actual-provider", model: "actual-model", ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  const response = { ok: true as const, value: { selected } };
  const select = createModelSelectionRemote(async input => { calls.push(input); return response; },
    (sessionId, selection) => { projections.push({ sessionId, selection }); });
  const input = { sessionId: "s", provider: "requested", model: "requested-model", ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  assert.equal(await select(input), response);
  assert.deepEqual(calls.at(-1), input, "the complete selection reaches the durable Host");
  assert.deepEqual(projections.at(-1), { sessionId: "s", selection: selected }, "only acknowledged values own the projection");
}
const before = projections.length;
const ignored = await createModelSelectionRemote(async () => ({ ok: true, value: { selected: { provider: "p", model: "m" } } }),
  () => { throw new Error("an ignored effort cannot be published"); })({ sessionId: "s", model: "m", reasoningEffort: "max" });
assert.equal(ignored.ok, false, "older Host model-only acknowledgements cannot masquerade as effort support");
const refusal = { ok: false as const, error: { code: "session/model-unavailable", message: "unsupported effort", details: { model: "m" } } };
assert.equal(await createModelSelectionRemote(async () => refusal, () => { throw new Error("must not publish refusal"); })({ sessionId: "s", model: "m", reasoningEffort: "unknown" }), refusal);
await assert.rejects(createModelSelectionRemote(async () => { throw new Error("offline"); }, () => { throw new Error("must not publish failure"); })({ sessionId: "s", model: "m" }), /offline/);
assert.equal(projections.length, before);
console.log("model selection Remote: full model/effort reaches Host; only acknowledged values project; ignored effort and failures remain failures");
