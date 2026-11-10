import { WaffoPancake, verifyWebhook, type CashierLanguage } from '@waffo/pancake-ts';
import { PaymentError, type PaymentConfig } from './config.ts';

export type {PaymentEvent,PaymentProvider,ProviderSnapshot} from './contracts.ts';
import {hostedUrl,parseSnapshot,type PaymentProvider} from './contracts.ts';
const LANGUAGES: Record<string,CashierLanguage> = {en:'en',zh:'zh-Hans','zh-CN':'zh-Hans','zh-TW':'zh-Hant-TW',ja:'ja-JP',ko:'ko-KR',es:'es-MX',pt:'pt-BR'};
export function providerFor(config: PaymentConfig): PaymentProvider {
  const client = new WaffoPancake({ merchantId: config.merchantId, privateKey: config.privateKey,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      // SDK 0.28 reads JSON envelopes without rejecting HTTP failures itself.
      if (!response.ok) { await response.body?.cancel(); throw new Error('provider unavailable'); }
      return response;
    } });
  return {
    verify(raw, signature) {
      try {
        // Explicit environment prevents the SDK's prod-then-test fallback.
        return verifyWebhook(raw, signature, {environment: config.environment, toleranceMs: 45 * 60_000, futureToleranceMs: 60_000});
      } catch { throw new PaymentError(400, 'invalid_webhook_signature'); }
    },
    async checkout(input) {
      const language = input.locale === undefined ? undefined : LANGUAGES[input.locale];
      const result = await client.checkout.authenticated.create({buyerIdentity: input.userId, buyerEmail: input.email,
        productId: input.plan.productId, currency: input.plan.currency, orderMerchantExternalId: input.reference,
        metadata: {dshPlanId: input.plan.id}, successUrl: input.returnUrl, expiresInSeconds: 3600,
        ...(language ? {language} : {})}, {idempotencyKey: `dsh_checkout_${input.reference}`});
      return {id: result.sessionId, url: hostedUrl(result.checkoutUrl)};
    },
    async portal(userId) {
      const result = await client.auth.createCustomerPortalLink({storeId: config.storeId, buyerIdentity: userId});
      return {url: hostedUrl(result.portalUrl)};
    },
    async snapshot(id, kind) {
      const field = kind === 'subscription' ? 'subscriptionOrder' : 'onetimeOrder';
      const product = kind === 'subscription' ? 'subscriptionProduct' : 'onetimeProduct';
      const subscription = kind === 'subscription' ? 'currentPeriodStart currentPeriodEnd changeOriginOrderId supersededByOrderId' : '';
      const result = await client.graphql.query<Record<string, unknown>>({query: `query DshPaymentOrder($id: String!) {
        ${field}(id: $id) { id status testMode store { id } merchantProvidedBuyerIdentity orderMerchantExternalId
          priceSnapshot { currency } ${product} { id } ${subscription}
          payments { id status refundStatus createdAt snapshotAmountDetails { currency } } }
      }`, variables: {id}});
      if (result.errors?.length || !result.data?.[field]) throw new Error('provider order unavailable');
      return parseSnapshot(result.data[field], kind);
    },
  };
}
