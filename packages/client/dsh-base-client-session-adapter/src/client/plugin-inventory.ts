/** Persistent, owner-scoped management over the real bundled composition inventory. */
import type { StaticPluginInspection } from "@dsh-base/plugin-loader-static";
import type { BundleInfo, ChangeResult, PluginInfo } from "@deepseek-ai/dsh-plugin-manager/types";
import type { PluginInventorySnapshot } from "@deepseek-ai/dsh-api-remotes/client";
import { isManageableClientModule, isManageableModule, isManageableThinkModule, GATEWAY_BUNDLE_NAME, GATEWAY_CLIENT_MODULE, GATEWAY_THINK_MODULE, GATEWAY_BUNDLE_MEMBERS, isGatewayModule } from "../../../../boot/dsh-base-plugin-management/src/index.ts";
import { fixedAgentPresetCopy } from "../../../../boot/dsh-base-agent-presets/src/availability.ts";
import {
  FIXED_AGENT_PRESET_ID,
  OFFICIAL_AGENT_PRESET_IDS,
} from "../../../../boot/dsh-base-agent-presets/src/index.ts";
import {
  OFFICIAL_PRESET_ROWS,
  THINK_PRESET_ROWS,
  type GeneratedPresetRow,
} from "./official-preset-declarations.generated.ts";
import { OWNED_PLUGIN_ROWS, OWNED_PLUGIN_BUNDLES } from "./owned-plugin-inventory.generated.ts";
import { OFFICIAL_BUNDLE_CATALOG } from "./official-bundle-catalog.generated.ts";
import { MANAGED_BUNDLE_META, OWNED_PLUGIN_META } from "./managed-bundle-meta.ts";

export interface PluginInventoryOptions {
  /** No account state or runtime observation is exposed to public catalog consumers. */
  readonly isAuthenticated?: () => boolean;
  /** Read on each request: enablement/intent and fiber phase stay separate. */
  readonly entries: () => readonly StaticPluginInspection[] | undefined;
  /** Active client locale, used for fixed composition copy and layer explanations. */
  readonly locale?: () => string;
  /** Same-origin authenticated transport; defaults to fetch. */
  readonly fetch?: typeof fetch;
  /** Apply one allowlisted client toggle to the live official Loader entry. */
  readonly applyRuntime?: (moduleName: string, disabled: boolean) => Promise<void>;
  /** Current live Entry disabled state, used to restore the record if Entry.update fails. */
  readonly runtimeDisabled?: (moduleName: string) => boolean | undefined;
  /** Re-read dependent official Host services after a persisted selection changes. */
  readonly selectionChanged?: (moduleName: string) => void;
}

interface WorkerInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly origin: "upstream" | "fork" | "custom";
  readonly enabled: boolean;
  readonly fiberPhase: PluginInfo["fiberPhase"];
  readonly replaces?: string;
  readonly unavailableReason?: string;
}

interface ControlState { revision: number; overrides: Record<string, { disabled?: boolean; config?: Record<string, unknown> }>; sessions?: Record<string, Record<string, { disabled?: boolean; config?: Record<string, unknown> }>>; session?: Record<string, { disabled?: boolean; config?: Record<string, unknown> }>; ownerId?: string }
type Answer<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

/** Host availability extension consumed by the marked official manager fork.
 * A known deployment limitation is separate from installation/runtime errors.
 */
export type DeploymentBundleInfo = BundleInfo & {
  readonly deploymentAvailability?: "not-adapted";
  readonly managementPolicy?: "required" | "deployment";
};

const MANAGEMENT_PATH = "/api/plugin-manager";
const INVENTORY_PATH = "/api/plugin-manager/inventory";
const CHANNEL_NAME = "dsh-base/plugin-manager";
const tabId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
let channel: BroadcastChannel | undefined;
let channelInstalled = false;
/** Keep concurrently open tabs consistent: a persisted selection is a restart intent, so peers reload into it. */
function announceChange(name?: string, disabled?: boolean): void {
  if (typeof window === "undefined") return;
  try { channel ??= typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL_NAME) } catch { channel = undefined }
  channel?.postMessage({ source: tabId, kind: "plugin-selection", ...(name === undefined ? {} : { name }), ...(disabled === undefined ? {} : { disabled }) });
}
function installPeerSync(applyRuntime?: (moduleName: string, disabled: boolean) => Promise<void>, selectionChanged?: (moduleName: string) => void): void {
  if (channelInstalled || typeof BroadcastChannel === "undefined" || typeof window === "undefined") return;
  channelInstalled = true;
  try { channel ??= new BroadcastChannel(CHANNEL_NAME) } catch { return }
  channel.addEventListener("message", event => {
    if (event.data?.source === tabId || event.data?.kind !== "plugin-selection") return;
    const name = event.data?.name, disabled = event.data?.disabled;
    if (typeof name !== "string" || typeof disabled !== "boolean") return;
    for (const member of isGatewayModule(name) ? GATEWAY_BUNDLE_MEMBERS : [name]) selectionChanged?.(member);
    const client = isGatewayModule(name) ? GATEWAY_CLIENT_MODULE : name;
    if (applyRuntime === undefined || !isManageableClientModule(client)) return;
    // Keep every peer tab on the same official Loader state without reloading the
    // document: no composer draft or other unsent UI state is discarded.
    void applyRuntime(client, disabled).catch(() => undefined);
  });
}

