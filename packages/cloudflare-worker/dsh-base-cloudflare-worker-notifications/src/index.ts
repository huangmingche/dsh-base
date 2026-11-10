import type {Context} from '@deepseek-ai/cordis';
import type {WorkerHandler} from '@dsh-base/cloudflare-worker-http';
import type {AuthFace} from '@dsh-base/cloudflare-worker-auth';
import {isSiteAdministrator} from '../../dsh-base-cloudflare-worker-site-config/src/store.ts';
import {NotificationError, type NotificationEnv} from './config.ts';
import {createNotifications, type NotificationsService} from './service.ts';
export {createNotifications, type NotificationsService, type NotificationPayment} from './service.ts';
export const name = '@dsh-base/cloudflare-worker-notifications';
export const inject = ['http', 'auth'];
export const Config = undefined;
declare module '@deepseek-ai/cordis' {interface Context {notifications: NotificationsService}}
async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new NotificationError(400, 'invalid_request');
  let text = ''; let bytes = 0; const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false});
  try {
    while (true) { const value = await reader.read(); if (value.done) break; bytes += value.value.length;
      if (bytes > 4096) { await reader.cancel(); throw new NotificationError(413, 'body_too_large'); }
      text += decoder.decode(value.value, {stream: true}); }
    text += decoder.decode(); return JSON.parse(text);
  } catch (error) { if (error instanceof NotificationError) throw error; throw new NotificationError(400, 'invalid_request'); }
  finally { reader.releaseLock(); }
}
export function createNotificationsHandler(auth: AuthFace, service: NotificationsService): WorkerHandler {
  return async (request, environment) => {
    const path = new URL(request.url).pathname;
    if (!['/api/saas/notifications/status', '/api/saas/notifications', '/api/saas/notifications/retry'].includes(path)) return undefined;
    const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}});
    const method = path.endsWith('/retry') ? 'POST' : 'GET';
    if (request.method !== method) return json({error: 'method_not_allowed'}, 405);
    if (path.endsWith('/status')) return json(service.status(environment));
    try {
      const user = await auth.session(request, environment); if (!user) throw new NotificationError(401, 'unauthenticated');
      const env = (environment ?? {}) as NotificationEnv;
      if (!isSiteAdministrator(env, user.id)) throw new NotificationError(403, 'site_admin_required');
      if (method === 'GET') return json({deliveries: await service.list(env)});
      const origin = env.AUTH_BASE_URL ? new URL(env.AUTH_BASE_URL).origin : undefined;
      if (!origin || request.headers.get('origin') !== origin || new URL(request.url).origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new NotificationError(403, 'untrusted_origin');
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new NotificationError(415, 'unsupported_media_type');
      const input = await body(request);
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new NotificationError(400, 'invalid_request');
      const value = input as Record<string, unknown>;
      if (Object.keys(value).some(key => !['id', 'expectedAttempts', 'reviewedUncertain'].includes(key))
        || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id) || !Number.isSafeInteger(value.expectedAttempts)
        || (value.expectedAttempts as number) < 0 || (value.reviewedUncertain !== undefined && typeof value.reviewedUncertain !== 'boolean')) throw new NotificationError(400, 'invalid_request');
      await service.retry(env, value.id, value.expectedAttempts as number, value.reviewedUncertain === true);
      return json({ok: true});
    } catch (error) {
      return error instanceof NotificationError ? json({error: error.code}, error.status) : json({error: 'notifications_unavailable'}, 503);
    }
  };
}
export function apply(ctx: Context): void {
  const service = createNotifications();
  ctx.provide('notifications', service);
  ctx.effect(() => ctx.http.use(createNotificationsHandler(ctx.auth, service), 35), 'dsh-base: operational notification outbox');
}
