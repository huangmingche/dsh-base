import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, createRequire } from 'node:module';
import { sourceDecorators } from '../../../packages/build/dsh-base-build-browser-compat/src/decorators.mjs';
import { sourcePackageMetadata } from '../../../packages/build/dsh-base-build-browser-compat/src/package-metadata.mjs';
import { checkWorkerOutput } from '../../../packages/build/dsh-base-build-browser-compat/src/check-worker-output.mjs';

const appRoot = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const plugin = sourceDecorators({ appRoot });
const sourceRoot = fileURLToPath(new URL('../../../.submodules/deepseek-harness/', import.meta.url));

test('pinned attribution keeps the real exported version without runtime paths or Node imports', async () => {
  const path = join(sourceRoot, 'packages/llm/llm/src/attribution.ts');
  const manifestPath = join(sourceRoot, 'packages/llm/llm/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const source = readFileSync(path, 'utf8');
  const metadata = sourcePackageMetadata({ sourceRoot });
  const watched = [];
  const result = metadata.transform.call({ addWatchFile: path => watched.push(path) }, source, path);
  assert.deepEqual(watched, [manifestPath]);
  const { build } = createRequire(join(appRoot, 'package.json'))('esbuild');
  // Browser platform intentionally has no node:module and the data URL has no
  // filesystem parent. Successful execution proves no runtime path fallback.
  const built = await build({ stdin: { contents: result.code, sourcefile: path, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const code = built.outputFiles[0].text;
  assert.doesNotMatch(code, /createRequire|import\.meta\.url|node:module/u);
  const attribution = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.deepEqual(attribution.APP_IDENTITY, { product: 'deepseek-harness', version: manifest.version, url: 'https://github.com/deepseek-ai/deepseek-harness' });
  assert.equal(attribution.userAgent(), `deepseek-harness/${manifest.version} (+https://github.com/deepseek-ai/deepseek-harness)`);
  assert.deepEqual(attribution.attributionHeaders(), { 'user-agent': attribution.userAgent() });
  const custom = { product: 'consumer', version: '9.2.1', url: 'https://consumer.example' };
  assert.deepEqual(attribution.attributionHeaders(custom), { 'user-agent': 'consumer/9.2.1 (+https://consumer.example)' });
  assert.equal(metadata.transform.call({}, source, '/unrelated/attribution.ts'), null);
  assert.throws(() => metadata.transform.call({}, source.replace("'../package.json'", 'dynamicPath'), path), /read changed/);
});

test('standard lowering executes real pinned LLM Remote markers and the permission service', async () => {
  await import('../../../packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs');
  const transformed = new Set();
  const hook = registerHooks({ load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.ts$/u.test(url)) {
      const path = fileURLToPath(url);
      const result = plugin.transform(readFileSync(path, 'utf8'), path);
      if (result !== null) { transformed.add(path); return { format: 'module', source: result.code, shortCircuit: true }; }
    }
    return nextLoad(url, context);
  } });
  const { Context } = await import('@deepseek-ai/cordis');
  const { default: LlmRuntime } = await import('@deepseek-ai/dsh-llm');
  const { remoteMethods } = await import('@deepseek-ai/dsh-typert-protocol');
  const { createPermissionRuntime } = await import('@dsh-base/cloudflare-worker-permissions/runtime');
  const ctx = new Context();
  let permission;
  try {
    await ctx.plugin(LlmRuntime);
    assert.deepEqual(ctx.llm.listProviders(), []);
    const names = remoteMethods(ctx.llm).map(marker => marker.exportName ?? marker.method);
    assert.ok(names.includes('listProviders'), 'bare @Remote initializer must execute');
    assert.ok(names.includes('discoverModels'), 'named @Remote initializer must execute');
    permission = await createPermissionRuntime();
    assert.equal(permission.initializeSession('build-test', null, 'read-only').snapshot.currentValue, 'read-only');
    assert.ok([...transformed].some(path => path.endsWith('/packages/llm/llm/src/index.ts')), 'test must use production transformer on exact failing upstream module');
    assert.ok([...transformed].some(path => path.endsWith('/dsh-base-cloudflare-worker-permissions/src/presets.ts')));
  } finally { await permission?.dispose(); await ctx.fiber.dispose(); hook.deregister(); }
});

test('legacy callable aliases preserve the agents descriptor ABI and comments are untouched', async () => {
  const result = plugin.transform(`import { callable as expose } from 'agents';
    export class Probe { @expose() value() { return 42; } }`, '/test/callable.ts');
  assert.ok(result);
  // Exercise the legacy decorator ABI without constructing a Cloudflare Agent
  // in Node; the real SDK remains covered by workerd acceptance.
  const code = result.code.replace(/import\s*\{[^}]+\}\s*from\s*["']agents["'];?/u, `
    function expose() { return (prototype, key, descriptor) => {
      if (typeof prototype !== 'object' || key !== 'value' || typeof descriptor.value !== 'function') throw new Error('wrong legacy ABI');
      prototype.decorated = true;
    }; }
  `);
  const { Probe } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.equal(new Probe().value(), 42);
  assert.equal(new Probe().decorated, true);
  assert.equal(plugin.transform('/** @Remote example */ export const value = "@callable()";', '/test/plain.ts'), null);
  assert.equal(plugin.transform('export default "@Remote";', '/test/file.ts?raw'), null);
  assert.throws(() => plugin.transform(`import { callable } from 'agents'; class Mixed { @callable() first() {} @Remote second() {} }`, '/test/mixed.ts'), /Cannot mix/);
});

test('deployable output syntax gate rejects leftover decorators and missing output', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-worker-syntax-'));
  try {
    assert.throws(() => checkWorkerOutput(root), /Missing Cloudflare/);
    const bundle = join(root, 'workers/default/bundle');
    mkdirSync(bundle, { recursive: true });
    const path = join(bundle, 'index.js');
    writeFileSync(path, 'export class Broken { @Remote listProviders() {} }');
    assert.throws(() => checkWorkerOutput(root), /syntax check failed/);
    writeFileSync(path, 'import "cloudflare:workers"; export default { fetch() { return new Response("ok"); } };');
    assert.equal(checkWorkerOutput(root), 1, 'parse-only gate must not execute Worker platform imports');
    mkdirSync(join(bundle, 'chunks'));
    writeFileSync(join(bundle, 'chunks/broken.mjs'), 'export const invalid = ;');
    assert.throws(() => checkWorkerOutput(root), /broken\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
