/** Localized installation manifest; no HTML or crawler-route ownership. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-site-config";
import { hreflangFor } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { PUBLIC_RESOURCES, resolvePublicResource } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { MANIFEST_CONTENT_TYPE, renderManifest } from "../../../boot/dsh-base-site-seo/src/render.ts";

export const name = "@dsh-base/cloudflare-worker-manifest";
export const inject = ["http", "siteSettings"];
export const Config = undefined;
export interface SiteManifest { readonly path: string }
declare module "@deepseek-ai/cordis" { interface Context { siteManifest: SiteManifest } }

export function apply(ctx: Context): void {
  ctx.provide("siteManifest", { path: PUBLIC_RESOURCES.manifest.path } satisfies SiteManifest);
  ctx.effect(() => ctx.http.use(async (request, env) => {
    const url = new URL(request.url);
    const resource = resolvePublicResource(url.pathname);
    if (resource?.name !== "manifest") return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    if (resource.canonicalPath !== url.pathname) return Response.redirect(new URL(`${resource.canonicalPath}${url.search}`, url.origin).href, 301);
    try {
      const config = (await ctx.siteSettings.read(env)).values.seo;
      const body = renderManifest({ config, locale: resource.locale, origin: url.origin });
      return new Response(request.method === "HEAD" ? null : body, { headers: {
        "content-type": MANIFEST_CONTENT_TYPE, "content-language": hreflangFor(resource.locale), "cache-control": "no-store, no-cache, must-revalidate",
      } });
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "site_settings_unavailable" }), {
        status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }, 20), "dsh-base: public app manifest");
}
