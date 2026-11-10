import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applicationContext, cliApplication, readApplications } from '../../composition/applications.mjs';
import { buildContext, generatedPath, generatedModulePath, outputPath } from '../../build/product-paths.mjs';
import { readClientMetadataRows } from '../../composition/metadata-roster.mjs';
import { generateClientComposition } from '../../composition/client.mjs';
import { auditPacks } from '../../composition/packs.mjs';
const registry = { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'console', path: 'apps/console', platform: 'web' }] };
function fixture(t, consumer = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apps-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); return target; };
  if (consumer) { mkdirSync(join(root, '.submodules/dsh-base'), { recursive: true }); put('dsh.project.json', { version: 1, base: '.submodules/dsh-base', namespace: 'example' }); }
  return { root, put };
}
test('legacy repositories preserve web generated paths', t => {
  for (const consumer of [false, true]) {
    const { root } = fixture(t, consumer), context = buildContext(root, { env: {} });
    assert.equal(context.appId, 'web'); assert.equal(context.appRoot, join(root, 'apps/web'));
    assert.equal(generatedPath(context, 'packages/value.generated.ts'), join(root, consumer ? '.artifacts/dsh/packages/value.generated.ts' : 'packages/value.generated.ts'));
  }
});
test('selection validates explicit application and root agreement', t => {
  const { root, put } = fixture(t); put('dsh.apps.json', { ...registry, default: 'console' });
  assert.equal(applicationContext(root, { env: {} }).appId, 'console');
  assert.equal(applicationContext(root, { env: { DSH_APP: 'web' } }).appId, 'web');
  assert.equal(applicationContext(root, { app: 'web', env: { DSH_APP: 'console' } }).appId, 'web');
  assert.equal(applicationContext(root, { appRoot: join(root, 'apps/console'), env: {} }).appId, 'console');
  assert.throws(() => applicationContext(root, { app: 'web', appRoot: join(root, 'apps/console') }), /disagree/);
  assert.throws(() => applicationContext(root, { app: 'missing' }), /Unknown application/);
  assert.throws(() => applicationContext(root, { appRoot: join(root, 'apps/missing') }), /declared/);
  assert.equal(cliApplication(['--root', root, '--app', 'console']), 'console');
  assert.throws(() => cliApplication(['--app']), /requires/);
  assert.throws(() => cliApplication(['--app', 'web', '--app', 'console']), /once/);
});
test('invalid registries reject unsupported platforms, duplicates and traversal', t => {
  const { root, put } = fixture(t);
  for (const value of [null, {}, { ...registry, version: 2 }, { ...registry, apps: [] }, { ...registry, default: 'missing' }, { ...registry, extra: true }, { ...registry, apps: [registry.apps[0], registry.apps[0]] }, { ...registry, apps: [registry.apps[0], { ...registry.apps[1], path: 'apps/web' }] }, ...['native', 'desktop', undefined].map(platform => ({ ...registry, apps: [{ ...registry.apps[0], platform }] })), ...['../escape', 'apps/../escape', '/tmp/escape', 'apps/web/sub'].map(path => ({ ...registry, apps: [{ ...registry.apps[0], path }] }))]) {
    put('dsh.apps.json', value); assert.throws(() => readApplications(root), undefined, JSON.stringify(value));
  }
});
test('symlink aliases cannot mix application directories or generated roots', t => {
  const { root, put } = fixture(t, true); put('dsh.apps.json', registry);
  mkdirSync(join(root, 'apps/web'), { recursive: true }); symlinkSync(join(root, 'apps/web'), join(root, 'apps/console'));
  assert.throws(() => readApplications(root), /symbolic links/); rmSync(join(root, 'apps/console'));
  mkdirSync(join(root, '.artifacts/dsh/applications'), { recursive: true }); mkdirSync(join(root, '.artifacts/other'), { recursive: true });
  symlinkSync(join(root, '.artifacts/other'), join(root, '.artifacts/dsh/applications/console'));
  assert.throws(() => applicationContext(root, { app: 'console' }), /symbolic links/);
});
test('two apps isolate generated shared modules, entries, explicit output and type projects', t => {
  for (const consumer of [false, true]) {
    const { root, put } = fixture(t, consumer); put('dsh.apps.json', registry);
    const web = buildContext(root, { app: 'web' }), other = buildContext(root, { app: 'console' });
    assert.notEqual(web.typecheckRoot, other.typecheckRoot);
    const output = generatedPath(other, 'apps/web/src/worker/generated-composition.ts');
    assert.equal(output, join(root, '.artifacts/dsh/applications/console/apps/console/src/worker/generated-composition.ts'));
    assert.equal(generatedModulePath(other, join(other.baseRoot, 'apps/web/src/worker/generated-composition')), output);
    assert.equal(generatedModulePath(other, join(other.appRoot, 'src/worker/generated-composition')), output);
    const name = 'packages/boot/shared/src/value.generated.ts', stale = join(other.baseRoot, name);
    mkdirSync(dirname(stale), { recursive: true }); writeFileSync(stale, 'stale web output');
    assert.equal(generatedModulePath(other, stale), generatedPath(other, name));
    assert.notEqual(generatedPath(web, name), generatedPath(other, name));
    assert.throws(() => outputPath(other, name, ['--output', generatedPath(web, name)]), /own generated|read-only/);
    assert.equal(readFileSync(stale, 'utf8'), 'stale web output');
    assert.throws(() => generatedPath(other, '../escape'), /Invalid/);
  }
});
test('app profiles preserve independent pack membership and disabled modules do not import', t => {
  const { root, put } = fixture(t); put('dsh.apps.json', registry);
  const name = '@dsh-base/client-example', meta = { id: 'client:example', origin: 'custom', order: 10 };
  put('packages/client/example/package.json', { name, dsh: { client: { platform: 'web' } }, dshBase: { client: meta } });
  put('apps/web/composition.profile.json', { client: [] });
  put('apps/console/composition.profile.json', { client: [{ name, disabled: true, config: { label: 'console' } }] });
  const pack = { id: 'core', planes: { client: [name] }, requires: [], toggleable: 'none', config: {}, uninstallImpact: 'Required.', reuse: { mode: 'custom', official: [], reason: 'Fixture.' } };
  put('packs/core/pack.json', pack);
  const web = readClientMetadataRows(root, { app: 'web' }), other = readClientMetadataRows(root, { app: 'console' });
  assert.equal(web[0].disabled, undefined); assert.equal(other[0].disabled, true); assert.equal(other[0].config.label, 'console');
  assert.equal(generateClientComposition(other).includes('await import('), false);
  for (const [app, client] of [['web', web], ['console', other]]) assert.equal(auditPacks(root, { client, worker: [], agent: [] }, root, { app }).ok, true);
  put('packs/core/pack.json', { ...pack, planes: { client: [{ name, ...meta, id: 'client:wrong' }] } });
  assert.equal(auditPacks(root, { client: other, worker: [], agent: [] }, root, { app: 'console' }).ok, false);
  put('apps/console/composition.profile.json', { client: [{ name, id: 'client:wrong' }] });
  assert.throws(() => readClientMetadataRows(root, { app: 'console' }), /cannot replace metadata/);
  put('apps/console/composition.profile.json', { client: [{ name: '@deepseek-ai/official', disabled: false }] });
  assert.throws(() => readClientMetadataRows(root, { app: 'console' }), /only its own/);
});
