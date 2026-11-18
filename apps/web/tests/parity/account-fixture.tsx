/** Unchanged official account surfaces over a local identity without Platform billing. */
import React, { useMemo } from "react";
import { AccountSection } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.tsx";
import { AccountSection as ForkAccountSection } from "@dsh-base/client-settings-account/client";
import { AccountMenu } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.tsx";
import { AccountMenu as ForkAccountMenu } from "@dsh-base/client-settings-account/src/client/AccountMenu.tsx";
import { AccountNotifications, type AccountNotificationsProps } from "@deepseek-ai/dsh-client-ui-account-notifications/src/client/AccountNotifications.tsx";
import * as notificationCopy from "@deepseek-ai/dsh-client-ui-account-notifications/src/client/locales.ts";
import * as accountCopy from "@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts";
import { apply as availabilityApply } from "../../../../packages/client/dsh-base-client-account-availability/src/client/index.tsx";
import { billingUnavailableReason } from "../../../../packages/client/dsh-base-client-account-availability/src/availability.ts";

export function AccountFixture({ locale, adapted, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  if (state.startsWith("auto-")) return <DefaultAccountFixture locale={locale} adapted={adapted} state={state.slice(5)} />;
  const setup = useMemo(() => {
    const calls: string[] = [];
    const snapshot = { view: { status: "credential-stored", attempt: null, links: { usageUrl: location.origin, topUpUrl: location.origin } }, details: { profile: { status: "ready", value: { id: "local-user", name: "Local User", contact: "local@example.invalid", avatarUrl: null } } }, avatar: undefined, failed: false };
    const t = (key: string) => (accountCopy[locale] as any)[key];
    const props: any = {
      t, useAccount: (selector: any) => selector(snapshot), useTheme: (selector: any) => selector({ active: { colorScheme: "light" } }),
      avatarFailed: () => {}, openPlatformPage: () => { calls.push("billing/open"); return () => {}; },
      start: async () => { calls.push("account/signIn"); }, cancel: async () => {}, signOut: async () => { calls.push("account/signOut"); },
      hasRunningAccountTasks: async () => false, refreshAccount: async () => {},
      contactUs: () => calls.push("contact"), showLogin: () => {}, setOnboarding: () => {}, renderSlot: (name: string, owner: Pick<AccountNotificationsProps, "active" | "openAccount">) => {
        if (name !== "settings.launcher.notifications") throw new Error(`Unexpected account slot: ${name}`);
        (window as any).__ACCOUNT_PARITY__.notificationActive = owner.active;
        return <AccountNotifications {...owner} useNotices={select => select([])}
          shown={() => {}} ctaClicked={() => {}} dismiss={() => {}} t={key => notificationCopy[locale][key]} />;
      },
      wide: true, settingsOpen: false, openSettings: () => calls.push("settings/open"), openOnboarding: () => {},
    };
    const registrations: any[] = [{ component: ForkAccountSection, options: { name: "settings.section", id: "account" }, inject: () => { const { t: _rendererLocale, ...operations } = props; return operations; } }];
    const listeners = new Set<() => void>();
    const ctx = {
      effect: (callback: any) => callback(),
      locale: { getSnapshot: () => ({ active: locale }) },
      slots: {
        entries: () => registrations,
        subscribe: (_name: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        register: (options: any, component: any) => {
          const entry = { options, component, inject: options.inject }; registrations.push(entry);
          for (const listener of listeners) listener();
          return () => { registrations.splice(registrations.indexOf(entry), 1); };
        },
      },
    };
    availabilityApply(ctx as never);
    const adaptedEntry = registrations.find(entry => entry.component !== ForkAccountSection);
    (window as any).__ACCOUNT_PARITY__ = { calls, copy: accountCopy[locale], registered: adaptedEntry !== undefined, registeredLocale: adaptedEntry?.options.locale };
    return { props, adaptedEntry, snapshot, reason: billingUnavailableReason(locale) };
  }, [locale]);
  const Menu = adapted ? ForkAccountMenu : AccountMenu;
  if (state === "menu") return <section style={{ position: "absolute", left: 32, bottom: 48, width: 250 }}><Menu {...setup.props} /></section>;
  const Adapted = setup.adaptedEntry.component;
  const referenceProps = { ...setup.props, useAccount: (selector: any) => selector({ ...setup.snapshot, details: { ...setup.snapshot.details, balance: { status: "failed" } } }), t: (key: string) => key === "balanceUnavailable" ? setup.reason : setup.props.t(key) };
  return <section className="permission-fixture">{adapted ? <Adapted {...setup.adaptedEntry.inject()} t={setup.adaptedEntry.options.locale === "settings.account" ? setup.props.t : undefined} /> : <fieldset className="dsh-account-billing-unavailable" disabled aria-disabled="true" title={setup.reason}><AccountSection {...referenceProps as any} /></fieldset>}</section>;
}

/** Direct pinned implementation versus the fork with its default presentation.
 * These are explicit Host contract fixtures; none is used to impersonate an anonymous account.
 */
function DefaultAccountFixture({ locale, adapted, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const calls = useMemo(() => [] as string[], []);
  const signedIn = state.startsWith('signed-in');
  const profile = { status: 'ready', value: { id: 'fixture-user', name: 'Fixture User', contact: 'fixture@example.invalid', avatarUrl: null } };
  const snapshot = {
    view: state === 'unknown' ? undefined : { status: signedIn ? 'credential-stored' : 'signed-out', attempt: null,
      links: { usageUrl: `${location.origin}/platform/usage`, topUpUrl: `${location.origin}/platform/top-up` } },
    details: !signedIn || state === 'signed-in-loading' ? undefined
      : state === 'signed-in-failed' ? { profile: { status: 'failed' }, balance: { status: 'failed' } }
      : { profile, balance: state === 'signed-in-wallets'
        ? { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }, { currency: 'USD', balance: '5.67' }], bonusWallets: [{ currency: 'CNY', balance: '2.50' }] }
        : { status: 'ready', value: [{ currency: 'CNY', balance: '0.00' }], bonusWallets: [] } },
    avatar: undefined, failed: state === 'stream-error',
  };
  const Component = adapted ? ForkAccountSection : AccountSection;
  const props = { t: (key: string) => (accountCopy[locale] as any)[key], useAccount: (select: any) => select(snapshot),
    useTheme: (select: any) => select({ active: { colorScheme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light' } }),
    start: async () => { calls.push('account/signIn'); }, cancel: async () => { calls.push('account/cancel'); }, avatarFailed: () => {},
    refreshAccount: async () => {}, contactUs: () => {}, showLogin: () => {}, setOnboarding: () => {},
  };
  (window as any).__ACCOUNT_PARITY__ = { calls, snapshot, copy: accountCopy[locale], registered: true, mode: 'auto' };
  return <section className="permission-fixture"><Component {...props as any} /></section>;
}
