/** Shared public site document and strict editor contract. No account settings or secrets. */
import { resolveSiteSeo, type SiteSeoConfig } from "../../dsh-base-site-seo/src/index.ts";
import { LOCALE_IDS } from "../../dsh-base-locale-path/src/index.ts";
import { PUBLIC_PAGES } from "../../dsh-base-public-pages/src/index.ts";
import { ANALYTICS_CAMPAIGN_ID, GOOGLE_MEASUREMENT_ID, type SiteLinksConfig, type SiteAnalyticsConfig } from "./index.ts";

export interface SiteSettingsValues {
  readonly seo: SiteSeoConfig;
  readonly links: SiteLinksConfig;
  readonly analytics?: SiteAnalyticsConfig;
}

export interface SiteSettingsSnapshot {
  readonly publicPagePaths?: readonly string[];
  readonly revision: number;
  readonly values: SiteSettingsValues;
  readonly canEdit: boolean;
  readonly source: "deployment" | "saved";
}

export interface SiteSettingsDeploymentEnv {
  readonly SITE_SEO_JSON?: unknown;
  readonly SITE_BRAND_NAME?: unknown;
  readonly SITE_DOCS_URL?: unknown;
  readonly SITE_SUPPORT_EMAIL?: unknown;
  readonly SITE_GITHUB_URL?: unknown;
}

export const SITE_SETTINGS_MAX_BYTES = 256 * 1024;
export const SITE_SETTINGS_PUBLIC_PATHS: readonly string[] = PUBLIC_PAGES.map(page => page.path);
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function validHttp(value: string, originOnly = false): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && (!originOnly || (url.pathname === "/" && !url.search && !url.hash));
  } catch { return false; }
}
function validAsset(value: string): boolean {
  if (/[\\\u0000-\u0020]/u.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  return validHttp(value);
}
function email(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value); }

/** Deployment defaults remain available before the first publication. */
export function resolveDeploymentSiteSettings(env: SiteSettingsDeploymentEnv = {}): SiteSettingsValues {
  const resolved = resolveSiteSeo(env).config;
  let raw: unknown = env.SITE_SEO_JSON;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = undefined; } }
  const explicitSite = record(raw) && record(raw.site) ? raw.site : undefined;
  // An explicit SEO identity wins; legacy deployment brand is a migration default.
  const name = text(explicitSite?.name) ?? text(env.SITE_BRAND_NAME) ?? resolved.site.name;
  const docs = text(env.SITE_DOCS_URL);
  const github = text(env.SITE_GITHUB_URL);
  const supportEmail = text(env.SITE_SUPPORT_EMAIL);
  return {
    seo: { ...resolved, site: { ...resolved.site, name } },
    links: {
      ...(docs !== undefined && validHttp(docs) ? { docs } : {}),
      ...(github !== undefined && validHttp(github) ? { github } : {}),
      ...(supportEmail !== undefined && email(supportEmail) ? { supportEmail } : {}),
    },
  };
}

