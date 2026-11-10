/**
 * Pinned official Plugins page contract guard.
 *
 * The pinned official page is the reference; the marked fork is the adapted
 * page. The same native contracts must retain exact text/geometry/pixels:
 * - `standard`: independent pinned-source catalog on the reference side and
 *   the production inventory seam on the adapted side. Neither may be empty.
 * - `management`: the real restored `pluginInventory`/`pluginManager` seam with a
 *   fixture control transport; this is where the owner-scoped selection, the
 *   generated Think allowlist and the "never fake a mutation" contract are
 *   exercised through the seam itself.
 *
 * `readonly` keeps the Commit 1 deployment reading (managementAvailable:false)
 * so the official unavailable copy stays covered.
 */
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { PluginArtworkDefault, PluginArtworkSubagent, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { PluginManagerPage as OfficialPage } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/PluginManagerPage.tsx";
import { PluginManagerController as OfficialController } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/manager-store.ts";
import { PluginManagerPage as AdaptedPage } from "../../../../packages/client/dsh-base-client-plugin-manager/src/client/PluginManagerPage.tsx";
import { PluginManagerController as AdaptedController } from "../../../../packages/client/dsh-base-client-plugin-manager/src/client/manager-store.ts";
import { createPluginHeaderRef } from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/header-scroll.ts";
import * as copy from "@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts";
import { createPluginInventoryRemotes } from "../../../../packages/client/dsh-base-client-session-adapter/src/client/plugin-inventory.ts";
import { createCountsFixture } from './plugin-counts-fixture.tsx';
import { PluginManagerBuiltinFixture } from './plugin-manager-builtin-fixture.tsx';
import { createGlobalSettingsSlotsFixture } from './global-settings-slots-fixture.tsx';

const snapshot = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} });
const entries: any[] = [
  { entryId: "client:official", moduleName: "@deepseek-ai/dsh-client-ui-session", origin: "upstream", enabled: true, fiberPhase: "active" },
  { entryId: "client:replacement", moduleName: "@dsh-base/client-model-selection", origin: "fork", enabled: true, fiberPhase: "active", replaces: "@deepseek-ai/dsh-client-ui-model-selection" },
  { entryId: "client:original", moduleName: "@deepseek-ai/dsh-client-ui-model-selection", origin: "upstream", enabled: false, fiberPhase: null, unavailableReason: "Read-only replacement" },
  { entryId: "client:gateway-provider", moduleName: "@dsh-base/client-gateway-provider", origin: "custom", enabled: true, fiberPhase: "active" },
];
const NO_CONFIG = snapshot({ items: [], bundles: new Set(), rows: new Set() });
const NO_TABS = snapshot([]);
const unsupported = async () => ({ ok: false as const, error: { code: "plugin-manager/unsupported", message: "Not available in this Workers deployment.", details: {} } });

/** Deterministic control-plane transport; the real seam decides every rule. */
function fixtureControlFetch(requests: any[], workerEntries: any[]) {
  let control = { revision: 0, overrides: {} as Record<string, { disabled?: boolean }> };
  const fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    requests.push({ path: url, method: init?.method ?? 'GET' });
    if (url.endsWith("/inventory")) return Response.json({ entries: workerEntries });
    if ((init?.method ?? "GET") === "GET") return Response.json(control);
    const body = JSON.parse(String(init?.body)) as { name: string; disabled?: boolean; expectedRevision?: number };
    if (body.expectedRevision !== control.revision) return Response.json({ error: { code: 'plugin-manager/conflict', message: 'Stale fixture revision' } }, { status: 409 });
    // Independent transport fixture for the owner bundle transaction. Both old
    // member identities remain aliases, but a request advances one revision.
    const gateway = ['@dsh-base/client-gateway-provider', '@dsh-base/cloudflare-think-ai-gateway'];
    const names = gateway.includes(body.name) ? gateway : [body.name];
    const overrides = { ...control.overrides };
    for (const name of names) overrides[name] = { ...(body.disabled === undefined ? {} : { disabled: body.disabled }) };
    control = { revision: control.revision + 1, overrides };
    return Response.json(control);
  }) as typeof globalThis.fetch;
  return { fetch, snapshot: () => structuredClone(control) };
}

/** The actual prior Host mapping, rendered by the unmodified pinned page. */
function legacyCatalog(bundles: any[]) {
  return bundles.map(({ deploymentAvailability: _, ...bundle }) => ({ ...bundle, error: { code: 'unsupported-platform' } }));
}

