/**
 * Pure renderers for the site-level SEO surfaces: the document head, the
 * JSON-LD graph and the web app manifest.
 *
 * Zero runtime dependencies and no request context beyond plain values, so
 * `node --experimental-strip-types` can assert the exact markup. The Worker
 * plugin owns when to render; this module owns what a complete, escaped head
 * looks like.
 */
import {
  BASE_LOCALE, LOCALE_IDS, hreflangFor, localizePath, prefixFor, type LocaleId,
} from "../../dsh-base-locale-path/src/index.ts";
import {
  DEFAULT_SITE_SEO, OG_LOCALES, absoluteAssetUrl, resolveSiteOrigin, type ResolvedPageCopy, type SiteSeoConfig,
} from "./index.ts";
import { SITE_ASSET_DARK_VARIANTS, SITE_ASSET_VERSIONS } from "./assets.generated.ts";

/** Refresh shipped artwork without rewriting saved paths or third-party URLs. */
export function siteAssetUrl(path: string, origin: string): string {
  const version = Object.hasOwn(SITE_ASSET_VERSIONS, path) ? SITE_ASSET_VERSIONS[path] : undefined;
  return absoluteAssetUrl(version === undefined ? path : `${path}?v=${version}`, origin);
}

/** One resolved social-card image. */
export interface ResolvedPageImage {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly type?: string;
  readonly alt?: string;
}

/** Inputs of the document head renderer. */
export interface HeadOptions {
  /** Only actual translations can be advertised. */
  readonly availableLocales?: readonly LocaleId[];
  /** Resolved site configuration. */
  readonly config: SiteSeoConfig;
  /** Locale-stripped document path (`/` for the root). */
  readonly path: string;
  /** Locale of this document. */
  readonly locale: LocaleId;
  /** Request origin; used when `site.url` is not configured. */
  readonly origin: string;
  /** Page copy after the page → locale → English → hard fallback chain. */
  readonly copy: ResolvedPageCopy;
  /** Page-level image override from the route registry or `pages[path].image`. */
  readonly pageImage?: string;
  /** Resource advertised by the composed manifest plugin; false omits the link. */
  readonly manifestPath?: string | false;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;",
});

/** Escape one HTML text or attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&"<>]/gu, character => HTML_ESCAPES[character] as string);
}

const JSON_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029",
});

/** Serialize JSON so it cannot close the surrounding `<script>` element. */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, character => JSON_ESCAPES[character] as string);
}

/** Absolute site origin for this request. */
function siteOrigin(config: SiteSeoConfig, origin: string): string {
  return resolveSiteOrigin(config, origin);
}

/** Absolute URL of one localized document path. */
export function documentUrl(config: SiteSeoConfig, path: string, locale: LocaleId, origin: string): string {
  return new URL(localizePath(path, locale), siteOrigin(config, origin)).href;
}

/** Resolve the social-card image, including page-level overrides. */
export function resolvePageImage(config: SiteSeoConfig, origin: string, pageImage?: string): ResolvedPageImage {
  if (pageImage !== undefined && pageImage !== "") {
    return { url: siteAssetUrl(pageImage, siteOrigin(config, origin)), alt: config.image.alt ?? config.site.name };
  }
  return {
    url: siteAssetUrl(config.image.url, siteOrigin(config, origin)),
    width: config.image.width,
    height: config.image.height,
    type: config.image.type,
    ...(config.image.alt === undefined ? {} : { alt: config.image.alt }),
  };
}

