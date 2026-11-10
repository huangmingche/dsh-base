/**
 * Single source of truth for public URL language prefixes.
 *
 * Chinese keeps the historical regional prefix `/zh-CN`; the other six
 * non-English languages use their official bare locale id (`/ja`, `/es`, `/fr`,
 * `/de`, `/pt`, `/ru`) and English stays unprefixed. Path segments therefore no
 * longer equal locale ids for Chinese, so this module owns the one path-segment
 * → locale reverse lookup. `<html lang>` and `hreflang` use BCP-47 (`zh-CN`).
 *
 * Production code must not hand-write either the path prefix or the language
 * tag; the `check:locale-path` guard fails on a second copy.
 */

/** Official DSH locale ids, in dictionary order. */
export const LOCALE_IDS = ["zh", "en", "ja", "es", "fr", "de", "pt", "ru"] as const;
export type LocaleId = typeof LOCALE_IDS[number];

/** The unprefixed locale. */
export const BASE_LOCALE: LocaleId = "en";

/** Path prefix per locale: English has no prefix, Chinese keeps `/zh-CN`. */
export const LOCALE_PREFIXES: Readonly<Record<LocaleId, string>> = Object.freeze({
  zh: "/zh-CN", en: "", ja: "/ja", es: "/es", fr: "/fr", de: "/de", pt: "/pt", ru: "/ru",
});

/** BCP-47 language tag per locale, used by `<html lang>` and `hreflang`. */
const HREFLANG: Readonly<Record<LocaleId, string>> = Object.freeze({
  zh: "zh-CN", en: "en", ja: "ja", es: "es", fr: "fr", de: "de", pt: "pt", ru: "ru",
});

const LOCALE_SET = new Set<string>(LOCALE_IDS);