/** Native and failure cases are independent of the product catalog projection. */
function faultContract(bundles: any[], state: string, adapted: boolean) {
  const visible = bundles.find(bundle => bundle.name === '@deepseek-ai/dsh-experimental-voice-input-bundle');
  if (visible === undefined) throw new Error('Pinned visible failure fixture is missing');
  const { deploymentAvailability: _, ...base } = visible;
  const row = { rowId: 'fixture-row', entryId: 'fixture:row', moduleName: 'fixture/runtime' };
  if (state === 'native') return {
    bundles: [
      { ...base, installed: true, availability: 'installation', enabled: true, rows: [row] },
      { ...base, name: 'fixture/disabled', official: false, installed: true, availability: 'installation', enabled: false, meta: { title: { en: 'Disabled plugin', zh: '已停用插件' }, description: { en: 'An installed plugin that the owner turned off.', zh: '用户关闭的已安装插件。' } } },
    ],
    plugins: [{ ...row, enabled: true, fiberPhase: 'active' }],
  };
  const bundle = { ...base, ...(adapted ? { deploymentAvailability: 'not-adapted' } : {}) };
  if (state === 'failure:invalid-marker') return { bundles: [{ ...bundle, deploymentAvailability: 'unknown', error: { code: 'unsupported-platform' } }], plugins: [] };
  if (state === 'failure:unmarked-platform') return { bundles: [{ ...base, error: { code: 'unsupported-platform' } }], plugins: [] };
  if (state === 'failure:operation') return { bundles: [{ ...bundle, error: { code: 'operation-error', diagnostic: 'Real Host operation failed.' } }], plugins: [] };
  if (state === 'failure:metadata') return { bundles: [{ ...bundle, meta: { ...base.meta, error: 'Invalid package metadata' }, error: { code: 'operation-error', diagnostic: 'Real package metadata could not be read.' } }], plugins: [] };
  if (state === 'failure:runtime' || state === 'failure:marked-runtime') return {
    bundles: [{ ...(state === 'failure:runtime' ? base : bundle), installed: true, availability: 'installation', enabled: true, rows: [row] }],
    plugins: [{ ...row, enabled: true, fiberPhase: 'failed', diagnostic: 'Real plugin startup failed.' }],
  };
  return undefined;
}

export function PluginManagerFixture({ locale, state, adapted }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  if (state.startsWith('builtin:')) return <PluginManagerBuiltinFixture id={state.slice(8) as 'shell' | 'agent-loop' | 'web-search' | 'subagent'} locale={locale} adapted={adapted} />;
  return <ManagerFixture locale={locale} state={state} adapted={adapted} />;
}

