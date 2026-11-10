/** Server-confirmed conversions. No public event ingestion endpoint exists. */
import type { SiteAnalyticsService, SiteSettingsService } from '@dsh-base/cloudflare-worker-site-config';
import { ANALYTICS_CAMPAIGN_ID, GOOGLE_MEASUREMENT_ID } from '../../../boot/dsh-base-site-config/src/index.ts';

export type ConversionName = 'sign_up' | 'activation' | 'begin_checkout' | 'purchase';
export interface ConversionEvent {
  readonly name: ConversionName;
  /** Trusted business key. Only its SHA-256 digest is stored, never sent to Google. */
  readonly dedupeKey: string;
  readonly consent?: boolean;
  readonly campaign?: string;
  /** Public catalog identifier, never a user/order/workspace identifier. */
  readonly itemId?: string;
  readonly currency?: string;
  /** Major currency units, confirmed by the payment provider. */
  readonly value?: number;
}
export interface ConversionOutcome { readonly status: 'disabled' | 'recorded' | 'duplicate' | 'accepted' | 'failed' | 'unavailable' }
export interface ConversionSummary { readonly day: string; readonly event_name: ConversionName; readonly campaign: string; readonly currency: string; readonly count: number; readonly value: number }
export interface ConversionAnalyticsService extends SiteAnalyticsService {
  recordConversion(env: unknown, event: ConversionEvent): Promise<ConversionOutcome>;
  /** Trusted administrator callers only; this service does not publish an HTTP endpoint. */
  conversionSummary(env: unknown, days?: number): Promise<readonly ConversionSummary[]>;
}
interface Environment { readonly AUTH_DB?: D1Database; readonly GOOGLE_ANALYTICS_API_SECRET?: string }
const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const monetary = (name: string) => name === 'purchase' || name === 'begin_checkout';
const valid = (event: ConversionEvent): boolean => {
  if (!event || !['sign_up', 'activation', 'begin_checkout', 'purchase'].includes(event.name)
    || typeof event.dedupeKey !== 'string' || event.dedupeKey.length < 1 || event.dedupeKey.length > 512
    || Object.keys(event).some(key => !['name', 'dedupeKey', 'consent', 'campaign', 'currency', 'value', 'itemId'].includes(key))) return false;
  if (event.consent !== undefined && typeof event.consent !== 'boolean') return false;
  if (event.campaign !== undefined && (typeof event.campaign !== 'string' || !ANALYTICS_CAMPAIGN_ID.test(event.campaign))) return false;
  if (event.name === 'begin_checkout' && event.value === undefined) return (event.currency === undefined || /^[A-Z]{3}$/u.test(event.currency))
    && typeof event.itemId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(event.itemId);
  if (monetary(event.name)) return typeof event.currency === 'string' && /^[A-Z]{3}$/u.test(event.currency)
    && typeof event.value === 'number' && Number.isFinite(event.value) && event.value >= 0 && event.value <= 1e9
    && typeof event.itemId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(event.itemId);
  return event.currency === undefined && event.value === undefined && event.itemId === undefined;
};