/** Twitter handle in `@handle` form, from either a handle or a profile URL. */
function twitterHandle(value: string): string {
  if (!/^https?:\/\//u.test(value)) return value.startsWith("@") ? value : `@${value}`;
  const last = new URL(value).pathname.split("/").filter(Boolean).at(-1);
  return last === undefined ? value : `@${last}`;
}

/** Public social profiles for the Organization graph. */
function socialProfiles(config: SiteSeoConfig): string[] {
  const profiles: string[] = [];
  if (config.site.twitter !== undefined && config.site.twitter !== "") {
    profiles.push(/^https?:\/\//u.test(config.site.twitter)
      ? config.site.twitter
      : `https://twitter.com/${config.site.twitter.replace(/^@/u, "")}`);
  }
  if (config.site.github !== undefined && config.site.github !== "") {
    profiles.push(/^https?:\/\//u.test(config.site.github)
      ? config.site.github
      : `https://github.com/${config.site.github.replace(/^@/u, "")}`);
  }
  return profiles;
}

/** Brand resources are shared by public and noindex documents without search metadata. */
export function renderBrandHead(options: Pick<HeadOptions, "config" | "locale" | "origin" | "manifestPath">): string {
  const { config, locale, origin } = options;
  const base = siteOrigin(config, origin);
  // Match official DSH's browser color-scheme pair only for the bundled mark.
  // An administrator's custom SVG remains the sole SVG in both color schemes.
  const darkSvg = Object.hasOwn(SITE_ASSET_DARK_VARIANTS, config.icons.svg)
    ? SITE_ASSET_DARK_VARIANTS[config.icons.svg] : undefined;
  const svgTags = darkSvg === undefined
    ? [`<link rel="icon" type="image/svg+xml" sizes="any" href="${escapeHtml(siteAssetUrl(config.icons.svg, base))}" />`]
    : [
      `<link rel="icon" type="image/svg+xml" href="${escapeHtml(siteAssetUrl(darkSvg, base))}" media="(prefers-color-scheme: dark)" />`,
      `<link rel="icon" type="image/svg+xml" href="${escapeHtml(siteAssetUrl(config.icons.svg, base))}" media="(prefers-color-scheme: light)" />`,
    ];
  // Match the official SVG-only candidate set for bundled branding. Chrome can
  // prefer an advertised raster over a matching SVG; link order is not enough.
  // Explicit administrator overrides remain advertised, with their URLs intact.
  const rasterIcons = [
    { key: "ico", type: "image/x-icon", sizes: undefined },
    { key: "png16", type: "image/png", sizes: "16x16" },
    { key: "png32", type: "image/png", sizes: "32x32" },
  ] as const;
  const rasterTags = rasterIcons
    .filter(icon => darkSvg === undefined || config.icons[icon.key] !== DEFAULT_SITE_SEO.icons[icon.key])
    .map(icon => `<link rel="icon" type="${icon.type}"${icon.sizes === undefined ? "" : ` sizes="${icon.sizes}"`} href="${escapeHtml(siteAssetUrl(config.icons[icon.key], base))}" />`);
  const tags = [
    ...rasterTags,
    ...svgTags,
    `<link rel="apple-touch-icon" sizes="180x180" href="${escapeHtml(siteAssetUrl(config.icons.appleTouch, base))}" />`,
    ...(options.manifestPath === false ? [] : [`<link rel="manifest" href="${escapeHtml(absoluteAssetUrl(localizePath(options.manifestPath ?? "/manifest.webmanifest", locale), base))}" />`]),
    `<meta name="theme-color" content="${escapeHtml(config.manifest.themeColor)}" />`,
  ];
  return tags.join("\n    ");
}

/**
 * Render a complete public document head: description, keywords, canonical,
 * the locale alternates, Open Graph, Twitter card, icons, manifest and
 * theme color.
 * @param options - resolved configuration, page copy and request facts.
 * @returns the tags to inject before `</head>`, indented for the shell.
 */
export function renderHead(options: HeadOptions): string {
  const { config, path, locale, origin, copy } = options;
  const canonical = documentUrl(config, path, locale, origin);
  const image = resolvePageImage(config, origin, options.pageImage);
  const servedLocales = options.availableLocales ?? LOCALE_IDS;
  const alternates = servedLocales.map(served =>
    `<link rel="alternate" hreflang="${hreflangFor(served)}" href="${escapeHtml(documentUrl(config, path, served, origin))}" />`);
  const ogLocaleAlternates = servedLocales.filter(served => served !== locale)
    .map(served => `<meta property="og:locale:alternate" content="${OG_LOCALES[served]}" />`);
  const tags = [
    `<meta name="description" content="${escapeHtml(copy.description)}" />`,
    `<meta name="keywords" content="${escapeHtml(copy.keywords.join(", "))}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    ...alternates,
    ...(servedLocales.includes(BASE_LOCALE) ? [`<link rel="alternate" hreflang="x-default" href="${escapeHtml(documentUrl(config, path, BASE_LOCALE, origin))}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(config.site.name)}" />`,
    `<meta property="og:title" content="${escapeHtml(copy.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(copy.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:locale" content="${OG_LOCALES[locale]}" />`,
    ...ogLocaleAlternates,
    `<meta property="og:image" content="${escapeHtml(image.url)}" />`,
    ...image.width === undefined ? [] : [`<meta property="og:image:width" content="${String(image.width)}" />`],
    ...image.height === undefined ? [] : [`<meta property="og:image:height" content="${String(image.height)}" />`],
    ...image.type === undefined ? [] : [`<meta property="og:image:type" content="${escapeHtml(image.type)}" />`],
    ...image.alt === undefined ? [] : [`<meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`],
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(copy.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(copy.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image.url)}" />`,
    ...config.site.twitter === undefined || config.site.twitter === ""
      ? []
      : [`<meta name="twitter:site" content="${escapeHtml(twitterHandle(config.site.twitter))}" />`],
    renderBrandHead({ config, locale, origin, manifestPath: options.manifestPath }),
  ];
  return tags.join("\n    ");
}

/**
 * Render the two JSON-LD graphs: the site and the publishing organization.
 * @param options - resolved configuration, locale and document URLs.
 * @returns the `<script>` blocks to inject before `</head>`.
 */
export function renderJsonLd(options: { readonly config: SiteSeoConfig; readonly locale: LocaleId; readonly origin: string; readonly canonical: string }): string {
  const { config, locale, origin, canonical } = options;
  const base = siteOrigin(config, origin);
  const profiles = socialProfiles(config);
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: config.site.name,
    url: canonical,
    inLanguage: hreflangFor(locale),
  };
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: config.site.name,
    url: `${base}/`,
    ...(profiles.length === 0 ? {} : { sameAs: profiles }),
    ...(config.site.contactEmail === undefined ? {} : { email: config.site.contactEmail }),
  };
  return [
    `<script type="application/ld+json">${escapeJsonForScript(website)}</script>`,
    `<script type="application/ld+json">${escapeJsonForScript(organization)}</script>`,
  ].join("\n    ");
}

