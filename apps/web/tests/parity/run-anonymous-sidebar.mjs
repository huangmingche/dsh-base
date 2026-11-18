#!/usr/bin/env node
/** Signed-in fork parity; anonymous authorization is tested against the real Worker. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { stableCompare, stableScreenshot } from './stability.mjs';
const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const vite = await import(require.resolve('vite')), puppeteer = require('puppeteer-core');
const configFile = resolve(app, 'vite.parity.config.ts'), output = resolve(app, 'dist/parity-evidence/sidebar-navigation');
let server, browser; const cases = [];
// ElementHandle.click scrolls through a background-tab animation frame even for
// fully visible controls. Send a real pointer at verified viewport coordinates
// instead, preserving the same foreground state for both pixel captures.
async function click(page, selector, index = 0) {
  const point = await page.$$eval(selector, (elements, at) => {
    const element = elements[at]; if (!element) throw new Error(`Missing control ${at}`);
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0 || box.right > innerWidth || box.bottom > innerHeight) throw new Error('Pointer target is outside the viewport');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, index);
  await page.mouse.click(point.x, point.y);
}
const snapshot = page => page.evaluate(() => ({
  text: document.querySelector('#root').textContent,
  controls: [...document.querySelectorAll('#root button,[role="menuitem"]')].map(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { label: element.getAttribute('aria-label'), text: element.textContent, disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      rect: [rect.x, rect.y, rect.width, rect.height], color: style.color, background: style.backgroundColor, opacity: style.opacity, fontSize: style.fontSize };
  }),
}));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale, scheme, mode, side) {
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(10000);
    await page.setViewport({ width: mode === 'mobile' ? 390 : 1280, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${base}/?${new URLSearchParams({ surface: 'sidebar-navigation', locale, scheme, mode, side })}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__SIDEBAR_NAV_PARITY__?.ready, { polling: 50 }); await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, [], `${locale}/${scheme}/${mode}/${side}: fixture boot errors`);
    await page.waitForSelector('[data-sidebar-parity] nav button[aria-haspopup="menu"]', { visible: true, timeout: 5000 }).catch(error => { throw new Error(`${error.message}; browser errors: ${errors.join('\n')}`); });
    assert.deepEqual(await page.evaluate(() => window.__SIDEBAR_NAV_PARITY__.registered), ['plugins', 'schedules']);
    assert.equal(await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), scheme === 'dark');
    return { page, errors };
  }
  for (const locale of ['en', 'zh']) for (const scheme of ['light', 'dark']) for (const mode of ['wide', 'collapsed', 'mobile']) {
    const reference = await open(locale, scheme, mode, 'reference'), adapted = await open(locale, scheme, mode, 'adapted');
    const name = `${locale}-${scheme}-${mode}`;
    try {
      assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${name}: official signed-in geometry, text and styles`);
      const compare = async state => {
        for (const { page } of [reference, adapted]) {
          await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
          const viewport = page.viewport(); await page.mouse.move(viewport.width - 1, viewport.height - 1);
        }
        const pair = await stableCompare(`${name}/${state}`, () => stableScreenshot(reference.page, { path: resolve(output, `${name}-${state}-official.png`), captureBeyondViewport: false }), () => stableScreenshot(adapted.page, { path: resolve(output, `${name}-${state}-adapted.png`), captureBeyondViewport: false }));
        assert.ok(pair.equal, `${name}/${state}: signed-in fork pixels differ`);
      };
      await compare('main');
      for (const { page } of [reference, adapted]) { await click(page, 'nav button[aria-haspopup="menu"]'); await page.waitForSelector('[role="menuitem"]'); }
      assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${name}: official More menu`); await compare('more');
      for (const { page } of [reference, adapted]) {
        await click(page, '[role="menuitem"]');
        await page.waitForFunction(() => window.__SIDEBAR_NAV_PARITY__.calls.includes('plugin:browse'), { polling: 50 });
        await click(page, 'nav button[aria-haspopup="menu"]'); await page.waitForSelector('[role="menuitem"]');
        await click(page, '[role="menuitem"]', 1);
        await page.waitForFunction(() => window.__SIDEBAR_NAV_PARITY__.calls.includes('plugin:create'), { polling: 50 });
        const label = await page.evaluate(() => window.__SIDEBAR_NAV_PARITY__.labels.plugins);
        await click(page, `button[aria-label=${JSON.stringify(label)}]`);
      }
      if (mode !== 'collapsed') {
        for (const { page } of [reference, adapted]) {
          const labels = await page.evaluate(() => window.__SIDEBAR_NAV_PARITY__.labels);
          const byName = value => `button[aria-label=${JSON.stringify(value)}]`;
          const schedule = 'nav ' + byName(labels.schedules);
          await page.focus(byName(labels.unpinSchedule));
          await page.keyboard.press('Enter');
          await page.waitForSelector(schedule, { hidden: true });
          await click(page, 'nav button[aria-haspopup="menu"]');
          await page.waitForSelector(byName(labels.pinSchedule));
          await page.focus(byName(labels.pinSchedule));
          await page.keyboard.press('Enter');
          await page.waitForSelector(schedule, { visible: true });
        }
      }
      assert.deepEqual(await adapted.page.evaluate(() => window.__SIDEBAR_NAV_PARITY__.calls), await reference.page.evaluate(() => window.__SIDEBAR_NAV_PARITY__.calls));
      assert.deepEqual(reference.errors, []); assert.deepEqual(adapted.errors, []);
      cases.push({ locale, scheme, mode, screenshotPairs: 2, registeredThroughOfficialSlotRegistry: true, actionsEqual: true });
      console.log(`sidebar parity: ${name} passed`);
    } finally { await reference.page.close(); await adapted.page.close(); }
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, scope: 'Official SidebarRoot, More and empty WorkspaceBrowser compared with authenticated forks using real sidebar/More slot registration and the official workspace store; identical account child. Actual anonymous composition and all 8 locales are covered separately by acceptance-anonymous-sidebar.mjs.', cases }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: cases.length, output }));
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
