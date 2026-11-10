/** Merchant payments over the existing authentication and D1 services. */
import type { Context } from '@deepseek-ai/cordis';
import type { WorkerHandler } from '@dsh-base/cloudflare-worker-http';
import type { NotificationsService } from '@dsh-base/cloudflare-worker-notifications';
import type { AuthFace } from '@dsh-base/cloudflare-worker-auth';
import { digest, nonempty, paymentConfig, paymentReturnUrl, PaymentError, readBody, record, type PaymentConfig, type PaymentEnv } from './config.ts';
import { providerFor, type PaymentProvider } from './provider.ts';
import { reconcile, validateEvent } from './reconcile.ts';
import { PaymentStore, type AccountOrder } from './store.ts';
import {publicCatalog} from './catalog.ts';
import {PaymentConversions,type PaymentAnalytics} from './analytics.ts';

export const name = '@dsh-base/cloudflare-worker-payment-waffo';
export const inject = ['http', 'auth'];
export const Config = undefined;
export interface PaymentService {
  ready(env: unknown): boolean;
  allows(env: unknown, userId: string, planIds: readonly string[]): Promise<boolean>;
  summary(env: unknown): Promise<{orders: number; activeSubscriptions: number; refundedOrders: number}>;
  /** Trusted plugins only: callers must derive userId from authenticated context. */
  account(env: unknown, userId: string): Promise<AccountOrder[]>;
}
declare module '@deepseek-ai/cordis' { interface Context { payments: PaymentService } }
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: {'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers},
});
export function createPaymentHandler(auth: AuthFace, provider: (config: PaymentConfig) => PaymentProvider = providerFor, notifications: () => NotificationsService | undefined = () => undefined,analytics:()=>PaymentAnalytics|undefined=()=>undefined): WorkerHandler {
  return async (request, environment) => {
    const path = new URL(request.url).pathname;
    if (!['/api/payments', '/api/payments/account', '/api/payments/checkout', '/api/payments/portal', '/api/webhooks/waffo'].includes(path)) return undefined;
    const method = ['/api/payments', '/api/payments/account'].includes(path) ? 'GET' : 'POST';
    if (request.method !== method) return json({error: 'method_not_allowed'}, 405, {allow: method});
    const config = paymentConfig((environment ?? {}) as PaymentEnv);
    if (path === '/api/payments') return json(publicCatalog(environment,config!==undefined));
    try {
      if (!config) throw new PaymentError(503, 'payments_unavailable');
      const store = new PaymentStore(config);
      const conversions=new PaymentConversions(config),metrics=analytics();
      if (path === '/api/webhooks/waffo') {
        const raw = await readBody(request, 256 * 1024);
        const client = provider(config);
        const event = client.verify(raw, request.headers.get('x-waffo-signature'));
        validateEvent(event, config);
        const hash = await digest(raw);
        const notifier = notifications();
        const result = await reconcile(config, store, client, event, hash, notifier === undefined ? undefined
          : notice => notifier.paymentStatements(environment, {...notice, scope: config.scope, eventId: event.id, payloadHash: hash}),
          metrics?(checkoutId,planId,snapshot)=>conversions.purchaseStatements(event,hash,checkoutId,planId,snapshot):undefined);
        // Delivery is secondary to the already committed financial state. Pending
        // outbox rows survive failure; ambiguous sends require explicit review.
        if (notifier) { try { await notifier.flush(environment, `${config.scope}:${event.id}`); } catch { /* Persisted for administrator review. */ } }
        if(metrics&&result!=='ignored'){try{await conversions.flush(environment,event.data.orderId,metrics);}catch{/* Durable pending conversion is retried on a later verified delivery. */}}
        return json({received: true, result});
      }
      const user = await auth.session(request, environment);
      if (!user) throw new PaymentError(401, 'unauthenticated');
      if (path === '/api/payments/account') return json({orders: await store.account(user.id), portalAvailable: true});
      // Cookie-authenticated mutations require the deployment's configured origin,
      // not a caller-controlled Host, and reject origin-less browser requests.
      if (request.headers.get('origin') !== config.origin || new URL(request.url).origin !== config.origin
        || request.headers.get('sec-fetch-site') === 'cross-site') throw new PaymentError(403, 'untrusted_origin');
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new PaymentError(415, 'unsupported_media_type');
      let input: unknown;
      try { input = JSON.parse(await readBody(request, 8 * 1024)); }
      catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError(400, 'invalid_json'); }
      if (!record(input)) throw new PaymentError(400, 'invalid_request');
      if (path === '/api/payments/portal') {
        if (Object.keys(input).length) throw new PaymentError(400, 'invalid_request');
        return json(await provider(config).portal(user.id));
      }
      if (Object.keys(input).some(key => !['planId', 'returnPath', 'locale','analyticsConsent','analyticsCampaign'].includes(key))
        || !nonempty(input.planId, 80) || (input.locale !== undefined && !nonempty(input.locale, 20))
        ||(input.analyticsConsent!==undefined&&typeof input.analyticsConsent!=='boolean')
        ||(input.analyticsCampaign!==undefined&&(typeof input.analyticsCampaign!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(input.analyticsCampaign)))) throw new PaymentError(400, 'invalid_request');
      const plan = config.plans.find(plan => plan.id === input.planId);
      if (!plan) throw new PaymentError(400, 'unknown_plan');
      const key = request.headers.get('idempotency-key');
      if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new PaymentError(400, 'invalid_idempotency_key');
      const returnUrl = paymentReturnUrl(config.origin, input.returnPath);
      const hash = await digest(JSON.stringify({plan:{id:plan.id,...(plan.name===undefined?{}:{name:plan.name}),productId:plan.productId,type:plan.type,currency:plan.currency}, returnUrl, locale: input.locale ?? null}));
      const checkout = await store.reserveCheckout(user.id, key, hash, plan);
      await conversions.saveConsent(checkout.id,{consent:input.analyticsConsent===true,...(typeof input.analyticsCampaign==='string'?{campaign:input.analyticsCampaign}:{})});
      const result=await provider(config).checkout({userId: user.id, email: user.email, plan,
        reference: checkout.id, returnUrl, ...(input.locale === undefined ? {} : {locale: input.locale as string})});
      if(metrics){try{await metrics.recordConversion(environment,{name:'begin_checkout',dedupeKey:`waffo:${config.scope}:checkout:${checkout.id}`,itemId:plan.id,currency:plan.currency,...await conversions.consent(checkout.id)});}catch{/* Analytics does not determine checkout or payment success. */}}
      return json(result);
    } catch (error) {
      return error instanceof PaymentError ? json({error: error.code}, error.status) : json({error: 'payments_unavailable'}, 503);
    }
  };
}
export function apply(ctx: Context): void {
  let analytics:PaymentAnalytics|undefined;
  ctx.inject(['siteAnalytics'],scope=>{const candidate=scope.siteAnalytics as Partial<PaymentAnalytics>;if(typeof candidate.recordConversion==='function')analytics=candidate as PaymentAnalytics;return()=>{analytics=undefined;};});
  const storeFor = (env: unknown) => {
    const config = paymentConfig((env ?? {}) as PaymentEnv);
    if (!config) throw new PaymentError(503, 'payments_unavailable');
    return new PaymentStore(config);
  };
  ctx.provide('payments', {ready: env => paymentConfig((env ?? {}) as PaymentEnv) !== undefined,
    allows: (env, userId, planIds) => storeFor(env).allows(userId, planIds),
    summary: env => storeFor(env).summary(),
    async account(env, userId) {
      const config = paymentConfig((env ?? {}) as PaymentEnv);
      if (!config) throw new PaymentError(503, 'payments_unavailable');
      return new PaymentStore(config).account(userId);
    },
  } satisfies PaymentService);
  ctx.effect(() => ctx.http.use(createPaymentHandler(ctx.auth, providerFor, () => ctx.get('notifications'),()=>analytics), 12), 'dsh-base: Waffo Pancake merchant payment API');
}