/**
 * Render the web app manifest for one locale.
 * @param options - resolved configuration, locale and request origin.
 * @returns the JSON document body.
 */
export function renderManifest(options: { readonly config: SiteSeoConfig; readonly locale: LocaleId; readonly origin: string }): string {
  const { config, locale, origin } = options;
  const base = siteOrigin(config, origin);
  const prefix = prefixFor(locale);
  const copy = config.locales[locale] ?? config.locales[BASE_LOCALE];
  const manifest = {
    name: config.site.name,
    ...(config.manifest.shortName === undefined ? {} : { short_name: config.manifest.shortName }),
    description: copy.description,
    id: "/",
    start_url: `${base}${prefix === "" ? "/" : `${prefix}/`}`,
    scope: `${base}/`,
    display: config.manifest.display,
    theme_color: config.manifest.themeColor,
    background_color: config.manifest.backgroundColor,
    lang: hreflangFor(locale),
    icons: [
      { src: siteAssetUrl(config.icons.icon192, base), sizes: "192x192", type: "image/png" },
      { src: siteAssetUrl(config.icons.icon512, base), sizes: "512x512", type: "image/png" },
      { src: siteAssetUrl(config.icons.maskable512, base), sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: siteAssetUrl(config.icons.svg, base), sizes: "any", type: "image/svg+xml" },
    ],
  };
  return JSON.stringify(manifest, null, 2);
}

/** Content type served for the manifest document. */
export const MANIFEST_CONTENT_TYPE = "application/manifest+json";
