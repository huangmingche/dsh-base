import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@deepseek-ai/dsh-llm-deepseek/src/models.ts") return { url: new URL("../../../../.submodules/deepseek-harness/packages/llm/llm-deepseek/src/models.ts", import.meta.url).href, shortCircuit: true };
  if (specifier === "ai") return { url: `data:text/javascript,${encodeURIComponent('export const wrapLanguageModel = ({model}) => model;')}`, shortCircuit: true };
  if (specifier === "@ai-sdk/openai-compatible") return { url: `data:text/javascript,${encodeURIComponent('export const createOpenAICompatible = options => id => ({ id, options });')}`, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiGateway } = await import("../src/index.ts");
const { deepSeek } = await import("../../dsh-base-cloudflare-think-deepseek/src/index.ts");

const gateways: string[] = [];
const runs: unknown[] = [];
const AI = { gateway(id: string) { gateways.push(id); return { async run(request: unknown) { runs.push(request); throw new Error("must not call provider"); } }; } };
const noKeyRuntime = { userCredential: () => undefined, reasoningEffort: () => undefined };

// ADR §12 three id forms: exactly one claimer each, and the claim is decided by
// the id prefix, never by plugin registration order.
const claimers = (modelId: string) => [
  ["aiGateway", aiGateway.matchesModel?.({} as never, modelId) === true],
  ["deepSeek", deepSeek.matchesModel?.({} as never, modelId) === true],
].filter(([, claimed]) => claimed).map(([name]) => name);
assert.deepEqual(claimers("cloudflare-ai-gateway/deepseek-flash"), ["aiGateway"], "gateway ids belong to the platform provider");
assert.deepEqual(claimers("deepseek-official/deepseek-v4-pro"), ["deepSeek"], "explicit DeepSeek ids belong to BYOK");
assert.deepEqual(claimers("deepseek-flash"), ["deepSeek"], "bare ids belong to BYOK");
assert.deepEqual(claimers("unrelated-other-provider/model"), [], "unrelated ids are claimed by nobody");

// Platform opt-in failures happen before any outbound request.
assert.throws(() => aiGateway.model!({ AI } as never, "cloudflare-ai-gateway/deepseek-flash", noKeyRuntime as never), /disabled/u);
assert.deepEqual(gateways, [], "disabled platform never resolves a gateway");
assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true" } as never, "cloudflare-ai-gateway/deepseek-flash", noKeyRuntime as never), /explicit AI_GATEWAY_ID/u);
assert.deepEqual(gateways, [], "missing AI_GATEWAY_ID never resolves a gateway");

// An owner key is never read on the platform route, and the explicit gateway
// selection wins over any stored credential.
const credentialReads: string[] = [];
const runtimeWithKey = { userCredential: () => { credentialReads.push("read"); return "owner-private-test-key" }, reasoningEffort: () => "low" };
const gatewayModel = aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "chosen-gateway" } as never, "cloudflare-ai-gateway/deepseek-flash", runtimeWithKey as never) as unknown as { options: { name: string; apiKey: string } };
assert.equal(gatewayModel.options.name, "cloudflare-ai-gateway-deepseek");
assert.deepEqual(credentialReads, [], "Gateway selection never reads the owner credential");
assert.deepEqual(gateways, ["chosen-gateway"]);

// Fail closed instead of falling back: explicit DeepSeek and bare ids are not
// this provider's business, and unknown gateway ids never reach the binding.
assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "chosen-gateway" } as never, "deepseek-official/deepseek-flash", noKeyRuntime as never), /explicit cloudflare-ai-gateway/u);
assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "chosen-gateway" } as never, "deepseek-flash", noKeyRuntime as never), /explicit cloudflare-ai-gateway/u);
assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "chosen-gateway" } as never, "cloudflare-ai-gateway/unknown-model", noKeyRuntime as never), /unsupported Cloudflare AI Gateway model/u);
assert.deepEqual(gateways, ["chosen-gateway"], "refusals never resolve a second gateway");
assert.deepEqual(runs, [], "no provider request was attempted");
console.log("provider: strict three-form claim partition, explicit platform opt-in + gateway id, zero fallback and zero outbound on refusal");
