/**
 * Pinned official Plugins page contract guard.
 *
 * Commit 1 mounts the unchanged official `ui-plugin-manager` page and supplies
 * its Remote services through the read-only adaptation seam. This fixture renders
 * that official page against an official-shaped read-only contract: inventory is
 * readable, management is explicitly unavailable, and no mutation fakes success.
 * The former marked fork and its client inventory module were removed, so there
 * is only one page implementation to compare — this guard keeps the official
 * page's list/details contract and the read-only seam semantics under test.
 */
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { PluginManagerPage as OfficialPage } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/PluginManagerPage.tsx";
import { PluginManagerController as OfficialController } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/manager-store.ts";
import { createPluginHeaderRef } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/header-scroll.ts";
import * as copy from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts";

const snapshot = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} });
const entries: any[] = [
  { entryId: "client:official", moduleName: "@deepseek-ai/dsh-client-ui-session", origin: "upstream", enabled: true, fiberPhase: "active" },
  { entryId: "client:replacement", moduleName: "@dsh-base/client-model-selection", origin: "custom", enabled: true, fiberPhase: "active", replaces: "@deepseek-ai/dsh-client-ui-model-selection" },
  { entryId: "client:original", moduleName: "@deepseek-ai/dsh-client-ui-model-selection", origin: "upstream", enabled: false, fiberPhase: null, unavailableReason: "Read-only replacement" },
];
const NO_CONFIG = snapshot({ items: [], bundles: new Set(), rows: new Set() });
const NO_TABS = snapshot([]);
const unsupported = async () => ({ ok: false as const, error: { code: "plugin-manager/unsupported", message: "Not available in this Workers deployment.", details: {} } });

export function PluginManagerFixture({ locale, state }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const readonly = state === "readonly";
  const [navigation, setNavigation] = useState<any>({ view: { kind: "list" }, tab: "installed" });
  const setup = useMemo(() => {
    const calls: any[] = [];
    const monitor = (name: string, object: any) => Object.fromEntries(Object.entries(object).map(([key, method]) => [key, async (...args: any[]) => {
      calls.push({ endpoint: `${name}/${key}`, args });
      return await (method as any)(...args);
    }]));
    const manager = monitor("pluginManager", {
      // The official page short-circuits on managementAvailable!==true before
      // calling these, exactly as the deployed seam does; they stay explicit.
      listPlugins: async () => ({ ok: true as const, value: [] }),
      listBundles: async () => ({ ok: true as const, value: [] }),
      registries: unsupported,
      readBundleDetail: async () => ({ ok: true as const, value: { status: "none" as const } }),
      setBundleEnabled: unsupported,
      setPluginEnabled: unsupported,
      removeBundle: unsupported,
      listVersions: unsupported,
      updateBundle: unsupported,
      installBundle: unsupported,
      waitForInstall: unsupported,
      cancelInstall: unsupported,
      inspect: unsupported,
    });
    const inventory = monitor("pluginInventory", {
      // Read-only projection; the fixture exposes the same contract as the
      // deployed seam for both sides (there is only the official page now).
      list: async () => ({ ok: true as const, value: { managementAvailable: readonly ? false : true, entries, agentPresets: [] } }),
    });
    const context = {
      get: () => undefined,
      configForms: { describe: () => snapshot({ view: { namespaces: [] } }), get: () => undefined },
      locale: snapshot({ active: locale }),
      remote: { pluginManager: manager, pluginInventory: inventory, pluginRegistryProbe: monitor("pluginRegistryProbe", { fastest: async () => ({ ok: true as const, value: null }) }) },
    };
    const controller = new OfficialController(context as never);
    const face = controller.inject(NO_CONFIG, NO_TABS, (value: any) => typeof value === "string" ? value : value[locale] ?? value.en);
    (window as any).__PLUGIN_PARITY__ = { source: face.hooks.pluginManager, calls, entries, copy: copy[locale] };
    return { face };
  }, [locale, readonly]);
  const { face } = setup;
  const observed = useSyncExternalStore(face.hooks.pluginManager.subscribe, face.hooks.pluginManager.getSnapshot);
  const details = useSyncExternalStore(face.hooks.bundleDetails.subscribe, face.hooks.bundleDetails.getSnapshot);
  const props = {
    ...face, createHeaderRef: createPluginHeaderRef,
    t: (key: keyof typeof copy.en, values: Record<string, unknown> = {}) => String(copy[locale][key]).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? "")),
    usePluginManager: (select: any) => select(observed),
    useConfigurations: (select: any) => select({ view: { namespaces: [] } }),
    useConfigLedger: (select: any) => select(NO_CONFIG.getSnapshot()),
    usePluginTabs: (select: any) => select([]),
    useBundleDetails: (select: any) => select(details),
    useLocale: (select: any) => select({ active: locale }),
    useStore: (select: any) => select(navigation),
    actions: { setView: (view: any) => setNavigation((old: any) => ({ ...old, view })), setTab: (tab: any) => setNavigation((old: any) => ({ ...old, tab })) },
    renderSlot: (_name: string, _owner: any, options: any) => options?.fallback ?? null,
  };
  return <OfficialPage {...props as any} />;
}
