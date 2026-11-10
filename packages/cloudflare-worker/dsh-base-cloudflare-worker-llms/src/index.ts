/** A small, truthful public site summary; never an export of private product data. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-site-config";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import { hreflangFor } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { PUBLIC_RESOURCES, resolvePublicResource } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { renderLlms } from "./render.ts";

export const name = "@dsh-base/cloudflare-worker-llms";
export const inject = ["http", "siteSettings", "publicPages"];
export const Config = undefined;
export interface SiteLlms { readonly path: string }
declare module "@deepseek-ai/cordis" { interface Context { siteLlms: SiteLlms } }

export function apply(ctx: Context): void {
  ctx.provide("siteLlms", { path: PUBLIC_RESOURCES.llms.path } satisfies SiteLlms);
  ctx.effect(() => ctx.http.use(async (request, env) => {
    const url = new URL(request.url);
    const resource = resolvePublicResource(url.pathname);
    if (resource?.name !== "llms") return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    if (resource.canonicalPath !== url.pathname) return Response.redirect(new URL(`${resource.canonicalPath}${url.search}`, url.origin).href, 301);
    try {
      const config = (await ctx.siteSettings.read(env)).values.seo;
      if (config.llms?.enabled === false) return new Response(null, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      const body = renderLlms(config, resource.locale, url.origin, await ctx.publicPages.list(env));
      return new Response(request.method === "HEAD" ? null : body, { headers: {
        "content-type": "text/plain; charset=utf-8", "content-language": hreflangFor(resource.locale), "cache-control": "no-store, no-cache, must-revalidate",
      } });
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "site_settings_unavailable" }), {
        status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }, 20), "dsh-base: public LLM site summary");
}
