/** Official preset projection and shared Think metadata reader contracts. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerOfficialSourceHooks } from "../../build/official-source-hook.mjs";
import { readThinkComposition, readThinkPresetRows } from "../../composition/think-composition.mjs";
import { THINK_PRESET_ROWS, OFFICIAL_PRESET_ROWS } from "../../../packages/client/dsh-base-client-session-adapter/src/client/official-preset-declarations.generated.ts";
import { loadOfficialDeclarations } from "../../../apps/web/scripts/generate-preset-declarations.mjs";

registerOfficialSourceHooks();
const { definitionComposition } = await import("@deepseek-ai/dsh-agent-preset-registry/src/composition-inventory.ts");
const conditional = () => { throw new Error("external disabled expression"); };
const project = rows => {
  const result = definitionComposition(rows, conditional);
  assert.equal("rows" in result, true, `unexpected broken projection: ${String(result.broken ?? "")}`);
  return result.rows;
};

assert.deepEqual(project([{ id: "example", name: "example", disabled: "x" }]), [{ entryId: "example", moduleName: "example", enabled: false }], "truthy strings disable like Boolean");
assert.deepEqual(project([{ id: "example", name: "example", disabled: 0 }]), [{ entryId: "example", moduleName: "example", enabled: true }], "falsy values stay enabled");
assert.deepEqual(project([{ id: "example", name: "example", disabled: false }]), [{ entryId: "example", moduleName: "example", enabled: true }]);
assert.deepEqual(project([{ id: "example", name: "example", disabled: true }]), [{ entryId: "example", moduleName: "example", enabled: false }]);
assert.deepEqual(project([{ id: "outer", name: "cordis:group", group: true, disabled: true, config: [{ id: "child", name: "child" }] }]), [{ entryId: "child", moduleName: "child", enabled: false }], "nested disabled is inherited");
assert.deepEqual(project([{ id: "example", name: "example", disabled: { __jsExpr: "ctx.missing" } }]), [{ entryId: "example", moduleName: "example", enabled: "conditional", condition: "ctx.missing" }], "external expressions remain conditional");
assert.equal("broken" in definitionComposition([{ id: "missing-name" }], conditional), true, "invalid row shapes are rejected by official entryListProblem");
assert.equal("broken" in definitionComposition({ not: "a list" }, conditional), true);

const root = join(import.meta.dirname, "../../..");
const think = readThinkComposition(root);
assert.deepEqual(think.map(row => row.id), ["cloudflare:think:deepseek", "cloudflare:think:fetch", "cloudflare:think:attachments", "cloudflare:think:persona", "cloudflare:think:memory"]);
const presetThink = readThinkPresetRows(root);
assert.deepEqual(THINK_PRESET_ROWS.map(row => row.moduleName), presetThink.map(row => row.module));
assert.equal(THINK_PRESET_ROWS.length, 4);
assert.equal(Object.keys(OFFICIAL_PRESET_ROWS).length, 4);
assert.ok(OFFICIAL_PRESET_ROWS.standard.length > 10);
const generated = await loadOfficialDeclarations(root);
assert.deepEqual(OFFICIAL_PRESET_ROWS, generated.officialRows, "generated declaration rows equal the official projection of the pinned declarations");
assert.deepEqual(THINK_PRESET_ROWS, generated.thinkRows, "generated Think rows equal the shared metadata reader projection");

const runtime = readFileSync(join(root, "apps/web/src/agent/generated-composition.ts"), "utf8");
for (const row of think) assert.ok(runtime.includes(`// ${row.id}`), `runtime composition includes ${row.id}`);

const invalidRoot = mkdtempSync(join(tmpdir(), "dsh-think-reader-"));
mkdirSync(join(invalidRoot, "packages/cloudflare-think/one"), { recursive: true });
mkdirSync(join(invalidRoot, "packages/cloudflare-think/two"), { recursive: true });
writeFileSync(join(invalidRoot, "packages/cloudflare-think/one/package.json"), JSON.stringify({ name: "@dsh-base/cloudflare-think-one", dshBase: { agent: { id: "cloudflare:think:same", export: "one" } } }));
writeFileSync(join(invalidRoot, "packages/cloudflare-think/two/package.json"), JSON.stringify({ name: "@dsh-base/cloudflare-think-two", dshBase: { agent: { id: "cloudflare:think:same", export: "two" } } }));
assert.throws(() => readThinkComposition(invalidRoot), /duplicate agent composition id/u, "duplicate ids are rejected");
writeFileSync(join(invalidRoot, "packages/cloudflare-think/two/package.json"), JSON.stringify({ name: "@dsh-base/cloudflare-think-two", dshBase: { agent: { id: "cloudflare:think:other" } } }));
assert.throws(() => readThinkComposition(invalidRoot), /export is required/u, "missing exports are rejected");
console.log("official preset projection and shared Think reader: literal/nested/conditional guards and metadata parity passed");