/** Reject invalid writes rather than silently publishing deployment fallbacks. */
export function validateSiteSettingsValues(input: unknown, registeredPaths: readonly string[] | null = SITE_SETTINGS_PUBLIC_PATHS):
  | { readonly ok: true; readonly value: SiteSettingsValues }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const fail = (path: string, reason: string): void => { issues.push(`${path}: ${reason}`); };
  const keys = (value: unknown, path: string, allowed: readonly string[], required: readonly string[] = []): RecordValue | undefined => {
    if (!record(value)) { fail(path, "expected an object"); return undefined; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown field");
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "required field");
    return value;
  };
  const string = (value: unknown, path: string, max = 4096): value is string => {
    if (typeof value !== "string" || value.trim() === "" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
      fail(path, `expected non-empty text up to ${max} characters`); return false;
    }
    return true;
  };
  const optionalText = (object: RecordValue, key: string, path: string, max?: number): void => {
    if (object[key] !== undefined) string(object[key], `${path}.${key}`, max);
  };
  const textList = (value: unknown, path: string): void => {
    if (!Array.isArray(value) || value.length > 128) { fail(path, "expected at most 128 text values"); return; }
    value.forEach((item, index) => { string(item, `${path}[${index}]`, 512); });
  };
  const asset = (value: unknown, path: string): void => {
    if (string(value, path, 2048) && !validAsset(value)) fail(path, "expected a local asset path or HTTP(S) URL without credentials");
  };
  const root = keys(input, "settings", ["seo", "links", "analytics"], ["seo", "links"]);
  if (!root) return { ok: false, issues };
  if (root.analytics !== undefined) {
    const analytics = keys(root.analytics, "analytics", ["google", "conversions"]);
    if (analytics?.google !== undefined) {
      const google = keys(analytics.google, "analytics.google", ["enabled", "measurementId"], ["enabled"]);
      if (google) {
        if (typeof google.enabled !== "boolean") fail("analytics.google.enabled", "expected a boolean");
        if (google.measurementId !== undefined && (typeof google.measurementId !== "string" || !GOOGLE_MEASUREMENT_ID.test(google.measurementId.trim()))) fail("analytics.google.measurementId", "expected a GA4 measurement ID (G-...)");
        if (google.enabled === true && google.measurementId === undefined) fail("analytics.google.measurementId", "required when enabled");
      }
    }
    if (analytics?.conversions !== undefined) {
      const conversions = keys(analytics.conversions, "analytics.conversions", ["mode", "campaigns"], ["mode"]);
      if (conversions) {
        if (!['off', 'aggregate', 'google'].includes(String(conversions.mode))) fail('analytics.conversions.mode', 'expected off, aggregate or google');
        if (conversions.mode === 'google' && !(analytics.google && typeof analytics.google === 'object' && typeof (analytics.google as Record<string, unknown>).measurementId === 'string')) fail('analytics.google.measurementId', 'required for Google conversions');
        if (conversions.campaigns !== undefined && (!Array.isArray(conversions.campaigns) || conversions.campaigns.length > 64
          || conversions.campaigns.some(item => typeof item !== 'string' || !ANALYTICS_CAMPAIGN_ID.test(item))
          || new Set(conversions.campaigns).size !== conversions.campaigns.length)) fail('analytics.conversions.campaigns', 'expected at most 64 unique public campaign identifiers');
      }
    }
  }
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > SITE_SETTINGS_MAX_BYTES) fail("settings", "document is too large"); }
  catch { fail("settings", "expected JSON data"); }
  const seo = keys(root.seo, "seo", ["site", "locales", "icons", "image", "manifest", "robots", "llms", "pages"], ["site", "locales", "icons", "image", "manifest"]);
  const links = keys(root.links, "links", ["docs", "supportEmail", "github"]);
  if (links) for (const key of ["docs", "github", "supportEmail"]) {
    if (links[key] === undefined) continue;
    if (string(links[key], `links.${key}`, 2048) && !(key === "supportEmail" ? email(links[key]) : validHttp(links[key]))) fail(`links.${key}`, "invalid public link");
  }
  if (!seo) return { ok: false, issues };
  const site = keys(seo.site, "seo.site", ["name", "url", "twitter", "github", "contactEmail"], ["name"]);
  if (site) {
    string(site.name, "seo.site.name", 200);
    if (site.url !== undefined && string(site.url, "seo.site.url", 2048) && !validHttp(site.url, true)) fail("seo.site.url", "expected an HTTP(S) origin without path, query or fragment");
    for (const key of ["twitter", "github"]) if (site[key] !== undefined && string(site[key], `seo.site.${key}`, 2048)) {
      if (!/^@?[\w.-]+$/u.test(site[key]) && !validHttp(site[key])) fail(`seo.site.${key}`, "expected a handle or HTTP(S) URL");
    }
    if (site.contactEmail !== undefined && string(site.contactEmail, "seo.site.contactEmail", 254) && !email(site.contactEmail)) fail("seo.site.contactEmail", "invalid email");
  }
  const locales = keys(seo.locales, "seo.locales", LOCALE_IDS, LOCALE_IDS);
  if (locales) for (const locale of LOCALE_IDS) {
    const copy = keys(locales[locale], `seo.locales.${locale}`, ["title", "description", "keywords", "ogImageAlt"], ["title", "description", "keywords"]);
    if (!copy) continue;
    string(copy.title, `seo.locales.${locale}.title`, 300);
    string(copy.description, `seo.locales.${locale}.description`, 4096);
    textList(copy.keywords, `seo.locales.${locale}.keywords`);
    optionalText(copy, "ogImageAlt", `seo.locales.${locale}`);
  }
  const iconKeys = ["svg", "ico", "png16", "png32", "appleTouch", "icon192", "icon512", "maskable512"];
  const icons = keys(seo.icons, "seo.icons", iconKeys, iconKeys);
  if (icons) for (const key of iconKeys) asset(icons[key], `seo.icons.${key}`);
  const image = keys(seo.image, "seo.image", ["url", "width", "height", "type", "alt"], ["url", "width", "height", "type"]);
  if (image) {
    asset(image.url, "seo.image.url");
    for (const dimension of ["width", "height"]) if (!Number.isSafeInteger(image[dimension]) || Number(image[dimension]) < 1 || Number(image[dimension]) > 16384) fail(`seo.image.${dimension}`, "expected an integer from 1 to 16384");
    if (string(image.type, "seo.image.type", 64) && !/^image\/[\w.+-]+$/u.test(image.type)) fail("seo.image.type", "expected an image MIME type");
    optionalText(image, "alt", "seo.image");
  }
  const manifest = keys(seo.manifest, "seo.manifest", ["shortName", "themeColor", "backgroundColor", "display"], ["themeColor", "backgroundColor", "display"]);
  if (manifest) {
    optionalText(manifest, "shortName", "seo.manifest", 200);
    for (const key of ["themeColor", "backgroundColor"]) if (string(manifest[key], `seo.manifest.${key}`, 64) && !/^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(manifest[key])) fail(`seo.manifest.${key}`, "expected a hexadecimal color");
    if (manifest.display !== "standalone") fail("seo.manifest.display", "unsupported display mode");
  }
  if (seo.robots !== undefined) {
    const robots = keys(seo.robots, "seo.robots", ["disallow", "extraLines"]);
    if (robots) for (const key of ["disallow", "extraLines"]) if (robots[key] !== undefined) textList(robots[key], `seo.robots.${key}`);
    if (robots && Array.isArray(robots.disallow)) robots.disallow.forEach((path, index) => {
      if (typeof path === "string" && (!path.startsWith("/") || /[\r\n]/u.test(path))) fail(`seo.robots.disallow[${index}]`, "expected a single-line absolute path");
    });
  }
  if (seo.llms !== undefined) {
    const llms = keys(seo.llms, "seo.llms", ["enabled", "introduction", "guidance"]);
    if (llms) {
      if (llms.enabled !== undefined && typeof llms.enabled !== "boolean") fail("seo.llms.enabled", "expected a boolean");
      optionalText(llms, "introduction", "seo.llms", 4096);
      optionalText(llms, "guidance", "seo.llms", 8192);
    }
  }
  if (seo.pages !== undefined) {
    if (!record(seo.pages)) fail("seo.pages", "expected a page map");
    else for (const [path, value] of Object.entries(seo.pages)) {
      if (registeredPaths === null ? !/^\/(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/u.test(path) : !registeredPaths.includes(path)) fail(`seo.pages.${path}`, "only registered public pages can be configured");
      const page = keys(value, `seo.pages.${path}`, ["title", "description", "keywords", "priority", "changefreq", "lastmod", "image"]);
      if (!page) continue;
      optionalText(page, "title", `seo.pages.${path}`, 300);
      optionalText(page, "description", `seo.pages.${path}`);
      if (page.keywords !== undefined) textList(page.keywords, `seo.pages.${path}.keywords`);
      if (page.image !== undefined) asset(page.image, `seo.pages.${path}.image`);
      if (page.priority !== undefined && (typeof page.priority !== "string" || !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(page.priority))) fail(`seo.pages.${path}.priority`, "expected a number from 0 to 1");
      if (page.changefreq !== undefined && !["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].includes(String(page.changefreq))) fail(`seo.pages.${path}.changefreq`, "invalid frequency");
      if (page.lastmod !== undefined && (typeof page.lastmod !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(page.lastmod) || Number.isNaN(Date.parse(page.lastmod)) || new Date(page.lastmod).toISOString().slice(0, 10) !== page.lastmod)) fail(`seo.pages.${path}.lastmod`, "expected a valid YYYY-MM-DD date");
    }
  }
  if (issues.length) return { ok: false, issues };
  // Store the same normalized identity that public/client consumers render.
  const normalized = JSON.parse(JSON.stringify(input, (_key, value: unknown) => typeof value === "string" ? value.trim() : value)) as SiteSettingsValues;
  const resolved = resolveSiteSeo({ SITE_SEO_JSON: normalized.seo });
  if (resolved.problems.length) return { ok: false, issues: resolved.problems.map(problem => `seo.${problem}`) };
  return { ok: true, value: { seo: resolved.config, links: normalized.links, ...(normalized.analytics === undefined ? {} : { analytics: normalized.analytics }) } };
}
