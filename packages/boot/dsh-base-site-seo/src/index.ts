/**
 * Site SEO configuration: one typed, validated source for head metadata,
 * sitemap hints, manifest and robots additions.
 *
 * Zero runtime dependencies (no npm imports): the Worker plugin imports this
 * module on every cold start, so it stays a pure data resolver that also runs
 * under `node --experimental-strip-types`. The only workspace import is the
 * locale-id list, the single source of truth for the eight public locales.
 */
import { BASE_LOCALE, LOCALE_IDS, type LocaleId } from "../../dsh-base-locale-path/src/index.ts";

/** Deployment env binding that carries the optional JSON override. */
export const SITE_SEO_ENV_KEY = "SITE_SEO_JSON";

/** Reject absurdly large override documents before parsing them. */
export const MAX_SITE_SEO_JSON_LENGTH = 256 * 1024;

/** Per-locale page copy. */
export interface SiteSeoLocaleCopy {
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly ogImageAlt?: string;
}

/** Social identities used by Organization JSON-LD and twitter:site. */
export interface SiteSeoIdentity {
  readonly name: string;
  /** Absolute site origin; absent means "use the request origin". */
  readonly url?: string;
  readonly twitter?: string;
  readonly github?: string;
  readonly contactEmail?: string;
}

/** Icon paths (public/ paths or absolute URLs). */
export interface SiteSeoIcons {
  readonly svg: string;
  readonly ico: string;
  readonly png16: string;
  readonly png32: string;
  readonly appleTouch: string;
  readonly icon192: string;
  readonly icon512: string;
  readonly maskable512: string;
}

/** Open Graph image. */
export interface SiteSeoImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly type: string;
  readonly alt?: string;
}

/** Web app manifest values. */
export interface SiteSeoManifest {
  readonly shortName?: string;
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly display: "standalone";
}

/** Robots additions; the default block is always emitted. */
export interface SiteSeoRobots {
  readonly disallow?: readonly string[];
  readonly extraLines?: readonly string[];
}

/** Public AI reading guide. It describes public content, never account data. */
export interface SiteSeoLlms {
  readonly enabled?: boolean;
  readonly introduction?: string;
  readonly guidance?: string;
}

/** One page-level override inside the deployment config. */
export interface SiteSeoPage {
  readonly title?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly priority?: string;
  readonly changefreq?: string;
  readonly lastmod?: string;
  readonly image?: string;
}

/** The complete site SEO configuration. */
export interface SiteSeoConfig {
  readonly site: SiteSeoIdentity;
  readonly locales: Readonly<Record<LocaleId, SiteSeoLocaleCopy>>;
  readonly icons: SiteSeoIcons;
  readonly image: SiteSeoImage;
  readonly manifest: SiteSeoManifest;
  readonly robots?: SiteSeoRobots;
  readonly llms?: SiteSeoLlms;
  readonly pages?: Readonly<Record<string, SiteSeoPage>>;
}

/** Result of resolving the deployment override over the shipped defaults. */
export interface ResolvedSiteSeo {
  readonly config: SiteSeoConfig;
  /** Field-level fallbacks applied while resolving; empty when the override was clean. */
  readonly problems: readonly string[];
}

/** Social-card language tags for the eight public locales. */
export const OG_LOCALES: Readonly<Record<LocaleId, string>> = Object.freeze({
  en: "en_US", zh: "zh_CN", ja: "ja_JP", es: "es_ES", fr: "fr_FR", de: "de_DE", pt: "pt_PT", ru: "ru_RU",
});

/** Last-resort copy used when even the shipped locale dictionaries are unusable. */
export const HARD_FALLBACK_COPY = Object.freeze({
  title: "DeepSeek Harness Base",
  description: "A deployable DeepSeek Harness web application.",
});

const DEFAULT_ICONS: SiteSeoIcons = Object.freeze({
  svg: "/favicon.svg",
  ico: "/favicon.ico",
  png16: "/favicon-16x16.png",
  png32: "/favicon-32x32.png",
  appleTouch: "/apple-touch-icon.png",
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  maskable512: "/icon-maskable-512.png",
});

