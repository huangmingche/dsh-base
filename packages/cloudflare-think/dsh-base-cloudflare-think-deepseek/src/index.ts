/** Official DeepSeek provider for the Workers Think agent (owner BYOK, no platform gateway). */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { DshAgentRuntime, DshPlugin } from "@dsh-base/cloudflare-think-core";

/** Deployment default endpoint; the Host freezes the owner's configured base URL per turn. */
const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

/** Deployment model ids; the Host may address them bare or with the official provider prefix. */
const MODELS = new Set(["deepseek-flash", "deepseek-v4-pro"]);

/** Strip the official `deepseek-official/` provider prefix used by frozen executions. */
function bareModelId(modelId: string): string {
  return modelId.startsWith("deepseek-official/") ? modelId.slice("deepseek-official/".length) : modelId;
}

/**
 * Official DeepSeek provider seam: the Host decrypts the owner's API key and
 * endpoint before each turn, so the model is constructed per execution and never
 * cached across owners. No platform gateway or deployment key is involved.
 */
export const deepSeek: DshPlugin = {
  name: "deepseek-official",
  matchesModel: (_env, modelId: string) => MODELS.has(bareModelId(modelId)),
  model: (_env, modelId = "deepseek-flash", runtime?: DshAgentRuntime) => {
    const apiKey = runtime?.userCredential?.();
    if (typeof apiKey !== "string" || apiKey === "") {
      throw new Error("DeepSeek requires an owner API key; configure one in Settings → Models");
    }
    const baseURL = runtime?.deepSeekBaseURL?.() ?? DEFAULT_BASE_URL;
    const provider = createOpenAICompatible({ name: "deepseek-official", baseURL, apiKey });
    // The AI SDK model is structurally a ThinkModel; the SDK majors in this
    // workspace are pinned by apps/web.
    return provider.chatModel(bareModelId(modelId)) as unknown as NonNullable<ReturnType<NonNullable<DshPlugin["model"]>>>;
  },
};
