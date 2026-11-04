import type { StaticPluginEntry, StaticPluginInspection, StaticPluginPhase } from "@dsh-base/plugin-loader-static";

/** Join declared provenance to observed fibers; configuration never proves activation. */
export function inspectComposition(entries: readonly StaticPluginEntry[], runtime: Iterable<{ name: string; phase: StaticPluginPhase; disabled?: boolean }>): StaticPluginInspection[] {
  const running = new Map(Array.from(runtime, entry => [entry.name, entry]));
  return entries.map(entry => ({
    entryId: entry.id, moduleName: entry.name, origin: entry.origin,
    enabled: running.get(entry.name)?.disabled === undefined ? !entry.disabled : !running.get(entry.name)!.disabled,
    fiberPhase: running.get(entry.name)?.phase ?? null,
    ...(entry.replaces === undefined ? {} : { replaces: entry.replaces }),
    ...(entry.unavailableReason === undefined ? {} : { unavailableReason: entry.unavailableReason }),
  }));
}
