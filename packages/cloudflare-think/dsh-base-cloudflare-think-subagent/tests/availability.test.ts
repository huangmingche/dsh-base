/** Capability and compatibility-export regression; the runtime type gate checks real Think signatures. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { CHAT_SKILLS } from "../../../boot/dsh-base-chat-skills/src/index.ts";
assert.equal(CHAT_SKILLS.some(skill => skill.name === "delegate"), false, "the composer/model skill catalog must not advertise unavailable delegation");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@cloudflare/think") return { url: `data:text/javascript,${encodeURIComponent('export class Think { constructor(state, env) { this.state = state; this.env = env; } async getMessages() { return this.state.messages; } getModel() { throw new Error("base provider must not be reached"); } }')}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { DshSubagent, subagentTools, SUBAGENT_UNAVAILABLE_REASON } = await import("../src/index.ts");
assert.equal(DshSubagent.name, "DshSubagent", "the persisted facet class export remains resolvable");
for (const PLATFORM_AI_ENABLED of [undefined, "false", "true"]) {
  let hostCalls = 0, providerCalls = 0;
  const env = { PLATFORM_AI_ENABLED, AI_GATEWAY_ID: "operator-gateway",
    AI: { gateway() { providerCalls++; throw new Error("must not reach provider"); } },
    SESSION_HOST: { idFromName() { hostCalls++; throw new Error("must not address an owner Host"); } } };
  // Commit 1's deleted migration cleared facet storage; a resurrected namespace
  // starts empty, so the only honest first read is an empty history.
  const child = new DshSubagent({ messages: [] } as never, env as never);
  assert.deepEqual(subagentTools.tools!(env as never, {} as never), {}, "no broken delegate tool may be advertised even when platform AI is enabled");
  assert.deepEqual(Object.keys(subagentTools.tools!(env as never, {} as never)), [], "the model-facing tool catalog stays empty");
  const prompt = subagentTools.prompt!(env as never, {} as never).map(part => part.text).join("\n");
  assert.ok(prompt.includes(SUBAGENT_UNAVAILABLE_REASON));
  assert.match(prompt, /do not claim that a subagent was launched/);
  assert.throws(() => child.getModel(), error => error instanceof Error && error.message === SUBAGENT_UNAVAILABLE_REASON);
  assert.throws(() => child.beforeTurn(), error => error instanceof Error && error.message === SUBAGENT_UNAVAILABLE_REASON);
  await assert.rejects(child.beforeStep(), error => error instanceof Error && error.message === SUBAGENT_UNAVAILABLE_REASON);
  await assert.rejects(child.beforeToolCall(), error => error instanceof Error && error.message === SUBAGENT_UNAVAILABLE_REASON);
  assert.deepEqual(child.getTools(), {});
  assert.deepEqual(await child.getMessages(), [], "first read of the restored class is empty; no history is claimed or fabricated");
  assert.deepEqual({ hostCalls, providerCalls }, { hostCalls: 0, providerCalls: 0 });
}
console.log("subagent availability: no delegation advertisement; compatibility export/read path resolvable; first read empty (no history to verify); model/turn/step/tool fail closed with zero Host/provider access");
