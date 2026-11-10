/** Administrator-only first-party counts. Public analytics never expose this data. */
import type { WorkerHandler } from '@dsh-base/cloudflare-worker-http';
import { isSiteAdministrator, type SiteSettingsEnv } from '../../dsh-base-cloudflare-worker-site-config/src/store.ts';
import type { ConversionAnalyticsService } from './conversions.ts';
export function createConversionSummaryHandler(auth: { session(request: Request, env: unknown): Promise<{id: string} | undefined> }, service: Pick<ConversionAnalyticsService, 'conversionSummary'>): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname !== '/api/site-analytics/conversions') return undefined;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', vary: 'Cookie, Authorization' } });
    if (request.method !== 'GET') return json({error: 'method_not_allowed'}, 405);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({error: 'untrusted_origin'}, 403);
    try {
      const user = await auth.session(request, env);
      if (!user) return json({error: 'unauthenticated'}, 401);
      if (!isSiteAdministrator((env ?? {}) as SiteSettingsEnv, user.id)) return json({error: 'forbidden'}, 403);
      if (url.search || url.hash) return json({error: 'invalid_query'}, 400);
      return json({ days: 30, rows: await service.conversionSummary(env, 30) });
    } catch { return json({error: 'analytics_unavailable'}, 503); }
  };
}
