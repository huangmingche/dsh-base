import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { baseDependencies, planDependencyUpdate, writeDependencyUpdate } from '../dependencies.mjs';

function fixture(t, basePath = '.submodules/dsh-base') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-deps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, basePath);
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  write(join(root, 'dsh.project.json'), { version: 1, base: basePath, namespace: 'fixture' });
  write(join(base, 'package.json'), { packageManager: 'pnpm@12.16.1' });
  const appPath = join(base, 'apps/web/package.json');
  const serverPath = join(base, 'packages/build/dsh-base-build-server-dependencies/package.json');
  write(appPath, { dependencies: { react: '18.3.1', '@dsh-base/build-server-dependencies': 'workspace:*' }, devDependencies: { typescript: '5.9.3' } });
  write(serverPath, { dependencies: { react: '19.3.1' } });
  write(join(base, 'pnpm-workspace.yaml'), 'packages:\n  - apps/web\n  - packages/build/dsh-base-build-server-dependencies\nstrictPeerDependencies: true\n');
  const contract = baseDependencies(base, 'fixture');
  write(join(root, 'dsh.dependencies.json'), contract);
  write(join(root, 'package.json'), { name: '@fixture/root', packageManager: contract.packageManager });
  write(join(root, 'apps/web/package.json'), { ...contract.app, dependencies: { ...contract.app.dependencies, 'product-only': '1.0.0' } });
  write(join(root, 'packages/build/product-server-dependencies/package.json'), contract.server);
  write(join(root, 'pnpm-workspace.yaml'), contract.workspace);
  return { root, base, write, appPath, serverPath, contract };
}

test('base upgrades synchronize inherited dependencies and preserve product additions and peer isolation', t => {
  const f = fixture(t);
  assert.equal(planDependencyUpdate(f.root, f.base, 'fixture').changed, false);
  f.write(f.appPath, { dependencies: { react: '18.4.0', '@dsh-base/build-server-dependencies': 'workspace:*', 'new-base-dependency': '2.0.0' }, devDependencies: { typescript: '6.0.0' } });
  const plan = planDependencyUpdate(f.root, f.base, 'fixture');
  assert.equal(plan.changed, true);
  writeDependencyUpdate(f.root, plan);
  const actual = JSON.parse(readFileSync(join(f.root, 'apps/web/package.json'), 'utf8'));
  assert.equal(actual.dependencies.react, '18.4.0');
  assert.equal(actual.dependencies['product-only'], '1.0.0');
  assert.equal(actual.dependencies['new-base-dependency'], '2.0.0');
  assert.equal(actual.dependencies['@fixture/build-server-dependencies'], 'workspace:*');
  assert.equal(actual.dependencies['@dsh-base/build-server-dependencies'], undefined);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'packages/build/product-server-dependencies/package.json'), 'utf8')).dependencies.react, '19.3.1');
});

test('conflicting product edits fail before changing manifests', t => {
  const f = fixture(t);
  const path = join(f.root, 'apps/web/package.json');
  const app = JSON.parse(readFileSync(path, 'utf8'));
  app.dependencies.react = 'custom-version';
  f.write(path, app);
  assert.throws(() => planDependencyUpdate(f.root, f.base, 'fixture'), /reconcile/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).dependencies.react, 'custom-version');
});

test('all dependency writes are validated before any output can reach a base symlink', t => {
  const f = fixture(t);
  const plan = planDependencyUpdate(f.root, f.base, 'fixture');
  const before = readFileSync(f.appPath, 'utf8');
  const path = join(f.root, 'apps/web/package.json');
  rmSync(path);
  symlinkSync(f.appPath, path);
  assert.throws(() => writeDependencyUpdate(f.root, plan), /read-only|outside|base|output/);
  assert.equal(readFileSync(f.appPath, 'utf8'), before);
  assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), JSON.stringify({ name: '@fixture/root', packageManager: f.contract.packageManager }));
});

test('all application dependencies update while preserving each application additions', t => {
  const f = fixture(t);
  const registry = { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] };
  f.write(join(f.root, 'dsh.apps.json'), registry);
  f.write(join(f.root, 'apps/admin/package.json'), { ...f.contract.app, dependencies: { ...f.contract.app.dependencies, 'admin-only': '7.0.0' } });
  f.write(f.appPath, { dependencies: { react: '18.4.0' }, devDependencies: { typescript: '6.0.0' } });
  const plan = planDependencyUpdate(f.root, f.base, 'fixture');
  writeDependencyUpdate(f.root, plan);
  const admin = JSON.parse(readFileSync(join(f.root, 'apps/admin/package.json'), 'utf8'));
  assert.equal(admin.dependencies.react, '18.4.0');
  assert.equal(admin.dependencies['admin-only'], '7.0.0');
  const workspace = readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspace, /  - apps\/web\n  - apps\/admin\n/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'dsh.dependencies.json'), 'utf8')), baseDependencies(f.base, 'fixture', registry));
});