const DEFAULT_IMAGE: SiteSeoImage = Object.freeze({
  url: "/og.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "DeepSeek Harness Base",
});

const DEFAULT_MANIFEST: SiteSeoManifest = Object.freeze({
  shortName: "DSH Base",
  themeColor: "#ffffff",
  backgroundColor: "#ffffff",
  display: "standalone",
});

/** Copy shipped with the application; the deployment JSON may override any field. */
const DEFAULT_COPY: Readonly<Record<LocaleId, SiteSeoLocaleCopy>> = Object.freeze({
  en: {
    title: "DeepSeek Harness Base · DSH on Cloudflare Workers",
    description: "A deployable DeepSeek Harness web application running on Cloudflare Workers.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "SaaS template", "AI application", "dsh-base"],
  },
  zh: {
    title: "DeepSeek Harness Base · 运行在 Cloudflare Workers 上的 DSH",
    description: "一个可部署的 DeepSeek Harness Web 应用，运行在 Cloudflare Workers 上。",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "SaaS 模板", "AI 应用", "dsh-base"],
  },
  ja: {
    title: "DeepSeek Harness Base · Cloudflare Workers 上の DSH",
    description: "Cloudflare Workers 上で動作する、デプロイ可能な DeepSeek Harness Web アプリケーション。",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "SaaS テンプレート", "AI アプリ", "dsh-base"],
  },
  es: {
    title: "DeepSeek Harness Base · DSH en Cloudflare Workers",
    description: "Una aplicación web de DeepSeek Harness desplegable que se ejecuta en Cloudflare Workers.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "plantilla SaaS", "aplicación de IA", "dsh-base"],
  },
  fr: {
    title: "DeepSeek Harness Base · DSH sur Cloudflare Workers",
    description: "Une application web DeepSeek Harness déployable qui s'exécute sur Cloudflare Workers.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "modèle SaaS", "application IA", "dsh-base"],
  },
  de: {
    title: "DeepSeek Harness Base · DSH auf Cloudflare Workers",
    description: "Eine deploybare DeepSeek-Harness-Webanwendung, die auf Cloudflare Workers läuft.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "SaaS-Vorlage", "KI-Anwendung", "dsh-base"],
  },
  pt: {
    title: "DeepSeek Harness Base · DSH no Cloudflare Workers",
    description: "Uma aplicação web DeepSeek Harness implantável executada no Cloudflare Workers.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "modelo SaaS", "aplicação de IA", "dsh-base"],
  },
  ru: {
    title: "DeepSeek Harness Base · DSH на Cloudflare Workers",
    description: "Развертываемое веб-приложение DeepSeek Harness, работающее на Cloudflare Workers.",
    keywords: ["DeepSeek Harness", "Cloudflare Workers", "SaaS-шаблон", "ИИ-приложение", "dsh-base"],
  },
});

/** Shipped defaults: the middle layer between the deployment JSON and the hard fallback. */
export const DEFAULT_SITE_SEO: SiteSeoConfig = Object.freeze({
  site: Object.freeze({ name: "DeepSeek Harness Base" }),
  locales: DEFAULT_COPY,
  icons: DEFAULT_ICONS,
  image: DEFAULT_IMAGE,
  manifest: DEFAULT_MANIFEST,
});

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function report(problems: string[], path: string, detail: string): void {
  problems.push(`${path}: ${detail}`);
}

function readText(candidate: unknown, fallback: string, path: string, problems: string[]): string {
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    report(problems, path, "expected a non-empty string; the default is used");
    return fallback;
  }
  return candidate;
}

function readOptionalText(candidate: unknown, fallback: string | undefined, path: string, problems: string[]): string | undefined {
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    report(problems, path, "expected a non-empty string; the fallback is used");
    return fallback;
  }
  return candidate;
}

function readOptionalTextList(candidate: unknown, path: string, problems: string[]): readonly string[] | undefined {
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate) || candidate.some(value => typeof value !== "string" || value.trim() === "")) {
    report(problems, path, "expected an array of non-empty strings; the field is dropped");
    return undefined;
  }
  return candidate.map(value => value as string);
}

