/**
 * Explicit Cloudflare AI Gateway provider.
 *
 * ADR §12 routing contract: `cloudflare-ai-gateway/*` ids belong to this
 * provider only; `deepseek-official/*` and legacy bare ids belong to the owner
 * BYOK provider only. A gateway selection never reads an owner key, and a
 * DeepSeek selection never spends platform quota; there is no implicit fallback
 * in either direction. Platform usage requires an explicit gateway id plus
 * `PLATFORM_AI_ENABLED=true` and `AI_GATEWAY_ID`, or the request fails closed
 * before any outbound call.
 */
import type { DshAgentRuntime, DshPlugin } from "@dsh-base/cloudflare-think-core";
import { wrapLanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DEFAULT_MODELS } from "@deepseek-ai/dsh-llm-deepseek/src/models.ts";
import { deepSeekRequestBody } from "./request-options.ts";
import { deepseekModelId, gatewayModelId, isGatewayModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";

/** Bindings consumed by the gateway provider. */
export interface AiGatewayEnv {
  AI: Ai;
  AI_GATEWAY_ID?: string;
  /** Explicit operator opt-in; the platform route stays off by default. */
  PLATFORM_AI_ENABLED?: string;
  /** Optional deployment cap for each provider attempt; empty preserves the existing provider limit. */
  PLATFORM_AI_MAX_OUTPUT_TOKENS?: string;
}

/** DSH catalog model ids mapped to DeepSeek provider model ids (provider catalog, not claim logic). */
export const DEEPSEEK_MODEL_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEFAULT_MODELS.flatMap(model => [[model.id, model.id], [deepseekModelId(model.id), model.id], [gatewayModelId(model.id), model.id]])),
);

/**
 * AI SDK provider whose fetch is the AI binding's gateway runner. The binding
 * performs gateway authentication and provider-key lookup, so no provider
 * secret ever reaches the Worker env or the browser.
 */
function gatewayProvider(env: AiGatewayEnv, effort: string | undefined, runtime: DshAgentRuntime | undefined) {
  if (env.PLATFORM_AI_ENABLED !== "true") throw new Error("Cloudflare AI Gateway is disabled for this deployment; the platform route is opt-in (zero outbound)");
  const gatewayId = env.AI_GATEWAY_ID;
  if (gatewayId === undefined || gatewayId.trim() === "") throw new Error("Platform AI requires an explicit AI_GATEWAY_ID; no platform provider is registered without it");
  const configuredLimit = env.PLATFORM_AI_MAX_OUTPUT_TOKENS;
  const maximum = configuredLimit === undefined || configuredLimit === '' ? undefined : Number(configuredLimit);
  if (maximum !== undefined && (!/^\d+$/u.test(configuredLimit!) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 131072)) throw new Error('Invalid PLATFORM_AI_MAX_OUTPUT_TOKENS');
  const gateway = env.AI.gateway(gatewayId);
  const gatewayFetch: typeof fetch = async (input, init) => {
    if (typeof runtime?.authorizeOperation !== 'function') throw new Error('entitlements_unavailable');
    await runtime.authorizeOperation('platform_ai');
    const request = new Request(input, init);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.clone().json().catch(() => undefined);
    if (maximum !== undefined) {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Invalid platform inference request');
      const values = body as Record<string, unknown>;
      const supplied = ['max_tokens', 'max_completion_tokens'].flatMap(key => {
        const value = values[key];
        if (value === undefined) return [];
        if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid platform output token limit');
        return [value as number];
      });
      values.max_tokens = Math.min(maximum, ...supplied);
      delete values.max_completion_tokens;
    }
    return gateway.run({
      provider: "deepseek",
      endpoint: "/chat/completions",
      headers: { "Content-Type": "application/json" },
      query: body,
    }, { signal: request.signal });
  };
  return createOpenAICompatible({
    name: "cloudflare-ai-gateway-deepseek",
    baseURL: "https://ai-gateway.dsh-base.invalid/deepseek",
    apiKey: "gateway-binding",
    fetch: gatewayFetch,
    transformRequestBody: deepSeekRequestBody(effort),
  });
}

/** Wrap a provider model so each SDK retry attempt is reported to the agent. */
function retryAware(model: ReturnType<ReturnType<typeof createOpenAICompatible>>, runtime: DshAgentRuntime | undefined) {
  let previousFailed = false;
  const middleware = {
    wrapGenerate: async ({ doGenerate }: { doGenerate: () => Promise<unknown> }) => {
      if (previousFailed) {
        previousFailed = false;
        runtime?.noteModelRetry?.({ message: "model request failed; retrying" });
      }
      try { return await doGenerate(); } catch (error) { previousFailed = true; throw error; }
    },
    wrapStream: async ({ doStream }: { doStream: () => Promise<unknown> }) => {
      if (previousFailed) {
        previousFailed = false;
        runtime?.noteModelRetry?.({ message: "model stream failed; retrying" });
      }
      try { return await doStream(); } catch (error) { previousFailed = true; throw error; }
    },
  };
  return wrapLanguageModel({ model, middleware } as never);
}

/** DeepSeek through Cloudflare AI Gateway; explicit gateway ids only. */
export const aiGateway: DshPlugin<AiGatewayEnv> = {
  name: "cloudflare-ai-gateway",
  // Strict partitioning: only explicit gateway ids belong to the platform
  // provider. `deepseek-official/*` and bare ids stay with the BYOK provider,
  // so a missing owner key can never silently spend platform quota.
  matchesModel: (_env, modelId) => isGatewayModelId(modelId),
  model: (env, modelId, runtime?: DshAgentRuntime) => {
    if (modelId === undefined) throw new Error("Cloudflare AI Gateway model id is required");
    if (!isGatewayModelId(modelId)) throw new Error(`Cloudflare AI Gateway serves explicit cloudflare-ai-gateway/* ids only: ${modelId}`);
    const providerModel = DEEPSEEK_MODEL_MAP[modelId];
    if (providerModel === undefined) throw new Error(`unsupported Cloudflare AI Gateway model: ${modelId}`);
    // Every failure below happens before any outbound request.
    const model = gatewayProvider(env, runtime?.reasoningEffort(), runtime)(providerModel);
    return retryAware(model, runtime) as never;
  },
};
