import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import StaticPluginLoader from '../src/index.ts';
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
