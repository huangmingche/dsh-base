import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dsh-base/cloudflare-worker-http";
import { LOCALE_IDS, splitLocalePath, type LocaleId } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { PUBLIC_PAGES, hasPageLocale, indexingPolicy, isPublishedPage, isPublicPagePath, type PublicPage, type PublicPageProvider, type PublicPagesService } from "../../../boot/dsh-base-public-pages/src/index.ts";

export const name = "@dsh-base/cloudflare-worker-public-pages";
export const inject = ["http"];
export const Config = undefined;
export type { PublicPagesService, PublicPageProvider };
declare module "@deepseek-ai/cordis" { interface Context { publicPages: PublicPagesService } }

function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value) && Number.isFinite(Date.parse(value)); }

/** Reject ambiguous addresses, reserved namespaces and declarations that could publish private UI. */
export function validatePage(page: PublicPage): void {
  if (!page || typeof page !== "object" || !isPublicPagePath(page.path)) throw new Error("Invalid or reserved public document path");
  if (page.access !== "public" && page.access !== "authenticated") throw new Error("Document access must be explicit");
  if (typeof page.indexable !== "boolean" || !["draft", "published", "archived"].includes(page.status ?? "")) throw new Error("Document publication and indexing must be explicit");
  if (page.access !== "public" && page.indexable) throw new Error("Private documents cannot be indexed");
  if (!Array.isArray(page.availableLocales) || page.availableLocales.length === 0 || new Set(page.availableLocales).size !== page.availableLocales.length
    || page.availableLocales.some(locale => !LOCALE_IDS.includes(locale))) throw new Error("Document languages must exist and be unique");
  for (const date of [page.publishedAt, page.lastmod]) if (date !== undefined && !validDate(date)) throw new Error("Invalid document date");
  if (page.status === "published" && page.publishedAt === undefined) throw new Error("Published documents require a publication date");
}

export function createPublicPages(now: () => number = Date.now): PublicPagesService {
  const providers = new Map<string, PublicPageProvider>();
  async function snapshot(env: unknown) {
    const rows: Array<{page: PublicPage; provider?: PublicPageProvider}> = PUBLIC_PAGES.map(page => ({page}));
    const paths = new Set(rows.map(row => row.page.path));
    for (const provider of providers.values()) {
      const declared = await provider.list(env);
      if (!Array.isArray(declared) || declared.length > 10000) throw new Error("Invalid public page inventory");
      for (const page of declared) {
        validatePage(page);
        if (paths.has(page.path)) throw new Error(`Duplicate public document: ${page.path}`);
        paths.add(page.path);
        if (isPublishedPage(page, now())) rows.push({page, provider});
      }
    }
    return rows;
  }
  return {
    register(owner, provider) {
      if (!/^cloudflare:worker:[a-z0-9:-]+$/u.test(owner) || providers.has(owner) || typeof provider.list !== "function") throw new Error("Invalid or duplicate document provider");
      providers.set(owner, provider);
      return () => { if (providers.get(owner) === provider) providers.delete(owner); };
    },
    async list(env) { return (await snapshot(env)).map(row => row.page); },
    async resolve(env, path, locale) { return (await snapshot(env)).find(row => row.page.path === path && hasPageLocale(row.page, locale))?.page; },
    async renderBody(env, page, locale, options) {
      const row = (await snapshot(env)).find(row => row.page.path === page.path && hasPageLocale(row.page, locale));
      return row?.provider?.renderBody?.(row.page, locale, env, options);
    },
  };
}

export function apply(ctx: Context): void {
  const service = createPublicPages();
  ctx.provide("publicPages", service);
  ctx.effect(() => ctx.http.use(async (request, env) => {
    if (new URL(request.url).pathname !== "/api/public-pages") return undefined;
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405, headers: {allow: "GET, HEAD"}});
    try {
      // Only published metadata is exposed; provider code and drafts never leave the server.
      const pages = (await service.list(env)).map(({path, availableLocales, copy, indexable}) => ({path, availableLocales: availableLocales ?? LOCALE_IDS, copy, indexable: indexable !== false}));
      return new Response(request.method === "HEAD" ? null : JSON.stringify({pages}), {headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex"}});
    } catch { return new Response(null, {status: 503, headers: {"cache-control": "no-store"}}); }
  }, 5), "dsh-base: published page inventory");
  ctx.effect(() => ctx.http.useResponse((request, env, response) => {
    if (indexingPolicy(env).enabled && response.status < 400) return response;
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set("cache-control", "no-store");
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
  }), "dsh-base: deployment indexing policy");
}
