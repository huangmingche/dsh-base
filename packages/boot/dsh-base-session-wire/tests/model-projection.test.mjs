/** Exercise the actual pinned-fork ModelDirectory, including a cold reconstruction. */
import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { deriveSessionProjections } from "../src/index.ts";

const require = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const { transformSync } = require("esbuild");
const fork = new URL("../../../client/dsh-base-client-model-selection/src/", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith(fork) && url.endsWith(".ts")) return { format: "module", shortCircuit: true,
    source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm", target: "es2022" }).code };
  return nextLoad(url, context);
} });
const { ModelDirectory } = await import("../../../client/dsh-base-client-model-selection/src/client/directory.ts");
const { ModelCatalogDirectory } = await import("../../../client/dsh-base-client-model-selection/src/client/catalog.ts");
const { createSnapshotStore } = await import("@deepseek-ai/dsh-client-store");
const flash = { provider: "deepseek-official", model: "deepseek-official/deepseek-flash" };
const pro = { provider: "deepseek-official", model: "deepseek-official/deepseek-v4-pro" };
const catalog = new ModelCatalogDirectory({ remote: { session: { modelCatalog: async () => ({ ok: true, value: {
  default: flash, groups: [{ id: flash.provider, name: "DeepSeek", models: [{ id: flash.model, name: "Flash" }, { id: pro.model, name: "Pro" }] }], failures: [],
} }) } } });
const coldRead = async projection => {
  const directory = new ModelDirectory({ selectModel: async () => { throw new Error("A reload must not write the model"); } }, "existing-session", () => true,
    catalog, createSnapshotStore(projection), () => false);
  try { await directory.load(); return directory.store.getSnapshot().current; } finally { directory.dispose(); }
};
assert.deepEqual(await coldRead(pro), flash, "the real consumer reproduces the old flat-projection fallback bug");
const normalized = deriveSessionProjections({}, { model: pro.model }).modelSelection;
assert.deepEqual(await coldRead(normalized), pro, "cold directory reads the saved Pro selection, without accepted local state");
assert.deepEqual(await coldRead(JSON.parse(JSON.stringify(normalized))), pro, "reload reconstructs the exact durable route");
assert.deepEqual(await coldRead(deriveSessionProjections({}, { model: flash.model }).modelSelection), flash);
console.log("model projection: real ModelDirectory reproduces flat-shape loss; official next/lastUsed survives cold Pro reads and reload without writes");
