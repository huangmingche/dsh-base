import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../../..');
const upstream = resolve(root, '.submodules/deepseek-harness/packages/client/ui-settings-models');
const fork = resolve(import.meta.dirname, '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const files = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const runtimeFiles = directory => ['src', 'locale'].flatMap(folder => files(resolve(directory, folder)))
  .map(file => relative(directory, file)).sort();

test('the Models fork records its pinned source, license and replacement', () => {
  const manifest = json(resolve(fork, 'package.json'));
  const pin = json(resolve(root, 'dsh-source.lock.json'));
  assert.deepEqual(manifest.dshBase.forkOf, {
    package: '@deepseek-ai/dsh-client-ui-settings-models',
    path: 'packages/client/ui-settings-models', commit: pin.commit, license: 'MIT',
  });
  assert.equal(manifest.dshBase.client.origin, 'fork');
  assert.equal(manifest.dshBase.client.replaces, manifest.dshBase.forkOf.package);
  assert.equal(manifest.dshBase.reuse.mode, 'fork');
  assert.equal(manifest.dshBase.reuse.sourceReviewCommit, pin.commit);
  assert.deepEqual(readFileSync(resolve(fork, 'LICENSE')), readFileSync(resolve(root, '.submodules/deepseek-harness/LICENSE')));
});

test('reversing public Host additions and separately recorded existing changes reproduces the complete pinned Models source', () => {
  const adaptations = json(resolve(fork, 'host-adaptations.json'));
  assert.equal(adaptations.upstreamCommit, json(resolve(root, 'dsh-source.lock.json')).commit);
  assert.deepEqual(adaptations.additions, []);
  assert.deepEqual(adaptations.files.map(file => file.path).sort(), [
    'src/client/ModelsSection.tsx', 'src/client/index.ts', 'src/client/locales.ts',
  ]);
  assert.deepEqual(runtimeFiles(fork), runtimeFiles(upstream), 'the full runtime and dictionary inventory remains intact');
  const byPath = new Map(adaptations.files.map(file => [file.path, file]));
  for (const path of runtimeFiles(upstream)) {
    let actual = readFileSync(resolve(fork, path));
    const adaptation = byPath.get(path);
    if (adaptation !== undefined) {
      let source = actual.toString('utf8');
      for (const { reason, before, after } of adaptation.changes.toReversed()) {
        assert.ok(reason.length > 0, `${path}: explain each change`);
        assert.notEqual(before, after, `${path}: each change must be meaningful`);
        assert.equal(source.split(after).length - 1, 1, `${path}: ${reason}`);
        source = source.replace(after, before);
      }
      // Some upstream locale dictionaries intentionally repeat fallback copy.
      // Recorded baseline line positions disambiguate those exact contexts.
      for (const { reason, line, before, after } of adaptation.baselineChanges.toReversed()) {
        assert.ok(reason.length > 0, `${path}: explain each baseline change`);
        assert.notEqual(before, after, `${path}: each baseline change must be meaningful`);
        assert.ok(Number.isInteger(line) && line > 0, `${path}: valid baseline location`);
        const start = source.split('\n').slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0);
        assert.equal(source.slice(start, start + after.length), after, `${path}:${line}: ${reason}`);
        source = source.slice(0, start) + before + source.slice(start + after.length);
      }
      actual = Buffer.from(source);
    }
    assert.deepEqual(actual, readFileSync(resolve(upstream, path)), path);
  }
});

test('the original Models editor components, all CSS and locale resources remain byte-identical', () => {
  const paths = runtimeFiles(upstream).filter(path => path.endsWith('.css') || path.startsWith('locale/'));
  paths.push('src/client/ProviderEditor.tsx', 'src/client/CustomProviderCard.tsx', 'src/client/DeepSeekModelsEditor.tsx');
  for (const path of paths) assert.deepEqual(readFileSync(resolve(fork, path)), readFileSync(resolve(upstream, path)), path);
});
