/** Plane-neutral fallback model catalog projection for the legacy Host transport. */
export interface FallbackModelAccess {
  readonly providers?: Readonly<Record<string, {
    readonly available: boolean;
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
  "deepseek-official": [
    { id: "deepseek-official/deepseek-flash", name: "DeepSeek-V4.1-Flash" },
    { id: "deepseek-official/deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
  ],
  "cloudflare-ai-gateway": [
    { id: "cloudflare-ai-gateway/deepseek-flash", name: "DeepSeek-V4.1-Flash" },
    { id: "cloudflare-ai-gateway/deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
  ],
} as const;
const strip = (id: string): string => id.replace(/^(?:deepseek-official|cloudflare-ai-gateway)\//u, "");

/** Build the same two-provider catalog the formal session/modelCatalog returns. */
export function buildFallbackModelCatalog(access: FallbackModelAccess) {
  const group = (id: "deepseek-official" | "cloudflare-ai-gateway") => {
    const provider = access.providers?.[id];
    const available = provider?.available === true;
    const models = available
      ? (provider?.catalog ?? []).map(model => ({ id: model.id, name: model.label || strip(model.id) }))
      : DEFAULTS[id].map(model => ({ id: model.id, name: model.name }));
    return {
      available: available && models.length > 0,
      models: models.map(model => ({ id: model.id, name: model.name, reasoning: REASONING, ...(available ? {} : { unavailable: true, unavailableReason: id === "cloudflare-ai-gateway" ? "Cloudflare AI Gateway is not enabled for this deployment." : "The owner DeepSeek API key is not configured or could not be read." }) })),
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
