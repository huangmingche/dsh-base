import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Check the pinned sidebar's rendered fallback mark, label and version badge. */
export async function assertSidebarBrand(page) {
  const selector = '[class*="brandIdentity"]';
  await page.waitForSelector(selector, { visible: true });
  const brand = await page.$eval(selector, identity => ({
    title: identity.querySelector('[class*="localBuildTitle"]')?.textContent.trim(),
    version: identity.querySelector('[class*="buildVersion"]')?.textContent.trim(),
    copyTargets: identity.querySelectorAll('[data-copy-version]').length,
    hasMark: identity.querySelector('svg') !== null,
  }));
  assert.ok(brand.title, 'the sidebar renders its localized title');
  assert.equal(brand.version, version);
  assert.equal(brand.copyTargets, 2, 'the official mark and label both offer version copying');
  assert.equal(brand.hasMark, true);
  return brand;
}