function readOptionalAssetRef(candidate: unknown, path: string, problems: string[]): string | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || !(candidate.startsWith("/") || /^https?:\/\//iu.test(candidate))) {
    report(problems, path, "expected a public/ path or an absolute HTTP(S) URL; the field is dropped");
    return undefined;
  }
  return candidate;
}

function readTextList(candidate: unknown, fallback: readonly string[], path: string, problems: string[]): readonly string[] {
  if (candidate === undefined) return fallback;
  if (!Array.isArray(candidate) || candidate.some(value => typeof value !== "string" || value.trim() === "")) {
    report(problems, path, "expected an array of non-empty strings; the default is used");
    return fallback;
  }
  return candidate.map(value => value as string);
}

function readAssetRef(candidate: unknown, fallback: string, path: string, problems: string[]): string {
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "string" || !(candidate.startsWith("/") || /^https?:\/\//iu.test(candidate))) {
    report(problems, path, "expected a public/ path or an absolute HTTP(S) URL; the default is used");
    return fallback;
  }
  return candidate;
}

function readUrl(candidate: unknown, fallback: string | undefined, path: string, problems: string[]): string | undefined {
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "string") {
    report(problems, path, "expected an absolute HTTP(S) URL; the fallback is used");
    return fallback;
  }
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new Error("invalid");
    return url.href.replace(/\/+$/u, "");
  } catch {
    report(problems, path, "expected an absolute HTTP(S) URL without credentials, query or fragment; the fallback is used");
    return fallback;
  }
}

function resolveSite(candidate: unknown, base: SiteSeoIdentity, problems: string[]): SiteSeoIdentity {
  if (candidate === undefined) return base;
  if (!isRecord(candidate)) {
    report(problems, "site", "expected an object; defaults are used");
    return base;
  }
  const url = readUrl(candidate.url, base.url, "site.url", problems);
  const twitter = readOptionalText(candidate.twitter, base.twitter, "site.twitter", problems);
  const github = readOptionalText(candidate.github, base.github, "site.github", problems);
  const contactEmail = readOptionalText(candidate.contactEmail, base.contactEmail, "site.contactEmail", problems);
  return {
    name: readText(candidate.name, base.name, "site.name", problems),
    ...(url === undefined ? {} : { url }),
    ...(twitter === undefined ? {} : { twitter }),
    ...(github === undefined ? {} : { github }),
    ...(contactEmail === undefined ? {} : { contactEmail }),
  };
}

function resolveLocales(candidate: unknown, base: Readonly<Record<LocaleId, SiteSeoLocaleCopy>>, problems: string[]): Readonly<Record<LocaleId, SiteSeoLocaleCopy>> {
  const input = candidate === undefined ? {} : candidate;
  if (!isRecord(input)) {
    report(problems, "locales", "expected an object; defaults are used");
    return base;
  }
  const resolved = {} as Record<LocaleId, SiteSeoLocaleCopy>;
  for (const locale of LOCALE_IDS) {
    const fallback = base[locale];
    const raw = input[locale];
    if (raw === undefined) {
      resolved[locale] = fallback;
      continue;
    }
    if (!isRecord(raw)) {
      report(problems, `locales.${locale}`, "expected an object; defaults are used");
      resolved[locale] = fallback;
      continue;
    }
    const ogImageAlt = readOptionalText(raw.ogImageAlt, fallback.ogImageAlt, `locales.${locale}.ogImageAlt`, problems);
    resolved[locale] = {
      title: readText(raw.title, fallback.title, `locales.${locale}.title`, problems),
      description: readText(raw.description, fallback.description, `locales.${locale}.description`, problems),
      keywords: readTextList(raw.keywords, fallback.keywords, `locales.${locale}.keywords`, problems),
      ...(ogImageAlt === undefined ? {} : { ogImageAlt }),
    };
  }
  return resolved;
}