/** Canonical first path segment per locale (empty for the base locale). */
const LOCALE_PATH_SEGMENTS: Readonly<Record<LocaleId, string>> = Object.freeze(
  Object.fromEntries(LOCALE_IDS.map((locale) => [locale, LOCALE_PREFIXES[locale].replace(/^\//u, "")])) as Record<LocaleId, string>,
);

/** Explicit base-locale spelling; `/en/*` 301s to the bare path. */
const BASE_PATH_SEGMENT = "en";

/** Canonical path segment → locale (Chinese included, base locale excluded). */
const SEGMENT_LOCALE: ReadonlyMap<string, LocaleId> = new Map(
  LOCALE_IDS.filter((locale) => LOCALE_PATH_SEGMENTS[locale] !== "")
    .map((locale) => [LOCALE_PATH_SEGMENTS[locale], locale] as const),
);

/** Case-insensitive path segment → canonical segment, for the canonicalizing 301. */
const SEGMENT_LOWER: ReadonlyMap<string, string> = new Map(
  [...LOCALE_IDS.map((locale) => LOCALE_PATH_SEGMENTS[locale]).filter((segment) => segment !== ""), BASE_PATH_SEGMENT]
    .map((segment) => [segment.toLowerCase(), segment] as const),
);

/**
 * Path shapes that never carry a language prefix: directory roots match only
 * `root` or `root/…` (so `/plugins/eventsfoo` is not excluded by accident), and
 * metadata endpoints match exactly.
 */
const UNPREFIXED_DIRECTORIES = ["/assets", "/api", "/plugins/events"] as const;
const UNPREFIXED_EXACT = ["/sitemap.xml", "/robots.txt"] as const;

const isUnprefixedPath = (raw: string): boolean =>
  UNPREFIXED_DIRECTORIES.some(root => raw === root || raw.startsWith(`${root}/`))
  || UNPREFIXED_EXACT.some(root => raw === root);

/** Narrow an arbitrary string to a known official locale id. */
export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === "string" && LOCALE_SET.has(value);
}

/** Path prefix for a locale (English is the empty string). */
export function prefixFor(locale: LocaleId): string {
  return LOCALE_PREFIXES[locale];
}

/** BCP-47 tag for `<html lang>` / `hreflang` (`zh` → `zh-CN`). */
export function hreflangFor(locale: LocaleId): string {
  return HREFLANG[locale];
}

/** Resolve a canonical path segment (`zh-CN`, `ja`, `en`, …) to its locale. */
export function localeForPathSegment(segment: string | undefined): LocaleId | undefined {
  if (segment === undefined || segment === "") return undefined;
  if (segment === BASE_PATH_SEGMENT) return BASE_LOCALE;
  return SEGMENT_LOCALE.get(segment);
}

/** Whether a raw first segment is a canonical locale prefix (`zh-CN` is the only non-id one). */
export function isLocalePrefix(segment: string | undefined): boolean {
  return localeForPathSegment(segment) !== undefined;
}

export interface LocalePath {
  /** Locale selected by the outermost prefix; base locale when there is none. */
  readonly locale: LocaleId;
  /** Path with the locale prefix removed (always starts with "/"). */
  readonly path: string;
  /** Whether a known locale prefix was present. */
  readonly prefixed: boolean;
  /** True for `/en/*`: callers should 301 to {@link canonicalPath}. */
  readonly needsLocaleRedirect: boolean;
  /**
   * The resolved address in canonical spelling, including the locale prefix
   * (`/zh-CN/app/session/1`, bare for English). Callers build 301 targets from this
   * value instead of joining prefix and path themselves.
   */
  readonly canonicalPath: string;
}

/** Split `/[segment][rest]` from a normalized pathname. */
function splitSegment(raw: string): { segment: string; rest: string } | undefined {
  const match = /^\/([^/]+)(.*)$/u.exec(raw);
  return match === null ? undefined : { segment: match[1], rest: match[2] };
}

/**
 * Split an outermost locale prefix from a pathname. Prefixes only resolve at the
 * outermost segment, so `/zh-CN/app/session/:id` is localized and `/app/session/zh-CN/:id`
 * is not. Only the canonical segment spelling resolves; a case variant must be
 * canonicalized first ({@link canonicalizeLocalePath}) and 301'd by the caller.
 *
 * Takes a pathname only (`url.pathname`): passing a full URL would silently drop
 * its query and hash, so that is a programming error, not an accepted input.
 */
export function splitLocalePath(pathname: string): LocalePath {
  if (pathname.includes("?") || pathname.includes("#")) {
    throw new TypeError("splitLocalePath() takes a pathname only (no query or hash); pass url.pathname");
  }
  const raw = pathname === "" ? "/" : pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (isUnprefixedPath(raw)) {
    return { locale: BASE_LOCALE, path: raw, prefixed: false, needsLocaleRedirect: false, canonicalPath: raw };
  }
  const parts = splitSegment(raw);
  const locale = parts === undefined ? undefined : localeForPathSegment(parts.segment);
  if (parts === undefined || locale === undefined) {
    return { locale: BASE_LOCALE, path: raw, prefixed: false, needsLocaleRedirect: false, canonicalPath: raw };
  }
  const rest = parts.rest === "" || parts.rest === "/" ? "/" : parts.rest;
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  const canonicalPath = localizePath(path, locale);
  // `/en/...` is the explicit base-locale spelling: 301 to the bare path.
  return {
    locale, path, prefixed: true, canonicalPath,
    needsLocaleRedirect: locale === BASE_LOCALE,
  };
}

/**
 * Canonical pathname for a case variant of a locale prefix.
 *
 * `/ZH-CN/x` → `/zh-CN/x`, `/Ja/x` → `/ja/x`, `/EN/x` → `/x`. A pathname that
 * already uses a canonical segment, has no locale segment, or is outside the
 * prefix surface is returned unchanged. Callers 301 when the value differs,
 * preserving the query string.
 */
export function canonicalizeLocalePath(pathname: string): string {
  const raw = pathname === "" ? "/" : pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (isUnprefixedPath(raw)) return raw;
  const parts = splitSegment(raw);
  if (parts === undefined) return raw;
  const canonicalSegment = SEGMENT_LOWER.get(parts.segment.toLowerCase());
  if (canonicalSegment === undefined || canonicalSegment === parts.segment) return raw;
  const locale = canonicalSegment === BASE_PATH_SEGMENT ? BASE_LOCALE : SEGMENT_LOCALE.get(canonicalSegment);
  if (locale === undefined) return raw;
  const rest = parts.rest === "" || parts.rest === "/" ? "/" : parts.rest;
  return localizePath(rest.startsWith("/") ? rest : `/${rest}`, locale);
}

/** Add the locale prefix to an absolute path (`localizePath("/", "zh")` → `/zh-CN`). */
export function localizePath(path: string, locale: LocaleId): string {
  const normalized = path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  const prefix = LOCALE_PREFIXES[locale];
  if (prefix === "") return normalized;
  if (normalized === "/") return prefix;
  return `${prefix}${normalized}`;
}
