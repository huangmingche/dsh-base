/** Unchanged official account surfaces over a local identity without Platform billing. */
import React, { useMemo } from "react";
import { AccountSection } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.tsx";
import { AccountMenu } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.tsx";
import * as accountCopy from "@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts";
import { apply as availabilityApply } from "../../../../packages/client/dsh-base-client-account-availability/src/client/index.tsx";
import { billingUnavailableReason } from "../../../../packages/client/dsh-base-client-account-availability/src/availability.ts";

export function AccountFixture({ locale, adapted, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const setup = useMemo(() => {
    const calls: string[] = [];
    const snapshot = { view: { status: "credential-stored", attempt: null, links: { usageUrl: location.origin, topUpUrl: location.origin } }, details: { profile: { status: "ready", value: { id: "local-user", name: "Local User", contact: "local@example.invalid", avatarUrl: null } } }, avatar: undefined, failed: false };
    const t = (key: string) => (accountCopy[locale] as any)[key];
    const props: any = {
      t, useAccount: (selector: any) => selector(snapshot), useTheme: (selector: any) => selector({ active: { colorScheme: "light" } }),
      avatarFailed: () => {}, openPlatformPage: () => { calls.push("billing/open"); return () => {}; },
      start: async () => { calls.push("account/signIn"); }, cancel: async () => {}, signOut: async () => { calls.push("account/signOut"); },
      hasRunningAccountTasks: async () => false, refreshAccount: async () => {},
      contactUs: () => calls.push("contact"), showLogin: () => {}, setOnboarding: () => {}, bonusNoticeShown: () => {}, bonusNoticeDismissed: () => {},
      wide: true, settingsOpen: false, openSettings: () => calls.push("settings/open"), openOnboarding: () => {},
    };
    const registrations: any[] = [{ component: AccountSection, options: { name: "settings.section", id: "account" }, inject: () => { const { t: _rendererLocale, ...operations } = props; return operations; } }];
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
    const adaptedEntry = registrations.find(entry => entry.component !== AccountSection);
    (window as any).__ACCOUNT_PARITY__ = { calls, copy: accountCopy[locale], registered: adaptedEntry !== undefined, registeredLocale: adaptedEntry?.options.locale };
    return { props, adaptedEntry, snapshot, reason: billingUnavailableReason(locale) };
  }, [locale]);
  if (state === "menu") return <section style={{ position: "absolute", left: 32, bottom: 48, width: 250 }}><AccountMenu {...setup.props} /></section>;
  const Adapted = setup.adaptedEntry.component;
  const referenceProps = { ...setup.props, useAccount: (selector: any) => selector({ ...setup.snapshot, details: { ...setup.snapshot.details, balance: { status: "failed" } } }), t: (key: string) => key === "balanceUnavailable" ? setup.reason : setup.props.t(key) };
  return <section className="permission-fixture">{adapted ? <Adapted {...setup.adaptedEntry.inject()} t={setup.adaptedEntry.options.locale === "settings.account" ? setup.props.t : undefined} /> : <fieldset className="dsh-account-billing-unavailable" disabled aria-disabled="true" title={setup.reason}><AccountSection {...referenceProps as any} /></fieldset>}</section>;
}
