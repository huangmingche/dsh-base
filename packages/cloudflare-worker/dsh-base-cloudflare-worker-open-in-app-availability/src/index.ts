/** Truthful native-application availability for the unchanged official client. */
import type { Context } from '@deepseek-ai/cordis';
import { OPEN_IN_APP_APPS_PATH, type OpenInAppAppsPayload } from '@deepseek-ai/dsh-host-open-in-app/shared';
import type { WorkerHandler } from '@dsh-base/cloudflare-worker-http';

export const name = '@dsh-base/cloudflare-worker-open-in-app-availability';
export const inject = ['http'];
export const Config = undefined;

/** This public deployment fact never consults account, session or filesystem services. */
export const openInAppAvailability: WorkerHandler = request => {
  const url = new URL(request.url);
  if (url.pathname !== OPEN_IN_APP_APPS_PATH) return undefined;
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' });
  const reply = (status: number, payload: unknown) => new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), { status, headers });
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'untrusted_origin' });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('allow', 'GET, HEAD');
    return reply(405, { error: 'method_not_allowed' });
  }
  if (url.search !== '') return reply(400, { error: 'invalid_query' });
  return reply(200, { apps: [] } satisfies OpenInAppAppsPayload);
};

export function apply(ctx: Context): void {
  // The exact public capability route precedes HTML navigation admission (0)
  // and static assets (1000); every other route retains its existing guards.
  ctx.effect(() => ctx.http.use(openInAppAvailability, -10), 'dsh-base: native application availability');
}