/** Exactly-once first-party aggregation; at most one Google send attempt per event. */
export function createConversionAnalytics(settings: SiteSettingsService, send: typeof fetch = fetch): Pick<ConversionAnalyticsService, 'recordConversion' | 'conversionSummary'> {
  return {
    async recordConversion(rawEnv, event) {
      if (!valid(event)) return { status: 'unavailable' };
      const env = (rawEnv ?? {}) as Environment;
      try {
        const { values } = await settings.read(rawEnv);
        const config = values.analytics?.conversions;
        if (!config || config.mode === 'off') return { status: 'disabled' };
        if (!env.AUTH_DB) return { status: 'unavailable' };
        const google = values.analytics?.google;
        const consented = event.name !== 'activation' && event.consent === true;
        const sendGoogle = config.mode === 'google' && consented;
        // An unready opted-in destination must not silently become aggregate.
        if (sendGoogle && (!env.GOOGLE_ANALYTICS_API_SECRET?.trim() || !google?.measurementId || !GOOGLE_MEASUREMENT_ID.test(google.measurementId))) return { status: 'unavailable' };
        const campaign = consented && event.campaign && config.campaigns?.includes(event.campaign) ? event.campaign : '';
        const currency = event.currency ?? '', value = event.value ?? 0;
        const eventKey = await digest(JSON.stringify([event.name, event.dedupeKey]));
        const fingerprint = await digest(JSON.stringify([event.name, currency, value, event.itemId ?? null]));
        const receipt = crypto.randomUUID(), now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
        const db = env.AUTH_DB.withSession('first-primary');
        const statement = (sql: string, ...bindings: (string | number)[]) => db.prepare(sql).bind(...bindings);
        await db.batch([
          statement('INSERT INTO dsh_analytics_conversions (event_key,fingerprint,receipt,event_name,day,campaign,currency,value,delivery,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING', eventKey, fingerprint, receipt, event.name, day, campaign, currency, value, sendGoogle ? 'attempting' : 'local', now),
          statement(`INSERT INTO dsh_analytics_daily (day,event_name,campaign,currency,count,value)
            SELECT day,event_name,campaign,currency,1,value FROM dsh_analytics_conversions WHERE receipt=?
            ON CONFLICT(day,event_name,campaign,currency) DO UPDATE SET count=count+1,value=value+excluded.value`, receipt),
        ]);
        const row = await statement('SELECT receipt,fingerprint FROM dsh_analytics_conversions WHERE event_key=?', eventKey).first<{receipt: string; fingerprint: string}>();
        if (!row || row.fingerprint !== fingerprint) return { status: 'unavailable' };
        if (row.receipt !== receipt) return { status: 'duplicate' };
        if (!sendGoogle) return { status: 'recorded' };
        const random = crypto.getRandomValues(new Uint32Array(2));
        const params = {
          ...(campaign === '' ? {} : { campaign_id: campaign }),
          ...(event.name === 'sign_up' ? { method: 'account' } : {}),
          ...(monetary(event.name) ? { ...(event.value === undefined ? {} : { currency, value }), items: [{ item_id: event.itemId, ...(event.value === undefined ? {} : { price: value }), quantity: 1 }] } : {}),
          ...(event.name === 'purchase' ? { transaction_id: receipt } : {}),
        };
        const target = new URL('https://www.google-analytics.com/mp/collect');
        target.searchParams.set('measurement_id', google!.measurementId!);
        target.searchParams.set('api_secret', env.GOOGLE_ANALYTICS_API_SECRET!.trim());
        let accepted = false;
        try {
          const result = await send(target.href, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: `${random[0]! + 1}.${random[1]! + 1}`, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' }, events: [{ name: event.name, params }] }),
            redirect: 'manual', signal: AbortSignal.timeout(3000) });
          await result.body?.cancel(); accepted = result.ok;
        } catch { /* Never retry an ambiguous external delivery. Local counting already committed. */ }
        await statement('UPDATE dsh_analytics_conversions SET delivery=? WHERE receipt=?', accepted ? 'accepted' : 'failed', receipt).run();
        return { status: accepted ? 'accepted' : 'failed' };
      } catch { return { status: 'unavailable' }; }
    },
    async conversionSummary(rawEnv, days = 30) {
      if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('invalid_analytics_period');
      const db = (rawEnv as Environment)?.AUTH_DB?.withSession('first-primary');
      if (!db) throw new Error('analytics_unavailable');
      const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
      const result = await db.prepare('SELECT day,event_name,campaign,currency,count,value FROM dsh_analytics_daily WHERE day>=? ORDER BY day,event_name,campaign,currency').bind(since).all<ConversionSummary>();
      return result.results;
    },
  };
}
