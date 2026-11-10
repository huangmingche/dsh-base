#!/usr/bin/env node
/** Real official row navigation, scoped edits and unchanged official control pixels. No deployment writes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { resolveDeploymentSiteSettings } from '../../../../packages/boot/dsh-base-site-config/src/settings.ts';
import { readOfficialPluginCatalog } from './official-plugin-catalog-oracle.mjs';
import { readOwnedPluginInventory } from './owned-plugin-inventory-oracle.mjs';
import { managerCopy } from './plugin-manager-assertions.mjs';
import { stableCompare, stableScreenshot, settle } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts'), outDir = resolve(process.env.DSH_PARITY_BUILD_DIR ?? resolve(app, 'dist/parity-site-settings-scopes'));
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/site-settings-scopes'));
const official = readOfficialPluginCatalog(), owned = readOwnedPluginInventory();
const bundle = 'dsh-base:global', cases = [];
const rows = [
  ['cloudflare:worker:seo', 'seo'], ['cloudflare:worker:sitemap', 'sitemap'], ['cloudflare:worker:robots', 'robots'],
  ['cloudflare:worker:manifest', 'manifest'], ['cloudflare:worker:llms', 'llms'], ['client:google-analytics', 'googleAnalytics'], ['cloudflare:worker:google-analytics', 'googleAnalytics'],
];
const pageOverride = { title: 'Home copy', description: 'Public home', keywords: ['home'], image: '/og.png', priority: '0.8', changefreq: 'weekly', lastmod: '2026-11-15' };
const field = path => `[data-global-field=${JSON.stringify(path)}]`;
const gaSwitch = `${field('analytics.google.enabled')} [role="switch"]`, gaId = field('analytics.google.measurementId');
const save = '[data-global-settings] button[class*="_save_"]';
async function click(page, selector) { await page.$eval(selector, element => element.scrollIntoView({ block: 'center' })); await page.click(selector); }
async function replace(page, selector, value) {
  // Pixel comparisons leave the reference tab active. Native keyboard input
  // must target the actual form instead of a background renderer.
  await page.bringToFront();
  await click(page, selector);
  await page.$eval(selector, element => element.select());
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
}
async function ready(page) { await page.waitForFunction(() => window.__SITE_SETTINGS_SCOPES__?.store.getSnapshot().status === 'ready'); }
async function openBundle(page) {
  await click(page, `[data-plugin-package="${bundle}"] button[aria-describedby]`);
  await page.waitForSelector(`[data-plugin-detail="${bundle}"] [data-global-scope="global"]`); await ready(page);
}
async function openRow(page, id, scope) {
  await click(page, `[data-plugin-row=${JSON.stringify(id)}] button[class*="rowOpen"]`);
  await page.waitForSelector(`[data-plugin-row-detail=${JSON.stringify(`${bundle}#${id}`)}] [data-global-scope=${JSON.stringify(scope)}]`);
  await ready(page);
  assert.equal(await page.$$eval('[data-global-settings]', elements => elements.length), 1, 'one scoped editor, never the complete bundle editor alongside it');
}
async function back(page, locale) {
  const title = locale === 'zh' ? 'Dsh-base 全局' : 'Dsh-base Global';
  const label = managerCopy(locale).backToPackage.replace('{name}', title);
  await click(page, `[data-plugin-row-detail] button[aria-label=${JSON.stringify(label)}]`);
  await page.waitForSelector(`[data-plugin-detail="${bundle}"] [data-global-scope="global"]`);
}
function assertFields(scope, fields) {
  if (scope === 'sitemap') assert.deepEqual(fields, ['priority', 'changefreq', 'lastmod'].map(key => `seo.pages./.${key}`));
  if (scope === 'robots') assert.deepEqual(fields, ['seo.robots.disallow', 'seo.robots.extraLines']);
  if (scope === 'llms') assert.deepEqual(fields, ['seo.llms.enabled', 'seo.llms.introduction', 'seo.llms.guidance']);
  if (scope === 'googleAnalytics') assert.deepEqual(fields, ['analytics.google.enabled', 'analytics.google.measurementId', 'analytics.conversions.mode', 'analytics.conversions.campaigns']);
  if (scope === 'manifest') assert.ok(fields.length > 0 && fields.every(path => path.startsWith('seo.manifest.') || ['svg', 'icon192', 'icon512', 'maskable512'].some(key => path === `seo.icons.${key}`)));
  if (scope === 'seo') {
    assert.ok(fields.includes('seo.pages./.title') && fields.some(path => /^seo.locales\.[^.]+\.title$/u.test(path)));
    assert.ok(fields.every(path => !/^(?:links\.|analytics\.|seo\.(?:llms|robots|manifest)\.)/u.test(path)));
    assert.ok(!fields.some(path => /\.(?:priority|changefreq|lastmod|icon192|icon512|maskable512)$/u.test(path)));
  }
}
async function compareControl(actual, reference, actualSelector, referenceSelector, label) {
  for (const page of [actual, reference]) { await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); }
  await actual.$eval(actualSelector, element => element.scrollIntoView({ block: 'center' })); await settle(actual);
  const target = await actual.$eval(actualSelector, element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const environment = await actual.$eval('[data-plugin-body]', body => ({ scroll: body.scrollTop, height: body.scrollHeight }));
  await reference.$eval(referenceSelector, (element, { target, environment }) => {
    // Normal flow and the same scroll layer preserve alpha-edge rasterization.
    // Only empty reference spacers change; official control styles stay untouched.
    const carrier = document.querySelector('[data-site-reference]'), body = document.querySelector('[data-plugin-body]');
    carrier.style.paddingTop = '0px'; body.scrollTop = 0;
    carrier.querySelector('[data-reference-before]').style.height = '0px'; carrier.querySelector('[data-reference-after]').style.height = '0px';
    for (const control of carrier.querySelectorAll('[data-reference-control]')) { control.style.paddingLeft = '0px'; control.style.display = control === element || control.contains(element) ? '' : 'none'; }
    const wrapper = element.closest('[data-reference-control]');
    if (wrapper && wrapper !== element) wrapper.style.paddingLeft = `${target.x - element.getBoundingClientRect().x}px`;
    carrier.style.paddingTop = `${target.y + environment.scroll - element.getBoundingClientRect().y}px`;
    // scrollHeight is clamped to clientHeight when the reference is short. Use
    // the actual flow extent, otherwise a barely overflowing real form creates
    // a scroll compositor layer while its reference remains non-scrollable.
    const flowEnd = body.lastElementChild.getBoundingClientRect().bottom - body.getBoundingClientRect().top + parseFloat(getComputedStyle(body).paddingBottom);
    carrier.querySelector('[data-reference-after]').style.height = `${Math.max(0, environment.height - flowEnd)}px`;
    body.scrollTop = environment.scroll;
  }, { target, environment });
  await settle(reference);
  assert.deepEqual(await reference.$eval('[data-plugin-body]', body => ({ scroll: body.scrollTop, height: body.scrollHeight })), environment, `${label}: identical scrolling surface`);
  const metrics = (page, selector) => page.$eval(selector, element => {
    const r = element.getBoundingClientRect(), s = getComputedStyle(element);
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, color: s.color, background: s.backgroundColor, border: s.border, radius: s.borderRadius,
      font: s.font, padding: s.padding, opacity: s.opacity, boxSizing: s.boxSizing, disabled: element.matches(':disabled') };
  });
  assert.deepEqual(await metrics(actual, actualSelector), await metrics(reference, referenceSelector), `${label}: official control geometry and styles`);
  const pair = await stableCompare(label, () => stableScreenshot(reference, { clip: target, captureBeyondViewport: false }), () => stableScreenshot(actual, { clip: target, captureBeyondViewport: false }));
  await writeFile(resolve(output, `${label}-official.png`), pair.a); await writeFile(resolve(output, `${label}-actual.png`), pair.b);
  if (!pair.equal) {
    const ancestors = (page, selector) => page.$eval(selector, element => {
      const result = [];
      for (let node = element; node; node = node.parentElement) { const s = getComputedStyle(node); result.push({tag: node.tagName, className: node.className, rect: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, background: s.backgroundColor, display: s.display, transform: s.transform, opacity: s.opacity, isolation: s.isolation, contain: s.contain, overflow: s.overflow, zoom: s.zoom}); }
      return result;
    });
    await writeFile(resolve(output, `${label}-geometry.json`), JSON.stringify({actual: await ancestors(actual, actualSelector), reference: await ancestors(reference, referenceSelector)}, null, 2));
  }
  assert.ok(pair.equal, `${label}: exact official control pixels`);
}
let server, browser;
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error', build: { outDir, emptyOutDir: true } });
  server = await vite.preview({ configFile, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const launch = acceptanceLaunchOptions(); browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  for (const [locale, theme, width] of [['en', 'light', 1280], ['en', 'dark', 720], ['zh', 'light', 720], ['zh', 'dark', 1280]]) {
    const label = `${locale}-${theme}-${width}`, writes = [], errors = [], reached = [];
    const document = { revision: 2, canEdit: true, source: 'deployment', values: resolveDeploymentSiteSettings({ SITE_BRAND_NAME: 'Fixture site' }) };
    document.values.seo.pages = { '/': structuredClone(pageOverride) };
    const pages = [];
    for (const side of ['reference', 'adapted', 'control']) {
      const page = await browser.newPage(); page.setDefaultTimeout(15000); pages.push(page);
      page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(({ official, owned }) => { window.__PLUGIN_CATALOG_REFERENCE__ = official; window.__OWNED_PLUGIN_REFERENCE__ = owned; }, { official: official.bundles, owned });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        try {
          const path = new URL(request.url()).pathname;
          if (path === '/api/site-analytics/conversions') {
            await request.respond({ status: document.canEdit ? 200 : 403, contentType: 'application/json', body: JSON.stringify(document.canEdit ? { rows: [] } : { error: 'forbidden' }) });
            return;
          }
          if (path !== '/api/site-settings') { await request.continue(); return; }
          if (request.method() === 'PUT') {
            const data = JSON.parse(request.postData()); assert.equal(data.expectedRevision, document.revision);
            writes.push(data); document.revision++; document.source = 'saved'; document.values = data.values;
          }
          await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
        } catch (error) { errors.push(error.message); await request.abort(); }
      });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'plugin-manager', state: 'site-settings', locale, side: side === 'control' ? 'adapted' : side, ...(side === 'control' ? { controlReference: '1' } : {}) })}`, { waitUntil: 'networkidle0' });
      await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
      await page.waitForFunction(() => window.__PLUGIN_PARITY__?.source.getSnapshot().status === 'ready');
      await openBundle(page);
      if (side === 'control') { await openRow(page, rows.at(-1)[0], 'googleAnalytics'); continue; }
      assert.deepEqual(await page.evaluate(() => window.__SITE_SETTINGS_SCOPES__.rowKeys), rows.map(([id]) => `${bundle}#${id}`));
      for (const [id, scope] of rows) {
        await openRow(page, id, scope);
        const shown = await page.$$eval('[data-global-field]', elements => elements.map(element => element.dataset.globalField));
        assertFields(scope, shown); reached.push({ side, id, scope, fields: shown });
        if (side === 'adapted' && (scope === 'seo' || scope === 'sitemap')) {
          await click(page, '[data-global-page="/"] button');
          const draft = await page.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.getSnapshot().draft.seo.pages['/']);
          assert.deepEqual(draft, scope === 'seo' ? { priority: '0.8', changefreq: 'weekly', lastmod: '2026-11-15' } : { title: 'Home copy', description: 'Public home', keywords: ['home'], image: '/og.png' });
          await click(page, save); await page.waitForFunction(() => window.__SITE_SETTINGS_SCOPES__.store.getSnapshot().saved);
          assert.deepEqual(document.values.seo.pages['/'], draft, 'only the current scope was cleared in the complete saved document');
          document.values.seo.pages['/'] = structuredClone(pageOverride); document.revision++;
          await page.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.reload());
        }
        if (id !== rows.at(-1)[0]) await back(page, locale);
      }
      await page.$eval('[data-plugin-body]', element => { element.scrollTop = 0; }); await settle(page);
      await page.screenshot({ path: resolve(output, `${label}-${side}-ga.png`), captureBeyondViewport: false });
    }
    const [, actual, reference] = pages;
    for (const [kind, actualSelector, referenceSelector] of [['switch', gaSwitch, '[data-reference-control="switch"] [role="switch"]'], ['field', gaId, '[data-reference-control="field"]'], ['save', save, '[data-site-reference] button[class*="_save_"]']]) {
      await compareControl(actual, reference, actualSelector, referenceSelector, `${label}-${kind}`);
    }
    const before = writes.length;
    console.log(`[site-settings-scopes] ${label}: official controls matched; editing GA`);
    await replace(actual, `${gaId} input`, 'G-EXAMPLE1');
    assert.equal(await actual.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.getSnapshot().draft.analytics.google.enabled), false);
    await actual.focus(gaSwitch); await actual.keyboard.press('Space');
    assert.equal(await actual.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.getSnapshot().draft.analytics.google.enabled), true);
    assert.equal(writes.length, before, 'native toggling only stages an edit');
    await click(actual, save); await actual.waitForFunction(() => window.__SITE_SETTINGS_SCOPES__.store.getSnapshot().saved);
    assert.deepEqual(document.values.analytics.google, { enabled: true, measurementId: 'G-EXAMPLE1' });
    console.log(`[site-settings-scopes] ${label}: keyboard edit and explicit Save passed; comparing read-only controls`);
    document.canEdit = false;
    for (const page of [actual, reference]) await page.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.reload());
    for (const [kind, actualSelector, referenceSelector] of [['switch', gaSwitch, '[data-reference-control="switch"] [role="switch"]'], ['field', gaId, '[data-reference-control="field"]'], ['save', save, '[data-site-reference] button[class*="_save_"]']]) {
      await compareControl(actual, reference, actualSelector, referenceSelector, `${label}-readonly-${kind}`);
    }
    assert.equal(await actual.$eval(`${gaId} input`, element => element.disabled), true);
    assert.equal(await actual.$eval(gaSwitch, element => element.disabled), true);
    assert.equal(await actual.$eval(save, element => element.disabled), true);
    assert.equal(await actual.evaluate(() => window.__SITE_SETTINGS_SCOPES__.store.save()), false);
    assert.equal(writes.length, before + 1); assert.deepEqual(errors, []);
    cases.push({ locale, theme, width, reached, officialControlPixelComparisons: 6, readerCannotSave: true, scopedResetPreservesOtherFields: true, writes: writes.length, errors });
    for (const page of pages) await page.close();
    console.log(`[site-settings-scopes] ${label}: 14 row visits, 6 official control comparisons passed`);
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, scope: 'Real plugin registration and seven row configuration pages through official and adapted PluginManagerPage; actual native browser interactions and untouched official primitive controls. Fixture responses only, no deployed writes.', cases }, null, 2));
} finally {
  try { await closeAcceptanceBrowser(browser); }
  finally { await server?.close(); }
}