function resolveIcons(candidate: unknown, base: SiteSeoIcons, problems: string[]): SiteSeoIcons {
  if (candidate === undefined) return base;
  if (!isRecord(candidate)) {
    report(problems, "icons", "expected an object; defaults are used");
    return base;
  }
  return {
    svg: readAssetRef(candidate.svg, base.svg, "icons.svg", problems),
    ico: readAssetRef(candidate.ico, base.ico, "icons.ico", problems),
    png16: readAssetRef(candidate.png16, base.png16, "icons.png16", problems),
    png32: readAssetRef(candidate.png32, base.png32, "icons.png32", problems),
    appleTouch: readAssetRef(candidate.appleTouch, base.appleTouch, "icons.appleTouch", problems),
    icon192: readAssetRef(candidate.icon192, base.icon192, "icons.icon192", problems),
    icon512: readAssetRef(candidate.icon512, base.icon512, "icons.icon512", problems),
    maskable512: readAssetRef(candidate.maskable512, base.maskable512, "icons.maskable512", problems),
  };
}

function readDimension(candidate: unknown, fallback: number, path: string, problems: string[]): number {
  if (candidate === undefined) return fallback;
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate <= 0) {
    report(problems, path, "expected a positive integer; the default is used");
    return fallback;
  }
  return candidate;
}

function resolveImage(candidate: unknown, base: SiteSeoImage, problems: string[]): SiteSeoImage {
  if (candidate === undefined) return base;
  if (!isRecord(candidate)) {
    report(problems, "image", "expected an object; defaults are used");
    return base;
  }
  const alt = readOptionalText(candidate.alt, base.alt, "image.alt", problems);
  return {
    url: readAssetRef(candidate.url, base.url, "image.url", problems),
    width: readDimension(candidate.width, base.width, "image.width", problems),
    height: readDimension(candidate.height, base.height, "image.height", problems),
    type: readText(candidate.type, base.type, "image.type", problems),
    ...(alt === undefined ? {} : { alt }),
  };
}

function resolveManifest(candidate: unknown, base: SiteSeoManifest, problems: string[]): SiteSeoManifest {
  if (candidate === undefined) return base;
  if (!isRecord(candidate)) {
    report(problems, "manifest", "expected an object; defaults are used");
    return base;
  }
  const shortName = readOptionalText(candidate.shortName, base.shortName, "manifest.shortName", problems);
  const display = candidate.display === undefined
    ? base.display
    : candidate.display === "standalone" ? "standalone" : (report(problems, "manifest.display", 'only "standalone" is supported; the default is used'), base.display);
  return {
    ...(shortName === undefined ? {} : { shortName }),
    themeColor: readText(candidate.themeColor, base.themeColor, "manifest.themeColor", problems),
    backgroundColor: readText(candidate.backgroundColor, base.backgroundColor, "manifest.backgroundColor", problems),
    display,
  };
}

function resolveRobots(candidate: unknown, problems: string[]): SiteSeoRobots | undefined {
  if (candidate === undefined) return undefined;
  if (!isRecord(candidate)) {
    report(problems, "robots", "expected an object; robots additions are ignored");
    return undefined;
  }
  let disallow: readonly string[] | undefined;
  if (candidate.disallow !== undefined) {
    if (!Array.isArray(candidate.disallow)) {
      report(problems, "robots.disallow", "expected an array of paths; the field is dropped");
    } else {
      disallow = candidate.disallow.filter((value: unknown, index: number): value is string => {
        if (typeof value !== "string" || !value.trim().startsWith("/")) {
          report(problems, `robots.disallow[${String(index)}]`, "expected a path starting with '/'; the entry is dropped");
          return false;
        }
        return true;
      });
    }
  }
  let extraLines: readonly string[] | undefined;
  if (candidate.extraLines !== undefined) {
    if (!Array.isArray(candidate.extraLines)) {
      report(problems, "robots.extraLines", "expected an array of lines; the field is dropped");
    } else {
      extraLines = candidate.extraLines.filter((value: unknown, index: number): value is string => {
        if (typeof value !== "string" || /[\r\n]/u.test(value)) {
          report(problems, `robots.extraLines[${String(index)}]`, "expected a single-line string; the entry is dropped");
          return false;
        }
        if (/^\s*(?:user-agent|sitemap)\s*:/iu.test(value)) {
          report(problems, `robots.extraLines[${String(index)}]`, "User-agent and Sitemap lines are managed by the deployment and cannot be overridden");
          return false;
        }
        return true;
      });
    }
  }
  return {
    ...(disallow === undefined ? {} : { disallow }),
    ...(extraLines === undefined ? {} : { extraLines }),
  };
}

