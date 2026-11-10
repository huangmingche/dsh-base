import assert from "node:assert/strict";
import { Context, FiberState } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import type { StaticPluginLoaderConfig } from "../../plugin-loader-static/src/index.ts";
import { ownerBootSelection } from "../src/client/control.ts";

const gateway = "@dsh-base/client-gateway-provider";
const original = "@deepseek-ai/dsh-client-provider";

for (const deploymentDisabled of [false, true]) {
  const ctx = new Context();
  let activations = 0;
  let disposals = 0;
  const imports: string[] = [];
  const plugin = { apply(context: Context) { context.effect(() => { activations++; return () => { disposals++; }; }); } };
  const base: StaticPluginLoaderConfig = {
    entries: [
      { id: "original", name: original, origin: "upstream", disabled: true },
      { id: "gateway", name: gateway, origin: "custom", disabled: deploymentDisabled },
    ],
    // Even a stale resolver cannot authorize deployment-disabled inventory.
    modules: { [gateway]: { load: async () => plugin } },
  };
  const selected = { ...base, entries: base.entries.map(entry => ({ ...entry, disabled: true })) };
  const namespaces = { [gateway]: async () => { imports.push(gateway); return plugin; } };
  const selection = ownerBootSelection(base, selected, namespaces);
  try {
    await ctx.plugin(Loader);
    ctx.loader.internal = { import: async (name: string) => {
      assert.equal(name, gateway, "disabled official originals never enter module resolution");
      return namespaces[gateway]();
    } } as never;
    for (const entry of selection.entries.filter(entry => !entry.disabled)) await ctx.loader.create({ name: entry.name });
    await ctx.loader.await();
    for (const name of selection.disableAfterBoot) {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === name);
      assert.ok(entry, "post-boot disposal only addresses a real deployment-authorized entry");
      await entry.update({ disabled: true });
    }
    await ctx.loader.await();
    assert.equal([...ctx.loader.entries()].some(entry => entry.options.name === original), false);
    if (deploymentDisabled) {
      assert.deepEqual(imports, []);
      assert.equal(activations, 0);
      assert.deepEqual([...ctx.loader.entries()], [], "deployment-disabled plugins stay inert for the entire boot");
    } else {
      const [entry] = [...ctx.loader.entries()];
      assert.ok(entry);
      assert.equal(entry.disabled, true);
      assert.equal(activations, 1);
      assert.equal(disposals, 1, "the persisted owner selection disposes the initial fiber");
      await entry.update({ disabled: false });
      await ctx.loader.await();
      assert.equal(entry.disabled, false);
      assert.equal(entry.fiber?.state, FiberState.ACTIVE);
      assert.equal(activations, 2, "the same official Entry can reactivate without a page restart");
      assert.deepEqual(imports, [gateway, gateway]);
    }
  } finally { await ctx.fiber.dispose(); }
}
console.log("client owner boot: deployment-disabled inventory is inert; owner-disabled entries retain the official disable/re-enable lifecycle");
