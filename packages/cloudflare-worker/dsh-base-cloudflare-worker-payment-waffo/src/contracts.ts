import type {WebhookEvent,WebhookEventData} from '@waffo/pancake-ts';
import {nonempty,record,type PaymentPlan} from './config.ts';
export type PaymentEvent = WebhookEvent<WebhookEventData>;
export interface ProviderSnapshot {
  id: string; status: string; testMode: boolean; storeId: string; buyerIdentity: string;
  checkoutId: string | null; productId: string; currency: string; kind: PaymentPlan['type'];
  periodStart: string | null; periodEnd: string | null; originId: string | null; supersededBy: string | null;
  payments: Array<{id: string; status: string; refundStatus: string; createdAt: string;currency?:string}>;
}
export interface PaymentProvider {
  verify(raw: string, signature: string | null): PaymentEvent;
  checkout(input: {userId: string; email: string; plan: PaymentPlan; reference: string; returnUrl: string; locale?: string}): Promise<{id: string; url: string}>;
  portal(userId: string): Promise<{url: string}>;
  snapshot(id: string, kind: PaymentPlan['type']): Promise<ProviderSnapshot>;
}
export function hostedUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'pancake.waffo.ai' || url.username || url.password || url.port) throw new Error('unexpected payment host');
  return url.href;
}
function date(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!nonempty(value, 50) || !Number.isFinite(Date.parse(value))) throw new Error('invalid provider date');
  return new Date(value).toISOString();
}
/** Validate query-only GraphQL separately from the SDK's REST types. */
export function parseSnapshot(value: unknown, kind: PaymentPlan['type']): ProviderSnapshot {
  if (!record(value) || !nonempty(value.id) || !nonempty(value.status)
    || typeof value.testMode !== 'boolean' || !record(value.store) || !nonempty(value.store.id)
    || !nonempty(value.merchantProvidedBuyerIdentity) || !record(value.priceSnapshot) || !nonempty(value.priceSnapshot.currency)
    || !Array.isArray(value.payments)) throw new Error('invalid provider order');
  const product = kind === 'subscription' ? value.subscriptionProduct : value.onetimeProduct;
  if (!record(product) || !nonempty(product.id)) throw new Error('invalid provider product');
  const optionalId = (item: unknown): string | null => { if (item == null) return null; if (!nonempty(item)) throw new Error('invalid provider identity'); return item; };
  const payments = value.payments.map(payment => {
    if (!record(payment) || !nonempty(payment.id) || !nonempty(payment.status)
      || !['none', 'pending', 'failed', 'refunded'].includes(String(payment.refundStatus))) throw new Error('invalid provider payment');
    const createdAt = date(payment.createdAt); if (!createdAt) throw new Error('missing provider payment date');
    const amounts=payment.snapshotAmountDetails;
    // A price snapshot is not proof of the amount actually charged. Keep only
    // its currency for matching the signed payment event to this queried payment.
    const currency=record(amounts)&&typeof amounts.currency==='string'&&/^[A-Z]{3}$/u.test(amounts.currency)?amounts.currency:undefined;
    return {id: payment.id, status: payment.status, refundStatus: String(payment.refundStatus), createdAt,...(currency===undefined?{}:{currency})};
  });
  return {id: value.id, status: value.status, testMode: value.testMode, storeId: value.store.id,
    buyerIdentity: value.merchantProvidedBuyerIdentity, checkoutId: optionalId(value.orderMerchantExternalId), productId: product.id,
    currency: value.priceSnapshot.currency, kind, periodStart: date(value.currentPeriodStart), periodEnd: date(value.currentPeriodEnd),
    originId: optionalId(value.changeOriginOrderId), supersededBy: optionalId(value.supersededByOrderId), payments};
}
