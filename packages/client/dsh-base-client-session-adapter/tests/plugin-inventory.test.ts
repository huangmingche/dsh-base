import assert from "node:assert/strict";
import { createPluginInventoryRemotes } from "../src/client/plugin-inventory.ts";
import { GATEWAY_BUNDLE_MEMBERS, GATEWAY_CLIENT_MODULE, GATEWAY_THINK_MODULE, isGatewayModule } from "../../../boot/dsh-base-plugin-management/src/index.ts";
import { OWNED_PLUGIN_ROWS, OWNED_PLUGIN_BUNDLES } from "../src/client/owned-plugin-inventory.generated.ts";
import { OWNED_PLUGIN_META, MANAGED_BUNDLE_META } from "../src/client/managed-bundle-meta.ts";
import { DSH_BASE_PLUGIN_ICON } from '../../dsh-base-client-plugin-manager/src/client/brand-artwork.ts';
import { CLOUDFLARE_PLUGIN_ICON } from '../src/client/cloudflare-plugin-icon.ts';
import { localPackages, repoRoot } from "../../../../scripts/conformance/lib.mjs";
import { OFFICIAL_BUNDLE_CATALOG } from "../src/client/official-bundle-catalog.generated.ts";

const peerListeners: Array<(event: { data: unknown }) => void> = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalBroadcast = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/", reload() {} } } });
Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: class {
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) { peerListeners.push(listener); }
  postMessage() {}
} });
const firstSelectionChanges: string[] = [];
const rows = [
  { entryId: "client:official", moduleName: "@deepseek-ai/dsh-client-official", origin: "upstream", enabled: false, fiberPhase: null, unavailableReason: "Unavailable on this platform" },
  { entryId: "client:seam", moduleName: "@dsh-base/client-seam", origin: "custom", enabled: true, fiberPhase: "pending", replaces: "@deepseek-ai/dsh-client-official" },
  ...OWNED_PLUGIN_ROWS.filter(row => row.plane === 'client').map(row => ({ entryId: row.entryId, moduleName: row.name, origin: row.origin, enabled: row.declaredEnabled, fiberPhase: row.declaredEnabled ? 'active' : null })),
];
const workerRows = OWNED_PLUGIN_ROWS.filter(row => row.plane === 'worker').map(row => ({ entryId: row.entryId, moduleName: row.name, origin: row.origin, enabled: row.declaredEnabled, fiberPhase: 'active' }));
// Independently enumerate source packages; generated display data must never
// silently miss a newly declared runtime plugin or include a support library.
const actualOwned = localPackages(repoRoot).filter(({ manifest }) => manifest.dshBase?.client || manifest.dshBase?.worker || manifest.dshBase?.agent).map(({manifest}) => manifest.name).sort();
assert.deepEqual(OWNED_PLUGIN_ROWS.map(row => row.name).sort(), actualOwned);
assert.deepEqual(OWNED_PLUGIN_BUNDLES.flatMap(bundle => bundle.members).sort(), actualOwned);
assert.deepEqual(Object.keys(OWNED_PLUGIN_META).sort(), actualOwned);
for (const meta of Object.values(OWNED_PLUGIN_META)) {
  assert.ok(meta.title?.en && meta.title?.zh && meta.description?.en && meta.description?.zh, 'every owned component has bilingual function copy');
}
assert.deepEqual(Object.keys(MANAGED_BUNDLE_META).sort(), OWNED_PLUGIN_BUNDLES.map(bundle => bundle.name).sort());
for (const meta of [...Object.values(OWNED_PLUGIN_META), ...Object.values(MANAGED_BUNDLE_META)]) {
  assert.equal(meta.icon, meta.title.en.startsWith('Dsh-base ') ? DSH_BASE_PLUGIN_ICON : CLOUDFLARE_PLUGIN_ICON, 'display branding determines artwork in both lists and component details');
}
let state = { revision: 4, overrides: {} as Record<string, { disabled?: boolean }> };
const calls: Array<{ method: string; path: string; body?: unknown }> = [];
const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const path = String(input); calls.push({ method: init?.method ?? "GET", path, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) });
  if (path.endsWith("/inventory")) return Response.json({ entries: workerRows });
  if ((init?.method ?? "GET") === "GET") return Response.json(state);
  const body = JSON.parse(String(init?.body)) as { name: string; disabled: boolean; expectedRevision: number };
  assert.equal(body.expectedRevision, state.revision, "owner writes compare the revision");
  state = { revision: state.revision + 1, overrides: { ...state.overrides, ...Object.fromEntries((isGatewayModule(body.name) ? GATEWAY_BUNDLE_MEMBERS : [body.name]).map(name => [name, { disabled: body.disabled }])) } };
  return Response.json(state);
};
const remotes = createPluginInventoryRemotes({ entries: () => rows as never, locale: () => "en", fetch: fakeFetch as typeof fetch, selectionChanged: name => { firstSelectionChanges.push(name); } });
const first = await remotes.inventory.list();
assert.equal(first.ok, true);
if (!first.ok) throw new Error("inventory read failed");
assert.equal(first.value.managementAvailable, true);
assert.equal(first.value.entries.length, rows.length + workerRows.length, "official global inventory includes observed client and Worker entries");
// Every Think component is declared, including the BYOK provider; there is no global live Think fiber.
assert.equal(first.value.agentPresets.at(-1)?.rows.length, 7, "Think session composition comes from generated agent metadata");
assert.ok(first.value.agentPresets.at(-1)?.rows.every(row => row.fiberPhase === null), "client inventory must not invent live Worker fibers");
const subagentRow = first.value.agentPresets.at(-1)?.rows.find(row => row.moduleName === "@dsh-base/cloudflare-think-subagent");
assert.ok(subagentRow, "the restored subagent row is part of the fixed composition");
const metaOf = row => row.meta as { title?: Record<string, string>; description?: Record<string, string> } | undefined;
assert.match(metaOf(subagentRow)?.title?.en ?? "", /unavailable/u, "the official inventory card must name the unavailable state");
assert.match(metaOf(subagentRow)?.title?.zh ?? "", /不可用/u, "the unavailable title is localized");
assert.match(metaOf(subagentRow)?.description?.en ?? "", /not.*support|unavailable|cannot/iu);
assert.match(metaOf(subagentRow)?.description?.zh ?? "", /不支持|不可用/u);
assert.ok(first.value.agentPresets.at(-1)?.rows.every(row => row.meta !== undefined), "all owned declarations have concise display metadata while retaining technical IDs");
const live = await remotes.manager.listPlugins();
assert.equal(live.ok, true);
if (live.ok) {
  assert.equal(live.value[2].fiberPhase, "active", "each refresh reads actual live fibers");
  assert.ok("readOnlyReason" in live.value[0], "upstream/required rows stay read-only");
  assert.ok("readOnlyReason" in live.value[2], "a client row without an L1 pack is read-only, not switchable");
}
const bundles = await remotes.manager.listBundles();
assert.equal(bundles.ok, true);
if (!bundles.ok) throw new Error("bundles read failed");
assert.ok(bundles.value.some(bundle => bundle.name === "@dsh-base/client-gateway-provider" && bundle.optional === true && bundle.readOnlyReason === undefined), "the gateway-provider L1 pack exposes a manageable client bundle");
assert.ok(bundles.value.some(bundle => bundle.name === "@dsh-base/cloudflare-think-fetch" && bundle.optional === true && bundle.readOnlyReason === undefined));
assert.equal(bundles.value.some(bundle => bundle.name === "@dsh-base/client-commands" && bundle.optional), false, "required client shell rows are never optional bundles");
assert.equal(bundles.value.some(bundle => bundle.name === "@dsh-base/cloudflare-worker-http"), false, "read-only Worker packages are not synthetic bundles");
assert.equal(bundles.value.filter(bundle => bundle.official).length, 18, "the full pinned optional/on-demand discovery catalog is represented");
for (const expected of OFFICIAL_BUNDLE_CATALOG) {
  const bundle = bundles.value.find(candidate => candidate.name === expected.name)!;
  assert.equal(bundle.official, true);
  assert.equal(bundle.availability, 'missing');
  assert.equal(bundle.installed, false);
  assert.equal(bundle.enabled, false);
  assert.equal(bundle.listedByDefault, true, 'unavailable candidates stay discoverable; official UI owns Hidden/More filtering');
  assert.equal(bundle.deploymentAvailability, 'not-adapted');
  assert.equal(bundle.error, undefined, 'a known deployment limitation is not a runtime failure');
  assert.equal(bundle.installTarget, undefined);
  assert.equal(bundle.removable, false);
  assert.equal(bundle.update, undefined, "a deployment-managed bundle has no registry or Git update mode");
  assert.deepEqual(bundle.rows, [], 'discovery data does not fabricate running fibers or patch rows');
  assert.deepEqual(bundle.meta, expected.meta, 'official localized text and artwork are unchanged');
}
const localBundles = bundles.value.filter(bundle => !bundle.official);
assert.equal(localBundles.length, OWNED_PLUGIN_BUNDLES.length);
assert.deepEqual(localBundles.flatMap(bundle => bundle.rows.map(row => row.moduleName)).sort(), actualOwned, 'every owned component is reachable exactly once through a feature bundle');
const gatewayBundle = localBundles.find(bundle => bundle.name === GATEWAY_CLIENT_MODULE)!;
assert.equal(localBundles.some(bundle => bundle.name === GATEWAY_THINK_MODULE), false, 'one Gateway card represents both runtime components');
assert.deepEqual(gatewayBundle.rows.map(row => row.moduleName), [GATEWAY_CLIENT_MODULE, GATEWAY_THINK_MODULE]);
assert.deepEqual(gatewayBundle.rows.map(row => row.meta?.title?.zh), ['Cloudflare 模型设置', 'Cloudflare 平台模型服务']);
if (live.ok) for (const name of GATEWAY_BUNDLE_MEMBERS) {
  const component = live.value.find(row => row.moduleName === name)!;
  assert.equal(component.readOnlyReason, 'unaddressable');
  assert.equal(component.managedByBundle, 'Cloudflare AI Gateway');
}
const beforePartToggle = calls.length;
for (const row of gatewayBundle.rows) {
  const result = await remotes.manager.setPluginEnabled(row.entryId!, false);
  assert.equal(result.ok, false, 'components cannot be split by detail switches');
}
assert.equal(calls.length, beforePartToggle, 'component controls are refused without reading or writing state');
for (const bundle of localBundles) {
  assert.equal(bundle.deploymentAvailability, undefined, "real local packages are not unavailable catalog placeholders");
  assert.equal(bundle.official, false, 'local Think/client packages never masquerade as official bundles');
  assert.equal(typeof bundle.meta?.title, 'object');
  assert.ok(bundle.meta?.title?.en && bundle.meta?.title?.zh, 'local packages have truthful bilingual display titles');
}
const readonlyBundles = localBundles.filter(bundle => bundle.readOnlyReason !== undefined);
assert.deepEqual(readonlyBundles.map(bundle => bundle.name).sort(), ['ai-chat-core', 'base', 'global', 'plugin-management', 'waffo', 'email', 'google-auth', 'account-profile', 'user-admin', 'api-keys', 'entitlements', 'files', 'newsletter', 'contact', 'notifications', 'crisp', 'cache', 'dashboard'].map(id => `dsh-base:${id}`).sort());
for (const bundle of readonlyBundles) {
  assert.equal(bundle.managementPolicy, 'required');
  assert.equal(bundle.optional, false);
  assert.equal(bundle.error, undefined, 'readonly ownership is not an error');
}
const beforeReadonlyToggle = calls.length;
for (const enabled of [true, false]) {
  for (const bundle of readonlyBundles) assert.equal((await remotes.manager.setBundleEnabled(bundle.name, enabled)).ok, false);
  for (const row of OWNED_PLUGIN_ROWS.filter(row => row.management !== 'optional')) {
    assert.equal((await remotes.manager.setPluginEnabled(row.entryId, enabled)).ok, false);
    assert.equal((await remotes.manager.setBundleEnabled(row.name, enabled)).ok, false);
  }
}
assert.equal(calls.length, beforeReadonlyToggle, 'readonly entries remain visible but forged operations are refused before any HTTP');
if (live.ok) {
  assert.equal(live.value.filter(row => actualOwned.includes(row.moduleName)).length, actualOwned.length);
  for (const definition of OWNED_PLUGIN_ROWS.filter(row => row.management !== 'optional')) {
    const row = live.value.find(row => row.moduleName === definition.name)!;
    assert.equal(row.readOnlyReason, 'unaddressable');
    assert.equal(row.managementPolicy, definition.plane === 'worker' ? 'deployment' : 'required');
  }
  const retired = OWNED_PLUGIN_ROWS.filter(row => !row.declaredEnabled);
  assert.deepEqual(retired.map(row => row.entryId).sort(), ['client:permission-availability', 'client:shell-extras', 'client:wire-bootstrap']);
  for (const definition of retired) assert.equal(live.value.find(row => row.moduleName === definition.name)?.enabled, false);
  assert.ok(live.value.filter(row => row.moduleName.startsWith('@dsh-base/cloudflare-think-')).every(row => row.fiberPhase === null));
}
const beforeCatalogToggle = calls.length;
for (const bundle of OFFICIAL_BUNDLE_CATALOG) for (const enabled of [true, false]) {
  const denied = await remotes.manager.setBundleEnabled(bundle.name, enabled);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'plugin-manager/unsupported-platform');
}
assert.equal(calls.length, beforeCatalogToggle, 'catalog-only toggles cannot read or write owner selection or install packages');
// A persisted owner override changes intent on the next read; the Think
// projection is consumed by the Session Host at the next turn, so the client
// seam reports an immediate application and never pretends a fiber changed.
const disable = await remotes.manager.setBundleEnabled("@dsh-base/cloudflare-think-fetch", false);
assert.deepEqual(disable, { ok: true, value: { changed: true, application: "applied", stage: "enable", target: "@dsh-base/cloudflare-think-fetch", enabled: false } });
const afterDisable = await remotes.manager.listBundles();
assert.equal(afterDisable.ok && afterDisable.value.find(bundle => bundle.name === "@dsh-base/cloudflare-think-fetch")?.enabled, false);
const nextBoot = await createPluginInventoryRemotes({ entries: () => rows as never, locale: () => "en", fetch: fakeFetch as typeof fetch }).manager.listBundles();
assert.equal(nextBoot.ok && nextBoot.value.find(bundle => bundle.name === "@dsh-base/cloudflare-think-fetch")?.enabled, false, "configuration survives a new client instance");
const reenabledIntent = await remotes.manager.setBundleEnabled("@dsh-base/cloudflare-think-fetch", true);
assert.equal(reenabledIntent.ok, true);
const reenabledBundles = await remotes.manager.listBundles();
assert.equal(reenabledBundles.ok && reenabledBundles.value.find(bundle => bundle.name === "@dsh-base/cloudflare-think-fetch")?.enabled, true, "override.disabled:false projects as enabled intent");
// Think toggles are applied by the Session Host, never through a live client
// Entry.update; an allowlisted client module without a live runtime hook reports
// restart-required, and with the official Loader hook reports applied.
const appliedCalls: Array<[string, boolean]> = [];
const changedSelections: string[] = [];
const runtime = createPluginInventoryRemotes({ entries: () => rows as never, locale: () => "en", fetch: fakeFetch as typeof fetch, applyRuntime: async (name, disabled) => { appliedCalls.push([name, disabled]) }, runtimeDisabled: () => true, selectionChanged: name => { changedSelections.push(name); } });
await runtime.manager.setBundleEnabled("@dsh-base/cloudflare-think-memory", false);
assert.deepEqual(appliedCalls, [], "Think selections never touch the client Loader");
assert.equal((await runtime.manager.setBundleEnabled("@dsh-base/cloudflare-think-ai-gateway", false)).ok, true);
assert.equal(changedSelections.at(-1), "@dsh-base/cloudflare-think-ai-gateway", "persisted Gateway toggles invalidate dependent provider/model services");
assert.equal(state.overrides["@dsh-base/cloudflare-think-fetch"]?.disabled, false, "Gateway toggle does not rewrite fetch");
assert.deepEqual(appliedCalls, [[GATEWAY_CLIENT_MODULE, true]], 'legacy Think bundle alias updates only the actual client Loader member');
for (const name of GATEWAY_BUNDLE_MEMBERS) assert.equal(state.overrides[name]?.disabled, true);
const disabledPlugins = await runtime.manager.listPlugins();
assert.equal(disabledPlugins.ok && disabledPlugins.value.find(row => row.moduleName === GATEWAY_THINK_MODULE)?.enabled, false);
assert.equal(disabledPlugins.ok && disabledPlugins.value.find(row => row.moduleName === GATEWAY_THINK_MODULE)?.fiberPhase, null, 'owner intent is not a fabricated Think fiber');
const appliedClient = await runtime.manager.setBundleEnabled("@dsh-base/client-gateway-provider", false);
assert.equal(appliedClient.ok && appliedClient.value.application, "applied", "allowlisted client toggle applies through Entry.update");
assert.deepEqual(appliedCalls.at(-1), ["@dsh-base/client-gateway-provider", true]);
const restartOnly = await remotes.manager.setBundleEnabled("@dsh-base/client-gateway-provider", true);
assert.equal(restartOnly.ok && restartOnly.value.application, "restart-required", "without a runtime hook the client toggle is persisted for the next page start");
assert.equal(restartOnly.ok && restartOnly.value.restartReason, "no-hmr");
for (const name of ["@dsh-base/client-deepseek-provider", "@dsh-base/client-locale-url", "@dsh-base/not-bundled"]) {
  const denied = await remotes.manager.setBundleEnabled(name, false);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error.message, /allowlist|not user-manageable/u);
}
for (const verb of ["removeBundle", "installBundle", "updateBundle", "listVersions", "registries"] as const) {
  const answer = await remotes.manager[verb]();
  assert.equal(answer.ok, false, verb);
  if (!answer.ok) assert.match(answer.error.message, /does not support.*plugins/iu);
}
assert.equal((await createPluginInventoryRemotes({ entries: () => undefined, locale: () => "en", fetch: fakeFetch as typeof fetch }).inventory.list()).ok, false, "missing inspection must not become an empty success");
assert.ok(calls.some(call => call.path.endsWith("/inventory")), "Worker inventory came from the real management endpoint");
const truncated = createPluginInventoryRemotes({ entries: () => rows as never, fetch: (async (url, init) => String(url).endsWith('/inventory') ? Response.json({ entries: workerRows.slice(1) }) : fakeFetch(url, init)) as typeof fetch });
assert.equal((await truncated.manager.listBundles()).ok, false, 'missing observed Worker entry cannot become a falsely complete list');
assert.equal((await truncated.inventory.list()).ok, false, 'Settings inventory does not hide a truncated Worker response');
const incompleteClient = createPluginInventoryRemotes({ entries: () => rows.filter(row => row.moduleName !== GATEWAY_CLIENT_MODULE) as never, fetch: fakeFetch as typeof fetch });
assert.equal((await incompleteClient.manager.listPlugins()).ok, false, 'a missing client component is an inventory failure');
const failing = createPluginInventoryRemotes({ entries: () => rows as never, locale: () => "en", fetch: (async () => new Response(JSON.stringify({ error: { code: 'plugin-manager/unavailable', message: 'read failed' } }), { status: 500 })) as typeof fetch });
const failedBundles = await failing.manager.listBundles();
assert.equal(failedBundles.ok, false, "a read failure is not reported as an empty successful inventory");
assert.match(failedBundles.ok ? "" : failedBundles.error.message, /read failed/u);
const beforePeer = firstSelectionChanges.length;
peerListeners[0]!({ data: { source: "another-tab", kind: "plugin-selection", name: "@dsh-base/cloudflare-think-ai-gateway", disabled: true } });
assert.equal(firstSelectionChanges.length, beforePeer + 2, "peer Think changes refresh provider services even without a client Loader update");
assert.equal(firstSelectionChanges.at(-1), "@dsh-base/cloudflare-think-ai-gateway");
const failedChanges: string[] = [];
const failedWrite = createPluginInventoryRemotes({ entries: () => rows as never, fetch: (async (url, init) => init?.method === "PUT" ? Response.json({ error: { code: "failed", message: "not committed" } }, { status: 503 }) : fakeFetch(url, init)) as typeof fetch, selectionChanged: name => { failedChanges.push(name); } });
assert.equal((await failedWrite.manager.setBundleEnabled("@dsh-base/cloudflare-think-ai-gateway", true)).ok, false);
assert.deepEqual(failedChanges, [], "failed writes do not announce a changed provider catalog");
let inheritedDisabled = true;
const ownerReads: string[] = [];
const inherited = createPluginInventoryRemotes({ entries: () => rows as never, fetch: (async (input, init) => {
  if (String(input).endsWith("/inventory")) return fakeFetch(input, init);
  ownerReads.push(String(input));
  return Response.json({ revision: 1, overrides: { "@dsh-base/cloudflare-think-ai-gateway": { disabled: inheritedDisabled } }, session: { "@dsh-base/cloudflare-think-ai-gateway": { disabled: !inheritedDisabled } } });
}) as typeof fetch });
let inheritedBundles = await inherited.manager.listBundles();
assert.equal(inheritedBundles.ok && inheritedBundles.value.find(bundle => bundle.name === GATEWAY_CLIENT_MODULE)?.enabled, false, "owner manager ignores a conflicting Session enable");
inheritedDisabled = false;
inheritedBundles = await inherited.manager.listBundles();
assert.equal(inheritedBundles.ok && inheritedBundles.value.find(bundle => bundle.name === GATEWAY_CLIENT_MODULE)?.enabled, true, "owner manager ignores a conflicting Session disable");
for (const path of ['/app/session/a', '/en/app/session/b', '/zh-CN/app/session/c', '/app/session/d']) {
  window.location.pathname = path;
  await inherited.manager.listBundles();
}
assert.ok(ownerReads.every(path => path === '/api/plugin-manager'), "owner inventory stays owner-scoped across locale and SPA navigation");
assert.ok(calls.filter(call => call.method === 'PUT').every(call => !('sessionId' in (call.body as object))), "official global toggles write owner defaults only");

