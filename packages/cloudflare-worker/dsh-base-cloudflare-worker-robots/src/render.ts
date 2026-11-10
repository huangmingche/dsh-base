/** Pure robots renderer; no database or runtime plugin dependency. */
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

/** Public paths that authenticated product UI must not expose to crawlers. */
export const ROBOTS_DISALLOW = Object.freeze(["/api/", "/agents/", "/app/session/", "/app/workspace/"]);

/** Optional deployment additions to the default robots block. */
export interface RobotsAdditions {
  /** Extra `Disallow:` paths; the default block is always emitted. */
  readonly disallow?: readonly string[];
  /** Raw lines appended after the rules; `User-agent:` lines are refused upstream. */
  readonly extraLines?: readonly string[];
}

/**
 * Render the public robots document, with localized disallow variants.
 * @param origin - deployment origin.
 * @param sitemapPath - sitemap path on that origin.
 * @param locales - locales to localize the disallow rules for.
 * @param baseLocale - locale whose URLs carry no prefix.
 * @param pathPrefix - optional locale prefix map.
 * @param additions - optional deployment `disallow` paths and raw extra lines.
 * @returns the robots.txt body.
 */
export function renderRobots(
  origin: string,
  sitemapPath: string | undefined,
  locales: readonly string[],
  baseLocale: string,
  pathPrefix?: Readonly<Record<string, string>>,
  additions?: RobotsAdditions,
): string {
  const rules = ROBOTS_DISALLOW.flatMap((path) => locales.map((locale) => pageUrl(origin, path, locale, baseLocale, pathPrefix).replace(origin.replace(/\/+$/u, ""), "")));
  for (const path of additions?.disallow ?? []) rules.push(path.startsWith("/") ? path : `/${path}`);
  const unique = rules.filter((path, index, all) => all.indexOf(path) === index)
    .map((path) => `Disallow: ${path}`);
  const extra = (additions?.extraLines ?? []).filter(line => line.trim() !== "" && !/[\r\n]/u.test(line) && !/^\s*(?:user-agent|sitemap)\s*:/iu.test(line));
  const base = origin.replace(/\/+$/u, "");
  const sitemap = sitemapPath === undefined ? "" : `\nSitemap: ${base}${sitemapPath.startsWith("/") ? sitemapPath : `/${sitemapPath}`}\n`;
  return `User-agent: *\nAllow: /\n${unique.join("\n")}${extra.length === 0 ? "" : `\n${extra.join("\n")}`}\n${sitemap}`;
}
