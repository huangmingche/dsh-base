import { repoRoot } from "../conformance/lib.mjs";
import { readClientMetadataRows } from "./metadata-roster.mjs";

export const compositionVirtualId = "virtual:dsh-composition";
const compositionResolvedId = "\0" + compositionVirtualId;

/** Build reads package metadata/profile and the pinned official inventory. Disabled rows remain
 * inventory only and never receive a bundled module resolver. */
export function readClientComposition(root = repoRoot, options = {}) {
  return readClientMetadataRows(root, options);
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
export function dshComposition({ root = repoRoot, app } = {}) {
  return {
    name: "dsh-base:composition",
    enforce: "pre",
    resolveId(id) { return id === compositionVirtualId ? compositionResolvedId : null; },
    load(id) {
      return id === compositionResolvedId ? generateClientComposition(readClientComposition(root, { app })) : null;
    },
  };
}
