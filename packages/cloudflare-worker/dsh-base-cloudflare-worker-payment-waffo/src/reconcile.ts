import { PaymentError, nonempty, record, type PaymentConfig } from './config.ts';
import type { PaymentEvent, PaymentProvider, ProviderSnapshot } from './provider.ts';
import { PaymentStore, type CheckoutRow, type OrderRow } from './store.ts';
const EVENTS = new Set(['order.completed', 'subscription.activated', 'subscription.payment_succeeded', 'subscription.renewed',
  'subscription.recovered', 'subscription.plan_changed', 'subscription.plan_change_scheduled', 'subscription.plan_change_failed',
  'subscription.canceling', 'subscription.uncanceled', 'subscription.canceled', 'subscription.past_due', 'refund.succeeded', 'refund.failed']);

export function validateEvent(event: unknown, config: PaymentConfig): asserts event is PaymentEvent {
  if (!record(event) || !nonempty(event.id) || !nonempty(event.eventId) || !nonempty(event.eventType)
    || !nonempty(event.timestamp, 50) || !Number.isFinite(Date.parse(event.timestamp))
    || event.mode !== config.environment || event.storeId !== config.storeId
    || !record(event.data) || !nonempty(event.data.orderId)) throw new PaymentError(400, 'invalid_webhook_event');
}
/** Refund state belongs to a payment, independent of subscription cancellation. */
export function orderState(snapshot: ProviderSnapshot): {refunded: number; eligible: number} {
  const successful = snapshot.payments.filter(payment => payment.status === 'succeeded');
  const current = snapshot.kind === 'one_time' ? successful : successful.filter(payment => snapshot.periodStart !== null
    && Date.parse(payment.createdAt) >= Date.parse(snapshot.periodStart)
    && (snapshot.periodEnd === null || Date.parse(payment.createdAt) < Date.parse(snapshot.periodEnd)));
  const refunded = current.some(payment => payment.refundStatus === 'refunded');
  const paid = current.some(payment => payment.refundStatus === 'none' || payment.refundStatus === 'failed');
  const eligible = snapshot.kind === 'one_time' ? snapshot.status === 'completed' && paid && !refunded
    : ['active', 'trialing', 'canceling'].includes(snapshot.status) && !refunded
      && (paid || snapshot.status === 'trialing') && snapshot.periodEnd !== null;
  return {refunded: refunded ? 1 : 0, eligible: eligible && !snapshot.supersededBy ? 1 : 0};
}
/** Snapshot reads happen after the revision read, so concurrent delivery cannot overwrite a newer commit. */
export async function reconcile(config: PaymentConfig, store: PaymentStore, provider: PaymentProvider, event: PaymentEvent, hash: string, prepareNotice?: (notice: {eventType: string; orderId: string; planId: string; status: string; refunded: boolean}) => Promise<readonly D1PreparedStatement[]>,preparePurchase?:(checkoutId:string,planId:string,snapshot:ProviderSnapshot)=>readonly D1PreparedStatement[]): Promise<'processed' | 'duplicate' | 'ignored'> {
  validateEvent(event, config);
  if (!EVENTS.has(event.eventType)) return 'ignored';
  if (await store.duplicate(event.id, hash)) return 'duplicate';
  const before = await store.order(event.data.orderId);
  const eventReference = event.data.orderMerchantExternalId;
  let checkout: CheckoutRow | null = eventReference ? await store.checkout(eventReference) : null;
  if (!checkout && before) checkout = await store.checkout(before.checkout_id);
  const kind = before?.kind ?? checkout?.kind ?? (event.eventType.startsWith('subscription.') ? 'subscription' : undefined);
  // Events from independent sales in this store cannot create application accounts or grants.
  if (!kind) return 'ignored';
  const snapshot = await provider.snapshot(event.data.orderId, kind);
  if (snapshot.id !== event.data.orderId || snapshot.storeId !== config.storeId || snapshot.testMode !== (config.environment === 'test')) throw new PaymentError(400, 'payment_scope_mismatch');
  let origin: OrderRow | null = null;
  if (snapshot.originId) origin = await store.order(snapshot.originId);
  if (!checkout && snapshot.checkoutId) checkout = await store.checkout(snapshot.checkoutId);
  if (!checkout && origin) checkout = await store.checkout(origin.checkout_id);
  if (!checkout) return 'ignored';
  if (origin && origin.superseded_by !== snapshot.id) {
    const original = await provider.snapshot(origin.id, 'subscription');
    if (original.id !== origin.id || original.storeId !== config.storeId || original.testMode !== (config.environment === 'test')
      || original.buyerIdentity !== checkout.user_id || original.supersededBy !== snapshot.id
      || (origin.superseded_by !== null && origin.superseded_by !== snapshot.id) || snapshot.status === 'pending') {
      throw new PaymentError(503, 'payment_replacement_unconfirmed');
    }
  }
  if (snapshot.buyerIdentity !== checkout.user_id || (before && before.user_id !== checkout.user_id)
    || (origin && origin.user_id !== checkout.user_id)
    || (event.data.merchantProvidedBuyerIdentity !== undefined && event.data.merchantProvidedBuyerIdentity !== checkout.user_id)) {
    throw new PaymentError(400, 'payment_owner_mismatch');
  }
  if (!origin && snapshot.checkoutId !== checkout.id) throw new PaymentError(400, 'payment_reference_mismatch');
  const plan = config.plans.find(plan => plan.productId === snapshot.productId && plan.currency === snapshot.currency && plan.type === kind);
  if (!plan || (!origin && (plan.productId !== checkout.product_id || plan.currency !== checkout.currency || plan.type !== checkout.kind))) throw new PaymentError(400, 'payment_product_mismatch');
  // For a renewal or late event the API's current state, never event timestamp/orderStatus, is authoritative.
  const state = orderState(snapshot);
  const changed = before === null || before.plan_id !== plan.id || before.status !== snapshot.status
    || before.period_end !== snapshot.periodEnd || before.refunded !== state.refunded
    || before.superseded_by !== (before.superseded_by ?? snapshot.supersededBy);
  const outbox = changed ? await prepareNotice?.({eventType: event.eventType, orderId: snapshot.id, planId: plan.id, status: snapshot.status, refunded: state.refunded === 1}) ?? [] : [];
  const purchase=state.eligible===1&&state.refunded===0?preparePurchase?.(checkout.id,plan.id,snapshot)??[]:[];
  await store.commit(event.id, hash, {id: snapshot.id, user_id: checkout.user_id, checkout_id: checkout.id,
    plan_id: plan.id, kind, status: snapshot.status, period_end: snapshot.periodEnd, ...state, superseded_by: before?.superseded_by ?? snapshot.supersededBy}, before, origin ?? undefined, [...outbox,...purchase]);
  return 'processed';
}
