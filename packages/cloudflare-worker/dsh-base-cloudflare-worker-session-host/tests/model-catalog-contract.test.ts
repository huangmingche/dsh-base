/** Formal RPC and client fallback model catalogs must be the same projection. */
import assert from "node:assert/strict";
import { toOfficialModelCatalog } from "../src/remote-mapping.ts";
import { buildFallbackModelCatalog } from "../../../client/dsh-base-client-session-adapter/src/client/model-catalog-fallback.ts";

type Catalog = Array<{ id: string; label: string }>;
function compare(label: string, access: { providers?: Record<string, { available: boolean; catalog: Catalog }> }): void {
  const deepseek = access.providers?.["deepseek-official"];
  const gateway = access.providers?.["cloudflare-ai-gateway"];
  const models = [
    ...deepseek?.available === true ? deepseek.catalog.map(model => ({ id: model.id, label: model.label })) : [],
    ...gateway?.available === true ? gateway.catalog.map(model => ({ id: model.id, label: model.label })) : [],
  ];
  const formal = toOfficialModelCatalog(models, {
    ...deepseek?.available === true ? { deepseek: deepseek.catalog.map(model => ({ id: model.id.replace(/^deepseek-official\//u, ""), label: model.label })) } : {},
    ...gateway?.available === true ? { gateway: gateway.catalog.map(model => ({ id: model.id.replace(/^cloudflare-ai-gateway\//u, ""), label: model.label })) } : {},
  });
  assert.deepEqual(buildFallbackModelCatalog(access), formal, label);
}
compare("gateway default", { providers: {
  "deepseek-official": { available: false, catalog: [] },
  "cloudflare-ai-gateway": { available: true, catalog: [{ id: "cloudflare-ai-gateway/deepseek-flash", label: "DeepSeek-V4.1-Flash" }, { id: "cloudflare-ai-gateway/deepseek-v4-pro", label: "DeepSeek-V4-Pro" }] },
} });
compare("custom deepseek without flash", { providers: {
  "deepseek-official": { available: true, catalog: [{ id: "deepseek-official/owner-model", label: "Owner Model" }] },
  "cloudflare-ai-gateway": { available: false, catalog: [] },
} });
compare("explicit empty directory", { providers: {
  "deepseek-official": { available: true, catalog: [] },
  "cloudflare-ai-gateway": { available: false, catalog: [] },
} });
compare("both unavailable", { providers: {
  "deepseek-official": { available: false, catalog: [] },
  "cloudflare-ai-gateway": { available: false, catalog: [] },
} });
console.log("model catalog contract: formal RPC and client fallback match for gateway default, custom DeepSeek, empty and unavailable providers");
