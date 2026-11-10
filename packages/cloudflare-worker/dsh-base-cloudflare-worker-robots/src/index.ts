/** Public robots rules; the sitemap pointer exists only with its producer. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-site-config";
import type {} from "@dsh-base/cloudflare-worker-sitemap";
import { BASE_LOCALE, LOCALE_IDS, localizePath } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { resolvePublicResource, indexingPolicy } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { resolveSiteOrigin } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { renderRobots } from "./render.ts";

export const name = "@dsh-base/cloudflare-worker-robots";
export const inject = ["http", "siteSettings"];
export const Config = undefined;

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.http.use(async (request, env) => {
    const url = new URL(request.url);
    if (resolvePublicResource(url.pathname)?.name !== "robots") return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    try {
      const config = (await ctx.siteSettings.read(env)).values.seo;
      const policy = indexingPolicy(env);
      const body = renderRobots(policy.origin ?? resolveSiteOrigin(config, url.origin), policy.enabled ? ctx.get("siteSitemap")?.path : undefined,
        LOCALE_IDS, BASE_LOCALE, Object.fromEntries(LOCALE_IDS.map(locale => [locale, localizePath("/", locale)])), config.robots);
      return new Response(request.method === "HEAD" ? null : body, { headers: {
        "content-type": "text/plain; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate",
      } });
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "site_settings_unavailable" }), {
        status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }, 20), "dsh-base: public robots rules");
}