/** Explain the unsupported operation without exposing deployment internals. */
const TEXT = {
  en: { install: "This deployment does not support installing, removing or updating plugins." },
  zh: { install: "当前部署不支持安装、移除或更新插件。" },
  ja: { install: "このデプロイでは、プラグインのインストール、削除、更新は利用できません。" },
  es: { install: "Este despliegue no permite instalar, eliminar ni actualizar plugins." },
  fr: { install: "Ce déploiement ne permet pas d’installer, de supprimer ou de mettre à jour des plugins." },
  de: { install: "In dieser Bereitstellung können Plugins nicht installiert, entfernt oder aktualisiert werden." },
  ru: { install: "В этом развёртывании нельзя устанавливать, удалять или обновлять плагины." },
  pt: { install: "Esta implantação não permite instalar, remover ou atualizar plugins." },
} as const;
type Copy = { readonly install: string };
function copyFor(locale: string): Copy { return (TEXT as Record<string, Copy>)[locale] ?? TEXT.en; }

/** Display metadata enriches declarations without manufacturing a running fiber. */
function declaredRows(rows: readonly GeneratedPresetRow[]): readonly NonNullable<PluginInventorySnapshot["agentPresets"]>[number]["rows"][number][] {
  return rows.map(row => ({ ...row, fiberPhase: null, ...(OWNED_PLUGIN_META[row.moduleName] === undefined ? {} : { meta: OWNED_PLUGIN_META[row.moduleName] }) }));
}

const ownedByName = new Map(OWNED_PLUGIN_ROWS.map(row => [row.name, row]));

function unavailable(code: string, message: string): Answer<never> {
  return { ok: false, error: { code, message, details: {} } };
}

