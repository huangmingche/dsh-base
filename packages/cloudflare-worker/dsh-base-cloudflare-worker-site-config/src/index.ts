/** Public site facts and administrator-managed, deployment-wide settings. */
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type {} from "@dsh-base/cloudflare-worker-auth";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import { PUBLIC_PAGES, indexingPolicy } from "../../../boot/dsh-base-public-pages/src/index.ts";
import { validateSiteSettingsValues, type SiteSettingsSnapshot } from "../../../boot/dsh-base-site-config/src/settings.ts";
import { isSiteAdministrator, readSiteSettings, writeSiteSettings, type SiteSettingsEnv, type StoredSiteSettings } from "./store.ts";
import { LOCALE_IDS, type LocaleId } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { resolvePageCopy } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { parseSiteAnalytics, type SiteAnalyticsConfig } from "../../../boot/dsh-base-site-config/src/index.ts";

export const name = "@dsh-base/cloudflare-worker-site-config";
export const inject = ["http", "auth", "publicPages"];
export const Config = undefined;
export { readSiteSettings, type SiteSettingsEnv, type StoredSiteSettings } from "./store.ts";

/** Server-only data face shared with the SEO plugin; no account-scoped state. */
export interface SiteSettingsService { read(env: unknown): Promise<StoredSiteSettings> }
/** Optional capability advertised only by the composed measurement provider. */
export interface SiteAnalyticsService { ready(env: unknown): boolean }
declare module "@deepseek-ai/cordis" {
  interface Context { siteSettings: SiteSettingsService; siteAnalytics: SiteAnalyticsService }
}

/** Public legacy payload; never includes administrator IDs, revisions or secrets. */
export interface SiteConfigPayload {
  readonly environmentLabel?: string;
  readonly brand: { readonly name: string };
  readonly documentTitles: Readonly<Record<LocaleId, string>>;
  readonly analytics?: SiteAnalyticsConfig;
  readonly links?: { readonly docs?: string; readonly supportEmail?: string; readonly github?: string };
}

/** Both brand and public links come from the same document the SEO renderer reads. */
export function siteConfigPayload(env: SiteSettingsEnv, stored: StoredSiteSettings, analyticsReady = false): SiteConfigPayload {
  const label = typeof env.SITE_ENVIRONMENT_LABEL === "string" ? env.SITE_ENVIRONMENT_LABEL.trim() : "";
  const { links, seo } = stored.values;
  const analytics = parseSiteAnalytics(stored.values.analytics);
  return {
    ...(label === "" ? {} : { environmentLabel: label }),
    brand: { name: seo.site.name },
    ...(analytics === undefined ? {} : { analytics: { ...analytics, ...(analytics.google === undefined ? {} : { google: { ...analytics.google, ready: analyticsReady } }) } }),
    documentTitles: Object.fromEntries(LOCALE_IDS.map(locale => [locale, resolvePageCopy(seo, "/", locale).title])) as Record<LocaleId, string>,
    ...(Object.keys(links).length === 0 ? {} : { links }),
  };
}

const MAX_BODY_BYTES = 384 * 1024;
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

/** Read actual bytes with a bound, including requests without Content-Length. */
async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: string }> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > MAX_BODY_BYTES) return { ok: false, status: 413, code: "body_too_large" };
  if (request.body === null) return { ok: false, status: 400, code: "invalid_json" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, code: "body_too_large" };
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { body.set(chunk, position); position += chunk.byteLength; }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)) };
  } catch { return { ok: false, status: 400, code: "invalid_json" }; }
  finally { reader.releaseLock(); }
}

type Auth = { session(request: Request, env?: unknown): Promise<{ readonly id: string } | undefined> };

/** Exported handler keeps real permission, validation and persistence behavior testable. */
export function createSiteSettingsHandler(auth: Auth, service: SiteSettingsService, analyticsReady: (env: unknown) => boolean = () => false, publicPaths: (env: unknown) => Promise<readonly string[]> = async () => PUBLIC_PAGES.map(page => page.path)): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url);
    const publicRoute = url.pathname === "/api/site-config";
    if (!publicRoute && url.pathname !== "/api/site-settings") return undefined;
    const allowed = publicRoute ? ["GET", "HEAD"] : ["GET", "PUT"];
    if (!allowed.includes(request.method)) return json({ error: "method_not_allowed" }, 405, { allow: allowed.join(", ") });
    const typed = (env ?? {}) as SiteSettingsEnv;
    try {
      if (publicRoute) {
        const payload = siteConfigPayload(typed, await service.read(env), analyticsReady(env));
        return request.method === "HEAD"
          ? new Response(null, { headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8" } })
          : json(payload);
      }
      const user = await auth.session(request, env);
      if (user === undefined) return json({ error: "unauthenticated" }, 401);
      const canEdit = isSiteAdministrator(typed, user.id);
      const publicPagePaths = await publicPaths(env);
      if (request.method === "GET") {
        const snapshot: SiteSettingsSnapshot = { ...await service.read(env), canEdit, publicPagePaths };
        return json(snapshot);
      }
      if (!canEdit) return json({ error: "site_admin_required" }, 403);
      // A cookie-authenticated browser write must originate at this deployment.
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return json({ error: "untrusted_origin" }, 403);
      }
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return json({ error: "unsupported_media_type" }, 415);
      }
      const body = await readJsonBody(request);
      if (!body.ok) return json({ error: body.code }, body.status);
      if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) return json({ error: "invalid_request" }, 400);
      const value = body.value as Record<string, unknown>;
      if (Object.keys(value).some(key => key !== "expectedRevision" && key !== "values")
        || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0
        || (value.expectedRevision as number) >= Number.MAX_SAFE_INTEGER) return json({ error: "invalid_request" }, 400);
      const validated = validateSiteSettingsValues(value.values, publicPagePaths);
      if (!validated.ok) return json({ error: "invalid_settings", issues: validated.issues }, 400);
      const policy = indexingPolicy(env);
      if (policy.enabled && validated.value.seo.site.url !== undefined && new URL(validated.value.seo.site.url).origin !== policy.origin) {
        return json({error: "invalid_settings", issues: ["seo.site.url: indexed sites must use the deployment origin"]}, 400);
      }
      if ((validated.value.analytics?.google?.enabled || validated.value.analytics?.conversions?.mode === 'google') && !analyticsReady(env)) {
        return json({ error: "invalid_settings", issues: ["analytics.google.enabled: configure GOOGLE_ANALYTICS_API_SECRET in the deployment before enabling Google Analytics"] }, 400);
      }
      const expectedRevision = value.expectedRevision as number;
      const saved = await writeSiteSettings(typed, expectedRevision, validated.value);
      if (!saved) return json({ error: "revision_conflict", revision: (await service.read(env)).revision }, 409);
      const snapshot: SiteSettingsSnapshot = { revision: expectedRevision + 1, values: validated.value, source: "saved", canEdit, publicPagePaths };
      return json(snapshot);
    } catch {
      return json({ error: "site_settings_unavailable" }, 503);
    }
  };
}

/** Install the shared service before the following SEO request handler. */
export function apply(ctx: Context): void {
  const service: SiteSettingsService = { read: env => readSiteSettings((env ?? {}) as SiteSettingsEnv) };
  ctx.provide("siteSettings", service);
  ctx.effect(() => ctx.http.use(createSiteSettingsHandler(ctx.auth, service, env => ctx.get('siteAnalytics')?.ready(env) === true,
    async env => (await ctx.publicPages.list(env)).map(page => page.path)), 10), "dsh-base: site settings API");
}
