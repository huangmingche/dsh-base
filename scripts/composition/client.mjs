import { repoRoot } from "../conformance/lib.mjs";
import { readClientRows } from "./packs.mjs";

export const compositionVirtualId = "virtual:dsh-composition";
const compositionResolvedId = "\0" + compositionVirtualId;

/** Build and conformance read the same pack-derived roster. Disabled rows remain
 * inventory only and never receive a bundled module resolver. */
export function readClientComposition(root = repoRoot) {
  // Resolved exclusively from `packs/`; a missing or invalid pack fails closed.
  return readClientRows(root);
}

/** Literal imports let Vite bundle exactly the enabled plugin namespaces. */
export function generateClientComposition(rows) {
  const entryLines = rows.map(row => {
    const fields = ["config", "unavailableReason", "replaces", "documentRoutes"]
      .filter(key => row[key] !== undefined)
      .map(key => `, ${key}: ${JSON.stringify(row[key])}`).join("");
    return `    { id: StaticPluginEntryId(${JSON.stringify(row.id)}), name: ${JSON.stringify(row.name)}, origin: ${JSON.stringify(row.origin)}, disabled: ${row.disabled === true}${fields} },`;
  });
  const active = rows.filter(row => row.disabled !== true);
  const moduleLines = active.map(row =>
    `    ${JSON.stringify(row.name)}: { load: async () => { const mod = await import(${JSON.stringify(row.module ?? row.name)}); return mod.default ?? mod; } },`);
  const namespaceLines = active.map(row =>
    `    ${JSON.stringify(row.name)}: async () => await import(${JSON.stringify(row.module ?? row.name)}),`);
  return [
    'import { StaticPluginEntryId } from "@dsh-base/plugin-loader-static";',
    "export const clientComposition = {",
    "  entries: [", ...entryLines, "  ],",
    "  modules: {", ...moduleLines, "  },",
    "  namespaces: {", ...namespaceLines, "  },",
    "};", "",
  ].join("\n");
}

/** @returns {import('vite').Plugin} */
export function dshComposition({ root = repoRoot } = {}) {
  return {
    name: "dsh-base:composition",
    enforce: "pre",
    resolveId(id) { return id === compositionVirtualId ? compositionResolvedId : null; },
    load(id) {
      return id === compositionResolvedId ? generateClientComposition(readClientComposition(root)) : null;
    },
  };
}
