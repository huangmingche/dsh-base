/** First-party daily counts, visible only within the existing administrator editor. */
import { useEffect, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import css from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import type { GlobalSettingsKey } from './locales.ts';
type Row = { day: string; event_name: string; count: number; campaign: string; currency: string; value: number };
const labels = { sign_up: 'conversionSignup', activation: 'conversionActivation', begin_checkout: 'conversionCheckout', purchase: 'conversionPurchase' } as const;
export function ConversionSummary({ t, locale = 'en' }: { t: (key: GlobalSettingsKey) => string; locale?: string }) {
  const [rows, setRows] = useState<readonly Row[]>();
  const [failure, setFailure] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setFailure(false); setRows(undefined);
    void fetch('/api/site-analytics/conversions', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json() as { rows?: Row[] };
      if (!Array.isArray(value.rows) || value.rows.some(row => !Object.hasOwn(labels, row.event_name) || !/^\d{4}-\d{2}-\d{2}$/u.test(row.day) || !Number.isSafeInteger(row.count) || row.count < 0 || typeof row.currency !== 'string' || row.currency !== '' && !/^[A-Z]{3}$/u.test(row.currency) || !Number.isFinite(row.value) || row.value < 0)) throw new Error('invalid');
      if (!controller.signal.aborted) setRows(value.rows);
    }).catch(() => { if (!controller.signal.aborted) setFailure(true); });
    return () => controller.abort();
  }, [revision]);
  return <section className={css.field} aria-label={t('conversionSummary')}>
    <div className={css.head}><h4 className={css.label}>{t('conversionSummary')}</h4><Button size="sm" variant="outline" onClick={() => refresh(value => value + 1)}>{t('reload')}</Button></div>
    {failure ? <p className={css.hint} role="status">{t('loadFailed')}</p> : rows === undefined ? <p className={css.hint}>{t('loading')}</p>
      : rows.length === 0 ? <p className={css.hint}>{t('conversionEmpty')}</p>
      : <table><thead><tr><th>{t('conversionDate')}</th><th>{t('conversionEvent')}</th><th>{t('conversionCount')}</th><th>{t('conversionRevenue')}</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}><td>{row.day}</td><td>{t(labels[row.event_name as keyof typeof labels])}{row.campaign ? ` · ${row.campaign}` : ''}</td><td>{row.count}</td><td>{row.currency ? new Intl.NumberFormat(locale, {style: 'currency', currency: row.currency}).format(row.value) : '—'}</td></tr>)}</tbody></table>}
  </section>;
}
