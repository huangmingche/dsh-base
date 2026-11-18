/** Independent acceptance oracle, read only from the pinned official checkout. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { officialPackages, repoRoot } from '../../../../scripts/conformance/lib.mjs';
import { registerOfficialSourceHooks } from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const {
  OPTIONAL_BUNDLES, ON_DEMAND_BUNDLES, OFFICIAL_ON_DEMAND_CATALOG,
  HIDDEN_BUNDLES, MORE_BUNDLES, EXTENSION_BUNDLES,
} = await import('@deepseek-ai/dsh-official-bundles');

/** No application roster/generator participates in the expected catalog. */
export function readOfficialPluginCatalog() {
  const packages = officialPackages(repoRoot);
  const metadata = name => {
    const catalog = OFFICIAL_ON_DEMAND_CATALOG.find(entry => entry.packageName === name);
    if (catalog !== undefined) return catalog.meta;
    const pkg = packages.get(name);
    assert.ok(pkg, `pinned optional bundle is absent: ${name}`);
    assert.equal(pkg.manifest.exports?.['./locale/*.json'], './locale/*.json');
    const title = {}, description = {};
    for (const filename of readdirSync(join(pkg.directoryPath, 'locale')).filter(name => name.endsWith('.json'))) {
      const locale = filename.slice(0, -5);
      const meta = JSON.parse(readFileSync(join(pkg.directoryPath, 'locale', filename), 'utf8')).meta;
      title[locale] = meta.title;
      description[locale] = meta.description;
    }
    assert.ok(title.en && title.zh && description.en && description.zh, `${name}: en/zh metadata missing`);
    assert.equal(typeof pkg.manifest.icon, 'string');
    return { title, description, icon: `data:image/svg+xml;base64,${readFileSync(join(pkg.directoryPath, pkg.manifest.icon)).toString('base64')}` };
  };
  const bundles = [...OPTIONAL_BUNDLES, ...ON_DEMAND_BUNDLES].map(name => ({
    name, official: true, availability: 'missing', installed: false, enabled: false,
    optional: true, removable: false, listedByDefault: true,
    meta: metadata(name), overrides: [], rows: [], deploymentAvailability: 'not-adapted',
  }));
  assert.equal(new Set(bundles.map(bundle => bundle.name)).size, bundles.length, 'official catalog identities must be unique');
  const rank = name => {
    const extension = EXTENSION_BUNDLES.indexOf(name);
    if (extension >= 0) return extension;
    const more = MORE_BUNDLES.indexOf(name);
    return more < 0 ? EXTENSION_BUNDLES.length : EXTENSION_BUNDLES.length + 1 + more;
  };
  // The official controller sorts by name before the page's stable group rank.
  const visible = bundles.map(bundle => bundle.name).filter(name => !HIDDEN_BUNDLES.has(name)).sort((a, b) => a.localeCompare(b));
  visible.sort((a, b) => rank(a) - rank(b));
  return { bundles, more: visible, main: visible.filter(name => !MORE_BUNDLES.includes(name)), hidden: bundles.map(bundle => bundle.name).filter(name => HIDDEN_BUNDLES.has(name)) };
}

export const LOCAL_MANAGEABLE_BUNDLES = [
  '@dsh-base/client-gateway-provider', '@dsh-base/cloudflare-think-fetch',
  '@dsh-base/cloudflare-think-memory',
];
export const REPRESENTATIVE_OFFICIAL_BUNDLES = [
  '@deepseek-ai/dsh-experimental-voice-input-bundle', '@deepseek-ai/dsh-cua-bundle', '@deepseek-ai/dsh-subagent-codex',
];

/** A complete catalog is truthful unavailable inventory, never executable rows. */
export function assertOfficialPluginCatalog(actual, expected = readOfficialPluginCatalog()) {
  assert.deepEqual(actual.filter(bundle => bundle.name.startsWith('@deepseek-ai/')).map(bundle => bundle.name).sort(), expected.bundles.map(bundle => bundle.name).sort());
  for (const reference of expected.bundles) {
    const bundle = actual.find(bundle => bundle.name === reference.name);
    for (const field of ['official', 'availability', 'installed', 'enabled', 'optional', 'removable', 'update', 'listedByDefault']) {
      assert.equal(bundle[field], reference[field], `${reference.name}: ${field}`);
    }
    assert.equal(bundle.error, undefined, `${reference.name}: expected deployment limits are not runtime errors`);
    assert.equal(bundle.deploymentAvailability, 'not-adapted');
    assert.equal(bundle.installTarget, undefined, `${reference.name}: unavailable runtime cannot offer installation`);
    assert.deepEqual(bundle.rows, [], `${reference.name}: metadata cannot invent live Loader rows`);
    assert.deepEqual(bundle.overrides, []);
    for (const locale of ['en', 'zh']) {
      assert.equal(bundle.meta?.title?.[locale], reference.meta.title[locale]);
      assert.equal(bundle.meta?.description?.[locale], reference.meta.description[locale]);
    }
    assert.equal(bundle.meta?.icon, reference.meta.icon, `${reference.name}: original artwork`);
  }
}
