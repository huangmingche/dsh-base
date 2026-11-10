import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { addApplication } from '../add-app.mjs';
import { commandOptions, runProduct } from '../run.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-add-app-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const write = (file, value) => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); };
  write('package.json', { packageManager: 'pnpm@10.0.0' });
  write('apps/web/package.json', { name: '@dsh-base/web', version: '0.1.0', dependencies: { react: '18.3.1', '@dsh-base/build-server-dependencies': 'workspace:*' } });
  write('apps/web/index.html', '<div id="root"></div>');
  write('apps/web/deployment.example.json', { workerName: 'fixture-web', authDatabaseName: 'fixture-web-auth', filesBucket: 'fixture-web-files', authBaseUrl: 'https://web.example.com' });
  write('packages/build/dsh-base-build-server-dependencies/package.json', { dependencies: { react: '19.0.0' } });
  write('pnpm-workspace.yaml', 'packages:\n  - apps/web\n  - packages/build/dsh-base-build-server-dependencies\nstrictPeerDependencies: true\n');
  return { root, write, read: file => readFileSync(join(root, file), 'utf8') };
}

test('add-app creates thin independent entries, preserves the default and never copies business code', t => {
  const f = fixture(t);
  addApplication({ root: f.root, id: 'admin' });
  addApplication({ root: f.root, id: 'portal' });
  assert.equal(JSON.parse(f.read('dsh.apps.json')).default, 'web');
  assert.equal(JSON.parse(f.read('dsh.apps.json')).apps.length, 3);
  assert.match(f.read('apps/admin/src/client/main.tsx'), /^import '\.\.\/\.\.\/\.\.\/web\/src\/client\/main';\n$/);
  assert.match(f.read('apps/admin/src/server.ts'), /from '\.\.\/\.\.\/web\/src\/server'/);
  assert.match(f.read('apps/admin/cloudflare.config.ts'), /appRoot: fileURLToPath/);
  assert.deepEqual(JSON.parse(f.read('apps/admin/composition.profile.json')), { client: [] });
  assert.equal(JSON.parse(f.read('apps/admin/deployment.example.json')).authDatabaseId, '');
  assert.equal(JSON.parse(f.read('apps/admin/deployment.example.json')).signupEnabled, false);
  const secret = file => /^AUTH_SECRET=(.+)$/m.exec(f.read(file))[1];
  assert.notEqual(secret('apps/admin/.dev.vars'), secret('apps/portal/.dev.vars'));
  assert.equal(statSync(join(f.root, 'apps/admin/.dev.vars')).mode & 0o777, 0o600);
  assert.match(f.read('pnpm-workspace.yaml'), /apps\/admin/);
  const before = f.read('dsh.apps.json');
  assert.throws(() => addApplication({ root: f.root, id: 'admin' }), /already exists/);
  assert.equal(f.read('dsh.apps.json'), before);
});

test('add-app rejects existing directories, unsafe paths and resource collisions before registry changes', t => {
  const f = fixture(t), before = f.read('pnpm-workspace.yaml');
  f.write('apps/admin/user-file.txt', 'existing work');
  assert.throws(() => addApplication({ root: f.root, id: 'admin' }), /overwrite/);
  assert.throws(() => addApplication({ root: f.root, id: '../outside' }), /identifier/);
  assert.throws(() => addApplication({ root: f.root, id: 'portal', workerName: 'fixture-web' }), /shares/);
  symlinkSync(join(f.root, 'apps/web'), join(f.root, 'apps/alias'));
  assert.throws(() => addApplication({ root: f.root, id: 'alias' }), /overwrite|symbolic/);
  assert.equal(f.read('apps/admin/user-file.txt'), 'existing work');
  assert.equal(f.read('pnpm-workspace.yaml'), before);
});

test('runner rejects ambiguous selection and bulk development/deployment', () => {
  assert.deepEqual(commandOptions(['build', '--app', 'admin']), { command: 'build', app: 'admin', all: false });
  assert.deepEqual(commandOptions(['check', '--all']), { command: 'check', app: undefined, all: true });
  for (const args of [['build', '--all', '--app', 'web'], ['dev', '--all'], ['deploy', '--all'], ['build', '--app'], ['build', '--app', 'web', '--app', 'admin']]) assert.throws(() => commandOptions(args));
});

test('a failed metadata write restores the registry and removes empty application directories so retry succeeds', { skip: process.getuid?.() === 0 }, t => {
  const f = fixture(t), workspace = join(f.root, 'pnpm-workspace.yaml'), before = f.read('pnpm-workspace.yaml');
  chmodSync(workspace, 0o444);
  try { assert.throws(() => addApplication({ root: f.root, id: 'admin' }), /EACCES|EPERM/); }
  finally { chmodSync(workspace, 0o644); }
  assert.equal(f.read('pnpm-workspace.yaml'), before);
  assert.equal(existsSync(join(f.root, 'dsh.apps.json')), false);
  assert.equal(existsSync(join(f.root, 'apps/admin')), false);
  assert.equal(addApplication({ root: f.root, id: 'admin' }).id, 'admin');
});

test('application metadata symlinks cannot redirect writes elsewhere inside the repository', t => {
  const f = fixture(t);
  const registry = { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }] };
  f.write('other-registry.json', registry);
  symlinkSync(join(f.root, 'other-registry.json'), join(f.root, 'dsh.apps.json'));
  const before = f.read('other-registry.json');
  assert.throws(() => addApplication({ root: f.root, id: 'admin' }), /cannot traverse symbolic links/);
  assert.equal(f.read('other-registry.json'), before);
  assert.throws(() => f.read('apps/admin/src/server.ts'), /ENOENT/);
});

test('bulk commands reject process-wide deployment overrides before running any app', async t => {
  const f = fixture(t);
  await assert.rejects(runProduct(['prepare', '--all'], { DSH_PRODUCT_ROOT: f.root, DSH_DEPLOYMENT_CONFIG: 'operator.json' }), /per-application deployment/);
  await assert.rejects(runProduct(['build', '--all'], { DSH_PRODUCT_ROOT: f.root, DSH_D1_DATABASE_ID: 'shared' }), /per-application deployment/);
});
