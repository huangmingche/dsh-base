/** Independent specification of the approved anonymous full layout.
 * The pinned AccountSection cannot render its full branch from a signed-out snapshot.
 * This test-only oracle composes its exported stylesheet and primitives; it does not
 * forge an authenticated Host state or claim to be the original signed-out renderer.
 * The default fork is separately compared directly to the original in run-account.mjs.
 */
import { useMemo, useState } from 'react';
import { IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { AccountAvatar } from '@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountAvatar.tsx';
import accountCss from '@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.module.css';
import * as accountCopy from '@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts';
import { AnonymousAccountSection } from '../../../../packages/client/dsh-base-client-account-launcher/src/client/AnonymousAccountSection.tsx';
import { accountSignInCopy } from '../../../../packages/client/dsh-base-client-account-launcher/src/client/locales.ts';

function AnonymousLayoutReference({ t }: { t: (key: string) => string }) {
  const unavailable = { 'aria-disabled': true, tabIndex: -1, style: { opacity: 0.4, cursor: 'not-allowed' } } as const;
  return <section className={accountCss.section} aria-label={t('nav')}>
    <div className={accountCss.card}>
      <div className={accountCss.identity}>
        <span className={accountCss.avatar}><AccountAvatar avatar={undefined} avatarFailed={() => {}} /></span>
        <div className={accountCss.identityCopy}>
          <span className={accountCss.name}>{t('signedOut')}</span>
          <span className={accountCss.status} role="status">{t('signInDescription')}</span>
        </div>
      </div>
      <a className={accountCss.accountInfo} {...unavailable}>{t('accountInfo')}<IconRightUpOutlineRegular size={12} /></a>
    </div>
    <div className={accountCss.balanceCard}>
      <div className={accountCss.row}><span>{t('balance')}</span><span className={accountCss.unavailable}>{t('balanceSignedOut')}</span></div>
      <div className={accountCss.divider} />
      <div className={accountCss.row}><span>{t('bonusBalance')}</span><span className={accountCss.bonusValue}><span className={accountCss.unavailable}>{t('balanceSignedOut')}</span></span></div>
      <div className={accountCss.divider} />
      <div className={accountCss.row}>
        <span className={accountCss.secondary}>{t('more')}</span>
        <div className={accountCss.links}>
          <a className={accountCss.linkButton} {...unavailable}>{t('usage')}</a>
          <a className={`${accountCss.linkButton} ${accountCss.primary}`} {...unavailable}>{t('topUp')}</a>
        </div>
      </div>
    </div>
  </section>;
}

export function AnonymousAccountFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const [height, setHeight] = useState(600);
  const calls = useMemo(() => [] as string[], []);
  const reads = useMemo(() => [] as unknown[], []);
  const snapshot = useMemo(() => Object.freeze({
    view: Object.freeze({ status: 'signed-out', attempt: null, links: Object.freeze({ usageUrl: `${location.origin}/private/usage`, topUpUrl: `${location.origin}/private/top-up` }) }),
    details: undefined, avatar: undefined, failed: false,
  }), []);
  const copy = accountSignInCopy(locale);
  const props = {
    t: (key: string) => (accountCopy[locale] as Record<string, string>)[key],
    useAccount: (select: any) => { reads.push({ status: snapshot.view.status, attempt: snapshot.view.attempt, detailsAbsent: snapshot.details === undefined, avatarAbsent: snapshot.avatar === undefined }); return select(snapshot); },
    useTheme: (select: any) => select({ active: { colorScheme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light' } }),
  };
  (window as any).__ANONYMOUS_ACCOUNT_PARITY__ = { calls, reads, snapshot, setHeight, copy, officialCopy: accountCopy[locale] };
  return <main style={{ width: 'calc(100% - 48px)', maxWidth: 720, height: 'calc(100% - 64px)', margin: '32px auto', fontSize: 13, lineHeight: '22px' }}>
    {adapted ? <AnonymousAccountSection {...props as any} signIn={() => { calls.push('local/signIn'); }} copy={copy} />
      : <fieldset data-reference-platform-account disabled title={copy.platformUnavailable} aria-disabled="true" aria-description={copy.platformUnavailable}
        style={{ minWidth: 0, margin: 0, padding: 0, border: 0, height }}>
        <AnonymousLayoutReference t={props.t} />
      </fieldset>}
  </main>;
}
