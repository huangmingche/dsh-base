#!/usr/bin/env node
/**
 * Extract the four official Agent preset declarations from the pinned upstream
 * submodule into a build-generated client module. The extractor parses
 * `config.plugins` with the pinned loader's declared YAML dialect
 * (JSON_SCHEMA + the vendor JsExpr type) and dumps it with the same js-yaml
 * `{ noRefs: true, lineWidth: -1 }` options; the pinned vendor schema source is
 * asserted before use so a pin change cannot silently drift the dialect.
 *
 * Usage: node apps/web/scripts/generate-preset-declarations.mjs [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load, dump, JSON_SCHEMA, Type } from "js-yaml";
import { registerOfficialSourceHooks } from "../../../scripts/build/official-source-hook.mjs";
import { readThinkPresetRows } from "../../../scripts/composition/think-composition.mjs";

/** Official preset ids covered by the shipped bundle declarations. */
export const OFFICIAL_PRESET_IDS = ["standard", "ptc", "minimal", "cordis"];
const ROOT = resolve(import.meta.dirname, "../../..");
const TARGET = "packages/client/dsh-base-client-session-adapter/src/client/official-preset-declarations.generated.ts";

/** Loader expression nodes read back exactly as declared. */
const JsExpr = new Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  resolve: (data) => typeof data === "string",
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => typeof value === "object" && value !== null && "__jsExpr" in value,
  represent: (value) => value.__jsExpr,
});
const schema = JSON_SCHEMA.extend(JsExpr);


let officialProjection;
/** Load the official projection implementation from the pinned source once. */
async function officialDefinitionComposition() {
  if (officialProjection !== undefined) return officialProjection;
  registerOfficialSourceHooks();
  const module = await import("@deepseek-ai/dsh-agent-preset-registry/src/composition-inventory.ts");
  officialProjection = module.definitionComposition;
  return officialProjection;
}

/** The loader-context evaluator is deliberately absent during build: report conditional. */
function evaluateExpression(expression) {
  throw new Error(`external !!js disabled expression cannot be evaluated at build time: ${expression}`);
}

/**
 * Read the pinned package exports and produce the four official documents.
 * @param {string} [root] repository root.
 * @returns {Promise<{ lock: any, declarations: Record<string, { source: string, content: string }>, generated: string }>}.
 */
export async function loadOfficialDeclarations(root = ROOT) {
  const lock = JSON.parse(await readFile(resolve(root, "dsh-source.lock.json"), "utf8"));
  const sourceRoot = resolve(root, lock.referencePath);
  const webApp = resolve(sourceRoot, "packages/bundle/web-app");
  // The loader's own dialect lives in the pinned vendor source. Assert that
  // composition and options still match this extractor instead of silently
  // claiming an unverified "exact" dump.
  const includeSource = await readFile(resolve(sourceRoot, "vendor/include/src/index.ts"), "utf8");
  for (const marker of [
    "new yaml.Type('tag:yaml.org,2002:js'",
    "kind: 'scalar'",
    "construct: (data) => ({ __jsExpr: data })",
    "export const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)",
  ]) {
    if (!includeSource.includes(marker)) throw new Error(`pinned entryListSchema changed; re-audit the declaration extractor (${marker})`);
  }
  const packageJson = JSON.parse(await readFile(resolve(webApp, "package.json"), "utf8"));
  const expected = "./presets/*.patch.yml";
  if (packageJson.name !== "@deepseek-ai/dsh-web-app" || packageJson.exports?.[expected] !== expected) {
    throw new Error("pinned @deepseek-ai/dsh-web-app does not export ./presets/*.patch.yml");
  }
  const declarations = {};
  const officialRows = {};
  const definitionComposition = await officialDefinitionComposition();
  for (const id of OFFICIAL_PRESET_IDS) {
    const file = resolve(webApp, "presets", `${id}.patch.yml`);
    const parsed = load(await readFile(file, "utf8"), { schema });
    const row = Array.isArray(parsed) ? parsed[0]?.insert?.[0] : undefined;
    const config = row?.config;
    if (row?.name !== "@deepseek-ai/dsh-agent-preset" || config?.id !== id || !Array.isArray(config?.plugins)) {
      throw new Error(`unexpected official preset declaration shape in ${id}.patch.yml`);
    }
    declarations[id] = {
      source: `@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`,
      content: dump(config.plugins, { schema, noRefs: true, lineWidth: -1 }),
    };
    const projection = definitionComposition(config.plugins, evaluateExpression);
    if ("broken" in projection) throw new Error(`official preset ${id} composition is invalid: ${projection.broken}`);
    officialRows[id] = projection.rows;
  }
  const thinkRows = readThinkPresetRows(root).map(({ id, module }) => ({ entryId: id, moduleName: module, enabled: true }));
  const generated = `/**
 * Generated from pinned official preset declarations. Do not edit by hand.
 * Regenerate with: node apps/web/scripts/generate-preset-declarations.mjs
 * Source: ${lock.repository} ${lock.tag} (${lock.commit})
 */
export interface OfficialPresetDeclaration {
  /** Package export the declaration came from. */
  readonly source: string;
  /** Entry-list YAML for the preset's declared plugins, matching official readDocument. */
  readonly content: string;
}

/** The four shipped preset declarations, keyed by official preset id. */
export const OFFICIAL_PRESET_DECLARATIONS = ${JSON.stringify(declarations, null, 2)} as const;

/** One composition row read from a pinned declaration or generated Think metadata. */
export interface GeneratedPresetRow {
  readonly entryId: string | null;
  readonly moduleName: string;
  readonly enabled: boolean | "conditional";
  readonly condition?: string;
}

/** Official preset composition rows, flattened from the pinned declarations. */
export const OFFICIAL_PRESET_ROWS: Record<string, readonly GeneratedPresetRow[]> = ${JSON.stringify(officialRows, null, 2)};

/** The composition rows generated from the Think packages' dshBase.agent metadata. */
export const THINK_PRESET_ROWS: readonly GeneratedPresetRow[] = ${JSON.stringify(thinkRows, null, 2)};

/** Official preset ids that the declarations cover. */
export const OFFICIAL_PRESET_IDS = ["standard", "ptc", "minimal", "cordis"] as const;
`;
  return { lock, declarations, officialRows, thinkRows, generated };
}

async function main() {
  const { lock, generated, officialRows, thinkRows } = await loadOfficialDeclarations();
  const target = resolve(ROOT, TARGET);
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("official preset declarations are stale; run node apps/web/scripts/generate-preset-declarations.mjs");
      process.exit(1);
    }
    console.log(`official preset declarations: 4 documents, ${Object.values(officialRows).reduce((count, rows) => count + rows.length, 0)} declaration rows and ${thinkRows.length} Think rows match ${lock.tag} (${lock.commit.slice(0, 12)})`);
  } else {
    await writeFile(target, generated);
    console.log(`official preset declarations: wrote 4 documents, ${Object.values(officialRows).reduce((count, rows) => count + rows.length, 0)} declaration rows and ${thinkRows.length} Think rows from ${lock.tag}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
