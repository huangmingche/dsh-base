import { useEffect } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import type { PaymentOrder, PaymentPlan, PaymentStore } from './payment-store.ts';
import { NS } from './locales.ts';
export interface PaymentFace {
  readonly hooks: { readonly payment: Pick<PaymentStore, 'getSnapshot' | 'subscribe'> };
  readonly ensure: PaymentStore['ensure'];
  readonly reload: () => void;
  readonly checkout: (plan: string) => void;
  readonly portal: () => void;
  readonly signIn: () => void;
  readonly leave: () => void;
  readonly language: string;
}
export type PaymentProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<PaymentFace>;
const statuses = { pending: 'pending', completed: 'completed', active: 'active', trialing: 'active', canceling: 'canceling', past_due: 'pastDue', canceled: 'canceled', expired: 'expired', closed: 'canceled', failed: 'failedPayment' } as const;
function orderStatus(order: PaymentOrder): (typeof statuses)[keyof typeof statuses] | 'refunded' | 'unknown' {
  return order.refunded ? 'refunded' : statuses[order.status as keyof typeof statuses] ?? 'unknown';
}
function formatPlanPrice(plan: PaymentPlan, language: string): string | undefined {
  if (!plan.price) return;
  const price = Number(plan.price.amount);
  try {
    const amount = new Intl.NumberFormat(language, { style: 'currency', currency: plan.currency }).format(price);
    if (!plan.price.interval) return amount;
    const interval = new Intl.NumberFormat(language, { style: 'unit', unit: plan.price.interval, unitDisplay: 'long' });
    return `${amount} / ${interval.format(plan.price.intervalCount ?? 1)}`;
  } catch {
    return `${plan.price.amount} ${plan.currency}`;
  }
}

/** Feature content only: the official plugin manager owns title, sections, navigation and page layout. */
export function PaymentPanel(props: PaymentProps) {
  const { t } = props;
  const state = props.usePayment(value => value);
  useEffect(() => { if (props.view === 'page') {props.ensure();return props.leave;} }, [props.view, props.ensure,props.leave]);
  if (props.view === 'summary') return t('description');
  const loading = state.status === 'loading' || state.status === 'idle';
  const ready = state.status === 'ready' && state.catalog?.ready === true;
  const blocked = !ready || !!state.busy || state.auth === 'unknown';
  const unavailable = !ready ? t('unavailable') : undefined;
  const planName = (id: string) => state.catalog?.plans.find(plan => plan.id === id)?.name ?? id;
  const date = (value: string): string => { try { return new Date(value).toLocaleDateString(props.language); } catch { return new Date(value).toISOString().slice(0, 10); } };
  return <div data-waffo-panel data-state={state.status} aria-busy={loading || !!state.busy}>
    <div className={fieldCss.field}>
      <div className={fieldCss.head}>
        <span className={fieldCss.label} role="status">{t(loading ? 'loading' : state.status === 'error' ? 'failed' : ready ? 'ready' : 'unavailable')}</span>
        <Button size="sm" variant="outline" disabled={loading || !!state.busy} onClick={props.reload}>{t('refresh')}</Button>
      </div>
      <p className={fieldCss.hint}>{t('scope')}</p>
      {!ready && !loading ? <p className={fieldCss.hint}>{t('setup')}</p> : null}
      {state.status === 'error' ? <p className={fieldCss.invalid} role="alert">{t('failed')}</p> : null}
      {state.accountFailed ? <p className={fieldCss.invalid} role="alert">{t('accountFailed')}</p> : null}
      {state.actionFailed ? <p className={fieldCss.invalid} role="alert">{t('actionFailed')}</p> : null}
    </div>
    <section className={fieldCss.field} aria-label={t('plans')}>
      <span className={fieldCss.label}>{t('plans')}</span>
      <p className={fieldCss.hint}>{t('priceNotice')}</p>
      {state.catalog?.plans.length ? state.catalog.plans.map(plan => <div className={fieldCss.field} key={plan.id} data-payment-plan={plan.id}>
        <div className={fieldCss.head}>
          <span className={fieldCss.label}>{plan.name ?? plan.id}</span>
          <Button size="sm" variant="primary" disabled={blocked} onClick={() => props.checkout(plan.id)}>{state.busy === plan.id ? t('wait') : t(state.auth === 'guest' ? 'signIn' : 'checkout')}</Button>
        </div>
        <p className={fieldCss.hint}>{t(plan.type === 'subscription' ? 'subscription' : 'oneTime')} · {plan.currency}</p>
        {plan.description ? <p className={fieldCss.hint}>{plan.description}</p> : null}
        <p className={fieldCss.label} data-plan-price={plan.price ? 'declared' : 'unavailable'}>
          {formatPlanPrice(plan, props.language) ?? t('priceNotice')}
        </p>
        {plan.features?.length ? <ul>{plan.features.map(feature =>
          <li key={feature.id} data-plan-feature={feature.id}>{feature.label}</li>
        )}</ul> : null}
      </div>) : <>
        {!loading ? <p className={fieldCss.hint}>{t('none')}</p> : null}
        <div className={fieldCss.head}><Button size="sm" variant="primary" disabled title={unavailable}>{t('checkout')}</Button></div>
      </>}
    </section>
    <section className={fieldCss.field} aria-label={t('orders')}>
      <div className={fieldCss.head}>
        <span className={fieldCss.label}>{t('orders')}</span>
        <Button size="sm" variant="outline" disabled={blocked || (state.auth === 'signed-in' && state.account?.portalAvailable !== true)} title={!ready ? unavailable : state.auth === 'signed-in' && !state.account?.portalAvailable ? t('portalUnavailable') : undefined}
          onClick={state.auth === 'guest' ? props.signIn : props.portal}>{state.busy === 'portal' ? t('wait') : t('portal')}</Button>
      </div>
      {state.auth === 'guest' ? <p className={fieldCss.hint}>{t('guest')}</p> : null}
      {state.auth === 'signed-in' && state.account?.orders.length === 0 ? <p className={fieldCss.hint}>{t('noOrders')}</p> : null}
      {state.auth === 'signed-in' ? state.account?.orders.map(order => <div className={fieldCss.field} key={order.id} data-payment-order={order.id}>
        <div className={fieldCss.head}><span className={fieldCss.label}>{planName(order.planId)}</span><span className={fieldCss.hint}>{t(orderStatus(order))}</span></div>
        <p className={fieldCss.hint}>{t(order.entitled && !order.refunded ? 'active' : 'inactive')}</p>
        {order.periodEnd ? <p className={fieldCss.hint}>{t('periodEnd')}: {date(order.periodEnd)}</p> : null}
      </div>) : null}
    </section>
  </div>;
}
