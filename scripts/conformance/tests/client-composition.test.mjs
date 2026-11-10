import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { clientRows, repoRoot } from "../lib.mjs";
import { auditPacks } from "../../composition/packs.mjs";
import { compositionVirtualId, dshComposition, readClientComposition } from "../../composition/client.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dsh-client-roster-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  return { root, write };
}

async function loadVirtual(root) {
  const plugin = dshComposition({ root });
  const source = plugin.load(plugin.resolveId(compositionVirtualId));
  // Branding is unrelated to module loading; all generated import/load code
  // stays unchanged and executes as a real ESM module.
  const branding = "data:text/javascript,export const StaticPluginEntryId = value => value;";
  const executable = source.replace('"@dsh-base/plugin-loader-static"', JSON.stringify(branding));
  const module = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  return { source, composition: module.clientComposition };
}

test("actual Vite roster respects retired metadata: inventory, reason, and no import or evaluator", async t => {
  const f = fixture(t);
  const retired = "@dsh-base/client-retired";
  const active = "@dsh-base/client-active";
  const bomb = "data:text/javascript,throw new Error('disabled plugin evaluated');";
  f.write("packages/client/retired/package.json", { name: retired, dshBase: { client: {
    id: "client:retired", origin: "custom", disabled: true, module: bomb,
    unavailableReason: "Replaced by the unchanged official plugin.",
  } } });
  f.write("packages/client/active/package.json", { name: active, dshBase: { client: {
    id: "client:active", origin: "custom", module: "data:text/javascript,export default {activated:true};",
  } } });
  const { source, composition } = await loadVirtual(f.root);
  const row = composition.entries.find(entry => entry.name === retired);
  assert.equal(row.disabled, true);
  assert.equal(row.unavailableReason, clientRows(f.root).find(entry => entry.name === retired).unavailableReason);
  assert.equal(Object.hasOwn(composition.modules, retired), false);
  assert.equal(Object.hasOwn(composition.namespaces, retired), false);
  assert.equal(source.includes(bomb), false, "disabled package cannot enter the bundled import graph");
  assert.deepEqual(await composition.modules[active].load(), { activated: true });
  assert.deepEqual((await composition.namespaces[active]()).default, { activated: true });
});

test("profile precedence is shared, preserves public ownership, and can explicitly re-enable metadata", async t => {
  const f = fixture(t);
  const name = "@dsh-base/client-public";
  f.write("packages/client/public/package.json", { name, dshBase: { client: {
    id: "client:public", origin: "custom", disabled: true, documentRoutes: ["/login"],
    unavailableReason: "Retired default.",
  } } });
  f.write("apps/web/composition.profile.json", { client: [{ name, id: "client:public", origin: "custom", disabled: false,
    module: "data:text/javascript,export default 42;" }] });
  const { composition } = await loadVirtual(f.root);
  assert.equal(composition.entries[0].disabled, false);
  assert.deepEqual(composition.entries[0].documentRoutes, ["/login"]);
  assert.equal(await composition.modules[name].load(), 42);
  assert.deepEqual(readClientComposition(f.root), clientRows(f.root));
});

test("profile edits drive the actual Vite roster even when pack declarations are stale", async t => {
  const f = fixture(t);
  const name = "@dsh-base/client-profile-source";
  const row = { name, id: "client:profile-source", module: "data:text/javascript,export default 1;", origin: "custom", order: 1 };
  f.write("apps/web/composition.profile.json", { client: [row] });
  f.write("packs/base/pack.json", { id: "base", planes: { client: [row] }, requires: [], config: {}, toggleable: "none", uninstallImpact: "fixture", reuse: { mode: "custom", official: [], reason: "fixture" } });
  assert.equal((await loadVirtual(f.root)).composition.entries[0].disabled, false);
  f.write("apps/web/composition.profile.json", { client: [{ ...row, disabled: true, unavailableReason: "disabled by profile" }] });
  const { composition } = await loadVirtual(f.root);
  assert.equal(composition.entries[0].disabled, true);
  assert.equal(Object.hasOwn(composition.modules, name), false);
  const audit = auditPacks(f.root, { client: readClientComposition(f.root), worker: [], agent: [] });
  assert.equal(audit.ok, false, "stale packs must fail the independent release audit");
  assert.ok(audit.errors.some(error => error.startsWith("client: roster differs")));
});

test("deployment activates the official permission plugin and keeps the retired wrapper unevaluated", async () => {
  const rows = readClientComposition(repoRoot);
  const wrapper = rows.find(row => row.name === "@dsh-base/client-permission-availability");
  const official = rows.find(row => row.name === "@deepseek-ai/dsh-client-ui-permission-presets");
  assert.equal(wrapper.disabled, true);
  assert.match(wrapper.unavailableReason, /Retired/);
  assert.notEqual(official.disabled, true);
  const { composition } = await loadVirtual(repoRoot);
  assert.equal(Object.hasOwn(composition.modules, wrapper.name), false);
  assert.equal(Object.hasOwn(composition.namespaces, wrapper.name), false);
  assert.equal(typeof composition.modules[official.name].load, "function");
});

test("official access/registry are active while the superseded generation bootstrap stays unevaluated", async () => {
  const rows = readClientComposition(repoRoot);
  const { source, composition } = await loadVirtual(repoRoot);
  for (const name of ["@deepseek-ai/dsh-api-remote-access", "@deepseek-ai/dsh-typert-registry"]) {
    const row = rows.find(entry => entry.name === name);
    assert.equal(row.origin, "upstream");
    assert.notEqual(row.disabled, true);
    assert.equal(typeof composition.modules[name].load, "function");
  }
  const retired = rows.find(row => row.name === "@dsh-base/client-wire-bootstrap");
  assert.equal(retired.disabled, true);
  assert.match(retired.unavailableReason, /official Gateway/);
  assert.equal(Object.hasOwn(composition.modules, retired.name), false);
  assert.equal(Object.hasOwn(composition.namespaces, retired.name), false);
  assert.equal(source.includes(`import ${JSON.stringify(retired.name)}`), false);
  const adapter = readFileSync(join(repoRoot, "packages/client/dsh-base-client-session-adapter/src/client/index.ts"), "utf8");
  assert.doesNotMatch(adapter, /OwnerRemoteAccess|ownerAccess|registerClient:\s*\(\)\s*=>/);
});
