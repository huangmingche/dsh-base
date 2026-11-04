/**
 * Read-only plugin-management Remote seam for the Workers deployment.
 *
 * The official `ui-plugin-manager` and `ui-settings-plugin-inventory` plugins
 * inject `remote.pluginManager`, `remote.pluginInventory` and
 * `remote.pluginRegistryProbe`. Upstream DSH provides those from a desktop/server
 * Host; a deployed Worker has no package-manager/process runtime, so this seam
 * exposes the real bundled inventory read-only and answers every mutation with
 * the same explicit "not available on Workers" reason. It is an adaptation
 * seam, not a capability: no owner-level switch, no install/update path, and no
 * write interface exists here.
 */
import type { StaticPluginInspection } from "@dsh-base/plugin-loader-static";
import type { BundleInfo, PluginInfo } from "@deepseek-ai/dsh-plugin-manager/types";
import type { PluginInventorySnapshot } from "@deepseek-ai/dsh-api-remotes/client";
import { fixedAgentPresetCopy } from "../../../../boot/dsh-base-agent-presets/src/availability.ts";
import { FIXED_AGENT_PRESET_ID, OFFICIAL_AGENT_PRESET_IDS } from "../../../../boot/dsh-base-agent-presets/src/index.ts";
import { OFFICIAL_PRESET_ROWS, THINK_PRESET_ROWS, type GeneratedPresetRow } from "./official-preset-declarations.generated.ts";

export interface PluginInventorySeamOptions {
  readonly entries: () => readonly StaticPluginInspection[] | undefined;
  readonly locale?: () => string;
}

type Answer<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

const COPY = {
  en: {
    install: "Installing, removing, upgrading or fetching plugins from a registry needs a package-manager/process runtime that a deployed Worker does not provide.",
  },
  zh: {
    install: "安装、移除、升级或从 registry 获取插件需要包管理器/进程运行时，部署的 Worker 不提供这些能力。",
  },
} as const;
type Copy = Record<keyof typeof COPY.en, string>;
const copyFor = (locale: string): Copy => (COPY as unknown as Record<string, Copy>)[locale] ?? COPY.en;

function unavailable(code: string, message: string): Answer<never> {
  return { ok: false, error: { code, message, details: {} } };
}

/** Map generated declaration rows without inventing a live fiber phase. */
function declaredRows(rows: readonly GeneratedPresetRow[]): NonNullable<PluginInventorySnapshot["agentPresets"]>[number]["rows"] {
  return rows.map(row => ({ ...row, fiberPhase: null }));
}

export function createReadOnlyPluginRemotes(options: PluginInventorySeamOptions) {
  const locale = () => options.locale?.() ?? "en";
  const copy = () => copyFor(locale());
  const clientEntries = (): readonly StaticPluginInspection[] => {
    const entries = options.entries();
    if (entries === undefined) throw new Error("The client composition inventory is unavailable.");
    return entries;
  };
  const unsupported = async () => unavailable("plugin-manager/unsupported", copy().install);

  return {
    inventory: {
      list: async (): Promise<Answer<PluginInventorySnapshot>> => {
        try {
          const entries = clientEntries().map(entry => ({
            entryId: entry.entryId as never,
            moduleName: entry.moduleName,
            enabled: entry.enabled,
            fiberPhase: entry.fiberPhase,
          }));
          return { ok: true, value: {
            // No owner-level switch exists in this deployment: the official
            // settings inventory stays visible and read-only.
            managementAvailable: false,
            entries,
            agentPresets: [
              ...OFFICIAL_AGENT_PRESET_IDS.map((id: string) => ({ id, isDefault: false, rows: declaredRows(OFFICIAL_PRESET_ROWS[id] ?? []) })),
              { id: FIXED_AGENT_PRESET_ID, name: fixedAgentPresetCopy(locale()).thinkName, isDefault: true, rows: declaredRows(THINK_PRESET_ROWS) },
            ],
          } };
        } catch (error) {
          return unavailable("plugin-manager/inventory-unavailable", error instanceof Error ? error.message : "Inventory is unavailable.");
        }
      },
    },
    manager: {
      listPlugins: async (): Promise<Answer<readonly PluginInfo[]>> => {
        try {
          const clientRows = clientEntries().map((entry): PluginInfo => ({
            entryId: entry.entryId as never,
            moduleName: entry.moduleName,
            enabled: entry.enabled,
            fiberPhase: entry.fiberPhase,
            ...(entry.replaces === undefined ? {} : { replaces: entry.replaces }),
            readOnlyReason: "management-required" as const,
          }));
          const thinkRows = THINK_PRESET_ROWS.map((row): PluginInfo => ({
            entryId: (row.entryId ?? row.moduleName) as never,
            moduleName: row.moduleName,
            enabled: row.enabled === true,
            fiberPhase: null,
            readOnlyReason: "management-required" as const,
          }));
          return { ok: true, value: [...clientRows, ...thinkRows] };
        } catch (error) {
          return unavailable("plugin-manager/inventory-unavailable", error instanceof Error ? error.message : "Inventory is unavailable.");
        }
      },
      // managementAvailable: false makes the official manager short-circuit to
      // its "unavailable" state, so listBundles/listPlugins are never called by
      // the UI; they remain for contract completeness. No bundle is manageable.
      listBundles: async (): Promise<Answer<readonly BundleInfo[]>> => ({ ok: true, value: [] }),
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
    },
    registryProbe: { fastest: unsupported },
  };
}
