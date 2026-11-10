/**
 * Worker SEO plugin: localized public and noindex HTML document heads,
 * driven by the shared site-settings document (saved values over deployment
 * defaults). Separate plugins own sitemap, robots, manifest and LLM resources.
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-site-config";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import {
  canonicalizeLocalePath, hreflangFor, splitLocalePath, type LocaleId,
} from "../../../boot/dsh-base-locale-path/src/index.ts";
import type {} from "@dsh-base/cloudflare-worker-manifest";
import {
  PUBLIC_PAGES, indexingPolicy, isNoIndexDocument, isPrivateDocument, isPublicDocument, type PublicPage,
} from "../../../boot/dsh-base-public-pages/src/index.ts";
import {
  resolvePageCopy, type SiteSeoConfig,
} from "../../../boot/dsh-base-site-seo/src/index.ts";
import {
  documentUrl, escapeHtml, renderBrandHead, renderHead, renderJsonLd,
} from "../../../boot/dsh-base-site-seo/src/render.ts";

export const name = "@dsh-base/cloudflare-worker-seo";
export const inject = ["http", "siteSettings", "publicPages"];
export const Config = undefined;

interface AssetEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional deployment override carried as one JSON binding. */
  readonly SITE_SEO_JSON?: unknown;
}

/** Resolve only requests that use SEO; failures must not revive older defaults. */
async function siteConfig(ctx: Context, env: unknown): Promise<SiteSeoConfig> {
  return (await ctx.siteSettings.read(env)).values.seo;
}

/** Registry entry for one locale-stripped public path. */
function publicPage(path: string): PublicPage | undefined {
  return PUBLIC_PAGES.find(page => page.path === path);
}

/** Page-level image override: registry first, then deployment `pages`. */
function pageImage(config: SiteSeoConfig, path: string): string | undefined {
  return publicPage(path)?.image ?? config.pages?.[path]?.image;
}

/**
 * Render one HTML shell with the complete head for its locale.
 * Private and login documents stay noindex and carry no canonical, Open Graph
 * or JSON-LD, exactly like before the extension.
 */
function renderHtml(shell: string, path: string, origin: string, locale: LocaleId, config: SiteSeoConfig, manifestPath: string | false, page = publicPage(path), noIndex = false): string {
  const copy = resolvePageCopy(config, path, locale, page?.copy);
  const lang = hreflangFor(locale);
  const withDocument = shell
    .replace(/<html[^>]*>/iu, `<html lang="${lang}">`)
    .replace(/<title>[\s\S]*?<\/title>/iu, `<title>${escapeHtml(copy.title)}</title>`);
  if (isNoIndexDocument(path)) {
    return withDocument.replace("</head>", `    <meta name="robots" content="noindex, nofollow" />\n    ${renderBrandHead({ config, locale, origin, manifestPath })}\n  </head>`);
  }
  const image = page?.image ?? pageImage(config, path);
  const tags = renderHead({
    config, path, locale, origin, copy, manifestPath, availableLocales: page?.availableLocales,
    ...(image === undefined ? {} : { pageImage: image }),
  });
  const jsonLd = renderJsonLd({
    config, locale, origin, canonical: documentUrl(config, path, locale, origin),
  });
  return withDocument.replace("</head>", `    ${noIndex ? '<meta name="robots" content="noindex, nofollow" />' : ''}\n    ${tags}\n    ${jsonLd}\n  </head>`);
}

/** Whether a pathname is an SPA navigation rather than an API, agent, or hashed asset request. */
function isDocumentNavigation(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/agents/") || pathname.startsWith("/assets/")) return false;
  if (pathname === "/favicon.svg" || pathname === "/favicon-dark.svg" || pathname === "/manifest.webmanifest") return false;
  const last = pathname.split("/").at(-1) ?? "";
  return !last.includes(".");
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.http.use(async (request, env) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") return undefined;
      if (!isDocumentNavigation(url.pathname)) return undefined;
      // One prefix implementation (the shared module). Case variants such as
      // `/ZH-CN/...` are 301s to the canonical spelling; `/en/*` is the explicit
      // base-locale form of the unprefixed document and 301s to the bare address.
      const canonical = canonicalizeLocalePath(url.pathname);
      if (canonical !== url.pathname) {
        const target = new URL(url.href); target.pathname = canonical;
        return Response.redirect(target.href, 301);
      }
      const split = splitLocalePath(url.pathname);
      if (split.needsLocaleRedirect) {
        const target = new URL(url.href); target.pathname = split.canonicalPath;
        return Response.redirect(target.href, 301);
      }
      // Public documents and the login shell belong to this plugin. Private
      // documents are still rendered for authenticated navigations so the first
      // screen carries the correct lang/title, but they are noindex and get no
      // canonical; an anonymous visitor was already redirected by the auth gate
      // (request priority 0, ahead of this handler) before this code runs.
      const registry = ctx.get("publicPages");
      const page = registry ? await registry.resolve(env, split.path, split.locale) : publicPage(split.path);
      if (!page && split.path !== "/login" && !isPrivateDocument(split.path)) return undefined;
      const accept = request.headers.get("accept") ?? "";
      if (!page && !accept.includes("text/html") && accept !== "*/*") return undefined;
      const shellResponse = await (env as AssetEnv).ASSETS.fetch(new Request(new URL("/", url.origin), { headers: { accept: "text/html" } }));
      if (!shellResponse.ok) return undefined;
      let shell = await shellResponse.text();
      const saved = await siteConfig(ctx, env);
      const policy = indexingPolicy(env);
      // Production has one operator-declared canonical origin; aliases never create new sitemap domains.
      if (page && policy.enabled && policy.origin !== url.origin) return Response.redirect(new URL(`${url.pathname}${url.search}`, policy.origin).href, 301);
      const config = policy.origin ? {...saved, site: {...saved.site, url: policy.origin}} : saved;
      const content = page && registry ? await registry.renderBody(env, page, split.locale, {brandName: saved.site.name}) : undefined;
      if (content !== undefined) {
        // Public documents hydrate their own official-component plugin. Booting the
        // private workspace composition here would erase the pre-rendered article.
        shell = shell.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
          .replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/giu, "")
          .replace(/<body[^>]*>[\s\S]*?<\/body>/iu, () => `<body>${content}</body>`);
      }
      const noIndex = !policy.enabled || page?.indexable === false || isNoIndexDocument(split.path);
      const body = renderHtml(shell, split.path, url.origin, split.locale, config, ctx.get("siteManifest")?.path ?? false, page, noIndex);
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-language": hreflangFor(split.locale),
          "cache-control": "no-store, no-cache, must-revalidate",
          ...(noIndex ? { "x-robots-tag": "noindex, nofollow" } : {}),
        },
      });
    } catch {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "site_settings_unavailable" }), {
        status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }, 20), "dsh-base: localized document metadata");
}
