#!/usr/bin/env node
/** Native site selectors reuse the official Models controls; no copied CSS. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { resolveDeploymentSiteSettings } from '../../../../packages/boot/dsh-base-site-config/src/settings.ts';
import { stableCompare, stableScreenshot, settle } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts'), output = resolve(app, 'dist/parity-evidence/global-settings-selects');
const selectors = { page: '[data-global-page-path]', language: '[data-global-language]', frequency: '[data-global-field="seo.pages./.changefreq"] select' };
// Reuse the already built fixture for a separate native-keyboard smoke check.
const keyboardOnly = process.argv.includes('--keyboard-only');
const cases = [];
let server, browser;
const metrics = (page, selector) => page.$eval(selector, element => {
  const r = element.getBoundingClientRect(), s = getComputedStyle(element);
  return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, value: element.value, disabled: element.disabled,
    boxSizing: s.boxSizing, maxWidth: s.maxWidth, paddingRight: s.paddingRight, appearance: s.appearance,
    backgroundImage: s.backgroundImage, backgroundPosition: s.backgroundPosition, backgroundSize: s.backgroundSize,
    background: s.backgroundColor, border: s.border, borderRadius: s.borderRadius, color: s.color, font: s.font, opacity: s.opacity,
    focused: document.activeElement === element, overflowing: r.right > innerWidth || r.left < 0 };
});
async function keyboardSelect(page, selector, key, value) {
  await page.focus(selector);
  // Headless Chromium on macOS does not commit OS-popup ArrowDown/Enter, even
  // on a plain select. Native closed-select typeahead matches visible labels.
  await page.keyboard.press(key);
  await page.keyboard.press('Tab');
  try {
    await page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.value === value, { timeout: 5000 }, { selector, value });
  } catch (error) {
    const observed = await page.$eval(selector, element => ({ value: element.value, focused: document.activeElement === element, disabled: element.disabled }));
    throw new Error(`Native keyboard selection failed for ${selector}: expected ${value}, observed ${JSON.stringify(observed)}`, { cause: error });
  }
  assert.equal(await page.$eval(selector, element => element.value), value);
}
try {
  await mkdir(output, { recursive: true });
  if (!keyboardOnly) await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  for (const locale of keyboardOnly ? ['en'] : ['en', 'zh']) for (const theme of keyboardOnly ? ['light'] : ['light', 'dark']) for (const width of keyboardOnly ? [1280] : [1280, 720]) {
    const label = `${locale}-${theme}-${width}`, pages = [], writes = [], errors = [], comparisons = [];
    const document = { revision: 2, canEdit: true, source: 'deployment', values: resolveDeploymentSiteSettings({ SITE_BRAND_NAME: 'Fixture site' }) };
    document.values.seo.pages = {};
    for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        if (new URL(request.url()).pathname !== '/api/site-settings') { await request.continue(); return; }
        if (request.method() === 'PUT') {
          const data = JSON.parse(request.postData()); writes.push(data);
          assert.equal(data.expectedRevision, document.revision);
          document.revision++; document.source = 'saved'; document.values = data.values;
        }
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
      });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'global-settings', globalControls: 'selects', locale, side })}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.__GLOBAL_SETTINGS_TEST__?.store.getSnapshot().status === 'ready');
      await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
      assert.equal(await page.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.registrations), 1);
      pages.push(page);
    }
    const [reference, adapted] = pages;
    const keyboardCase = label === 'en-light-1280';
    if (keyboardCase) {
      const before = await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft));
      await keyboardSelect(reference, '[data-reference-select="language"]', 'd', 'de');
      await keyboardSelect(adapted, selectors.language, 'd', 'de');
      assert.equal(await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft)), before, 'native language keyboard selection only changes the viewed locale');
      await adapted.select(selectors.language, locale);
      assert.equal(writes.length, 0);
    }
    if (keyboardOnly) {
      await adapted.click('[data-global-page-path] + button');
      await adapted.waitForSelector(selectors.frequency);
      await keyboardSelect(reference, '[data-reference-select="frequency"]', 'w', 'weekly');
      await keyboardSelect(adapted, selectors.frequency, 'w', 'weekly');
      assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft.seo.pages['/'].changefreq), 'weekly');
      assert.equal(writes.length, 0); assert.deepEqual(errors, []);
      cases.push({ locale, theme, width, nativeTypeahead: { language: 'd + Tab -> de', frequency: 'w + Tab -> weekly', comparedWithOfficialReference: true }, languageViewOnly: true, frequencyDraftOnly: true, writes: 0, errors });
      for (const page of pages) await page.close();
      console.log('[global-settings-selects] native keyboard smoke passed');
      continue;
    }
    const compare = async (kind, state) => {
      const actualSelector = selectors[kind], expectedSelector = `[data-reference-select="${kind}"]`;
      for (const page of pages) { await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); }
      await adapted.$eval(actualSelector, element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const environment = await adapted.$eval(actualSelector, element => {
        const main = document.querySelector('main'), r = element.getBoundingClientRect(), mr = main.getBoundingClientRect(), style = getComputedStyle(main);
        const top = parseFloat(style.paddingTop), bottom = parseFloat(style.paddingBottom);
        const before = r.y - mr.y + main.scrollTop - top;
        return { before, after: main.scrollHeight - top - before - r.height - bottom, scroll: main.scrollTop, value: element.value };
      });
      await reference.$eval('[data-reference-select-host]', (host, { kind, environment }) => {
        for (const select of host.querySelectorAll('select')) select.style.display = select.dataset.referenceSelect === kind ? '' : 'none';
        host.querySelector('[data-reference-before-select]').style.height = `${environment.before}px`;
        host.querySelector('[data-reference-after-select]').style.height = `${environment.after}px`;
        host.querySelector(`[data-reference-select="${kind}"]`).value = environment.value;
        document.querySelector('main').scrollTop = environment.scroll;
      }, { kind, environment });
      if (state === 'focused') {
        await adapted.focus(actualSelector); await reference.focus(expectedSelector);
      }
      await settle(adapted); await settle(reference);
      const actual = await metrics(adapted, actualSelector), official = await metrics(reference, expectedSelector);
      assert.deepEqual(actual, official, `${kind}/${state}: exact official computed styles and geometry`);
      assert.equal(actual.rect.height, 32); assert.equal(actual.rect.width, 240); assert.equal(actual.maxWidth, '240px');
      assert.equal(actual.paddingRight, '32px'); assert.equal(actual.appearance, 'none');
      assert.equal(actual.backgroundPosition, 'calc(100% - 12px) 50%'); assert.equal(actual.backgroundSize, '12px 12px');
      assert.match(actual.backgroundImage, /data:image\/svg\+xml/u); assert.equal(actual.overflowing, false);
      assert.equal(actual.focused, state === 'focused');
      if (state === 'readonly') assert.equal(actual.disabled, kind !== 'language');
      const pair = await stableCompare(`${label}-${kind}-${state}`, () => stableScreenshot(reference, { clip: actual.rect, captureBeyondViewport: false }), () => stableScreenshot(adapted, { clip: actual.rect, captureBeyondViewport: false }));
      await writeFile(resolve(output, `${label}-${kind}-${state}-official.png`), pair.a);
      await writeFile(resolve(output, `${label}-${kind}-${state}-actual.png`), pair.b);
      await writeFile(resolve(output, `${label}-${kind}-${state}-metrics.json`), JSON.stringify({ actual, official }, null, 2));
      assert.ok(pair.equal, `${kind}/${state}: exact official native select pixels`);
      comparisons.push({ kind, state, metrics: actual });
    };
    for (const kind of ['page', 'language']) { await compare(kind, 'idle'); await compare(kind, 'focused'); }
    const initialDraft = await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft));
    await adapted.select(selectors.language, 'ja');
    assert.equal(await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft)), initialDraft, 'language selection changes the viewed locale only');
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().dirty), false);
    await adapted.select(selectors.language, locale);
    const addButton = '[data-global-page-path] + button';
    assert.equal(await adapted.$eval(addButton, element => element.disabled), false);
    await adapted.click(addButton);
    await adapted.waitForSelector(selectors.frequency);
    assert.equal(writes.length, 0, 'adding a page only stages a draft');
    assert.equal(await adapted.$eval(addButton, element => element.disabled), true, 'duplicate page addition is disabled');
    assert.deepEqual(await adapted.evaluate(() => Object.keys(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft.seo.pages)), ['/']);
    await adapted.click(addButton);
    assert.deepEqual(await adapted.evaluate(() => Object.keys(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft.seo.pages)), ['/']);
    for (const state of ['idle', 'focused']) await compare('frequency', state);
    if (keyboardCase) {
      await keyboardSelect(reference, '[data-reference-select="frequency"]', 'w', 'weekly');
      await keyboardSelect(adapted, selectors.frequency, 'w', 'weekly');
      assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft.seo.pages['/'].changefreq), 'weekly');
      assert.equal(writes.length, 0, 'native frequency keyboard selection only stages a draft');
    }
    await adapted.select(selectors.frequency, 'weekly');
    await adapted.select(selectors.language, 'de');
    assert.equal(await adapted.$eval(selectors.frequency, element => element.value), 'weekly', 'switching the viewed locale preserves the page-frequency draft');
    assert.equal(writes.length, 0);
    await adapted.click('button[class*="_save_"]');
    await adapted.waitForFunction(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().saved);
    assert.equal(writes.length, 1); assert.equal(writes[0].values.seo.pages['/'].changefreq, 'weekly');
    assert.deepEqual(writes[0].values.seo.locales, JSON.parse(initialDraft).seo.locales, 'view-only language selection does not alter locale copy');
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.refreshes()), 1);
    document.canEdit = false;
    for (const page of pages) await page.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.reload());
    for (const kind of ['page', 'language', 'frequency']) await compare(kind, 'readonly');
    const readonlyDraft = await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft));
    await adapted.select(selectors.language, 'ja');
    await adapted.waitForSelector('[data-global-field="seo.locales.ja.title"]');
    assert.equal(await adapted.evaluate(() => JSON.stringify(window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().draft)), readonlyDraft);
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.save()), false);
    assert.equal(writes.length, 1, 'readers can switch the viewed language without writes');
    await adapted.$eval(selectors.page, element => element.scrollIntoView({ block: 'center' }));
    assert.equal(await adapted.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await adapted.screenshot({ path: resolve(output, `${label}-page-row.png`), captureBeyondViewport: false });
    assert.deepEqual(errors, []);
    cases.push({ locale, theme, width, comparisons, nativeTypeahead: keyboardCase, pageAdditionDraftOnly: true, duplicateAdditionDisabled: true, languageViewOnly: true, frequencyDraftAndPayload: true, readonlyLanguageEnabled: true, writes: writes.length, errors });
    for (const page of pages) await page.close();
    console.log(`[global-settings-selects] ${label} passed`);
  }
  await writeFile(resolve(output, keyboardOnly ? 'keyboard-report.json' : 'report.json'), JSON.stringify({ ok: true, scope: keyboardOnly ? 'Native closed-select typeahead d/Tab and w/Tab on actual registered selectors and official CSS reference; no control-value injection during tested key actions. OS popup ArrowDown/Enter cannot be exercised by this headless macOS Chromium, including a plain native select.' : 'Actual plugin native selects versus unchanged official Models input/selectInput CSS; exact computed styles, geometry, pixels and draft behavior.', cases }, null, 2));
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
