import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { developmentWorkerOverrides, selectDevelopmentDate } from '../src/development.mjs';
import { dshSource, defineDshViteConfig } from '../src/vite.mjs';
import { createDshCloudflareConfig } from '../src/cloudflare.mjs';
import { buildContext, generatedModulePath, generatedPath, outputPath } from '../../../../scripts/build/product-paths.mjs';
import { prepareProductPublic } from '../../../../scripts/build/prepare-public.mjs';
import { fileURLToPath } from 'node:url';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-build-product-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  write('dsh.project.json', { version: 1, base: '.submodules/dsh-base', namespace: 'test-product' });
  write('.submodules/dsh-base/package.json', { name: '@dsh-base/root' });
  write('apps/web/package.json', { name: '@test-product/web', version: '1.0.0' });
  return { root, write, context: buildContext(root) };
}

test('consumer source resolver loads product scope exports and redirects only deployment-generated data', async t => {
  const { root, write, context } = fixture(t);
  write('packages/client/demo/package.json', { name: '@test-product/client-demo', exports: { './client': './src/client.ts' } });
  const productEntry = write('packages/client/demo/src/client.ts', 'export default {};');
  const baseSource = write('.submodules/dsh-base/packages/client/base/src/index.ts', '');
  write('.submodules/dsh-base/packages/client/base/src/owned.generated.ts', 'stale');
  write('.submodules/dsh-base/packages/client/base/package.json', { name: '@dsh-base/client-generated-fixture', exports: { './generated': './src/owned.generated.ts' } });
  const generated = write('.artifacts/dsh/packages/client/base/src/owned.generated.ts', 'fresh');
  const plugin = dshSource({ productRoot: root });
  assert.equal(await plugin.resolveId.call({}, '@test-product/client-demo/client'), productEntry);
  assert.equal(await plugin.resolveId.call({}, './owned.generated.ts', baseSource), generated);
  assert.equal(await plugin.resolveId.call({}, '@dsh-base/client-generated-fixture/generated', baseSource), generated);
  rmSync(join(root, '.submodules/dsh-base/packages/client/base/src/owned.generated.ts'));
  assert.equal(await plugin.resolveId.call({}, '@dsh-base/client-generated-fixture/generated', baseSource), generated);
  const upstreamGenerated = join(context.upstreamRoot, 'packages/util/official-bundles/src/catalog.generated.ts');
  assert.equal(generatedModulePath(context, upstreamGenerated), undefined);
  assert.equal(generatedModulePath(context, generated), undefined);
  assert.equal(generatedModulePath(context, join(root, 'packages/client/demo/src/own.generated.ts')), undefined);
  let dependencyAnchor;
  await plugin.resolveId.call({ resolve(id, importer) { dependencyAnchor = importer; return { id }; } }, 'react', baseSource);
  assert.equal(dependencyAnchor, join(root, 'apps/web/package.json'));
});

test('consumer generated outputs reject child symlinks into the base and explicit escaping outputs', t => {
  const { root, context } = fixture(t);
  mkdirSync(join(context.generatedRoot, 'packages'), { recursive: true });
  symlinkSync(context.baseRoot, join(context.generatedRoot, 'packages/escape'), 'dir');
  assert.throws(() => generatedPath(root, 'packages/escape/generated.ts'), /read-only|escapes/);
  assert.throws(() => outputPath(root, 'safe.ts', ['--output', join(context.baseRoot, 'bad.ts')]), /read-only|escapes/);
  symlinkSync(join(root, 'apps'), join(context.generatedRoot, 'outside-output'), 'dir');
  assert.throws(() => generatedPath(root, 'outside-output/generated.ts'), /escapes/);
  mkdirSync(join(context.generatedRoot, '.artifacts'));
  symlinkSync(join(root, 'apps'), join(context.generatedRoot, '.artifacts/typecheck'), 'dir');
  assert.throws(() => buildContext(root), /escapes/);
});

test('Cloudflare configuration uses explicit product deployment identity', t => {
  const { root, write } = fixture(t);
  write('apps/web/deployment.local.json', { workerName: 'consumer-app', authDatabaseName: 'consumer-auth', filesBucket: 'consumer-files', brandName: 'Consumer' });
  const bindings = new Proxy({}, { get: (_, type) => value => ({ type, value }) });
  const config = createDshCloudflareConfig({ bindings, exports: bindings, defineConfig: value => value }, { productRoot: root });
  assert.equal(config.worker.name, 'consumer-app');
  assert.equal(config.worker.env.SITE_BRAND_NAME.value, 'Consumer');
  assert.equal(config.worker.entrypoint, 'src/server.ts');
});

