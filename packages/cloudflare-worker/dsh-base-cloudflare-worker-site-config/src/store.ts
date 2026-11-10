/** One versioned site document in the existing deployment D1 database. */
import {
  resolveDeploymentSiteSettings,
  validateSiteSettingsValues,
  type SiteSettingsValues,
} from "../../../boot/dsh-base-site-config/src/settings.ts";

/** Runtime bindings used by the site settings service. */
export interface SiteSettingsEnv {
  readonly GOOGLE_ANALYTICS_API_SECRET?: string;
  readonly SITE_ANALYTICS_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  readonly AUTH_DB?: D1Database;
  readonly SITE_ADMIN_USER_IDS?: unknown;
  readonly SITE_SEO_JSON?: unknown;
  readonly SITE_ENVIRONMENT_LABEL?: string;
  readonly SITE_BRAND_NAME?: string;
  readonly SITE_DOCS_URL?: string;
  readonly SITE_SUPPORT_EMAIL?: string;
  readonly SITE_GITHUB_URL?: string;
}

/** Shared data has no account-dependent fields or authority flags. */
export interface StoredSiteSettings {
  readonly revision: number;
  readonly values: SiteSettingsValues;
  readonly source: "deployment" | "saved";
}

/** A binding, schema, query or stored document failure must not mask saved data. */
export class SiteSettingsUnavailable extends Error {
  constructor() { super("Site settings are unavailable."); }
}

/** Empty, malformed or mixed-type administrator lists deny all writes. */
export function isSiteAdministrator(env: SiteSettingsEnv, userId: string): boolean {
  if (typeof env.SITE_ADMIN_USER_IDS !== "string") return false;
  try {
    const ids: unknown = JSON.parse(env.SITE_ADMIN_USER_IDS);
    return Array.isArray(ids) && ids.length > 0
      && ids.every(id => typeof id === "string" && id.trim() !== "" && id === id.trim())
      && ids.includes(userId);
  } catch { return false; }
}

function primary(env: SiteSettingsEnv): D1DatabaseSession {
  if (env.AUTH_DB === undefined) throw new SiteSettingsUnavailable();
  // Every request starts on the primary; an earlier writer in another isolate
  // is visible immediately. No in-memory TTL can silently revive older values.
  return env.AUTH_DB.withSession("first-primary");
}

/** Read the single shared document, using deployment defaults only if no row exists. */
export async function readSiteSettings(env: SiteSettingsEnv): Promise<StoredSiteSettings> {
  try {
    const row = await primary(env).prepare("SELECT revision, values_json FROM dsh_site_settings WHERE singleton = 1")
      .first<{ revision: number; values_json: string }>();
    if (row === null) return { revision: 0, values: resolveDeploymentSiteSettings(env), source: "deployment" };
    if (!Number.isSafeInteger(row.revision) || row.revision <= 0 || typeof row.values_json !== "string") throw new SiteSettingsUnavailable();
    // Withdrawn documents may retain harmless metadata. This does not register a
    // route: writes validate against active providers and rendering only uses them.
    const validated = validateSiteSettingsValues(JSON.parse(row.values_json), null);
    if (!validated.ok) throw new SiteSettingsUnavailable();
    return { revision: row.revision, values: validated.value, source: "saved" };
  } catch { throw new SiteSettingsUnavailable(); }
}

/** Atomic compare-and-swap, including two administrators creating the first row. */
export async function writeSiteSettings(env: SiteSettingsEnv, expectedRevision: number, values: SiteSettingsValues): Promise<boolean> {
  try {
    const result = await primary(env).prepare(`
      INSERT INTO dsh_site_settings (singleton, revision, values_json)
      SELECT 1, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM dsh_site_settings WHERE singleton = 1)
      ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, values_json = excluded.values_json
      WHERE dsh_site_settings.revision = ?
    `).bind(expectedRevision + 1, JSON.stringify(values), expectedRevision, expectedRevision).run();
    return result.meta.changes === 1;
  } catch { throw new SiteSettingsUnavailable(); }
}
