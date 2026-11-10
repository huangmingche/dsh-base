import type { Context } from "@deepseek-ai/cordis";
import { json } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
export const name = "@dsh-base/cloudflare-worker-crisp";
export const inject = ["http"];
export const Config = undefined;
export function crispConfig(input: unknown): { enabled: boolean; websiteId: string | null } {
  const env = (input ?? {}) as { CRISP_ENABLED?: string; CRISP_WEBSITE_ID?: string };
  const websiteId = typeof env.CRISP_WEBSITE_ID === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(env.CRISP_WEBSITE_ID) ? env.CRISP_WEBSITE_ID : null;
  return { enabled: env.CRISP_ENABLED === "true" && websiteId !== null, websiteId: env.CRISP_ENABLED === "true" ? websiteId : null };
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.http.use((request, env) => {
    if (new URL(request.url).pathname !== "/api/saas/crisp") return undefined;
    return request.method === "GET" ? json(crispConfig(env)) : json({ error: "method_not_allowed" }, 405);
  }, 27), "dsh-base: public support widget configuration");
}
