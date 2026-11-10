import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { baseDependencies, migratePreparedPatches } from '../dependencies.mjs';
import { addApplication } from '../add-app.mjs';

const updateScript = fileURLToPath(new URL('../update.mjs', import.meta.url));
const sourceInitScript = fileURLToPath(new URL('../source-init.mjs', import.meta.url));
const testEnv = {
  ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Local fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Local fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
delete testEnv.DSH_PRODUCT_ROOT;
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: testEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
};
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const commit = cwd => { git(cwd, 'add', '--all'); git(cwd, 'commit', '-qm', 'Fixture version'); return git(cwd, 'rev-parse', 'HEAD'); };

/** Only temporary local repositories are fetched, including the fake official source. */
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-product-update-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const officialRemote = join(directory, 'official-remote');
  const baseRemote = join(directory, 'base-remote');
  const product = join(directory, 'product');
  for (const path of [officialRemote, baseRemote, product]) {
    mkdirSync(path);
    git(path, 'init', '-q', '-b', 'main');
  }
  write(join(officialRemote, 'source.txt'), 'Official fixture release one\n');
  const officialV1 = commit(officialRemote);
  git(officialRemote, 'tag', 'dsh-v1.0.0');
  write(join(officialRemote, 'source.txt'), 'Official fixture release two\n');
  const officialPatch = 'patches/@vendor__view@2.0.0.patch';
  write(join(officialRemote, officialPatch), 'fixture official patch for prepare-only\n');
  const officialV2 = commit(officialRemote);
  git(officialRemote, 'tag', 'dsh-v1.1.0');
  git(baseRemote, 'submodule', 'add', '-q', officialRemote, '.submodules/deepseek-harness');
  const nested = join(baseRemote, '.submodules/deepseek-harness');
  const setBase = (version, officialCommit, tag) => {
    git(nested, 'checkout', '-q', '--detach', officialCommit);
    write(join(baseRemote, 'dsh-source.lock.json'), {
      repository: 'https://github.com/deepseek-ai/deepseek-harness.git', referencePath: '.submodules/deepseek-harness',
      tag, commit: officialCommit, tree: git(nested, 'rev-parse', 'HEAD^{tree}'),
    });
    write(join(baseRemote, 'package.json'), { name: '@dsh-base/root', packageManager: `pnpm@10.${version}.0` });
    write(join(baseRemote, 'apps/web/package.json'), { name: '@dsh-base/web', dependencies: { '@dsh-base/build-server-dependencies': 'workspace:*', shared: `${version}.0.0` }, devDependencies: { compiler: `${version}.0.0` } });
    write(join(baseRemote, 'apps/web/index.html'), '<div id="root"></div>');
    write(join(baseRemote, 'packages/build/dsh-base-build-server-dependencies/package.json'), { name: '@dsh-base/build-server-dependencies', dependencies: { server: `${version}.0.0` } });
    const patchPolicy = version === 1 ? '' : `patchedDependencies:\n  "shared@2.0.0": patches/shared.patch\n  "@vendor/view@2.0.0": .submodules/deepseek-harness/${officialPatch}\n`;
    write(join(baseRemote, 'pnpm-workspace.yaml'), 'packages:\n  - apps/web\n  - packages/build/dsh-base-build-server-dependencies\nstrictPeerDependencies: true\n' + patchPolicy);
    if (patchPolicy) write(join(baseRemote, 'patches/shared.patch'), 'fixture patch for prepare-only\n');
  };
  setBase(1, officialV1, 'dsh-v1.0.0');
  const baseV1 = commit(baseRemote);
  git(baseRemote, 'tag', 'base-v1');
  setBase(2, officialV2, 'dsh-v1.1.0');
  const baseV2 = commit(baseRemote);
  git(baseRemote, 'tag', 'base-v2');
  write(join(baseRemote, 'dsh-source.lock.json'), { ...read(join(baseRemote, 'dsh-source.lock.json')), tree: 'c'.repeat(40) });
  const invalidBase = commit(baseRemote);
  git(baseRemote, 'tag', 'base-invalid');
  git(baseRemote, 'checkout', '-q', '--detach', baseV2);
  write(join(baseRemote, 'apps/web/package.json'), { ...read(join(baseRemote, 'apps/web/package.json')), dependencies: { shared: '2.0.0', 'business-only': '9.0.0' } });
  commit(baseRemote);
  git(baseRemote, 'tag', 'base-conflicting');
  git(baseRemote, 'checkout', '-q', '--detach', baseV2);

  git(product, 'submodule', 'add', '-q', baseRemote, '.submodules/dsh-base');
  const base = join(product, '.submodules/dsh-base');
  git(base, 'checkout', '-q', '--detach', baseV1);
  git(base, 'submodule', 'update', '--init', '--recursive');
  const upstream = join(base, '.submodules/deepseek-harness');
  const contract = baseDependencies(base, 'my-product');
  write(join(product, 'dsh.project.json'), { version: 1, base: '.submodules/dsh-base', namespace: 'my-product' });
  write(join(product, 'dsh.dependencies.json'), contract);
  write(join(product, 'package.json'), { name: '@my-product/root', packageManager: contract.packageManager, scripts: { 'test:business': 'echo business' } });
  write(join(product, 'apps/web/package.json'), { name: '@my-product/web', ...contract.app, dependencies: { ...contract.app.dependencies, 'business-only': '3.0.0' } });
  write(join(product, 'packages/build/product-server-dependencies/package.json'), { name: '@my-product/build-server-dependencies', ...contract.server, dependencies: { ...contract.server.dependencies, 'business-server': '4.0.0' } });
  write(join(product, 'pnpm-workspace.yaml'), contract.workspace);
  write(join(product, 'pnpm-lock.yaml'), '# Fixture lockfile: prepare-only does not install dependencies.\n');
  commit(product);
  const invoke = (script, args = [], environment = {}) => spawnSync(process.execPath, [script, ...args], { cwd: product, env: { ...testEnv, DSH_PRODUCT_ROOT: product, ...environment }, encoding: 'utf8', timeout: 30_000 });
  const update = (ref = 'base-v2') => invoke(updateScript, ['--ref', ref, '--prepare-only']);
  const files = ['package.json', 'apps/web/package.json', 'packages/build/product-server-dependencies/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'dsh.dependencies.json'];
  const manifests = () => Object.fromEntries(files.map(file => [file, readFileSync(join(product, file), 'utf8')]));
  return { directory, product, base, upstream, baseRemote, officialRemote, baseV1, baseV2, invalidBase, officialV1, officialV2, update, invoke, manifests };
}