test('a conflict in a second app prevents every dependency write', t => {
  const f = fixture(t);
  f.write(join(f.root, 'dsh.apps.json'), { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] });
  f.write(join(f.root, 'apps/admin/package.json'), { ...f.contract.app, dependencies: { ...f.contract.app.dependencies, react: 'local-edit' } });
  const before = readFileSync(join(f.root, 'apps/web/package.json'), 'utf8');
  assert.throws(() => planDependencyUpdate(f.root, f.base, 'fixture'), /apps\/admin\/package.json.*reconcile/);
  assert.equal(readFileSync(join(f.root, 'apps/web/package.json'), 'utf8'), before);
});

for (const patchName of ['patches/example.patch', '.submodules/deepseek-harness/patches/@example__lib@1.0.0.patch']) {
  test(`pnpm installs inherited ${patchName} from a custom base path and reuses the frozen product lockfile`, t => {
    const f = fixture(t, 'vendor/platform');
    // A local tarball lets this exercise the real pnpm patcher without network access.
    const pkg = join(f.root, 'tarball/package');
    f.write(join(pkg, 'package.json'), { name: 'example-lib', version: '1.0.0', main: 'index.js' });
    f.write(join(pkg, 'index.js'), 'module.exports = 1;\n');
    execFileSync('tar', ['-czf', join(f.root, 'example-lib.tgz'), '-C', dirname(pkg), 'package']);
    const patch = 'diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n';
    f.write(join(f.base, patchName), patch);
    const sourceWorkspace = `packages:\n  - apps/web\npatchedDependencies:\n  "example-lib@1.0.0": ${patchName}\nstoreDir: .pnpm-store\n`;
    f.write(join(f.base, 'pnpm-workspace.yaml'), sourceWorkspace);
    const registry = { apps: [{ path: 'apps/web' }, { path: 'apps/admin' }] };
    const contract = baseDependencies(f.base, 'fixture', registry, f.root);
    f.write(join(f.root, 'pnpm-workspace.yaml'), contract.workspace);
    f.write(join(f.root, 'package.json'), { name: 'patch-consumer', private: true });
    f.write(join(f.root, 'packages/build/product-server-dependencies/package.json'), { name: '@fixture/build-server-dependencies', private: true });
    for (const app of registry.apps) {
      f.write(join(f.root, app.path, 'package.json'), { name: app.path.split('/')[1], dependencies: { 'example-lib': 'file:../../example-lib.tgz' } });
    }
    const install = flag => execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', flag], { cwd: f.root, encoding: 'utf8', stdio: 'pipe' });
    install('--no-frozen-lockfile');
    const lock = readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8');
    assert.ok(contract.workspace.includes('vendor/platform/' + patchName));
    assert.match(lock, /example-lib@1\.0\.0: [a-f0-9]{64}/);
    for (const location of ['node_modules', ...registry.apps.map(app => app.path + '/node_modules')]) rmSync(join(f.root, location), { recursive: true, force: true });
    install('--frozen-lockfile');
    for (const app of registry.apps) {
      assert.equal(readFileSync(join(f.root, app.path, 'node_modules/example-lib/index.js'), 'utf8'), 'module.exports = 2;\n');
    }
    assert.equal(readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8'), lock);
    assert.equal(readFileSync(join(f.base, 'pnpm-workspace.yaml'), 'utf8'), sourceWorkspace);
    assert.equal(readFileSync(join(f.base, patchName), 'utf8'), patch);
  });
}

test('rejects a patch symlink escaping the pinned base before dependency synchronization', t => {
  const f = fixture(t);
  mkdirSync(join(f.base, 'patches'));
  symlinkSync(join(f.root, 'package.json'), join(f.base, 'patches/plugin.patch'));
  f.write(join(f.base, 'pnpm-workspace.yaml'), 'packages:\n  - apps/web\npatchedDependencies:\n  example: patches/plugin.patch\n');
  assert.throws(() => planDependencyUpdate(f.root, f.base, 'fixture'), /regular patch in the pinned base/);
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), f.contract.workspace);
});
