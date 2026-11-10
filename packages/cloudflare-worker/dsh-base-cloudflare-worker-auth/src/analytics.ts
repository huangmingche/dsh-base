/** Runs only after Better Auth has created a real account. */
import type { ConversionAnalyticsService } from '@dsh-base/cloudflare-worker-google-analytics';
export async function recordSignupConversion(service: Pick<ConversionAnalyticsService, 'recordConversion'> | undefined, env: unknown, userId: string, headers?: Headers): Promise<void> {
  if (!service || !userId) return;
  const consent = headers?.get('x-dsh-analytics-consent') === 'granted';
  const campaign = consent ? headers?.get('x-dsh-analytics-campaign') : undefined;
  try { await service.recordConversion(env, { name: 'sign_up', dedupeKey: `signup:${userId}`, consent,
    ...(campaign ? { campaign } : {}) }); } catch { /* Observability never changes an account creation result. */ }
}
