/** Independently composed public sitemap, backed by the shared site document. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-site-config";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import { BASE_LOCALE, LOCALE_IDS, hreflangFor, localizePath } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { PUBLIC_PAGES, PUBLIC_RESOURCES, resolvePublicResource, indexingPolicy, isIndexablePage, type PublicPage } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { resolveSiteOrigin, type SiteSeoConfig } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { renderSitemap } from "./render.ts";

export const name = "@dsh-base/cloudflare-worker-sitemap";
export const inject = ["http", "siteSettings", "publicPages"];
export const Config = undefined;
export interface SiteSitemap { readonly path: string }
declare module "@deepseek-ai/cordis" { interface Context { siteSitemap: SiteSitemap } }

/** Configuration can describe registered public pages, never publish new routes. */
export function sitemapDocument(config: SiteSeoConfig, requestOrigin: string, pages: readonly PublicPage[] = PUBLIC_PAGES): string {
  pages = pages.filter(isIndexablePage);
  return renderSitemap({
    origin: resolveSiteOrigin(config, requestOrigin), baseLocale: BASE_LOCALE, locales: LOCALE_IDS,
    pathPrefix: Object.fromEntries(LOCALE_IDS.map(locale => [locale, localizePath("/", locale)])),
    hreflang: Object.fromEntries(LOCALE_IDS.map(locale => [locale, hreflangFor(locale)])),
    localizedPaths: pages.map(page => page.path),
    pages: pages.map(page => {
      const override = config.pages?.[page.path];
      return { ...page, ...override, path: page.path, availableLocales: page.availableLocales, lastmod: page.lastmod ?? override?.lastmod };
    }),
  });
}

export function apply(ctx: Context): void {
  ctx.provide("siteSitemap", { path: PUBLIC_RESOURCES.sitemap.path } satisfies SiteSitemap);
  ctx.effect(() => ctx.http.use(async (request, env) => {
    const url = new URL(request.url);
    if (resolvePublicResource(url.pathname)?.name !== "sitemap") return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    try {
      const policy = indexingPolicy(env);
      const config = (await ctx.siteSettings.read(env)).values.seo;
      const pages = policy.enabled ? await ctx.publicPages.list(env) : [];
      const effective = policy.origin ? {...config, site: {...config.site, url: policy.origin}} : config;
      const body = sitemapDocument(effective, url.origin, pages);
      return new Response(request.method === "HEAD" ? null : body, { headers: {
        "content-type": "application/xml; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate", "x-robots-tag": "noindex",
      } });
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "site_settings_unavailable" }), {
        status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }, 20), "dsh-base: public sitemap");
}