const diagnostic = result => `${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`;
const currentLink = root => git(root, 'ls-files', '--stage', '--', '.submodules/dsh-base').split(' ')[1];

test('--prepare-only updates the exact base and official pins and preserves business dependencies', t => {
  const f = fixture(t), before = f.manifests();
  const result = f.update();
  assert.equal(result.status, 0, diagnostic(result));
  assert.match(result.stdout, /install and build verification are still required/);
  assert.equal(currentLink(f.product), f.baseV2);
  assert.equal(git(f.base, 'rev-parse', 'HEAD'), f.baseV2);
  assert.equal(git(f.upstream, 'rev-parse', 'HEAD'), f.officialV2);
  const lock = read(join(f.base, 'dsh-source.lock.json'));
  assert.equal(git(f.upstream, 'rev-parse', `refs/tags/${lock.tag}^{commit}`), lock.commit);
  assert.equal(git(f.upstream, 'rev-parse', 'HEAD^{tree}'), lock.tree);
  const app = read(join(f.product, 'apps/web/package.json'));
  assert.equal(app.dependencies.shared, '2.0.0');
  assert.equal(app.dependencies['business-only'], '3.0.0');
  assert.equal(app.dependencies['@my-product/build-server-dependencies'], 'workspace:*');
  assert.equal(app.dependencies['@dsh-base/build-server-dependencies'], undefined);
  assert.equal(app.devDependencies.compiler, '2.0.0');
  const server = read(join(f.product, 'packages/build/product-server-dependencies/package.json'));
  assert.deepEqual(server.dependencies, { server: '2.0.0', 'business-server': '4.0.0' });
  assert.equal(read(join(f.product, 'package.json')).packageManager, 'pnpm@10.2.0');
  assert.equal(f.manifests()['pnpm-lock.yaml'], before['pnpm-lock.yaml']);
  assert.deepEqual(read(join(f.product, 'dsh.dependencies.json')), baseDependencies(f.base, 'my-product', undefined, f.product));
  assert.match(f.manifests()['pnpm-workspace.yaml'], /\.submodules\/dsh-base\/patches\/shared\.patch/);
  assert.ok(f.manifests()['pnpm-workspace.yaml'].includes('.submodules/dsh-base/.submodules/deepseek-harness/patches/@vendor__view@2.0.0.patch'));
  assert.equal(git(f.base, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(f.upstream, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('products prepared by an older updater can migrate patch paths without replacing local policy', t => {
  const f = fixture(t);
  assert.equal(f.update().status, 0);
  const prepared = f.manifests();
  // This is the base-relative projection used by the pre-patch-path updater.
  const legacy = baseDependencies(f.base, 'my-product');
  write(join(f.product, 'dsh.dependencies.json'), legacy);
  write(join(f.product, 'pnpm-workspace.yaml'), legacy.workspace + 'localSetting: true\n');
  assert.throws(() => migratePreparedPatches(f.product), /reconcile local edits/);
  write(join(f.product, 'pnpm-workspace.yaml'), legacy.workspace);
  migratePreparedPatches(f.product);
  migratePreparedPatches(f.product);
  assert.deepEqual(f.manifests(), prepared);
  assert.equal(git(f.base, 'status', '--porcelain'), '');
});

test('source initialization fetches only a missing recorded official release tag from the local remote', t => {
  const f = fixture(t);
  git(f.upstream, 'tag', '-d', 'dsh-v1.0.0');
  const result = f.invoke(sourceInitScript);
  assert.equal(result.status, 0, diagnostic(result));
  assert.equal(git(f.upstream, 'rev-parse', 'refs/tags/dsh-v1.0.0^{commit}'), f.officialV1);
  assert.equal(git(f.upstream, 'rev-parse', 'HEAD'), f.officialV1);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(git(f.product, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('updates reject dirty product and dirty base checkouts before changing either pin', t => {
  const f = fixture(t), before = f.manifests();
  write(join(f.product, 'untracked-product.txt'), 'local work\n');
  let result = f.update();
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /Commit or save product changes/);
  rmSync(join(f.product, 'untracked-product.txt'));
  write(join(f.base, 'untracked-base.txt'), 'local work\n');
  result = f.update();
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /clean read-only submodules/);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(git(f.base, 'rev-parse', 'HEAD'), f.baseV1);
  assert.deepEqual(f.manifests(), before);
});

for (const [ref, reason] of [['base-invalid', /nested official source does not match/], ['base-conflicting', /product changed dependencies.business-only/]]) {
  test(`a rejected ${ref} candidate restores the prior gitlink, nested source and manifests`, t => {
    const f = fixture(t), before = f.manifests();
    const result = f.update(ref);
    assert.notEqual(result.status, 0);
    assert.match(diagnostic(result), /rolled back/);
    assert.match(diagnostic(result), reason);
    assert.equal(currentLink(f.product), f.baseV1);
    assert.equal(git(f.base, 'rev-parse', 'HEAD'), f.baseV1);
    assert.equal(git(f.upstream, 'rev-parse', 'HEAD'), f.officialV1);
    assert.deepEqual(f.manifests(), before);
    assert.equal(git(f.product, 'status', '--porcelain', '--untracked-files=all'), '');
  });
}

test('a failed dependency install restores manifests already updated and the previous lockfile', t => {
  const f = fixture(t), before = f.manifests();
  const bin = join(f.directory, 'fake-bin');
  write(join(bin, 'pnpm'), '#!/bin/sh\nprintf "failed install lockfile\\n" > pnpm-lock.yaml\nexit 23\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const result = f.invoke(updateScript, ['--ref', 'base-v2'], { PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /rolled back/);
  assert.match(diagnostic(result), /Upgrade verification failed: pnpm install/);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(git(f.base, 'rev-parse', 'HEAD'), f.baseV1);
  assert.equal(git(f.upstream, 'rev-parse', 'HEAD'), f.officialV1);
  assert.deepEqual(f.manifests(), before);
  assert.equal(git(f.product, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('a committed product manifest symlink into the base is rejected without modifying the dependency', t => {
  const f = fixture(t);
  const target = join(f.base, 'apps/web/package.json');
  const contents = readFileSync(target, 'utf8');
  rmSync(join(f.product, 'apps/web/package.json'));
  symlinkSync(target, join(f.product, 'apps/web/package.json'));
  commit(f.product);
  const result = f.update();
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /read-only dependency/);
  assert.equal(readFileSync(target, 'utf8'), contents);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(git(f.base, 'rev-parse', 'HEAD'), f.baseV1);
  assert.equal(git(f.base, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('rollback refuses a manifest symlink retargeted into the base by a failing installer', t => {
  const f = fixture(t);
  const before = readFileSync(join(f.base, 'apps/web/package.json'), 'utf8');
  const bin = join(f.directory, 'fake-bin');
  write(join(bin, 'pnpm'), '#!/bin/sh\nrm apps/web/package.json\nln -s ../../.submodules/dsh-base/apps/web/package.json apps/web/package.json\nexit 23\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const result = f.invoke(updateScript, ['--ref', 'base-v2'], { PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /automatic rollback could not safely finish/);
  assert.match(diagnostic(result), /read-only dependency/);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(readFileSync(join(f.base, 'apps/web/package.json'), 'utf8'), before);
  assert.equal(git(f.base, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(f.upstream, 'status', '--porcelain', '--untracked-files=all'), '');
});

function addAdminApplication(f) {
  const registry = { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] };
  write(join(f.product, 'dsh.apps.json'), registry);
  const contract = baseDependencies(f.base, 'my-product', registry);
  write(join(f.product, 'dsh.dependencies.json'), contract);
  write(join(f.product, 'pnpm-workspace.yaml'), contract.workspace);
  write(join(f.product, 'apps/admin/package.json'), { name: '@my-product/admin', ...contract.app, dependencies: { ...contract.app.dependencies, 'admin-specific': '5.0.0' } });
  commit(f.product);
}

test('upgrading a multi-app product updates all manifests without losing app-specific dependencies', t => {
  const f = fixture(t);
  addAdminApplication(f);
  const result = f.update();
  assert.equal(result.status, 0, diagnostic(result));
  const admin = read(join(f.product, 'apps/admin/package.json'));
  assert.equal(admin.dependencies.shared, '2.0.0');
  assert.equal(admin.dependencies['admin-specific'], '5.0.0');
  assert.equal(read(join(f.product, 'apps/web/package.json')).dependencies['business-only'], '3.0.0');
  assert.match(readFileSync(join(f.product, 'pnpm-workspace.yaml'), 'utf8'), /apps\/admin/);
});

test('a multi-app build failure restores every app manifest and verifies with --all', t => {
  const f = fixture(t);
  addAdminApplication(f);
  const before = f.manifests(), adminBefore = readFileSync(join(f.product, 'apps/admin/package.json'), 'utf8');
  const bin = join(f.directory, 'fake-bin');
  write(join(bin, 'pnpm'), '#!/bin/sh\nif [ "$1" = "install" ]; then exit 0; fi\nif [ "$1 $2 $3" != "run build --all" ]; then exit 99; fi\nprintf "changed by build\\n" > apps/admin/package.json\nexit 23\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const result = f.invoke(updateScript, ['--ref', 'base-v2'], { PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(diagnostic(result), /Upgrade verification failed: pnpm run build --all/);
  assert.equal(currentLink(f.product), f.baseV1);
  assert.equal(readFileSync(join(f.product, 'apps/admin/package.json'), 'utf8'), adminBefore);
  assert.deepEqual(f.manifests(), before);
  assert.equal(git(f.product, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('adding an app to a pinned consumer keeps both dependencies clean and updates only outer-owned files', t => {
  const f = fixture(t);
  write(join(f.product, 'apps/web/deployment.example.json'), { workerName: 'fixture-web', authDatabaseName: 'fixture-auth', filesBucket: 'fixture-files', authBaseUrl: 'https://fixture.example.com' });
  const result = addApplication({ root: f.product, id: 'admin' });
  assert.equal(result.appPath, 'apps/admin');
  assert.equal(read(join(f.product, 'apps/admin/package.json')).dependencies['@my-product/build-server-dependencies'], 'workspace:*');
  assert.match(readFileSync(join(f.product, 'apps/admin/src/server.ts'), 'utf8'), /\.\.\/\.\.\/\.\.\/\.submodules\/dsh-base\/apps\/web\/src\/server/);
  assert.match(readFileSync(join(f.product, 'pnpm-workspace.yaml'), 'utf8'), /apps\/admin/);
  assert.equal(git(f.base, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(f.upstream, 'status', '--porcelain', '--untracked-files=all'), '');
});
