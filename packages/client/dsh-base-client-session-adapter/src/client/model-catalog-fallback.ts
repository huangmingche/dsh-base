import { DEPLOYMENT_MODELS } from "../../../../boot/dsh-base-model-declarations/src/index.ts";
/** Plane-neutral fallback model catalog projection for the legacy Host transport. */
export interface FallbackModelAccess {
  readonly providers?: Readonly<Record<string, {
    readonly available: boolean;
    readonly unavailableReason?: string;
    readonly catalog: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  }>>;
}
const REASONING = {
  efforts: [
    { id: "off", name: "Off", description: "Use for simple tasks that do not need reasoning." },
    { id: "low", name: "Low", description: "Prefer for routine or latency-sensitive tasks." },
    { id: "high", name: "High", description: "The default balance for most tasks." },
    { id: "max", name: "Max", description: "Reserve for the hardest quality-first tasks." },
  ],
  defaultEffort: "high",
} as const;
const DEFAULTS = {
  "deepseek-official": DEPLOYMENT_MODELS.map(model => ({ id: `deepseek-official/${model.id}`, name: model.label })),
  "cloudflare-ai-gateway": DEPLOYMENT_MODELS.map(model => ({ id: `cloudflare-ai-gateway/${model.id}`, name: model.label })),
};
const strip = (id: string): string => id.replace(/^(?:deepseek-official|cloudflare-ai-gateway)\//u, "");

/** Build the same two-provider catalog the formal session/modelCatalog returns. */
export function buildFallbackModelCatalog(access: FallbackModelAccess, unavailable: { readonly gateway?: string; readonly deepseek?: string } = {}) {
  const group = (id: "deepseek-official" | "cloudflare-ai-gateway") => {
    const provider = access.providers?.[id];
    const available = provider?.available === true;
    const models = available
      ? (provider?.catalog ?? []).map(model => ({ id: model.id, name: model.label || strip(model.id) }))
      : DEFAULTS[id].map(model => ({ id: model.id, name: model.name }));
    return {
      available: available && models.length > 0,
      models: models.map(model => ({ id: model.id, name: model.name, reasoning: REASONING, ...(available ? {} : { unavailable: true, unavailableReason: provider?.unavailableReason ?? (id === "cloudflare-ai-gateway" ? unavailable.gateway ?? "Cloudflare AI Gateway is disabled for this deployment or account." : unavailable.deepseek ?? "The owner DeepSeek API key is not configured or could not be read.") }) })),
    };
  };
  const deepseek = group("deepseek-official");
  const gateway = group("cloudflare-ai-gateway");
  return {
    default: gateway.available
      ? { provider: "cloudflare-ai-gateway", model: gateway.models[0].id }
      : deepseek.available ? { provider: "deepseek-official", model: deepseek.models[0].id } : { provider: "deepseek-official", model: "" },
    routableProviders: [...deepseek.available ? ["deepseek-official"] : [], ...gateway.available ? ["cloudflare-ai-gateway"] : []],
    groups: [
      { id: "deepseek-official", name: "DeepSeek", models: deepseek.models },
      { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", models: gateway.models },
    ],
    failures: [],
  };
}
