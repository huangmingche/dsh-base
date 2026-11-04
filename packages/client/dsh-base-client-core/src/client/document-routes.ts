import type { StaticPluginEntry } from "@dsh-base/plugin-loader-static";

/** Undefined selects the ordinary app; a declared public route never falls back to private fibers. */
export function publicDocumentEntries(entries: readonly StaticPluginEntry[], pathname: string): readonly StaticPluginEntry[] | undefined {
  const selected = entries.filter(entry => entry.documentRoutes?.includes(pathname));
  return selected.length === 0 ? undefined : selected;
}
