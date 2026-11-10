/**
 * Single source of truth for the public document surface.
 *
 * SEO decides what to render and auth decides whether an anonymous navigation
 * is allowed; both must agree or a public page redirects to login (the P3
 * regression) and a private page becomes crawlable. This module is the one
 * predicate both planes import. Prefix rules stay in `@dsh-base/locale-path`.
 */

import { LOCALE_IDS, canonicalizeLocalePath, splitLocalePath, type LocaleId } from "../../dsh-base-locale-path/src/index.ts";

const reservedPageSegments = new Set(["api", "agents", "app", "agent", "workspace", "login", "auth", "settings", "admin", "assets", "plugins", "favicon", "en", "zh", "zh-cn", ...LOCALE_IDS]);
/** One path rule for build-time content and live provider registration. */
export function isPublicPagePath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 512
    && /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/u.test(path)
    && !reservedPageSegments.has(path.split("/")[1]!);
}

/** Per-locale copy overrides for one page. */
export interface PublicPageCopy {
  readonly title?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
}

/** One public page that may have localized variants. */
export interface PublicPage {
  /** Locale-neutral path; `/` is the root. */
  readonly path: string;
  /** Editorial kind, used only when the page supplies real article metadata. */
  readonly kind?: string;
  /** Public visibility and search eligibility are independent capabilities. */
  readonly access?: "public" | "authenticated";
  readonly indexable?: boolean;
  readonly status?: "draft" | "published" | "archived";
  readonly publishedAt?: string;
  readonly availableLocales?: readonly LocaleId[];
  /** Optional sitemap hint. */
  readonly changefreq?: string;
  /** Optional sitemap hint; already formatted (for example `0.8`). */
  readonly priority?: string;
  /** Optional sitemap last modification date (`YYYY-MM-DD`); never read from the clock. */
  readonly lastmod?: string;
  /** Optional per-locale copy; merged page → locale → English → built-in fallback. */
  readonly copy?: Partial<Record<LocaleId, PublicPageCopy>>;
  /** Optional social-card image override (a public path or an absolute URL). */
  readonly image?: string;
}

/** Providers register real documents; an administrator's SEO edit is never a route. */
export interface PublicPageProvider {
  list(env: unknown): readonly PublicPage[] | Promise<readonly PublicPage[]>;
  renderBody?(page: PublicPage, locale: LocaleId, env: unknown, options?: PublicPageRenderOptions): string | Promise<string>;
}
export interface PublicPageRenderOptions { readonly brandName: string }
export interface PublicPagesService {
  register(owner: string, provider: PublicPageProvider): () => void;
  list(env: unknown): Promise<readonly PublicPage[]>;
  resolve(env: unknown, path: string, locale: LocaleId): Promise<PublicPage | undefined>;
  renderBody(env: unknown, page: PublicPage, locale: LocaleId, options?: PublicPageRenderOptions): Promise<string | undefined>;
}

export function isPublishedPage(page: PublicPage, now = Date.now()): boolean {
  return (page.status ?? "published") === "published" && (page.access ?? "public") === "public"
    && (page.publishedAt === undefined || Date.parse(page.publishedAt) <= now);
}
export function isIndexablePage(page: PublicPage): boolean {
  return isPublishedPage(page) && page.indexable !== false;
}
export function hasPageLocale(page: PublicPage, locale: LocaleId): boolean {
  return page.availableLocales === undefined || page.availableLocales.includes(locale);
}

/** Search indexing is an explicit deployment decision, never inferred from a label. */
export function indexingPolicy(env: unknown): { enabled: boolean; origin?: string } {
  const value = (env ?? {}) as Record<string, unknown>;
  if (value.SITE_INDEXING_ENABLED !== "true" || value.SITE_DEPLOYMENT_ENVIRONMENT !== "production") return { enabled: false };
  try {
    const origin = new URL(String(value.AUTH_BASE_URL));
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
      || /^(localhost|127\.0\.0\.1|\[::1\])$/u.test(origin.hostname) || /(?:^|\.)example\.(?:com|org|net)$/u.test(origin.hostname)) return { enabled: false };
    return { enabled: true, origin: origin.origin };
  } catch { return { enabled: false }; }
}

/** Public pages and their localized availability. `/login` is intentionally absent. */
export const PUBLIC_PAGES: readonly PublicPage[] = Object.freeze([
  Object.freeze({ path: "/", changefreq: "weekly", priority: "1.0" }),
]);

/** Whether a locale-stripped path is a private product address. */
export function isPrivateDocument(path: string): boolean {
  return /^\/app\/(?:session|workspace)(?:\/|$)/u.test(path);
}

/** Documents that are reachable but must never be indexed (no canonical). */
export function isNoIndexDocument(path: string): boolean {
  return isPrivateDocument(path) || path === "/login";
}

/** Whether a locale-stripped path belongs to the crawlable public surface. */
export function isPublicDocument(path: string): boolean {
  return PUBLIC_PAGES.some(page => page.path === path);
}

/** Public metadata routes, independently supplied by their Worker plugins. */
export const PUBLIC_RESOURCES = Object.freeze({
  sitemap: Object.freeze({ path: "/sitemap.xml", localized: false }),
  robots: Object.freeze({ path: "/robots.txt", localized: false }),
  manifest: Object.freeze({ path: "/manifest.webmanifest", localized: true }),
  llms: Object.freeze({ path: "/llms.txt", localized: true }),
});
export type PublicResourceName = keyof typeof PUBLIC_RESOURCES;
export interface PublicResourceMatch {
  readonly name: PublicResourceName;
  readonly locale: LocaleId;
  readonly canonicalPath: string;
}

/** Resolve exact resource routes; a registered name never grants a directory prefix. */
export function resolvePublicResource(pathname: string): PublicResourceMatch | undefined {
  const canonical = canonicalizeLocalePath(pathname);
  const split = splitLocalePath(canonical);
  for (const name of Object.keys(PUBLIC_RESOURCES) as PublicResourceName[]) {
    const resource = PUBLIC_RESOURCES[name];
    if (resource.localized ? split.path === resource.path : canonical === resource.path) {
      return { name, locale: split.locale, canonicalPath: resource.localized ? split.canonicalPath : resource.path };
    }
  }
  return undefined;
}

/** Auth allowlist: route ownership remains with the independently mounted plugin. */
export function isPublicResource(pathname: string): boolean {
  return resolvePublicResource(pathname) !== undefined;
}
