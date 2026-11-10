import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { catalogTarget, loadOfficialBundleCatalog } from '../../composition/generate-official-bundle-catalog.mjs';
import { officialPackages, repoRoot } from '../lib.mjs';

test('offline bundle metadata matches all pinned official optional/on-demand resources without runtime imports', async () => {
  const { entries, source, commit } = await loadOfficialBundleCatalog();
  const { OPTIONAL_BUNDLES, ON_DEMAND_BUNDLES, OFFICIAL_ON_DEMAND_CATALOG, HIDDEN_BUNDLES, MORE_BUNDLES } = await import('@deepseek-ai/dsh-official-bundles');
  assert.equal(entries.length, 18);
  assert.deepEqual(entries.map(row => row.name), [...OPTIONAL_BUNDLES, ...ON_DEMAND_BUNDLES]);
  assert.equal(source, readFileSync(join(repoRoot, catalogTarget), 'utf8'), 'pin/resource changes require regenerating the production catalog');
  assert.equal(commit, JSON.parse(readFileSync(join(repoRoot, 'dsh-source.lock.json'), 'utf8')).commit);
  assert.doesNotMatch(source, /^import\s|\b(?:require|import)\s*\(/mu, 'browser catalog is data, never optional runtime or Node imports');
  const packages = officialPackages(repoRoot);
  for (const row of entries) {
    if (row.source === 'on-demand') {
      assert.deepEqual(row.meta, OFFICIAL_ON_DEMAND_CATALOG.find(entry => entry.packageName === row.name).meta);
      continue;
    }
    const { manifest, directoryPath } = packages.get(row.name);
    assert.equal(row.originalListedByDefault, manifest.dsh.bundle.listedByDefault ?? true);
    for (const locale of ['en', 'zh', 'ja', 'es', 'fr', 'de', 'pt', 'ru']) {
      const meta = JSON.parse(readFileSync(join(directoryPath, 'locale', `${locale}.json`), 'utf8')).meta;
      assert.equal(row.meta.title[locale], meta.title);
      assert.equal(row.meta.description[locale], meta.description);
    }
    assert.equal(row.meta.icon, `data:image/svg+xml;base64,${readFileSync(join(directoryPath, manifest.icon)).toString('base64')}`, 'artwork comes from the exported manifest icon declaration');
  }
  assert.equal(entries.filter(row => !row.originalListedByDefault).length, 4, 'the upstream discovery policy stays auditable');
  const visible = entries.filter(row => !HIDDEN_BUNDLES.has(row.name));
  assert.equal(visible.length, 16, 'unchanged official Hidden policy excludes terminal and worktree');
  assert.equal(visible.filter(row => !MORE_BUNDLES.includes(row.name)).length, 6, 'explicitly visible unavailable catalog offers six main-list cards and sixteen More cards');
});