function ManagerFixture({ locale, state, adapted }: { locale: "en" | "zh"; adapted: boolean; state: string }) {
  const readonly = state === "readonly";
  const counts = state === 'counts';
  const useAdapted = adapted || counts;
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const countsFixture = useMemo(() => counts || state === 'navigation' ? createCountsFixture(locale, counts && adapted, state === 'navigation') : undefined, [counts, state, locale, adapted]);
  const siteFixture = useMemo(() => state === 'site-settings' ? createGlobalSettingsSlotsFixture(locale) : undefined, [state, locale]);
  const [navigation, setNavigation] = useState<any>({ view: { kind: "list" }, tab: "installed" });
  const setup = useMemo(() => {
    const calls: any[] = [];
    const requests: any[] = [];
    const monitor = (name: string, object: any) => Object.fromEntries(Object.entries(object).map(([key, method]) => [key, async (...args: any[]) => {
      calls.push({ endpoint: `${name}/${key}`, args });
      return await (method as any)(...args);
    }]));
    const owned = (window as any).__OWNED_PLUGIN_REFERENCE__ as { rows: any[] } | undefined;
    if (!readonly && !owned?.rows.length) throw new Error('Independent owned composition reference is missing');
    let hiddenBundles: string[] = [];
    let hiddenComponents: string[] = [];
    const control = fixtureControlFetch(requests, owned?.rows.filter(row => row.plane === 'worker') ?? []);
    const liveEntries = [...entries.filter(entry => entry.moduleName.startsWith('@deepseek-ai/')), ...(owned?.rows.filter(row => row.plane === 'client') ?? [])].map(entry => ({ ...entry }));
    const remotes = readonly ? undefined : createPluginInventoryRemotes({ entries: () => liveEntries as never, locale: () => locale, fetch: control.fetch,
      applyRuntime: async (moduleName, disabled) => {
        const entry = liveEntries.find(row => row.moduleName === moduleName);
        if (entry === undefined) throw new Error('Unknown fixture client entry');
        entry.enabled = !disabled;
        entry.fiberPhase = disabled ? null : 'active';
      },
      runtimeDisabled: moduleName => !liveEntries.find(row => row.moduleName === moduleName)?.enabled,
    });
    const reference = (window as any).__PLUGIN_CATALOG_REFERENCE__ as any[] | undefined;
    if (!readonly && (!Array.isArray(reference) || reference.length === 0)) throw new Error('Independent official catalog reference is missing');
    const native = readonly ? undefined : faultContract(reference!, state, adapted);
    const implementation = remotes === undefined ? undefined : {
      ...remotes.manager,
      ...(native === undefined ? {} : { listPlugins: async () => ({ ok: true as const, value: native.plugins }) }),
      listBundles: state === 'failure:request'
        ? async () => ({ ok: false as const, error: { code: 'plugin-manager/transport', message: 'A real request failed.', details: {} } })
        : native !== undefined ? async () => ({ ok: true as const, value: native.bundles })
        : useAdapted ? async () => {
          const reply = await remotes.manager.listBundles();
          return !reply.ok ? reply : { ok: true as const, value: reply.value.filter(bundle => !hiddenBundles.includes(bundle.name)).map(bundle => ({ ...bundle, rows: bundle.rows.filter(row => !hiddenComponents.includes(row.rowId)) })) };
        } : async () => {
        const local = await remotes.manager.listBundles();
        if (!local.ok) return local;
        return { ok: true as const, value: [...legacyCatalog(reference!), ...local.value.filter(bundle => !bundle.official)] };
      },
    };
    const manager = remotes === undefined
      ? monitor("pluginManager", {
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
      })
      : monitor("pluginManager", implementation!);
    const inventory = remotes === undefined
      ? monitor("pluginInventory", {
        // Read-only projection; the fixture exposes the same contract as the
        // deployed seam for both the original and the adapted page.
        list: async () => ({ ok: true as const, value: { managementAvailable: readonly ? false : true, entries, agentPresets: [] } }),
      })
      : monitor("pluginInventory", remotes.inventory);
    const context = {
      get: () => undefined,
      configForms: { describe: () => snapshot({ view: { namespaces: [] } }), get: () => undefined },
      locale: snapshot({ active: locale }),
      remote: { pluginManager: manager, pluginInventory: inventory, pluginRegistryProbe: monitor("pluginRegistryProbe", { fastest: async () => ({ ok: true as const, value: null }) }) },
    };
    const Controller = useAdapted ? AdaptedController : OfficialController;
    const controller = new Controller(context as never);
    const config = siteFixture?.config ?? countsFixture?.config ?? NO_CONFIG;
    const face = controller.inject(config, NO_TABS, (value: any) => typeof value === "string" ? value : value[locale] ?? value.en);
    (window as any).__PLUGIN_PARITY__ = { source: face.hooks.pluginManager, calls, requests, entries: liveEntries, control: control.snapshot, copy: copy[locale], remotes, refresh: face.refresh,
      showView: (view: any) => setNavigation((current: any) => ({ ...current, view })),
      setStatus: setStatusOverride,
      setListing: async ({ omitBundles = [], omitComponents = [] }: { omitBundles?: string[]; omitComponents?: string[] }) => {
        hiddenBundles = omitBundles; hiddenComponents = omitComponents; await controller.load();
      },
      countRegistrations: countsFixture?.registrationCount() ?? 0,
    };
    return { face };
  }, [locale, readonly, adapted, state]);
  const { face } = setup;
  const observed = useSyncExternalStore(face.hooks.pluginManager.subscribe, face.hooks.pluginManager.getSnapshot);
  const details = useSyncExternalStore(face.hooks.bundleDetails.subscribe, face.hooks.bundleDetails.getSnapshot);
  const props = {
    ...face, createHeaderRef: createPluginHeaderRef,
    t: (key: keyof typeof copy.en, values: Record<string, unknown> = {}) => String(copy[locale][key]).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? "")),
    usePluginManager: (select: any) => select(statusOverride === null ? observed : { ...observed, status: statusOverride, packages: [], error: statusOverride === 'error' ? { code: 'plugin-manager/transport', message: 'Count fixture failure' } : null }),
    useConfigurations: (select: any) => select({ view: { namespaces: [] } }),
    useConfigLedger: (select: any) => select((siteFixture?.config ?? countsFixture?.config ?? NO_CONFIG).getSnapshot()),
    usePluginTabs: (select: any) => select([]),
    useBundleDetails: (select: any) => select(details),
    useLocale: (select: any) => select({ active: locale }),
    useStore: (select: any) => select(navigation),
    actions: { setView: (view: any) => setNavigation((old: any) => ({ ...old, view })), setTab: (tab: any) => setNavigation((old: any) => ({ ...old, tab })) },
    renderSlot: (name: string, owner: any, options: any) => siteFixture?.renderSlot(name, owner, options) ?? countsFixture?.renderSlot(name, owner, options) ?? options?.fallback ?? null,
  };
  const Page = useAdapted ? AdaptedPage : OfficialPage;
  return <><span data-neutral-tag-reference style={{ position: 'absolute', left: -10000 }}><Tag tone="neutral">{locale === 'zh' ? '不可用' : 'Unavailable'}</Tag></span>
    <div aria-hidden="true" style={{ position: 'fixed', left: -10000 }}>
      <span data-default-bundle><PluginArtworkDefault size={36}/></span>
      <span data-default-row><PluginArtworkSubagent size={30}/></span>
    </div>
    <Page {...props as any} /></>;
}
