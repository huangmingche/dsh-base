#!/usr/bin/env node
/** Field/save/readonly pixel equality against stable official primitives, plus real draft behavior. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { resolveDeploymentSiteSettings } from '../../../../packages/boot/dsh-base-site-config/src/settings.ts';
import { stableCompare, stableScreenshot, settle } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts'), output = resolve(app, 'dist/parity-evidence/global-settings');
const cases = [];
let server, browser;
const nameField = '[data-global-field="seo.site.name"]';
async function replace(page, selector, text) {
  await page.click(selector);
  await page.$eval(selector, input => input.select());
  await page.keyboard.press('Backspace');
  await page.type(selector, text);
}
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1280, 720]) {
    const label = `${locale}-${theme}-${width}`, pages = [], requests = [], errors = [];
    const document = { revision: 2, canEdit: true, source: 'deployment', values: resolveDeploymentSiteSettings({ SITE_BRAND_NAME: 'Fixture site' }) };
    let nextError = 0;
    for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        if (new URL(request.url()).pathname !== '/api/site-settings') { await request.continue(); return; }
        requests.push({ side, method: request.method() });
        if (request.method() === 'PUT') {
          const data = JSON.parse(request.postData());
          if (nextError) { const status = nextError; nextError = 0; await request.respond({ status, contentType: 'application/json', body: JSON.stringify({ error: status === 409 ? 'revision_conflict' : 'site_settings_unavailable' }) }); return; }
          assert.equal(data.expectedRevision, document.revision);
          document.revision++; document.source = 'saved'; document.values = data.values;
        }
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
      });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'global-settings', locale, side })}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.__GLOBAL_SETTINGS_TEST__?.store.getSnapshot().status === 'ready');
      await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
      assert.equal(await page.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.registrations), 1);
      await settle(page); pages.push(page);
    }
    const [reference, adapted] = pages;
    const compareControl = async (selector, suffix) => {
      for (const page of pages) { await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await settle(page); }
      await adapted.$eval(selector, element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await settle(adapted);
      const bounds = (page, selector) => page.$eval(selector, element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
      const target = await bounds(adapted, selector);
      // Standalone official controls have no upstream SEO page. Blank reference
      // spacers reproduce only their flow offsets and scroll-layer geometry, so
      // opacity and fractional-radius rasterization share the same coordinates.
      const environment = await adapted.$eval('main', main => {
        const form = main.querySelector('[class*="_form_"]'), field = main.querySelector('[data-global-field="seo.site.name"]');
        const footer = form.querySelector('[class*="_footer_"]');
        const mr = main.getBoundingClientRect(), fr = form.getBoundingClientRect(), nr = field.getBoundingClientRect();
        return { top: fr.y - mr.y + main.scrollTop, before: nr.y - fr.y, after: footer.getBoundingClientRect().y - nr.bottom, scroll: main.scrollTop };
      });
      await reference.$eval('main', (main, environment) => {
        const form = main.querySelector('[class*="_form_"]'), field = main.querySelector('[data-global-field="seo.site.name"]');
        const before = main.querySelector('[data-reference-before-field]'), after = main.querySelector('[data-reference-after-field]');
        before.style.height = '0px'; after.style.height = '0px';
        const builtin = field.getBoundingClientRect().y - form.getBoundingClientRect().y;
        before.style.height = `${environment.before - builtin}px`;
        after.style.height = `${environment.after}px`;
        main.style.paddingTop = `${environment.top}px`;
        main.scrollTop = environment.scroll;
      }, environment);
      await settle(reference);
      assert.deepEqual(await bounds(reference, selector), target, 'same actual control geometry before pixel comparison');
      const capture = page => stableScreenshot(page, { clip: target, captureBeyondViewport: false });
      const pair = await stableCompare(`${label}-${suffix}`, () => capture(reference), () => capture(adapted));
      const describe = page => page.$eval(selector, element => [element, ...element.querySelectorAll('*'), element.parentElement, element.parentElement.parentElement].map(item => { const r = item.getBoundingClientRect(), s = getComputedStyle(item); return {tag:item.tagName, class:item.className, rect:{x:r.x,y:r.y,width:r.width,height:r.height}, background:s.backgroundColor, opacity:s.opacity, border:s.border, transform:s.transform, filter:s.filter, overflow:s.overflow, color:s.color, font:s.font}; }));
      await writeFile(resolve(output, `${label}-${suffix}-geometry.json`), JSON.stringify({ target, official: await bounds(reference, selector), actualNodes:await describe(adapted),referenceNodes:await describe(reference), alignment: 'reference blank flow spacers and container scroll, no control style changes' },null,2));
      await writeFile(resolve(output, `${label}-${suffix}-official.png`), pair.a);
      await writeFile(resolve(output, `${label}-${suffix}-actual.png`), pair.b);
      assert.ok(pair.equal, `${suffix}: exact official control pixels`);
    };
    await compareControl(nameField, 'name-field');
    await compareControl('button[class*="_save_"]', 'save');
    await adapted.$eval('main', element => { element.scrollTop = 0; });
    await adapted.screenshot({ path: resolve(output, `${label}-form.png`), captureBeyondViewport: false });
    await replace(adapted, `${nameField} input`, 'Published site');
    await adapted.click('button[class*="_save_"]');
    await adapted.waitForFunction(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().saved);
    assert.equal(document.values.seo.site.name, 'Published site');
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.refreshes()), 1);
    await replace(adapted, `${nameField} input`, 'Unsaved draft');
    nextError = 409;
    await adapted.click('button[class*="_save_"]');
    await adapted.waitForFunction(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().failure === 'conflict');
    assert.equal(await adapted.$eval(`${nameField} input`, input => input.value), 'Unsaved draft');
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().saved), false);
    const reloadText = locale === 'zh' ? '重新加载并放弃更改' : 'Reload and discard changes';
    await adapted.$$eval('[data-global-settings] button', (buttons, label) => buttons.find(button => button.textContent === label).click(), reloadText);
    await adapted.waitForFunction(() => !window.__GLOBAL_SETTINGS_TEST__.store.getSnapshot().dirty);
    assert.equal(await adapted.$eval(`${nameField} input`, input => input.value), 'Published site');
    document.canEdit = false;
    for (const page of pages) await page.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.reload());
    await compareControl(nameField, 'readonly-field');
    await compareControl('[class*="_readOnly_"]', 'readonly-notice');
    assert.equal(await adapted.$eval('button[class*="_save_"]', button => button.disabled), true);
    assert.equal(await adapted.$eval(`${nameField} input`, input => input.disabled), true);
    assert.equal(await adapted.evaluate(() => window.__GLOBAL_SETTINGS_TEST__.store.save()), false);
    assert.equal(requests.filter(request => request.method === 'PUT').length, 2, 'only the two explicit administrator saves reach transport');
    assert.deepEqual(errors, []);
    cases.push({ locale, theme, width, comparisons: 4, actualPluginRegistration: true, save: true, conflictDraftPreserved: true, reload: true, readerReadonly: true, requests, errors });
    for (const page of pages) await page.close();
    console.log(`[global-settings] ${label} passed`);
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, scope: 'Shared field, save and read-only controls compared with unmodified official SettingsForm/SettingsValueField. Actual plugin registration and native fetch transport with intercepted site-settings responses. No whole-editor official equivalent is claimed.', cases }, null, 2));
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
