import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const upstream = resolve(root, '.submodules/deepseek-harness/packages/client/ui-settings-account');
const fork = resolve(import.meta.dirname, '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const files = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const runtimeFiles = directory => ['src', 'locale'].flatMap(folder => files(resolve(directory, folder)))
  .map(file => relative(directory, file)).sort();

test('account fork records the exact pinned source, license and replacement contract', () => {
  const manifest = json(resolve(fork, 'package.json'));
  const official = json(resolve(upstream, 'package.json'));
  const pin = json(resolve(root, 'dsh-source.lock.json'));
  assert.deepEqual(manifest.dshBase.forkOf, {
    package: official.name,
    path: 'packages/client/ui-settings-account',
    commit: pin.commit,
    license: 'MIT',
  });
  assert.equal(manifest.dshBase.client.origin, 'fork');
  assert.equal(manifest.dshBase.client.replaces, official.name);
  assert.equal(manifest.dshBase.reuse.mode, 'fork');
  assert.equal(manifest.dshBase.reuse.sourceReviewCommit, pin.commit);
  assert.deepEqual(manifest.dsh, official.dsh);
  assert.deepEqual(readFileSync(resolve(fork, 'LICENSE')), readFileSync(resolve(root, '.submodules/deepseek-harness/LICENSE')));
  assert.equal(manifest.exports['.'], './src/client/entry.ts');
  assert.equal(manifest.exports['./client'], './src/client/entry.ts');
});

test('the complete runtime, resources and dictionaries reproduce the pin after reversing declared Host adaptations', () => {
  const adaptations = json(resolve(fork, 'host-adaptations.json'));
  const pin = json(resolve(root, 'dsh-source.lock.json'));
  assert.equal(adaptations.upstreamCommit, pin.commit);
  assert.deepEqual(adaptations.additions, ['src/client/entry.ts', 'src/client/AccountAvailability.module.css']);
  assert.deepEqual(adaptations.files.map(file => file.path), ['src/client/AccountSection.tsx', 'src/client/AccountOnboarding.tsx']);
  const originals = runtimeFiles(upstream);
  assert.deepEqual(runtimeFiles(fork), [...originals, ...adaptations.additions].sort(), 'full source/resource inventory');
  const changes = new Map(adaptations.files.map(file => [file.path, file.changes]));
  for (const path of originals) {
    let actual = readFileSync(resolve(fork, path));
    const replacements = changes.get(path);
    if (replacements !== undefined) {
      let source = actual.toString('utf8');
      for (const { reason, before, after } of replacements.toReversed()) {
        assert.ok(reason.length > 0, `${path}: document each adaptation`);
        assert.notEqual(before, after, `${path}: adaptation must change source`);
        assert.equal(source.split(after).length - 1, 1, `${path}: ${reason}`);
        source = source.replace(after, before);
      }
      actual = Buffer.from(source);
    }
    assert.deepEqual(actual, readFileSync(resolve(upstream, path)), path);
  }
  for (const addition of adaptations.additions) assert.ok(readFileSync(resolve(fork, addition)).length > 0, addition);
});

test('the account fork preserves the official stylesheet and all binary onboarding assets byte for byte', () => {
  const paths = runtimeFiles(upstream).filter(path => path.endsWith('.css') || path.includes('/assets/') || path.startsWith('locale/'));
  assert.ok(paths.some(path => path.endsWith('.webp')), 'binary resources are part of the runtime comparison');
  assert.ok(paths.includes('src/client/AccountSection.module.css'));
  for (const path of paths) assert.deepEqual(readFileSync(resolve(fork, path)), readFileSync(resolve(upstream, path)), path);
});
