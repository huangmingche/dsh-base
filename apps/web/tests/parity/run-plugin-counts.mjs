#!/usr/bin/env node
/** Exact official fork baseline versus the same page with the optional count plugin mounted. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { readOfficialPluginCatalog } from './official-plugin-catalog-oracle.mjs';
import { readOwnedPluginInventory } from './owned-plugin-inventory-oracle.mjs';
import { assertCategoryCounts, assertWrappedCategoryCount } from './plugin-counts-assertions.mjs';
import { openMorePlugins, managerCopy } from './plugin-manager-assertions.mjs';
import { settle, stableCompare, stableScreenshot } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core');
const vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(app, 'dist/parity-evidence/plugin-counts');
const official = readOfficialPluginCatalog();
const owned = readOwnedPluginInventory();
const cases = [];
let server, browser;
const snapshot = page => page.evaluate(() => ({
  text: document.querySelector('#root').innerText,
  controls: [...document.querySelectorAll('#root button,#root input')].map(element => {
    const rect = element.getBoundingClientRect();
    return { tag: element.tagName, text: element.textContent, label: element.getAttribute('aria-label'), disabled: element.matches(':disabled'), rect: [rect.x,rect.y,rect.width,rect.height].map(value => Math.round(value * 100) / 100) };
  }),
}));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  // Software rasterization avoids one-level GPU rounding variance at unrelated rounded Tag corners.
  // Both sides still require byte-identical captures; no pixels or error states are excluded.
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1440, 720]) {
    const pages = [];
    const errors = [];
    const label = `${locale}-${theme}-${width}`;
    for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await page.evaluateOnNewDocument(({ official, owned }) => { window.__PLUGIN_CATALOG_REFERENCE__ = official; window.__OWNED_PLUGIN_REFERENCE__ = owned; }, { official: official.bundles, owned });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'plugin-manager', state: 'counts', locale, side })}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.__PLUGIN_PARITY__?.source.getSnapshot().status === 'ready');
      await page.evaluate(theme => { document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'); }, theme);
      const palette = await page.evaluate(() => ({ dark: document.body.hasAttribute('data-ds-dark-theme'), background: getComputedStyle(document.body).backgroundColor, foreground: getComputedStyle(document.body).color }));
      assert.equal(palette.dark, theme === 'dark');
      assert.equal(palette.background, theme === 'dark' ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)', 'official theme attribute actually changes the rendered palette');
      assert.equal(palette.foreground, theme === 'dark' ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)');
      await settle(page);
      assert.equal(await page.evaluate(() => window.__PLUGIN_PARITY__.countRegistrations), side === 'adapted' ? 1 : 0, 'actual plugin registration owns the optional slot');
      pages.push(page);
    }
    const [reference, adapted] = pages;
    assert.equal(await reference.$$eval('[data-plugin-category-count]', rows => rows.length), 0, 'absent plugin contributes no UI');
    const before = await adapted.evaluate(() => window.__PLUGIN_PARITY__.requests.length);
    assert.deepEqual(await adapted.evaluate(() => window.__PLUGIN_PARITY__.requests), await reference.evaluate(() => window.__PLUGIN_PARITY__.requests), 'mounting the count plugin adds no request');
    const main = await assertCategoryCounts(adapted, locale);
    const wrapped = width === 720 ? await assertWrappedCategoryCount(adapted) : undefined;
    await adapted.screenshot({ path: resolve(output, `${label}-main-actual.png`), captureBeyondViewport: false });
    const compare = async surface => {
      const style = await adapted.addStyleTag({ content: '[data-plugin-category-count]{display:none!important}' });
      const dimensions = await reference.$eval('[data-plugin-body]', element => ({ height: element.clientHeight, total: element.scrollHeight }));
      const positions = [0];
      if (dimensions.total > dimensions.height) positions.push(dimensions.total - dimensions.height);
      const hashes = [];
      for (const [index, y] of positions.entries()) {
        for (const page of pages) {
          await page.$eval('[data-plugin-body]', (element, y) => { element.scrollTop = y; element.dispatchEvent(new Event('scroll')); }, y);
          await page.mouse.move(0, 0);
          await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
          await settle(page);
        }
        assert.deepEqual(await snapshot(adapted), await snapshot(reference), 'only the explicitly asserted count text changes the original UI');
        const pair = await stableCompare(`${label}-${surface}-${index}`, () => stableScreenshot(reference, { captureBeyondViewport: false }), () => stableScreenshot(adapted, { captureBeyondViewport: false }));
        await writeFile(resolve(output, `${label}-${surface}-${index}-reference.png`), pair.a);
        await writeFile(resolve(output, `${label}-${surface}-${index}-adapted.png`), pair.b);
        assert.ok(pair.equal, 'all non-counter pixels retain the exact original fork rendering');
        hashes.push(createHash('sha256').update(pair.a).digest('hex'));
      }
      await style.evaluate(element => element.remove());
      return hashes;
    };
    const mainHashes = await compare('main');
    await adapted.screenshot({ path: resolve(output, `${label}-main-bottom-actual.png`), captureBeyondViewport: false });
    assert.equal(await adapted.evaluate(() => window.__PLUGIN_PARITY__.requests.length), before, 'count rendering and comparison perform no API reads or writes');
    for (const page of pages) await openMorePlugins(page);
    const more = await assertCategoryCounts(adapted, locale, { more: true });
    await adapted.screenshot({ path: resolve(output, `${label}-more-actual.png`), captureBeyondViewport: false });
    const moreHashes = await compare('more');
    if (theme === 'light' && width === 1440) {
      await adapted.$eval(`button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
      await adapted.waitForSelector('[data-plugin-group="bundles"]');
      await adapted.evaluate(() => window.__PLUGIN_PARITY__.refresh());
      await assertCategoryCounts(adapted, locale);
      await adapted.waitForFunction(() => window.__PLUGIN_PARITY__.source.getSnapshot().refreshStatus !== 'refreshing');
      await assertCategoryCounts(adapted, locale);
      for (const enabled of [false, true]) {
        const result = await adapted.evaluate(async enabled => {
          const answer = await window.__PLUGIN_PARITY__.remotes.manager.setBundleEnabled('@dsh-base/cloudflare-think-fetch', enabled);
          await window.__PLUGIN_PARITY__.setListing({}); return answer;
        }, enabled);
        assert.equal(result.ok, true); await assertCategoryCounts(adapted, locale);
      }
      await adapted.evaluate(() => window.__PLUGIN_PARITY__.setListing({ omitBundles: ['@dsh-base/cloudflare-think-memory'], omitComponents: ['client:plugin-counts'] }));
      await assertCategoryCounts(adapted, locale, {
        bundles: owned.bundles.length - 1,
        components: owned.rows.filter(row => row.bundle !== '@dsh-base/cloudflare-think-memory' && row.entryId !== 'client:plugin-counts').length,
      });
      await adapted.evaluate(() => window.__PLUGIN_PARITY__.setListing({}));
      await assertCategoryCounts(adapted, locale);
      const stableRequests = await adapted.evaluate(() => window.__PLUGIN_PARITY__.requests.length);
      for (const status of ['idle', 'loading', 'error', 'unavailable']) {
        await adapted.evaluate(status => window.__PLUGIN_PARITY__.setStatus(status), status);
        await adapted.waitForFunction(() => document.querySelector('[data-plugin-category-count]') === null);
      }
      await adapted.evaluate(() => window.__PLUGIN_PARITY__.setStatus(null));
      await adapted.waitForSelector('[data-plugin-category-count="bundles"]');
      await assertCategoryCounts(adapted, locale);
      assert.equal(await adapted.evaluate(() => window.__PLUGIN_PARITY__.requests.length), stableRequests, 'status changes never trigger count-only network traffic');
    }
    assert.deepEqual(errors, []);
    cases.push({ locale, theme, width, main, more, wrapped, mainHashes, moreHashes, dynamic: theme === 'light' && width === 1440 });
    for (const page of pages) await page.close();
    console.log(`[plugin-counts] ${label} passed`);
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, scope: 'Actual optional count plugin registration on the unchanged manager fork: rendered category membership, component cardinality, refresh and toggle stability, request-free counting, non-ready suppression, measured 10px text spacing and normal weight, 200px title-area wrapping, exact non-counter pixels at two widths/themes/locales.', cases }, null, 2));
  console.log(`[plugin-counts] ${cases.length} browser cases passed`);
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
