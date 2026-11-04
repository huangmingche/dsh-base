/** Exercise the shared model selection boundary used by composer and /model. */
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { ModelDirectory } from "../../../../packages/client/dsh-base-client-model-selection/src/client/directory.ts";
import { selectionOf } from "../../../../packages/client/dsh-base-client-model-selection/src/client/index.ts";

export async function checkModelDirectoryAvailability() {
  const calls: unknown[] = [];
  const catalog = {
    store: createSnapshotStore<any>({ status: "ready", error: null, value: {
      default: { provider: "fixture", model: "blocked" }, failures: [],
      groups: [{ id: "fixture", name: "Fixture", models: [
        { id: "blocked", name: "Blocked", unavailable: true, unavailableReason: "此模型在当前部署不可用" },
        { id: "enabled", name: "Enabled", reasoning: { unavailable: true, unavailableReason: "This model service does not advertise configurable reasoning effort.", efforts: [{ id: "max", name: "Max" }], defaultEffort: "max" } },
      ] }],
    } }),
    reasoningFor: () => undefined,
    load: async () => catalog.store.getSnapshot().value,
  };
  const projected = createSnapshotStore<any>({ lastUsed: null, next: { provider: "fixture", model: "blocked" } });
  const directory = new ModelDirectory({ selectModel: async value => { calls.push(value); return { ok: true, value: undefined }; } } as any,
    "fixture-session" as any, () => true, catalog as any, projected, () => true);
  try {
    const blockedRoutable = directory.store.getSnapshot().routable;
    const blocked = await directory.select({ provider: "fixture", model: "blocked" });
    const unknown = await directory.select({ provider: "fixture", model: "missing" });
    const effort = await directory.select({ provider: "fixture", model: "enabled", reasoningEffort: "max" });
    const commandSelection = selectionOf(directory.store.getSnapshot(), "fixture/enabled");
    const callsBeforeEnabled = calls.length;
    const enabled = await directory.select(commandSelection!);
    const acknowledgementDoesNotForgeProjection = directory.store.getSnapshot().current?.model === "blocked";
    projected.set({ lastUsed: null, next: { provider: "fixture", model: "enabled" } });
    const enabledRoutable = directory.store.getSnapshot().routable;
    projected.set({ lastUsed: null, next: { provider: "fixture", model: "blocked" } });
    const laterRemoteSelectionWins = directory.store.getSnapshot().current?.model === "blocked";
    projected.set({ lastUsed: null, next: { provider: "fixture", model: "enabled" } });
    // A previously visible choice becomes unavailable before a later command gesture.
    catalog.store.update(state => { state.value.groups[0].models[1].unavailable = true; state.value.groups[0].models[1].unavailableReason = "Now unavailable"; });
    const stale = await directory.select({ provider: "fixture", model: "enabled" });
    return {
      blocked: blocked.ok ? "accepted" : blocked.error.code,
      blockedReason: blocked.ok ? "" : blocked.error.message,
      unknown: unknown.ok ? "accepted" : unknown.error.code,
      effort: effort.ok ? "accepted" : effort.error.code,
      commandSelection,
      enabled: enabled.ok,
      stale: stale.ok ? "accepted" : stale.error.code,
      callsBeforeEnabled, calls, blockedRoutable, enabledRoutable, acknowledgementDoesNotForgeProjection, laterRemoteSelectionWins,
      staleRoutable: directory.store.getSnapshot().routable,
    };
  } finally { directory.dispose(); }
}
