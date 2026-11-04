/** Actual Cordis SlotRegistry + full settings apply: raw inventory and rendered navigation differ. */
import React, { useMemo, useSyncExternalStore } from "react";
import { Context } from "@deepseek-ai/cordis";
import { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { apply as officialApply } from "@deepseek-ai/dsh-client-ui-settings-general/client";
import { apply as adaptedApply } from "../../../../packages/client/dsh-base-client-settings-navigation/src/client/index.ts";
import * as accountCopy from "@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts";
import * as presetCopy from "@deepseek-ai/dsh-client-ui-agent-preset/src/client/locales.ts";
import { AccountSection } from "@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountSection.tsx";
import { AgentPresetSection } from "@deepseek-ai/dsh-client-ui-agent-preset/src/client/AgentPresetSection.tsx";
import { apply as accountAvailability, UnavailableBillingSection } from "../../../../packages/client/dsh-base-client-account-availability/src/client/index.tsx";
import { AgentPresetSection as ForkAgentPresetSection } from "../../../../packages/client/dsh-base-client-agent-preset/src/client/AgentPresetSection.tsx";

export function SettingsNavigationFixture({ locale, adapted }: { locale: "en" | "zh"; adapted: boolean }) {
  const setup = useMemo(() => {
    const ctx = new Context();
    const dictionaries = new Map<string, any>();
    const localeStore = createSnapshotStore({ active: locale, revision: 1 });
    const localeFace = {
      ...localeStore,
      register: (namespace: string, dictionary: any) => { dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace); },
      bind: (namespace: string) => (key: string, values: Record<string, unknown> = {}) => String(dictionaries.get(namespace)?.[locale]?.[key] ?? key).replace(/\{([^}]+)\}/g, (_, key) => String(values[key] ?? "")),
    };
    ctx.provide("locale", localeFace as never);
    ctx.provide("connection", { state: createSnapshotStore("connected"), reconnect: () => {} } as never);
    ctx.provide("shortcuts", { catalog: createSnapshotStore([]), register: () => () => {} } as never);
    ctx.provide("remote", { $host: { isLoopback: false }, settings: {} } as never);
    ctx.provide("modules", { entries: { releaseChange: createSnapshotStore(undefined), dismissRelease: () => {} } } as never);
    ctx.provide("configForms", {} as never);
    ctx.provide("remoteAccess", { whenAccess: (_key: string, effect: () => unknown) => effect() } as never);
    new SlotRegistry(ctx);
    const slots = ctx.get("slots")!;
    slots.register({ name: "root", children: {
      "sidebar.settings": { kind: "single", scope: "root" },
      "sidebar.toggle.badge": { kind: "single", scope: "root" },
      "shell.overlay": { kind: "list", scope: "root" },
    } } as never, (() => null) as never);
    (adapted ? adaptedApply : officialApply)(ctx);
    const labels = { account: accountCopy[locale].nav, presets: presetCopy[locale].nav };
    const accountOptions = { name: "settings.section", id: "account", order: -10, label: () => labels.account, locale: "settings.account", inject: () => ({}) };
    let accountDisposer = slots.register(accountOptions as never, AccountSection as never);
    const presetSection = adapted ? ForkAgentPresetSection : AgentPresetSection;
    slots.register({ name: "settings.section", id: "agent-presets", order: 20, label: () => labels.presets, locale: "settings.agentPreset",
      inject: () => adapted ? ({ viewUnavailableReason: () => "unavailable", creatorUnavailableReason: "unavailable" } as never) : ({} as never) } as never, presetSection as never);
    slots.register({ name: "settings.onboarding", id: "capability", order: 0 } as never, (() => null) as never);
    if (adapted) {
      // Run the real availability plugins, including their subscribe/re-register lifecycle.
      accountAvailability(ctx);
      slots.register({ name: "settings.onboarding", id: "capability", order: 0, priority: -1 } as never, (() => null) as never);
    }
    const registration = slots.entriesOfSlot("sidebar.settings")[0]!;
    const injected = registration.inject!();
    const shell = (registration.store as any).create();
    shell.actions.openSection("account");
    const source = (injected as any).hooks.sections;
    const onboarding = (injected as any).hooks.onboardingSteps;
    (window as any).__NAV_PARITY__ = { source, onboarding, labels,
      rawSections: () => slots.entries("settings.section").map(entry => entry.options.id),
      rawOnboarding: () => slots.entries("settings.onboarding").map(entry => entry.options.id),
      removeAccount: () => { accountDisposer(); },
      restoreAccount: () => { accountDisposer = slots.register(accountOptions as never, AccountSection as never); },
    };
    return { ctx, slots, registration, injected, shell, source, onboarding, t: localeFace.bind(registration.locale!) };
  }, [locale, adapted]);
  const state = useSyncExternalStore(setup.shell.subscribe, setup.shell.getSnapshot);
  const sections = useSyncExternalStore(setup.source.subscribe, setup.source.getSnapshot);
  const steps = useSyncExternalStore(setup.onboarding.subscribe, setup.onboarding.getSnapshot);
  const Shell = setup.registration.component as React.ComponentType<any>;
  const renderSlot = (name: string, _owner: unknown, options: any = {}) => {
    if (name === "settings.section") {
      const entry = setup.slots.entriesOfSlot("settings.section").find(entry => entry.options.id === options.only);
      const unavailable = entry?.component === UnavailableBillingSection || entry?.component === ForkAgentPresetSection;
      return <div data-settings-content={options.only} data-unavailable-winner={String(unavailable)}>{options.only}</div>;
    }
    if (name === "settings.header" || name === "settings.trigger") return setup.t("trigger");
    if (name === "settings.close") return locale === "zh" ? "关闭" : "Close";
    return options.fallback ?? null;
  };
  return <section style={{ position: "absolute", left: 20, bottom: 24, width: 240 }}><Shell
    {...setup.injected} wide t={setup.t} useStore={(select: any) => select(state)} actions={setup.shell.actions}
    useSections={(select: any) => select(sections)} useOnboardingSteps={(select: any) => select(steps)}
    useShortcuts={(select: any) => select([])} useDesktopUpdate={(select: any) => select({ failed: false, opening: false })}
    useConnectionState={(select: any) => select("connected")} useSessions={(select: any) => select({ phase: "ready", byId: { session: { blank: false, retainedBy: { mainView: 1 } } } })}
    renderSlot={renderSlot}
  /></section>;
}
