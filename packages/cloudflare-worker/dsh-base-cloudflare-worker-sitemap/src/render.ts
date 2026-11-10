/**
 * Pure sitemap renderer for the public document surface.
 *
 * Mirrors the mkfast/TanStarter pattern without its framework: typed page
 * entries, per-locale canonical URLs, reciprocal `xhtml:link` alternates,
 * `x-default` only when the base locale is available, and XML escaping.
 * Kept framework-free so `node --experimental-strip-types` can test it.
 */

/** One public page that may have localized variants. */
export interface SitemapPage {
  /** Locale-neutral path; `/` is the root. */
  readonly path: string;
  /** Locales where this page exists; omitted means every configured locale. */
  readonly availableLocales?: readonly string[];
  /** Optional sitemap hint. */
  readonly changefreq?: string;
  /** Optional sitemap hint; already formatted (for example `0.8`). */
  readonly priority?: string;
  /** Optional last modification date (ISO `YYYY-MM-DD`). */
  readonly lastmod?: string;
}

/** Inputs required to render one sitemap document. */
export interface SitemapOptions {
  /** Deployment origin without a trailing slash. */
  readonly origin: string;
  /** Locale whose URLs carry no prefix. */
  readonly baseLocale: string;
  /** Every configured locale, in output order. */
  readonly locales: readonly string[];
  /** Locale-neutral path prefix per locale, relative to the origin. */
  readonly pathPrefix?: Readonly<Record<string, string>>;
  /** Locale → `hreflang` value; defaults to the locale itself. */
  readonly hreflang?: Readonly<Record<string, string>>;
  /** Paths that have locale variants; any other path is emitted once. */
  readonly localizedPaths: readonly string[];
  /** Pages to publish, in output order. */
  readonly pages: readonly SitemapPage[];
}

/** Escape XML text and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Locale prefix, normalized to start with `/` for non-base locales. */
function prefixOf(locale: string, baseLocale: string, pathPrefix: Readonly<Record<string, string>> | undefined): string {
  const configured = pathPrefix?.[locale] ?? (locale === baseLocale ? "" : `/${locale}`);
  if (configured === "" || configured === "/") return "";
  return configured.startsWith("/") ? configured : `/${configured}`;
}

/** Absolute URL for one localized page. */
export function pageUrl(origin: string, path: string, locale: string, baseLocale: string, pathPrefix?: Readonly<Record<string, string>>): string {
  const base = origin.replace(/\/+$/u, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const prefix = prefixOf(locale, baseLocale, pathPrefix);
  const localized = prefix === "" ? normalized : prefix === "/" ? normalized : `${prefix}${normalized === "/" ? "" : normalized}`;
  return `${base}${localized === "/" ? "/" : localized}`;
}

/** Whether a page path participates in locale variants. */
function isLocalized(path: string, localizedPaths: readonly string[]): boolean {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return localizedPaths.some((candidate) => normalized === candidate || (candidate !== "/" && candidate.endsWith("/") && normalized.startsWith(candidate)));
}

/**
 * Render a deterministic sitemap document.
 * @param options - deployment origin, locales, localized path set, and pages.
 * @returns the XML body.
 */
export function renderSitemap(options: SitemapOptions): string {
  const entries: string[] = [];
  for (const page of options.pages) {
    const path = page.path.startsWith("/") ? page.path : `/${page.path}`;
    const localized = isLocalized(path, options.localizedPaths);
    const available = localized
      ? options.locales.filter((locale) => (page.availableLocales ?? options.locales).includes(locale))
      : [];
    // An explicit empty availability means the page is not published yet.
    if (localized && page.availableLocales !== undefined && available.length === 0) continue;
    const targetLocales: readonly (string | undefined)[] = localized ? available : [undefined];
    for (const locale of targetLocales) {
      const url = locale === undefined
        ? pageUrl(options.origin, path, options.baseLocale, options.baseLocale)
        : pageUrl(options.origin, path, locale, options.baseLocale, options.pathPrefix);
      const alternates = localized
        ? available.map((availableLocale) => {
            const href = pageUrl(options.origin, path, availableLocale, options.baseLocale, options.pathPrefix);
            const hreflang = options.hreflang?.[availableLocale] ?? availableLocale;
            return `\n    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}" />`;
          }).join("")
        : "";
      const fallback = localized && available.includes(options.baseLocale)
        ? `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(pageUrl(options.origin, path, options.baseLocale, options.baseLocale, options.pathPrefix))}" />`
        : "";
      const lastmod = page.lastmod === undefined ? "" : `\n    <lastmod>${escapeXml(page.lastmod)}</lastmod>`;
      const changefreq = page.changefreq === undefined ? "" : `\n    <changefreq>${escapeXml(page.changefreq)}</changefreq>`;
      const priority = page.priority === undefined ? "" : `\n    <priority>${escapeXml(page.priority)}</priority>`;
      entries.push(`  <url>\n    <loc>${escapeXml(url)}</loc>${alternates}${fallback}${lastmod}${changefreq}${priority}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>`;
}
