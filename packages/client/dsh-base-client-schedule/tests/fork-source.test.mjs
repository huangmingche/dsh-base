import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '../../../..');
const source = resolve(root, '.submodules/deepseek-harness/packages/client/ui-schedule');
const fork = resolve(import.meta.dirname, '..');
const read = path => readFileSync(path, 'utf8');
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);

test('the complete Schedule fork differs only by the optional pre-create Host hook', () => {
  const manifest = JSON.parse(read(resolve(fork, 'package.json')));
  const pin = JSON.parse(read(resolve(root, 'dsh-source.lock.json')));
  assert.equal(manifest.dshBase.forkOf.commit, pin.commit);
  assert.equal(manifest.dshBase.client.replaces, '@deepseek-ai/dsh-client-ui-schedule');
  assert.equal(manifest.dshBase.client.origin, 'fork');
  for (const folder of ['src', 'locale']) for (const file of files(resolve(source, folder))) {
    const path = relative(source, file);
    let actual = read(resolve(fork, path));
    if (path === 'src/client/TaskManagerPage.tsx') {
      for (const addition of ['  /** Optional Host account gate before opening a manual task draft. */\n  readonly onBeforeCreate?: () => boolean\n', '    if (props.onBeforeCreate?.() === false) return\n']) {
        assert.equal(actual.split(addition).length - 1, 1);
        actual = actual.replace(addition, '');
      }
    }
    assert.equal(actual, read(file), path);
  }
  assert.equal(read(resolve(fork, 'LICENSE')), read(resolve(root, '.submodules/deepseek-harness/LICENSE')));
  const profile = JSON.parse(read(resolve(root, 'apps/web/composition.profile.json')));
  assert.equal(profile.client.find(row => row.name === '@deepseek-ai/dsh-client-ui-schedule').disabled, true);
});
