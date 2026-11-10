/**
 * Product site configuration shared by the client plugin and its tests.
 *
 * This is product facts (brand, public links) plus the public runtime snapshot
 * returned by the Worker. Secrets and feature gating of official DSH UI never
 * belong here.
 */

import { LOCALE_IDS, type LocaleId } from "../../dsh-base-locale-path/src/index.ts";

/** Brand facts consumed through the official sidebar name slot. */
export interface SiteBrandConfig {
  /** Product name shown by custom surfaces. */
  readonly name: string;
  /** Optional light-mode logo URL. */
  readonly logoLight?: string;
  /** Optional dark-mode logo URL. */
  readonly logoDark?: string;
}

/** Public outbound links rendered by our own custom surfaces. */
export interface SiteLinksConfig {
  /** Product documentation or repository URL. */
  readonly docs?: string;
  /** Support mailbox (rendered as a mailto link). */
  readonly supportEmail?: string;
  /** Public source repository URL. */
  readonly github?: string;
}

/** Optional public-page measurement. The property identifier is public, never a secret. */
export interface GoogleAnalyticsConfig {
  readonly enabled: boolean;
  readonly measurementId?: string;
  /** Server-derived readiness; never accepted by the administrator write schema. */
  readonly ready?: boolean;
}
export interface ConversionAnalyticsConfig {
  /** Off by default. Aggregate never sends data outside this deployment. */
  readonly mode: 'off' | 'aggregate' | 'google';
  /** Public campaign labels approved by the site administrator; never arbitrary query values. */
  readonly campaigns?: readonly string[];
}
export interface SiteAnalyticsConfig { readonly google?: GoogleAnalyticsConfig; readonly conversions?: ConversionAnalyticsConfig }
export const GOOGLE_MEASUREMENT_ID = /^G-[A-Z0-9]{4,32}$/u;
export const ANALYTICS_CAMPAIGN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** Fail closed on untrusted/incomplete runtime configuration. */
export function parseSiteAnalytics(value: unknown): SiteAnalyticsConfig | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const candidate = input.google !== null && typeof input.google === 'object' && !Array.isArray(input.google) ? input.google as Record<string, unknown> : undefined;
  const conversion = input.conversions !== null && typeof input.conversions === 'object' && !Array.isArray(input.conversions) ? input.conversions as Record<string, unknown> : undefined;
  const mode = conversion?.mode === 'aggregate' || conversion?.mode === 'google' ? conversion.mode : 'off';
  const campaigns = Array.isArray(conversion?.campaigns) && conversion.campaigns.length <= 64
    && conversion.campaigns.every(item => typeof item === 'string' && ANALYTICS_CAMPAIGN_ID.test(item))
    ? [...new Set(conversion.campaigns as string[])] : undefined;
  if (candidate === undefined && conversion === undefined) return undefined;
  const measurementId = typeof candidate?.measurementId === 'string' && GOOGLE_MEASUREMENT_ID.test(candidate.measurementId)
    ? candidate.measurementId : undefined;
  return {
    ...(candidate === undefined ? {} : { google: { enabled: candidate.enabled === true && measurementId !== undefined, ...(measurementId === undefined ? {} : { measurementId }), ...(typeof candidate.ready !== 'boolean' ? {} : { ready: candidate.ready }) } }),
    ...(conversion === undefined ? {} : { conversions: { mode: mode === 'google' && measurementId === undefined ? 'off' : mode, ...(campaigns === undefined ? {} : { campaigns }) } }),
  };
}

/** Build-time product configuration. */
export interface SiteConfig {
  readonly brand: SiteBrandConfig;
  readonly links: SiteLinksConfig;
  /** Public localized titles, also consumed by the official browser-title projection. */
  readonly documentTitles?: Partial<Record<LocaleId, string>>;
  readonly analytics?: SiteAnalyticsConfig;
}

/** Untrusted composition row input accepted by the client plugin. */
export interface SiteConfigInput {
  readonly brand?: Partial<SiteBrandConfig>;
  readonly links?: Partial<SiteLinksConfig>;
  readonly documentTitles?: Partial<Record<LocaleId, string>>;
  readonly analytics?: SiteAnalyticsConfig;
}

/** Public runtime snapshot served by the Worker. */
export interface SiteRuntimeConfig {
  /** Deployment environment label, for example `Staging`. */
  readonly environmentLabel?: string;
  /** Public product facts; merged over the build defaults. */
  readonly config: SiteConfigInput;
}