/** Owner management Remote over the persisted control record and real client/Worker/Think inventory. */
export function createPluginInventoryRemotes(options: PluginInventoryOptions) {
  const authenticated = () => options.isAuthenticated?.() !== false;
  const fetchImpl = options.fetch ?? fetch;
  installPeerSync(options.applyRuntime, options.selectionChanged);
  const locale = () => options.locale?.() ?? "en";
  const copy = () => copyFor(locale());
  // Presets are pinned composition declarations, independent of account or live fibers.
  const presetDeclarations = (): NonNullable<PluginInventorySnapshot["agentPresets"]> => [
    ...OFFICIAL_AGENT_PRESET_IDS.map((id: string) => ({ id, isDefault: false, rows: declaredRows(OFFICIAL_PRESET_ROWS[id] ?? []) })),
    { id: FIXED_AGENT_PRESET_ID, name: fixedAgentPresetCopy(locale()).thinkName, isDefault: true, rows: declaredRows(THINK_PRESET_ROWS) },
  ];
  const clientEntries = () => {
    const entries = options.entries();
    if (entries === undefined) throw new Error("The client composition inventory is unavailable.");
    return entries;
  };
  const request = async <T>(method: string, path = MANAGEMENT_PATH, body?: unknown): Promise<Answer<T>> => {
    if (!authenticated()) return unavailable("plugin-manager/unauthenticated", "Sign in to manage your plugins.");
    try {
      const response = await fetchImpl(path, {
        method, credentials: "same-origin", headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401) return unavailable("plugin-manager/unauthenticated", "Sign in to manage your plugins.");
      const parsed = await response.json().catch(() => undefined) as T & { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
      if (!response.ok) return { ok: false, error: { code: parsed?.error?.code ?? "plugin-manager/operation-error", message: parsed?.error?.message ?? `plugin manager ${response.status}`, details: parsed?.error?.details ?? {} } };
      return { ok: true, value: parsed as T };
    } catch (error) {
      return unavailable("plugin-manager/transport", error instanceof Error ? error.message : "Plugin manager transport failed.");
    }
  };
  let bootOwnerId: string | undefined;
  const controlState = async (): Promise<ControlState> => {
    // The official global manager writes owner defaults. Its displayed intent
    // must use that same scope, independently of the current Session or URL.
    const answer = await request<ControlState>("GET", MANAGEMENT_PATH);
    if (!answer.ok) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
    const ownerId = answer.value.ownerId;
    if (bootOwnerId === undefined && typeof ownerId === "string") bootOwnerId = ownerId;
    else if (bootOwnerId !== undefined && ownerId !== bootOwnerId) {
      const error = Object.assign(new Error("The signed-in account changed; reloading the plugin composition for the new account."), { code: "plugin-manager/account-changed" });
      if (typeof window !== "undefined") setTimeout(() => window.location.reload(), 0);
      throw error;
    }
    return { revision: Number(answer.value.revision) || 0, overrides: answer.value.overrides ?? {}, sessions: answer.value.sessions ?? {}, session: answer.value.session ?? {}, ...(ownerId === undefined ? {} : { ownerId }) };
  };
  const workerEntries = async (): Promise<readonly WorkerInventoryEntry[]> => {
    const answer = await request<{ entries?: readonly WorkerInventoryEntry[] }>("GET", INVENTORY_PATH);
    if (!answer.ok) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
    if (!Array.isArray(answer.value.entries)) throw new Error("Worker inventory response is malformed");
    return answer.value.entries;
  };
  const allRows = async () => {
    const [worker, control] = await Promise.all([workerEntries(), controlState()]);
    const client = clientEntries();
    // A truncated Host response must not silently remove a deployed component
    // or turn a missing observation into a fabricated disabled/running state.
    for (const row of OWNED_PLUGIN_ROWS) {
      if (row.plane === "think") continue;
      const observed = (row.plane === "client" ? client : worker).filter(entry => entry.entryId === row.entryId && entry.moduleName === row.name);
      if (observed.length !== 1) throw new Error(`Plugin inventory is incomplete: ${row.entryId}`);
    }
    return { client, worker, control };
  };
  /** Visibility comes from the full composition; management is an independent policy. */
  const bundles = async (): Promise<readonly DeploymentBundleInfo[]> => {
    const control = authenticated() ? (await allRows()).control : { overrides: {} } as ControlState;
    const result: DeploymentBundleInfo[] = OWNED_PLUGIN_BUNDLES.map(bundle => {
      const optional = bundle.management === "optional";
      const selectionName = bundle.name === GATEWAY_BUNDLE_NAME ? GATEWAY_THINK_MODULE : bundle.name;
      const override = optional ? control.overrides[selectionName] : undefined;
      return {
        name: bundle.name,
        official: false,
        meta: MANAGED_BUNDLE_META[bundle.name],
        // These are the deployment's shipped component groups, not registry
        // packages or claims of npm installation. No installTarget is offered.
        availability: "installation",
        enabled: override?.disabled === undefined ? bundle.members.some(name => ownedByName.get(name)!.declaredEnabled) : !override.disabled,
        installed: true,
        optional,
        removable: false,
        listedByDefault: true,
        ...optional ? {} : { readOnlyReason: "unaddressable" as const, managementPolicy: bundle.management },
        overrides: [],
        rows: bundle.members.map(name => {
          const row = ownedByName.get(name)!;
          return { rowId: row.entryId, moduleName: name, entryId: row.entryId as never, meta: OWNED_PLUGIN_META[name] };
        }),
      };
    });
    for (const bundle of OFFICIAL_BUNDLE_CATALOG) {
      result.push({
        name: bundle.name, official: true, meta: bundle.meta,
        availability: "missing", enabled: false, installed: false,
        optional: true, removable: false,
        // Explicit product requirement: unavailable candidates remain visible.
        // Original visibility is retained in generated provenance; the unchanged
        // official page still owns HIDDEN_BUNDLES and main/More ordering.
        listedByDefault: true,
        deploymentAvailability: "not-adapted",
        rows: [], overrides: [],
      });
    }
    return result;
  };
  type ManagedPluginInfo = PluginInfo & { readonly managedByBundle?: string; readonly managementPolicy?: "required" | "deployment" };
  const plugins = async (): Promise<readonly ManagedPluginInfo[]> => {
    if (!authenticated()) return OWNED_PLUGIN_ROWS.map(row => ({
      entryId: row.entryId as never, moduleName: row.name, enabled: row.declaredEnabled, fiberPhase: null,
      ...(row.management === "optional" ? { patchId: row.entryId } : { readOnlyReason: "unaddressable" as const, managementPolicy: row.management }),
    }));
    const { client, worker, control } = await allRows();
    const clientRows = client.map((entry): ManagedPluginInfo => ({
      entryId: entry.entryId as never,
      moduleName: entry.moduleName,
      enabled: entry.enabled,
      fiberPhase: entry.fiberPhase,
      ...(entry.replaces === undefined ? {} : { replaces: entry.replaces }),
      ...(isGatewayModule(entry.moduleName)
        ? { readOnlyReason: "unaddressable" as const, managedByBundle: "Cloudflare AI Gateway" }
        : isManageableClientModule(entry.moduleName) ? { patchId: entry.entryId }
        : ownedByName.has(entry.moduleName) ? { readOnlyReason: "unaddressable" as const, managementPolicy: "required" as const }
        : { readOnlyReason: "management-required" as const }),
    }));
    const workerRows = worker.map((entry): ManagedPluginInfo => ({
      entryId: entry.entryId as never, moduleName: entry.moduleName, enabled: entry.enabled, fiberPhase: entry.fiberPhase,
      readOnlyReason: "unaddressable", managementPolicy: "deployment",
    }));
    const thinkRows = OWNED_PLUGIN_ROWS.filter(row => row.plane === "think").map((row): ManagedPluginInfo => ({
      entryId: row.entryId as never, moduleName: row.name,
      enabled: isManageableThinkModule(row.name) && control.overrides[row.name]?.disabled !== undefined ? !control.overrides[row.name]!.disabled : row.declaredEnabled,
      // Think components execute within sessions; no live global fiber is claimed.
      fiberPhase: null,
      ...(isGatewayModule(row.name) ? { readOnlyReason: "unaddressable" as const, managedByBundle: "Cloudflare AI Gateway" }
        : isManageableThinkModule(row.name) ? { patchId: row.entryId }
        : { readOnlyReason: "unaddressable" as const, managementPolicy: "required" as const }),
    }));
    return [...clientRows, ...workerRows, ...thinkRows];
  };
  const setEnabled = async (name: string, enabled: boolean): Promise<Answer<ChangeResult>> => {
    if (!authenticated()) return unavailable("plugin-manager/unauthenticated", "Sign in to manage your plugins.");
    if (OFFICIAL_BUNDLE_CATALOG.some(bundle => bundle.name === name)) return unavailable("plugin-manager/unsupported-platform", copy().install);
    if (!isManageableModule(name)) return unavailable("plugin-manager/not-manageable", "This plugin is not user-manageable in the deployment allowlist.");
    const gateway = isGatewayModule(name);
    // Both legacy member names address the same owner bundle, never two writes.
    const target = gateway ? GATEWAY_BUNDLE_NAME : name;
    const client = gateway ? GATEWAY_CLIENT_MODULE : name;
    const changed = (disabled: boolean) => {
      announceChange(target, disabled);
      for (const member of gateway ? GATEWAY_BUNDLE_MEMBERS : [name]) options.selectionChanged?.(member);
    };
    const before = await controlState();
    const liveBefore = options.runtimeDisabled?.(client);
    const answer = await request<ControlState>("PUT", MANAGEMENT_PATH, { name: target, disabled: !enabled, expectedRevision: before.revision });
    if (!answer.ok) return answer;
    changed(!enabled);
    if (!gateway && isManageableThinkModule(name)) {
      return { ok: true, value: { changed: true, application: "applied", stage: "enable", target, enabled } };
    }
    if (options.applyRuntime === undefined) {
      return { ok: true, value: { changed: true, application: "restart-required", restartReason: "no-hmr", stage: "enable", target, enabled } };
    }
    try {
      await options.applyRuntime(client, !enabled);
      return { ok: true, value: { changed: true, application: "applied", stage: "enable", target, enabled } };
    } catch (error) {
      // Never leave persisted intent pointing at a state the live Loader rejected.
      const previousOverride = before.overrides[gateway ? GATEWAY_THINK_MODULE : name];
      const previousDisabled = gateway ? previousOverride?.disabled ?? false : previousOverride?.disabled ?? liveBefore;
      const rollback = await request<ControlState>("PUT", MANAGEMENT_PATH, !gateway && previousOverride === undefined ? { name: target, reset: true, expectedRevision: answer.value.revision } : { name: target, disabled: previousDisabled, expectedRevision: answer.value.revision });
      if (rollback.ok) {
        changed(previousDisabled ?? false);
        // Entry.update can reject after changing its options. Restore its live
        // intent too; never overwrite another tab's newer server revision.
        try { await options.applyRuntime(client, liveBefore ?? previousDisabled ?? false); } catch { /* original failure remains visible */ }
      }
      if (!rollback.ok) return unavailable("plugin-manager/runtime-apply-failed", "The change was saved, but the running page could not apply it and a newer selection could not be restored. Reload to read the saved state.");
      return unavailable("plugin-manager/runtime-apply-failed", error instanceof Error ? error.message : "The running Loader rejected the change.");
    }
  };
  return {
    inventory: {
      list: async (): Promise<Answer<PluginInventorySnapshot>> => {
        try {
          if (!authenticated()) return { ok: true, value: {
            managementAvailable: true,
            // Think composition is session-scoped and belongs exclusively to presets.
            entries: OWNED_PLUGIN_ROWS.filter(row => row.plane !== "think").map(row => ({ entryId: row.entryId as never, moduleName: row.name, enabled: row.declaredEnabled, fiberPhase: null, meta: OWNED_PLUGIN_META[row.name] })),
            agentPresets: presetDeclarations(),
          } };
          // Preserve the official global/session grouping, with the complete
          // observed client + Worker inventory and all declared Think providers.
          const { client, worker } = await allRows();
          const entries = [...client, ...worker].map(entry => ({ entryId: entry.entryId as never, moduleName: entry.moduleName, enabled: entry.enabled, fiberPhase: entry.fiberPhase,
            ...(OWNED_PLUGIN_META[entry.moduleName] === undefined ? {} : { meta: OWNED_PLUGIN_META[entry.moduleName] }),
          }));
          return { ok: true, value: {
            managementAvailable: true,
            entries,
            agentPresets: presetDeclarations(),
          } };
        } catch (error) {
          return unavailable("plugin-manager/inventory-unavailable", error instanceof Error ? error.message : "Inventory is unavailable.");
        }
      },
    },
    manager: {
      listPlugins: async () => { try { return { ok: true as const, value: await plugins() }; } catch (error) { return unavailable("plugin-manager/inventory-unavailable", error instanceof Error ? error.message : "Inventory is unavailable."); } },
      listBundles: async () => { try { return { ok: true as const, value: await bundles() }; } catch (error) { return unavailable("plugin-manager/inventory-unavailable", error instanceof Error ? error.message : "Inventory is unavailable."); } },
      registries: async () => unavailable("plugin-manager/unsupported", copy().install),
      readBundleDetail: async () => ({ ok: true as const, value: { status: "none" as const } }),
      setBundleEnabled: async (name: string, enabled: boolean) => await setEnabled(name, enabled),
      setPluginEnabled: async (entryId: string, enabled: boolean) => {
        if (!authenticated()) return unavailable("plugin-manager/unauthenticated", "Sign in to manage your plugins.");
        const entry = clientEntries().find(candidate => candidate.entryId === entryId);
        if (entry !== undefined) return isGatewayModule(entry.moduleName) ? unavailable("plugin-manager/unaddressable", "Use the Cloudflare AI Gateway bundle switch to manage both components.") : await setEnabled(entry.moduleName, enabled);
        const row = OWNED_PLUGIN_ROWS.find(row => row.entryId === entryId);
        if (row !== undefined && isGatewayModule(row.name)) return unavailable("plugin-manager/unaddressable", "Use the Cloudflare AI Gateway bundle switch to manage both components.");
        return row === undefined ? unavailable("plugin-manager/unknown-plugin", "The plugin entry is not in the current bundled composition.") : await setEnabled(row.name, enabled);
      },
      removeBundle: async () => unavailable("plugin-manager/not-removable", copy().install),
      listVersions: async () => unavailable("plugin-manager/unsupported", copy().install),
      updateBundle: async () => unavailable("plugin-manager/unsupported", copy().install),
      installBundle: async () => unavailable("plugin-manager/unsupported", copy().install),
      waitForInstall: async () => unavailable("plugin-manager/unsupported", copy().install),
      cancelInstall: async () => unavailable("plugin-manager/unsupported", copy().install),
      inspect: async () => unavailable("plugin-manager/unsupported", copy().install),
    },
    registryProbe: { fastest: async () => unavailable("plugin-manager/unsupported", copy().install) },
  };
}
