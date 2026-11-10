/** Keep official Platform account UI separate from the appended local account action. */
import { useId, type ReactElement } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { AccountSection } from '@dsh-base/client-settings-account/client'
import type { AccountSnapshot } from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'
import accountCss from '@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.module.css'
import css from './AnonymousAccountSection.module.css'
import type { AccountSignInCopy } from './locales.ts'

const NOOP = (): void => undefined
const NOOP_ASYNC = async (): Promise<void> => undefined

type Account = (props: {
  readonly presentation?: 'auto' | 'full-unavailable'
  readonly t: Translate
  readonly useAccount: SnapshotSelectorHook<AccountSnapshot>
  readonly useTheme: SnapshotSelectorHook<ThemeSnapshot>
  readonly start: () => Promise<void>
  readonly cancel: () => Promise<void>
  readonly avatarFailed: () => void
  readonly refreshAccount: () => Promise<void>
  readonly contactUs: () => void
  readonly showLogin: () => void
  readonly setOnboarding: () => void
}) => ReactElement

const OfficialAccount = AccountSection as unknown as Account

export interface AnonymousAccountSectionProps {
  readonly t: Translate
  readonly useAccount: SnapshotSelectorHook<AccountSnapshot>
  readonly useTheme: SnapshotSelectorHook<ThemeSnapshot>
  readonly signIn: () => void
  readonly copy: AccountSignInCopy
}

/** The unavailable official action must never authenticate a different account. */
export function AnonymousAccountSection({ t, useAccount, useTheme, signIn, copy }: AnonymousAccountSectionProps): ReactElement {
  const id = useId()
  return (
    <div className={css.accountPage} data-anonymous-account-page="true">
      <fieldset className={css.platformAccount} data-anonymous-platform-account
        disabled aria-disabled="true" title={copy.platformUnavailable} aria-description={copy.platformUnavailable}>
        <OfficialAccount presentation="full-unavailable" t={t} useAccount={useAccount} useTheme={useTheme}
          start={async () => { throw new Error(copy.platformUnavailable) }} cancel={NOOP_ASYNC} avatarFailed={NOOP}
          refreshAccount={NOOP_ASYNC} contactUs={NOOP} showLogin={NOOP} setOnboarding={NOOP} />
      </fieldset>
      <section className={`${accountCss.section} ${css.localAccount}`} data-dsh-base-account-sign-in aria-labelledby={id}>
        <div className={`${accountCss.row} ${css.localRow}`}>
          <div className={`${accountCss.identityCopy} ${css.localCopy}`}>
            <span id={id} className={accountCss.name}>{copy.title}</span>
            <span className={accountCss.status}>{copy.description}</span>
          </div>
          <Button variant="primary" data-dsh-base-sign-in onClick={signIn}>{copy.signIn}</Button>
        </div>
      </section>
    </div>
  )
}
