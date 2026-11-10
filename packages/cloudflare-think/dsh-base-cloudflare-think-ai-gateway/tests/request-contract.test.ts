import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const appRequire = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const sdkEntries = new Map(["ai", "@ai-sdk/openai-compatible"].map(name => [name, pathToFileURL(appRequire.resolve(name)).href]));
registerHooks({ resolve(specifier, context, nextResolve) {
  if (sdkEntries.has(specifier)) return { url: sdkEntries.get(specifier)!, shortCircuit: true };
  if (specifier === "@deepseek-ai/dsh-llm-deepseek/src/models.ts") return { url: new URL("../../../../.submodules/deepseek-harness/packages/llm/llm-deepseek/src/models.ts", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiGateway, DEEPSEEK_MODEL_MAP } = await import("../src/index.ts");
assert.deepEqual(DEEPSEEK_MODEL_MAP, {
  "deepseek-flash": "deepseek-flash", "deepseek-v4-pro": "deepseek-v4-pro",
  "cloudflare-ai-gateway/deepseek-flash": "deepseek-flash", "cloudflare-ai-gateway/deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-official/deepseek-flash": "deepseek-flash", "deepseek-official/deepseek-v4-pro": "deepseek-v4-pro",
});
const captured: { path: string; body: Record<string, unknown>; authorization?: string | null }[] = [];
const actualModel = "provider-returned-revision";
const response = (stream = false) => stream ? new Response([
  { id: "reply", created: 1, model: actualModel, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "fixture reasoning" }, finish_reason: null }] },
  { id: "reply", created: 1, model: actualModel, choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] },
  { id: "reply", created: 1, model: actualModel, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }) : new Response(JSON.stringify({
  id: "reply", created: 1, model: actualModel, choices: [{ index: 0, message: { role: "assistant", content: "OK", reasoning_content: "fixture reasoning" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
}), { headers: { "content-type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = await request.json() as Record<string, unknown>;
  captured.push({ path: request.url, body, authorization: request.headers.get("authorization") });
  return response(body.stream === true);
};
const AI = { gateway(id: string) {
  assert.equal(id, "test-gateway");
  return { async run(request: { provider: string; endpoint: string; query: Record<string, unknown> }) {
    assert.equal(request.provider, "deepseek");
    captured.push({ path: request.endpoint, body: request.query });
    return response(request.query.stream === true);
  } };
} };
const prompt = [
  { role: "user", content: [{ type: "text", text: "Use the tool." }] },
  { role: "assistant", content: [{ type: "reasoning", text: "preserve this prior reasoning" }, { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: "{}" }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "lookup", output: { type: "text", value: "result" } }] },
];
try {
  for (const modelId of Object.keys(DEEPSEEK_MODEL_MAP).filter(id => id.startsWith("cloudflare-ai-gateway/"))) {
    {
      for (const effort of [undefined, "off", "low", "high", "max"] as const) {
        const model = aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" } as never, modelId, {
          userCredential: () => { throw new Error("gateway requests must never read the owner credential"); },
          reasoningEffort: () => effort,
          authorizeOperation: async (operation: string) => { assert.equal(operation, 'platform_ai'); },
        } as never) as unknown as { doGenerate(options: unknown): Promise<{ response?: { modelId?: string } }>; doStream(options: unknown): Promise<{ stream: ReadableStream<{ type: string; modelId?: string }> }> };
        const generated = await model.doGenerate({ prompt });
        assert.equal(generated.response?.modelId, actualModel, "provider provenance must preserve the returned model, not echo the request id");
        const request = captured.at(-1)!;
        assert.equal(request.body.model, modelId.replace(/^(?:cloudflare-ai-gateway|deepseek-official)\//u, ""), "send the canonical provider model, not the UI/provider id");
        assert.deepEqual(request.body.thinking, { type: effort === "off" ? "disabled" : "enabled" });
        if (effort === "off") assert.equal(Object.hasOwn(request.body, "reasoning_effort"), false);
        else assert.equal(request.body.reasoning_effort, effort ?? "high");
        const messages = request.body.messages as { role: string; reasoning_content?: string }[];
        assert.equal(messages.find(message => message.role === "assistant")?.reasoning_content, "preserve this prior reasoning", "real SDK serialization retains tool-step reasoning for the next request");
        assert.equal(request.path, "/chat/completions");
        assert.equal(request.authorization, undefined, "gateway authentication must not expose an owner credential");
        if (effort === "low") {
          const streamed = await model.doStream({ prompt });
          const chunks = [];
          for await (const chunk of streamed.stream) chunks.push(chunk);
          assert.equal(chunks.find(chunk => chunk.type === "response-metadata")?.modelId, actualModel);
          assert.ok(chunks.some(chunk => chunk.type === "reasoning-delta"));
          assert.ok(chunks.some(chunk => chunk.type === "text-delta"));
          assert.deepEqual(captured.at(-1)?.body.thinking, { type: "enabled" });
          assert.equal(captured.at(-1)?.body.reasoning_effort, "low");
        }
      }
    }
  }
  const before = captured.length;
  assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" } as never, "cloudflare-ai-gateway/deepseek-flash", { reasoningEffort: () => "invalid" } as never), /Unsupported DeepSeek reasoning effort/);
  for (const rejected of ["deepseek-flash", "deepseek-official/deepseek-flash"]) {
    assert.throws(() => aiGateway.model!({ AI, PLATFORM_AI_ENABLED: "true", AI_GATEWAY_ID: "test-gateway" } as never, rejected, {} as never), /explicit cloudflare-ai-gateway/u, `${rejected} is never routed to the gateway`);
  }
  assert.equal(captured.length, before, "invalid effort fails before a provider request");
  let allowed = true, authorizations = 0;
  const runtime = { reasoningEffort: () => 'off', async authorizeOperation(operation: string) {
    assert.equal(operation, 'platform_ai'); authorizations++;
    if (!allowed) throw new Error('entitlement_required');
  } };
  const capped = aiGateway.model!({ AI, PLATFORM_AI_ENABLED: 'true', AI_GATEWAY_ID: 'test-gateway', PLATFORM_AI_MAX_OUTPUT_TOKENS: '64' } as never,
    'cloudflare-ai-gateway/deepseek-flash', runtime as never) as unknown as { doGenerate(options: unknown): Promise<unknown>; doStream(options: unknown): Promise<{stream:ReadableStream}> };
  await capped.doGenerate({prompt, maxOutputTokens: 1000}); assert.equal(captured.at(-1)!.body.max_tokens, 64);
  await capped.doGenerate({prompt, maxOutputTokens: 16}); assert.equal(captured.at(-1)!.body.max_tokens, 16);
  await capped.doGenerate({prompt}); assert.equal(captured.at(-1)!.body.max_tokens, 64);
  const beforeRevocation = captured.length;
  allowed = false;
  await assert.rejects(capped.doGenerate({prompt}), /entitlement_required/);
  await assert.rejects(capped.doStream({prompt}), /entitlement_required/);
  assert.equal(captured.length, beforeRevocation, 'a refund or expiry stops later requests from the same model instance before Gateway.run');
  assert.equal(authorizations, 5, 'generate and stream attempts each recheck current authorization');
  const missingRuntime = aiGateway.model!({AI, PLATFORM_AI_ENABLED:'true', AI_GATEWAY_ID:'test-gateway'} as never,
    'cloudflare-ai-gateway/deepseek-flash', {reasoningEffort:()=>undefined} as never) as unknown as {doGenerate(options:unknown):Promise<unknown>};
  await assert.rejects(missingRuntime.doGenerate({prompt}), /entitlements_unavailable/);
  assert.equal(captured.length, beforeRevocation, 'missing trusted authorization never bypasses payment enforcement');
  for (const limit of ['0', '-1', '1.5', 'NaN', '131073', ' 64']) assert.throws(() => aiGateway.model!({AI, PLATFORM_AI_ENABLED:'true', AI_GATEWAY_ID:'test-gateway', PLATFORM_AI_MAX_OUTPUT_TOKENS:limit} as never,
    'cloudflare-ai-gateway/deepseek-flash', runtime as never), /Invalid PLATFORM_AI_MAX_OUTPUT_TOKENS/);
} finally { globalThis.fetch = originalFetch; }
console.log("provider request contract: real SDK, canonical models, efforts, reasoning passback, per-request paid authorization and output cap, no BYOK routing; no external requests");
