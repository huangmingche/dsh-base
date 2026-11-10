/** Minimal public-page counts through GA4 Measurement Protocol, never session telemetry. */
import type { Context } from '@deepseek-ai/cordis';
import type { WorkerHandler } from '@dsh-base/cloudflare-worker-http';
import type { SiteSettingsService } from '@dsh-base/cloudflare-worker-site-config';
import { PUBLIC_PAGES, hasPageLocale, type PublicPagesService } from '../../../boot/dsh-base-public-pages/src/index.ts';
import { localizePath, splitLocalePath } from '../../../boot/dsh-base-locale-path/src/index.ts';
import { GOOGLE_MEASUREMENT_ID } from '../../../boot/dsh-base-site-config/src/index.ts';
import { resolvePageCopy } from '../../../boot/dsh-base-site-seo/src/index.ts';
import { documentUrl } from '../../../boot/dsh-base-site-seo/src/render.ts';
import { createConversionAnalytics } from './conversions.ts';
import { createConversionSummaryHandler } from './summary.ts';
import type {} from '@dsh-base/cloudflare-worker-auth';
import type {} from '@dsh-base/cloudflare-worker-public-pages';
export { createConversionAnalytics } from './conversions.ts';
export type { ConversionAnalyticsService, ConversionEvent, ConversionName, ConversionOutcome, ConversionSummary } from './conversions.ts';

export const name = '@dsh-base/cloudflare-worker-google-analytics';
export const inject = ['http', 'siteSettings', 'publicPages'];
export const Config = undefined;
const PATH = '/api/site-analytics/google';
const LIMIT = 512;
interface AnalyticsEnv {
  readonly GOOGLE_ANALYTICS_API_SECRET?: string;
  readonly SITE_ANALYTICS_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
const response = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

/** Bounded streaming read; Content-Length is not trusted. */
async function publicPath(request: Request): Promise<string | undefined> {
  if (!request.body || Number(request.headers.get('content-length')) > LIMIT) return undefined;
  const reader = request.body.getReader();
  let text = '', bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > LIMIT) { await reader.cancel(); return undefined; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const data = body as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || typeof data.path !== 'string' || !data.path.startsWith('/') || /[?#\\\s%]/u.test(data.path)) return undefined;
    const split = splitLocalePath(data.path);
    if (localizePath(split.path, split.locale) !== data.path) return undefined;
    return data.path;
  } catch { return undefined; }
  finally { reader.releaseLock(); }
}

// The static registry is only the standalone test/compatibility default. Production injects publicPages.
export function createAnalyticsHandler(settings: SiteSettingsService, send: typeof fetch = fetch, pages: Pick<PublicPagesService, 'resolve'> = { async resolve(_env, path, locale) { return PUBLIC_PAGES.find(page => page.path === path && hasPageLocale(page, locale)); } }): WorkerHandler {
  return async (request, rawEnv) => {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return undefined;
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return response(403);
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return response(415);
    const path = await publicPath(request);
    if (path === undefined) return response(400);
    const split = splitLocalePath(path);
    let page;
    try { page = await pages.resolve(rawEnv, split.path, split.locale); } catch { return response(503); }
    if (!page) return response(400);
    const env = (rawEnv ?? {}) as AnalyticsEnv;
    const secret = env.GOOGLE_ANALYTICS_API_SECRET?.trim();
    // No configuration or limiter means no event, D1 read or outbound request.
    if (!secret || !env.SITE_ANALYTICS_LIMITER) return response(204);
    try {
      // The key stays in Cloudflare's native limiter; it is never sent to Google.
      const limited = await env.SITE_ANALYTICS_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
      if (!limited.success) return response(429);
      const { values } = await settings.read(rawEnv);
      const google = values.analytics?.google;
      if (!google?.enabled || !google.measurementId || !GOOGLE_MEASUREMENT_ID.test(google.measurementId)) return response(204);
      const random = crypto.getRandomValues(new Uint32Array(2));
      const payload = {
        client_id: `${random[0]! + 1}.${random[1]! + 1}`,
        consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
        events: [{ name: 'page_view', params: {
          page_location: documentUrl(values.seo, page.path, split.locale, url.origin),
          page_title: resolvePageCopy(values.seo, page.path, split.locale, page.copy).title,
        } }],
      };
      const target = new URL('https://www.google-analytics.com/mp/collect');
      target.searchParams.set('measurement_id', google.measurementId);
      target.searchParams.set('api_secret', secret);
      const result = await send(target.href, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(3000) });
      await result.body?.cancel();
      // A 2xx is transport acceptance, not proof of ingestion into the property.
      return response(result.ok ? 204 : 502);
    } catch { return response(503); }
  };
}

export function apply(ctx: Context): void {
  const conversions = createConversionAnalytics(ctx.siteSettings);
  ctx.provide('siteAnalytics', { ...conversions, ready(rawEnv: unknown) {
    const env = (rawEnv ?? {}) as AnalyticsEnv;
    return Boolean(env.GOOGLE_ANALYTICS_API_SECRET?.trim() && env.SITE_ANALYTICS_LIMITER);
  } });
  ctx.effect(() => ctx.http.use(createAnalyticsHandler(ctx.siteSettings, fetch, ctx.publicPages), 30), 'dsh-base: public page measurement');
  ctx.inject(['auth'], scope => scope.effect(() => scope.http.use(createConversionSummaryHandler(scope.auth, conversions), 30), 'dsh-base: administrator conversion summary'));
}
