/** Invert the explicit Host edits; every inherited byte must match the pin. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const fork = resolve(import.meta.dirname, '..');
const read = (base, path) => readFileSync(resolve(base, path), 'utf8');
const manifest = JSON.parse(read(fork, 'package.json'));
const upstream = resolve(root, '.submodules/deepseek-harness', manifest.dshBase.forkOf.path);
const adaptations = JSON.parse(read(fork, 'tests/host-adaptations.json'));
const files = base => readdirSync(base, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(base, entry.name)) : [resolve(base, entry.name)]);

test('all pinned runtime, locale and license bytes match after the exact reviewed Host inverse', () => {
  assert.equal(manifest.dshBase.forkOf.commit, JSON.parse(read(root, 'dsh-source.lock.json')).commit);
  assert.equal(manifest.dshBase.client.replaces, manifest.dshBase.forkOf.package);
  assert.equal(manifest.dshBase.reuse.mode, 'fork');
  const inherited = [];
  for (const folder of ['src', 'locale']) for (const filename of files(resolve(upstream, folder))) {
    const path = relative(upstream, filename); inherited.push(path);
    let source = read(fork, path);
    for (const { official, adapted } of adaptations[path] ?? []) {
      assert.equal(source.split(adapted).length - 1, 1, `${path}: the reviewed Host adaptation occurs exactly once`);
      source = source.replace(adapted, official);
    }
    assert.equal(source, read(upstream, path), path);
  }
  for (const path of Object.keys(adaptations)) assert.ok(inherited.includes(path), `reviewed source exists: ${path}`);
  assert.deepEqual(files(resolve(fork, 'src')).map(path => relative(fork, path)).sort(), [...inherited.filter(path => path.startsWith('src/')), 'src/client/entry.ts'].sort());
  assert.equal(read(fork, 'LICENSE'), read(resolve(root, '.submodules/deepseek-harness'), 'LICENSE'));
  assert.equal(manifest.exports['./client'], './src/client/entry.ts');
});
