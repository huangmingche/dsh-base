import assert from 'node:assert/strict';
import { LOCALE_IDS, splitLocalePath } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';

/** Routes the base used to publish. A downstream provider may declare its own pages. */
export const retiredDocuments = [
  '/about', '/use-cases', '/guides/getting-started', '/pricing',
  '/privacy', '/terms', '/cookie', '/blog', '/blog/keep-product-features-in-plugins',
];

export function assertBaseRegistry(pages) {
  assert.deepEqual(pages.map(page => page.path), ['/'], 'only the workbench is published by the base');
  assert.deepEqual([...pages[0].availableLocales].sort(), [...LOCALE_IDS].sort());
}

export function assertNoRetiredLinks(hrefs, base) {
  for (const href of hrefs) {
    const url = new URL(href, base);
    if (url.origin !== base) continue;
    const { path } = splitLocalePath(url.pathname);
    assert.ok(!retiredDocuments.includes(path.replace(/\/$/u, '')), `link to a removed document: ${href}`);
    assert.ok(!path.startsWith('/assets/public-content/'), `link to a removed publication asset: ${href}`);
  }
}
