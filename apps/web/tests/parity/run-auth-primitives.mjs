#!/usr/bin/env node
/** Rendered official atoms, not a claim that DSH supplies a local-account flow. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { stableCompare, stableScreenshot, settle } from './stability.mjs';

const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/auth-primitives'));
const modal = '[role="dialog"]';
const selectors = { submit: '[data-auth-dialog] button[type="submit"]', provider: '[data-auth-dialog] button[title]:disabled', input: '[data-auth-dialog] input[name="username"]', create: '[data-auth-dialog] > button' };
const cases = [], errors = [], requests = [];
const report = { ok: false, scope: 'Pinned official Modal chrome and Button/Input primitives; local-account content and auth behavior are separate', cases, errors, requests };
let browser, server;

async function metrics(page, selector, parent = false) {
  return page.$eval(selector, (selected, parent) => {
    const node = parent ? selected.parentElement : selected, box = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { rect: { x: box.x, y: box.y, width: box.width, height: box.height }, styles: Object.fromEntries([
      'backgroundColor', 'backgroundImage', 'color', 'font', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'opacity',
      'border', 'borderRadius', 'cornerShape', 'boxShadow', 'boxSizing', 'padding', 'gap', 'alignItems', 'justifyContent',
    ].map(key => [key, css[key]])), disabled: selected.matches(':disabled') };
  }, parent);
}

try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const label = `${locale}-${theme}-${width}`, pages = [], comparisons = [];
    for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push({ label, side, message: error.message }));
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        const path = new URL(request.url()).pathname;
        if (!path.startsWith('/api/')) { await request.continue(); return; }
        requests.push({ label, side, path, method: request.method() });
        if (path === '/api/auth-policy' && request.method() === 'GET') {
          await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ signUpEnabled: false }) });
        } else await request.abort();
      });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'auth-primitives', locale, side })}`, { waitUntil: 'networkidle0' });
      await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
      await page.waitForSelector(modal, { visible: true });
      await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await settle(page); pages.push(page);
    }
    const [reference, adapted] = pages;
    const body = await adapted.$eval('[data-auth-dialog]', node => { const r = node.getBoundingClientRect(); return { bodyHeight: r.height, bodyX: r.x, bodyY: r.y }; });
    await reference.evaluate(body => window.__AUTH_PRIMITIVES__.setLayout(body), body); await settle(reference);
    const officialModal = await metrics(reference, modal), actualModal = await metrics(adapted, modal);
    assert.deepEqual(actualModal, officialModal, `${label}: official modal geometry and appearance`);
    const compare = async (kind, actualSelector, officialSelector, { actualParent = false, officialParent = false, focused = false } = {}) => {
      const prepare = async (page, selector) => { if (focused) { await page.bringToFront(); await page.focus(selector); await settle(page); } };
      await prepare(adapted, actualSelector); const actual = await metrics(adapted, actualSelector, actualParent);
      await prepare(reference, officialSelector); const official = await metrics(reference, officialSelector, officialParent);
      assert.deepEqual(actual, official, `${label}/${kind}: exact official computed styles and geometry`);
      const pair = await stableCompare(`${label}-${kind}`,
        async () => { await prepare(reference, officialSelector); return stableScreenshot(reference, { clip: actual.rect, captureBeyondViewport: false }); },
        async () => { await prepare(adapted, actualSelector); return stableScreenshot(adapted, { clip: actual.rect, captureBeyondViewport: false }); });
      await writeFile(resolve(output, `${label}-${kind}-official.png`), pair.a);
      await writeFile(resolve(output, `${label}-${kind}-actual.png`), pair.b);
      assert.ok(pair.equal, `${label}/${kind}: exact official primitive pixels`);
      comparisons.push({ kind, metrics: actual, exactPixels: true });
    };
    await compare('header', `${modal} h2`, `${modal} h2`, { actualParent: true, officialParent: true });
    await compare('description', `${modal} > div > p`, `${modal} > div > p`);
    for (const kind of ['submit', 'provider', 'input', 'create']) {
      const actual = await metrics(adapted, selectors[kind], kind === 'input');
      await reference.evaluate(layout => window.__AUTH_PRIMITIVES__.setLayout(layout), { ...body, atom: kind, rect: actual.rect });
      await settle(reference);
      const officialSelector = kind === 'input' ? '[data-reference-auth-atom] input' : '[data-reference-auth-atom] button';
      await compare(kind, selectors[kind], officialSelector, { actualParent: kind === 'input', officialParent: kind === 'input' });
      if (kind === 'input') {
        await compare('input-focused', selectors.input, officialSelector, { actualParent: true, officialParent: true, focused: true });
        await reference.evaluate(() => document.activeElement.blur()); await adapted.evaluate(() => document.activeElement.blur());
      }
    }
    await adapted.screenshot({ path: resolve(output, `${label}-actual.png`), captureBeyondViewport: false });
    cases.push({ locale, theme, width, modal: actualModal, comparisons });
    for (const page of pages) await page.close();
    console.log(`auth primitives: ${label} passed`);
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.path === '/api/auth-policy' && request.method === 'GET'), 'primitive fixture never reads private data or authenticates');
  report.ok = true; console.log(JSON.stringify({ ok: true, cases: cases.length, comparisons: cases.reduce((total, item) => total + item.comparisons.length, 0), output }));
} catch (error) {
  report.error = String(error?.stack ?? error); throw error;
} finally {
  try { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); }
  finally {
    try { await closeAcceptanceBrowser(browser); }
    finally { await server?.httpServer.close(); }
  }
}