function addApplications(write) {
  write('dsh.apps.json', { version: 1, default: 'web', apps: [
    { id: 'web', path: 'apps/web', platform: 'web' },
    { id: 'admin', path: 'apps/admin', platform: 'web' },
  ] });
  write('apps/admin/package.json', { name: '@test-product/admin', version: '1.0.0' });
}

test('a registered app resolves dependencies and generated modules within its own application', async t => {
  const { root, write } = fixture(t);
  addApplications(write);
  const baseSource = write('.submodules/dsh-base/apps/web/src/worker/index.ts', '');
  const adminGenerated = write('.artifacts/dsh/applications/admin/apps/admin/src/worker/generated-composition.ts', 'admin');
  write('.artifacts/dsh/apps/web/src/worker/generated-composition.ts', 'web');
  const plugin = dshSource({ productRoot: root, appRoot: join(root, 'apps/admin') });
  assert.equal(await plugin.resolveId.call({}, './generated-composition', baseSource), adminGenerated);
  let anchor;
  await plugin.resolveId.call({ resolve(id, importer) { anchor = importer; return { id }; } }, 'react', baseSource);
  assert.equal(anchor, join(root, 'apps/admin/package.json'));
  const baseClient = write('.submodules/dsh-base/apps/web/src/client/main.tsx', '');
  await plugin.resolveId.call({ resolve(id, importer) { anchor = importer; return { id }; } }, 'react', baseClient);
  assert.equal(anchor, join(root, 'apps/admin/package.json'));
  const baseSeo = write('.submodules/dsh-base/packages/boot/site-seo/src/index.ts', '');
  assert.equal(await plugin.resolveId.call({}, './assets.generated.ts', baseSeo), join(root, '.artifacts/dsh/applications/admin/packages/boot/site-seo/src/assets.generated.ts'));
  assert.throws(() => dshSource({ productRoot: root, app: 'web', appRoot: join(root, 'apps/admin') }), /app|application/i);
  assert.throws(() => dshSource({ productRoot: root, appRoot: join(root, 'apps/unregistered') }), /app|application/i);
});

test('Cloudflare configuration selects the registered application deployment and never its sibling', t => {
  const { root, write } = fixture(t);
  addApplications(write);
  write('apps/web/deployment.local.json', { workerName: 'web-app', authDatabaseName: 'web-auth', filesBucket: 'web-files', brandName: 'Web', authBaseUrl: 'https://web.example.com' });
  write('apps/admin/deployment.example.json', { workerName: 'admin-app', authDatabaseName: 'admin-auth', filesBucket: 'admin-files', brandName: 'Admin', authBaseUrl: 'https://admin.example.com' });
  const bindings = new Proxy({}, { get: (_, type) => value => ({ type, value }) });
  const config = createDshCloudflareConfig({ bindings, exports: bindings, defineConfig: value => value }, { productRoot: root, app: 'admin' });
  assert.equal(config.worker.name, 'admin-app');
  assert.equal(config.worker.env.SITE_BRAND_NAME.value, 'Admin');
  assert.equal(config.worker.env.AUTH_DB.value.name, 'admin-auth');
  assert.equal(config.worker.env.FILES.value.name, 'admin-files');
});

test('the original web Cloudflare entry validates sibling resource isolation when a second app is registered', t => {
  const { root, write } = fixture(t);
  rmSync(join(root, 'dsh.project.json'));
  addApplications(write);
  const web = { workerName: 'web-app', authDatabaseName: 'web-auth', filesBucket: 'web-files', brandName: 'Web', authBaseUrl: 'https://web.example.com' };
  const admin = { workerName: 'admin-app', authDatabaseName: 'admin-auth', filesBucket: 'admin-files', brandName: 'Admin', authBaseUrl: 'https://admin.example.com' };
  write('apps/web/deployment.example.json', web);
  write('apps/admin/deployment.example.json', admin);
  const bindings = new Proxy({}, { get: (_, type) => value => ({ type, value }) });
  const config = () => createDshCloudflareConfig({ bindings, exports: bindings, defineConfig: value => value }, { productRoot: root });
  assert.equal(config().worker.name, 'web-app');
  for (const key of ['workerName', 'authDatabaseName', 'filesBucket', 'authBaseUrl']) {
    write('apps/admin/deployment.example.json', { ...admin, [key]: web[key] });
    assert.throws(config, new RegExp(`shares ${key} with admin`));
  }
});

