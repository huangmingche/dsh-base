import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import StaticPluginLoader, { bootStaticPlugins } from '../src/index.ts';
const ctx = new Context();
let activations = 0;
try {
  await ctx.plugin(StaticPluginLoader, {
    entries: [
      { id: 'official', name: '@deepseek-ai/dsh-test', origin: 'upstream', disabled: true },
      { id: 'fork', name: '@dsh-base/fork-test', origin: 'fork', replaces: '@deepseek-ai/dsh-test', disabled: false },
    ],
    modules: { '@dsh-base/fork-test': { load: async () => ({ apply() { activations++; } }) } },
  });
  await ctx.staticPluginLoader.start();
  const entries = ctx.staticPluginLoader.entries();
  assert.equal(entries[0]!.fiberPhase, null);
  assert.equal(entries[1]!.fiberPhase, 'active');
  assert.equal(entries[1]!.origin, 'fork');
  assert.equal(activations, 1);
} finally { await ctx.fiber.dispose(); }
console.log('static composition: declared fork origin survives validation and real Cordis activation; disabled official original stays unevaluated');

const productContext = new Context();
const executed: string[] = [];
let undeclaredImports = 0;
try {
  const names = ['@fixture-product/client-probe', '@fixture-product/cloudflare-worker-probe', '@fixture.product/client_probe.v2'];
  const loader = await bootStaticPlugins(productContext, {
    entries: names.map((name, index) => ({ id: `product:${index}`, name, origin: 'custom' as const, disabled: false })),
    modules: {
      ...Object.fromEntries(names.map(name => [name, { load: async () => ({ apply() { executed.push(name); } }) }])),
      '@fixture-product/client-undeclared': { load: async () => { undeclaredImports++; return { apply() { executed.push('undeclared'); } }; } },
    },
  });
  assert.deepEqual(executed.sort(), [...names].sort());
  assert.ok(loader.entries().every(entry => entry.fiberPhase === 'active' && entry.origin === 'custom'));
  await assert.rejects(loader.update('product:undeclared', { disabled: false }), /static_plugin_entry_missing/);
  assert.equal(undeclaredImports, 0, 'a module resolver does not authorize an undeclared composition entry');
} finally { await productContext.fiber.dispose(); }

for (const name of ['unscoped', '@scope', '@scope/', '@scope/plugin/client', '@scope/../plugin', '@scope/plugin%2fclient', '@scope/plugin?code=1', '@scope/plugin;run()', '@Upper/plugin', '@scope/.hidden', `@scope/${'a'.repeat(208)}`]) {
  const invalidContext = new Context();
  let imports = 0;
  try {
    await assert.rejects(bootStaticPlugins(invalidContext, {
      entries: [{ id: 'invalid', name, origin: 'custom', disabled: false }],
      modules: { [name]: { load: async () => { imports++; return { apply() {} }; } } },
    }), /invalid_static_plugin_name/);
    assert.equal(imports, 0, `invalid package identity must never be resolved: ${name}`);
  } finally { await invalidContext.fiber.dispose(); }
}

const unbundledContext = new Context();
try {
  await assert.rejects(bootStaticPlugins(unbundledContext, {
    entries: [{ id: 'product:missing', name: '@fixture-product/client-missing', origin: 'custom', disabled: false }], modules: {},
  }), /static_plugin_not_bundled/);
} finally { await unbundledContext.fiber.dispose(); }
console.log('static composition: product client/Worker scopes activate real Cordis fibers; malformed, undeclared and unbundled entries cannot execute');