// Runtime rejection restores both owner members under the committed revision,
// and invalidates the provider catalog again. A failed CAS never overwrites a peer.
state = { revision: 20, overrides: { [GATEWAY_CLIENT_MODULE]: { disabled: false }, [GATEWAY_THINK_MODULE]: { disabled: false } } };
const rollbackChanges: string[] = [];
const rollbackRuntime: Array<[string, boolean]> = [];
const rejectsRuntime = createPluginInventoryRemotes({ entries: () => rows as never, fetch: fakeFetch as typeof fetch, runtimeDisabled: () => false,
  selectionChanged: name => { rollbackChanges.push(name); },
  applyRuntime: async (name, disabled) => { rollbackRuntime.push([name, disabled]); if (disabled) throw new Error('Loader refused'); },
});
const rejected = await rejectsRuntime.manager.setBundleEnabled(GATEWAY_CLIENT_MODULE, false);
assert.equal(rejected.ok, false);
assert.equal(state.revision, 22, 'one atomic commit and one CAS rollback');
for (const name of GATEWAY_BUNDLE_MEMBERS) assert.equal(state.overrides[name]?.disabled, false);
assert.deepEqual(rollbackRuntime, [[GATEWAY_CLIENT_MODULE, true], [GATEWAY_CLIENT_MODULE, false]]);
assert.deepEqual(rollbackChanges, [...GATEWAY_BUNDLE_MEMBERS, ...GATEWAY_BUNDLE_MEMBERS]);
let writes = 0;
const conflicting = createPluginInventoryRemotes({ entries: () => rows as never, runtimeDisabled: () => false,
  fetch: (async (url, init) => {
    if (init?.method === 'PUT' && ++writes === 2) return Response.json({ error: { code: 'conflict', message: 'newer owner selection' } }, { status: 409 });
    return fakeFetch(url, init);
  }) as typeof fetch,
  applyRuntime: async () => { throw new Error('Loader refused'); },
});
const conflict = await conflicting.manager.setBundleEnabled(GATEWAY_CLIENT_MODULE, false);
assert.equal(conflict.ok, false);
if (!conflict.ok) assert.match(conflict.error.message, /saved.*Reload/u);
for (const name of GATEWAY_BUNDLE_MEMBERS) assert.equal(state.overrides[name]?.disabled, true, 'failed rollback does not silently clobber persisted intent');
if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
if (originalBroadcast) Object.defineProperty(globalThis, "BroadcastChannel", originalBroadcast);
console.log("plugin inventory: real client/Worker/Think inventory, owner-scoped persisted selection, generated Think allowlist, read-only layers and unsupported package-manager operations passed");