test('Vite uses the selected application for generated assets, compiler settings and dependency resolution', async t => {
  const { root, write } = fixture(t);
  addApplications(write);
  write('.submodules/dsh-base/dsh-source.lock.json', { tag: 'dsh-v0.2.2-rc.1', commit: 'fixed-release', repository: 'https://github.com/deepseek-ai/deepseek-harness.git' });
  write('.submodules/dsh-base/.submodules/deepseek-harness/packages/client/ui-sidebar-documentpreview/licenses/FortuneSheet.txt', 'Fixture dependency notice');
  symlinkSync(fileURLToPath(new URL('../../../../apps/web/node_modules', import.meta.url)), join(root, 'apps/admin/node_modules'), 'dir');
  const configure = await defineDshViteConfig({ productRoot: root, appRoot: join(root, 'apps/admin') });
  const config = configure({ command: 'build', mode: 'production' });
  const context = buildContext(root, { app: 'admin' });
  assert.equal(config.root, context.appRoot);
  assert.equal(config.publicDir, join(context.generatedRoot, 'apps/admin/public'));
  assert.equal(config.tsconfig, join(context.typecheckRoot, 'client.json'));
  assert.equal(config.environments.worker.optimizeDeps.rolldownOptions.tsconfig, join(context.typecheckRoot, 'worker.json'));
});

test('public asset preparation rejects input aliases before deleting a successful application build', t => {
  const { root, write } = fixture(t);
  addApplications(write);
  const context = buildContext(root, { app: 'admin' });
  const target = generatedPath(context, 'apps/admin/public');
  const sentinel = write(join('.artifacts/dsh/applications/admin/apps/admin/public', 'sentinel'), 'keep');
  symlinkSync(target, join(root, 'apps/admin/public'), 'dir');
  assert.throws(() => prepareProductPublic(root, { app: 'admin' }), /symbolic|overlap/);
  assert.equal(realpathSync(sentinel), sentinel);
});

test('development date follows installed support while production ignores local overrides', () => {
  const dates = { productionDate: '2026-11-06', supportedDate: '2026-10-23' };
  assert.equal(selectDevelopmentDate({ ...dates, command: 'serve' }), '2026-10-23');
  assert.equal(selectDevelopmentDate({ ...dates, supportedDate: '2026-12-01', command: 'serve' }), '2026-11-06');
  assert.equal(selectDevelopmentDate({ ...dates, command: 'serve', override: '2026-10-30' }), '2026-10-30');
  assert.equal(selectDevelopmentDate({ ...dates, command: 'build', override: 'not-a-date' }), undefined);
  assert.throws(() => selectDevelopmentDate({ ...dates, command: 'serve', override: '2026-02-31' }), /valid/);
  assert.throws(() => selectDevelopmentDate({ productionDate: dates.productionDate, command: 'serve' }), /explicitly/);
});

test('only development auth origin reads local configuration; production and feature flags do not', t => {
  const { root, write } = fixture(t);
  const app = join(root, 'apps/web');
  write('apps/web/.dev.vars', 'AUTH_BASE_URL="http://localhost:5173"\nAUTH_SIGNUP_ENABLED=true\nPLATFORM_AI_ENABLED=true\n');
  const options = { command: 'serve', consumer: true, compatibilityDate: '2026-10-23' };
  assert.deepEqual(developmentWorkerOverrides(app, options), {
    compatibilityDate: '2026-10-23', env: { AUTH_BASE_URL: { type: 'text', value: 'http://localhost:5173' } },
  });
  write('apps/web/.dev.vars.preview', 'AUTH_BASE_URL=http://localhost:5199');
  assert.equal(developmentWorkerOverrides(app, { ...options, mode: 'preview' }).env.AUTH_BASE_URL.value, 'http://localhost:5199');
  write('apps/web/.dev.vars', 'AUTH_BASE_URL=not-a-url');
  assert.equal(developmentWorkerOverrides(app, { ...options, command: 'build' }), undefined);
  assert.throws(() => developmentWorkerOverrides(app, options), /Invalid URL/);
  assert.deepEqual(developmentWorkerOverrides(app, { ...options, consumer: false }), { compatibilityDate: '2026-10-23' });
});