function resolveLlms(candidate: unknown, problems: string[]): SiteSeoLlms | undefined {
  if (candidate === undefined) return undefined;
  if (!isRecord(candidate)) {
    report(problems, "llms", "expected an object; defaults are used");
    return undefined;
  }
  const introduction = readOptionalText(candidate.introduction, undefined, "llms.introduction", problems);
  const guidance = readOptionalText(candidate.guidance, undefined, "llms.guidance", problems);
  if (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean") report(problems, "llms.enabled", "expected a boolean; defaults are used");
  return {
    ...(typeof candidate.enabled !== "boolean" ? {} : { enabled: candidate.enabled }),
    ...(introduction === undefined ? {} : { introduction }),
    ...(guidance === undefined ? {} : { guidance }),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;

function resolvePages(candidate: unknown, problems: string[]): Readonly<Record<string, SiteSeoPage>> | undefined {
  if (candidate === undefined) return undefined;
  if (!isRecord(candidate)) {
    report(problems, "pages", "expected an object; page overrides are ignored");
    return undefined;
  }
  const pages: Record<string, SiteSeoPage> = {};
  for (const [path, value] of Object.entries(candidate)) {
    if (!path.startsWith("/")) {
      report(problems, `pages["${path}"]`, "expected a path starting with '/'; the page is dropped");
      continue;
    }
    if (!isRecord(value)) {
      report(problems, `pages["${path}"]`, "expected an object; the page is dropped");
      continue;
    }
    const title = readOptionalText(value.title, undefined, `pages["${path}"].title`, problems);
    const description = readOptionalText(value.description, undefined, `pages["${path}"].description`, problems);
    const keywords = readOptionalTextList(value.keywords, `pages["${path}"].keywords`, problems);
    const priority = readOptionalText(value.priority, undefined, `pages["${path}"].priority`, problems);
    const changefreq = readOptionalText(value.changefreq, undefined, `pages["${path}"].changefreq`, problems);
    let lastmod: string | undefined;
    if (value.lastmod !== undefined) {
      if (typeof value.lastmod === "string" && ISO_DATE.test(value.lastmod)) lastmod = value.lastmod;
      else report(problems, `pages["${path}"].lastmod`, "expected an ISO date (YYYY-MM-DD or a full timestamp); the field is dropped");
    }
    const image = readOptionalAssetRef(value.image, `pages["${path}"].image`, problems);
    pages[path] = {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(keywords === undefined ? {} : { keywords }),
      ...(priority === undefined ? {} : { priority }),
      ...(changefreq === undefined ? {} : { changefreq }),
      ...(lastmod === undefined ? {} : { lastmod }),
      ...(image === undefined ? {} : { image }),
    };
  }
  return pages;
}

/**
 * Resolve the deployment override over the shipped defaults.
 *
 * Fail-open: a malformed JSON document or a bad field never throws or returns
 * an error response. Each invalid field falls back to the shipped default and
 * records a problem for the caller to log.
 * @param env - Worker env slice carrying the optional `SITE_SEO_JSON` binding; a raw object is also accepted for tests.
 * @returns the resolved configuration plus the field-level problems.
 */
export function resolveSiteSeo(env?: { readonly SITE_SEO_JSON?: unknown } | null): ResolvedSiteSeo {
  const problems: string[] = [];
  const raw = env?.SITE_SEO_JSON;
  let candidate: unknown;
  if (typeof raw === "string") {
    if (raw.trim() === "") {
      candidate = undefined;
    } else if (raw.length > MAX_SITE_SEO_JSON_LENGTH) {
      report(problems, SITE_SEO_ENV_KEY, `exceeds ${String(MAX_SITE_SEO_JSON_LENGTH)} characters; the shipped defaults are used`);
      candidate = undefined;
    } else {
      try {
        candidate = JSON.parse(raw);
      } catch {
        report(problems, SITE_SEO_ENV_KEY, "is not valid JSON; the shipped defaults are used");
        candidate = undefined;
      }
    }
  } else if (raw !== undefined && raw !== null) {
    candidate = raw;
  }
  if (candidate === undefined) return { config: clone(DEFAULT_SITE_SEO), problems };
  if (!isRecord(candidate)) {
    report(problems, SITE_SEO_ENV_KEY, "expected a JSON object; the shipped defaults are used");
    return { config: clone(DEFAULT_SITE_SEO), problems };
  }
  const robots = resolveRobots(candidate.robots, problems);
  const llms = resolveLlms(candidate.llms, problems);
  const pages = resolvePages(candidate.pages, problems);
  return {
    config: {
      site: resolveSite(candidate.site, DEFAULT_SITE_SEO.site, problems),
      locales: resolveLocales(candidate.locales, DEFAULT_SITE_SEO.locales, problems),
      icons: resolveIcons(candidate.icons, DEFAULT_SITE_SEO.icons, problems),
      image: resolveImage(candidate.image, DEFAULT_SITE_SEO.image, problems),
      manifest: resolveManifest(candidate.manifest, DEFAULT_SITE_SEO.manifest, problems),
      ...(robots === undefined ? {} : { robots }),
      ...(llms === undefined ? {} : { llms }),
      ...(pages === undefined ? {} : { pages }),
    },
    problems,
  };
}

/** One page's resolved copy, after the page → locale → English → hard fallback chain. */
export interface ResolvedPageCopy {
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

/**
 * Merge page-level copy over the locale dictionaries.
 * @param config - resolved site configuration.
 * @param path - locale-stripped document path (for `config.pages` overrides).
 * @param locale - requested locale.
 * @param pageCopy - optional `PublicPage.copy` from the route registry.
 * @returns the copy for this page and locale.
 */
export function resolvePageCopy(
  config: SiteSeoConfig,
  path: string,
  locale: LocaleId,
  pageCopy?: Partial<Record<LocaleId, { title?: string; description?: string; keywords?: readonly string[] }>>,
): ResolvedPageCopy {
  const localeCopy = config.locales[locale] ?? config.locales[BASE_LOCALE];
  const english = config.locales[BASE_LOCALE];
  const page = config.pages?.[path];
  const registry = pageCopy?.[locale];
  const registryEnglish = pageCopy?.[BASE_LOCALE];
  const first = <T>(...values: (T | undefined)[]): T | undefined => values.find(value => value !== undefined);
  const title = first(page?.title, registry?.title, localeCopy.title, english.title, HARD_FALLBACK_COPY.title) as string;
  const description = first(page?.description, registry?.description, localeCopy.description, english.description, HARD_FALLBACK_COPY.description) as string;
  const keywords = first(page?.keywords, registry?.keywords, localeCopy.keywords, english.keywords, registryEnglish?.keywords, []) as readonly string[];
  return { title, description, keywords };
}

/**
 * Base origin for canonical and asset URLs.
 * @param config - resolved site configuration.
 * @param requestOrigin - origin of the current request.
 * @returns the configured absolute origin when valid, else the request origin.
 */
export function resolveSiteOrigin(config: SiteSeoConfig, requestOrigin: string): string {
  return config.site.url ?? new URL(requestOrigin).origin;
}

/**
 * Resolve one configured asset path (or absolute URL) against the site origin.
 * @param value - `/path` or absolute HTTP(S) URL.
 * @param origin - site origin used for relative paths.
 * @returns an absolute URL with no trailing slash (except the bare origin).
 */
export function absoluteAssetUrl(value: string, origin: string): string {
  const url = new URL(value, `${origin.replace(/\/+$/u, "")}/`);
  return url.href.replace(/\/+$/u, "");
}