/** Conservative defaults; every field here has a visible consumer. */
export const DEFAULT_SITE_CONFIG: SiteConfig = Object.freeze({
  brand: Object.freeze({ name: "DSH Base" }),
  links: Object.freeze({}),
});

/** Reject empty/non-string link values instead of rendering broken hrefs. */
function optionalUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Links that are opened with `window.open`/anchors must be absolute HTTP(S).
 * A deployment binding misconfigured as `javascript:` is treated as unset, so
 * the consuming surface renders its "not configured" state instead of running
 * script from configuration.
 */
function httpUrl(value: unknown): string | undefined {
  const text = optionalUrl(value);
  return text !== undefined && /^https?:\/\//iu.test(text) ? text : undefined;
}

function documentTitles(value: unknown): Partial<Record<LocaleId, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const entries = LOCALE_IDS.flatMap(locale => {
    const title = optionalUrl(source[locale]);
    return title === undefined ? [] : [[locale, title] as const];
  });
  return entries.length === 0 ? undefined : Object.freeze(Object.fromEntries(entries));
}

/**
 * Merge a composition row over {@link DEFAULT_SITE_CONFIG}.
 * @param input - untrusted composition row `config`.
 * @returns a frozen product configuration.
 */
export function mergeSiteConfig(input: SiteConfigInput | undefined): SiteConfig {
  const brandName = typeof input?.brand?.name === "string" && input.brand.name.trim() !== ""
    ? input.brand.name.trim()
    : DEFAULT_SITE_CONFIG.brand.name;
  return Object.freeze({
    ...(parseSiteAnalytics(input?.analytics) === undefined ? {} : { analytics: parseSiteAnalytics(input?.analytics) }),
    ...(documentTitles(input?.documentTitles) === undefined ? {} : { documentTitles: documentTitles(input?.documentTitles) }),
    brand: Object.freeze({
      name: brandName,
      ...(optionalUrl(input?.brand?.logoLight) === undefined ? {} : { logoLight: optionalUrl(input?.brand?.logoLight) }),
      ...(optionalUrl(input?.brand?.logoDark) === undefined ? {} : { logoDark: optionalUrl(input?.brand?.logoDark) }),
    }),
    links: Object.freeze({
      ...(httpUrl(input?.links?.docs) === undefined ? {} : { docs: httpUrl(input?.links?.docs) }),
      ...(optionalUrl(input?.links?.supportEmail) === undefined ? {} : { supportEmail: optionalUrl(input?.links?.supportEmail) }),
      ...(httpUrl(input?.links?.github) === undefined ? {} : { github: httpUrl(input?.links?.github) }),
    }),
  });
}

/**
 * Validate the Worker's public runtime payload.
 * @param value - parsed `GET /api/site-config` JSON.
 * @returns a snapshot with only recognized public fields.
 */
export function parseSiteRuntimeConfig(value: unknown): SiteRuntimeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { config: {} };
  const record = value as { environmentLabel?: unknown; brand?: unknown; links?: unknown; documentTitles?: unknown; analytics?: unknown };
  const label = record.environmentLabel;
  const brandSource = typeof record.brand === "object" && record.brand !== null && !Array.isArray(record.brand)
    ? record.brand as { name?: unknown; logoLight?: unknown; logoDark?: unknown }
    : {};
  const linksSource = typeof record.links === "object" && record.links !== null && !Array.isArray(record.links)
    ? record.links as { docs?: unknown; supportEmail?: unknown; github?: unknown }
    : {};
  const brand = {
    ...(typeof brandSource.name === "string" ? { name: brandSource.name } : {}),
    ...(typeof brandSource.logoLight === "string" ? { logoLight: brandSource.logoLight } : {}),
    ...(typeof brandSource.logoDark === "string" ? { logoDark: brandSource.logoDark } : {}),
  };
  const links = {
    ...(typeof linksSource.docs === "string" ? { docs: linksSource.docs } : {}),
    ...(typeof linksSource.supportEmail === "string" ? { supportEmail: linksSource.supportEmail } : {}),
    ...(typeof linksSource.github === "string" ? { github: linksSource.github } : {}),
  };
  return {
    ...(typeof label === "string" && label.trim() !== "" ? { environmentLabel: label.trim() } : {}),
    config: {
      ...(parseSiteAnalytics(record.analytics) === undefined ? {} : { analytics: parseSiteAnalytics(record.analytics) }),
      ...(documentTitles(record.documentTitles) === undefined ? {} : { documentTitles: documentTitles(record.documentTitles) }),
      ...(Object.keys(brand).length === 0 ? {} : { brand }),
      ...(Object.keys(links).length === 0 ? {} : { links }),
    },
  };
}
