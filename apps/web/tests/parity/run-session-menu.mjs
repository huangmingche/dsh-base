#!/usr/bin/env node
/** Pinned official Session menu: real plugin registration, pixels and browser-controller contracts. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { settle, stableCompare, stableScreenshot } from './stability.mjs';

const app = resolve(import.meta.dirname, '../..'), root = resolve(app, '../..');
const require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/session-menu'));
const transcript = '# Complete Session\n\n> First message outside the loaded page\n\nFinal response.\n';
const cases = [], errors = [];
const report = { ok: false, scope: 'Pinned official Session header more menu and browser controllers; controlled HTTP, clipboard and download carrier. Real owner authorization, persisted logs and R2 archive bytes require separate Host acceptance.', cases, errors };
let browser, server;
const watchdog = setTimeout(() => {
  report.error = 'Session-menu acceptance exceeded the ten-minute whole-run limit';
  console.error(report.error);
  void writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)).finally(() => {
    browser?.process()?.kill('SIGTERM'); process.exit(1);
  });
}, 600_000);

async function snapshot(page) {
  return page.evaluate(() => ({
    text: document.body.innerText,
    controls: [...document.querySelectorAll('button,[role="menu"],[role="dialog"]')].map(node => {
      const box = node.getBoundingClientRect(), css = getComputedStyle(node);
      return { role: node.getAttribute('role'), label: node.getAttribute('aria-label'), text: node.textContent,
        disabled: node.matches(':disabled'), expanded: node.getAttribute('aria-expanded'), busy: node.getAttribute('aria-busy'),
        rect: [box.x, box.y, box.width, box.height].map(value => Math.round(value * 100) / 100),
        css: [css.color, css.backgroundColor, css.borderRadius, css.fontSize, css.padding, css.gap] };
    }),
  }));
}

try {
  await mkdir(output, { recursive: true });
  const profile = JSON.parse(await readFile(resolve(app, 'composition.profile.json'), 'utf8'));
  const rows = Object.values(profile).find(value => Array.isArray(value));
  assert.ok(rows?.some(row => row.name === '@deepseek-ai/dsh-session-log-export' && !row.disabled && row.module === '@deepseek-ai/dsh-session-log-export/client'), 'production composition must mount the unchanged official export browser plugin');
  await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, protocolTimeout: 30_000, args: [...launch.args, '--disable-gpu'] });
  async function open(locale, theme, width, side, files = false) {
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push({ locale, theme, width, side, message: error.message }));
    const requests = []; let markdownStatus = 200, exportStatus = 200;
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) { await request.continue(); return; }
      requests.push({ path: url.pathname, method: request.method(), sessionId: url.searchParams.get('sessionId'), descendants: url.searchParams.get('includeDescendants') });
      if (url.pathname === '/api/session.markdown' && request.method() === 'GET') {
        await request.respond({ status: markdownStatus, contentType: 'text/markdown', body: markdownStatus === 200 ? transcript : 'read rejected' });
      } else if (url.pathname === '/api/session.export' && request.method() === 'HEAD') {
        await request.respond({ status: exportStatus, contentType: 'application/zip' });
      } else { errors.push({ side, unexpectedRequest: request.url() }); await request.abort(); }
    });
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'session-menu', locale, side, ...(files ? {files: '1'} : {}) })}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__SESSION_MENU__?.originalHeader === true);
    await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
    const words = await page.evaluate(() => window.__SESSION_MENU__.copy);
    return { page, requests, words, more: `button[aria-label="${words['header.more']}"]`, failMarkdown: value => { markdownStatus = value ? 500 : 200; }, failExport: value => { exportStatus = value ? 403 : 200; } };
  }
  async function menu(target) {
    await target.page.bringToFront();
    await target.page.click(target.more); await target.page.waitForSelector('[role="menu"]', { visible: true });
  }
  async function choose(target, index) {
    const items = await target.page.$$('[role="menuitem"]');
    await items[index].click();
  }
  async function compare(label, reference, adapted) {
    for (const { page } of [reference, adapted]) {
      await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await settle(page);
    }
    assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${label}: official text, controls, geometry and styles`);
    const pair = await stableCompare(label,
      async () => { await reference.page.bringToFront(); return stableScreenshot(reference.page, { captureBeyondViewport: false }); },
      async () => { await adapted.page.bringToFront(); return stableScreenshot(adapted.page, { captureBeyondViewport: false }); });
    await writeFile(resolve(output, `${label}-official.png`), pair.a); await writeFile(resolve(output, `${label}-adapted.png`), pair.b);
    assert.ok(pair.equal, `${label}: exact pinned official pixels`);
  }
  for (const locale of ['en', 'zh']) {
    const reference = await open(locale, 'dark', 1280, 'reference', true), adapted = await open(locale, 'dark', 1280, 'adapted', true);
    const selector = '[data-files-page] [data-open-target="directory"] button';
    for (const target of [reference, adapted]) {
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('missing-directory'));
      await target.page.waitForSelector('[data-files-state="no-workspace"]');
      assert.equal(await target.page.$(selector), null);
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('loading'));
      await target.page.waitForSelector('[data-files-page]');
      assert.equal(await target.page.$(selector), null, 'waiting for the catalog preserves the official loading state');
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('unavailable'));
    }
    assert.equal(await reference.page.$(selector), null);
    const unavailable = await adapted.page.waitForSelector(selector + ':disabled');
    assert.match(await unavailable.evaluate(node => node.getAttribute('aria-label')), locale === 'zh' ? /当前部署不支持/ : /unavailable in this deployment/);
    await unavailable.click();
    assert.deepEqual(await adapted.page.evaluate(() => window.__SESSION_MENU__.launches), []);
    for (const target of [reference, adapted]) {
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('available'));
      await target.page.waitForSelector(selector + ':enabled');
      assert.equal((await target.page.$$(selector)).length, 1, 'the official action is the only native opener when available');
    }
    await compare(`files-available-${locale}`, reference, adapted);
    await adapted.page.click(selector);
    await adapted.page.waitForFunction(() => window.__SESSION_MENU__.launches.length === 1);
    assert.deepEqual(await adapted.page.evaluate(() => window.__SESSION_MENU__.launches), [{ app: 'vscode', path: '/workspace' }]);
    await reference.page.close(); await adapted.page.close();
    cases.push({ surface: 'Files directory toolbar', locale, exactComparisons: 1,
      checks: ['no workspace', 'pending catalog', 'disabled without application', 'native target launches once'] });
    console.log(`Files directory toolbar ${locale}: workspace, catalog loading, unavailable and official launch passed`);
  }
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const label = `${locale}-${theme}-${width}`;
    const reference = await open(locale, theme, width, 'reference'), adapted = await open(locale, theme, width, 'adapted');
    console.log(`session menu ${label}: comparing header`);
    await compare(`${label}-header`, reference, adapted);
    // Workers exposes a localized, disabled action in the original shared menu when
    // the official contribution has no eligible native application.
    await menu(reference); await menu(adapted);
    const native = async target => target.page.evaluateHandle(label => [...document.querySelectorAll('[role="menuitem"]')]
      .find(node => node.textContent.includes(label)), target.words.openIn);
    assert.equal((await native(reference)).asElement(), null);
    const disabled = (await native(adapted)).asElement();
    assert.ok(disabled, 'the unavailable entry remains visible in its official position');
    assert.equal(await disabled.evaluate(node => node.matches(':disabled,[aria-disabled=true]')), true);
    await disabled.evaluate(node => node.click());
    assert.deepEqual(await adapted.page.evaluate(() => window.__SESSION_MENU__.launches), []);
    for (const target of [reference, adapted]) {
      await target.page.bringToFront();
      await target.page.keyboard.press('Escape');
      await target.page.waitForSelector('[role="menu"]', { hidden: true });
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('available'));
      await menu(target);
      assert.deepEqual(await target.page.$$eval('[role="menuitem"]', items => items.map(node => node.textContent.trim())),
        ['menu.copyMarkdown', 'menu.download', 'openIn', 'menu.feedback'].map(key => target.words[key]), 'official order and translations');
    }
    await compare(`${label}-native-available`, reference, adapted);
    for (const target of [reference, adapted]) {
      await target.page.bringToFront();
      const opener = (await native(target)).asElement();
      assert.ok(opener);
      await opener.focus(); await target.page.keyboard.press('ArrowRight');
      await target.page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent.trim() === 'VS Code'));
    }
    await compare(`${label}-submenu`, reference, adapted);
    for (const target of [reference, adapted]) {
      await target.page.bringToFront();
      const option = await target.page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent.trim() === 'VS Code'));
      await option.asElement().click();
      await target.page.waitForFunction(() => window.__SESSION_MENU__.launches.length === 1);
      assert.deepEqual(await target.page.evaluate(() => window.__SESSION_MENU__.launches), [{ app: 'vscode', path: '/workspace' }]);
      await target.page.waitForSelector('[role="menu"]', { hidden: true });
      await target.page.evaluate(() => window.__SESSION_MENU__.setNativeState('missing-directory'));
      await menu(target);
      const entry = (await native(target)).asElement();
      if (target === adapted) assert.equal(await entry.evaluate(node => node.matches(':disabled,[aria-disabled=true]')), true);
      else assert.equal(entry, null);
    }
    console.log(`session menu ${label}: keyboard and downloads`);
    for (const target of [reference, adapted]) {
      await target.page.bringToFront();
      const { page } = target;
      await page.focus('[role="menuitem"]'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      assert.equal(await page.$eval(target.more, node => document.activeElement === node), true, 'Escape returns focus to the original trigger');
      await page.keyboard.press('Enter'); await page.waitForSelector('[role="menu"]');
      await page.waitForFunction(label => document.activeElement?.textContent.trim() === label, {}, target.words['menu.copyMarkdown']);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__SESSION_MENU__.copyState().notice?.kind === 'success');
      assert.deepEqual(await page.evaluate(() => window.__SESSION_MENU__.copies), [transcript], 'keyboard copy preserves complete Host Markdown');
      await page.evaluate(() => window.__SESSION_MENU__.clear());
      // A locale/session deep link must still use the root Host route through <base>.
      await page.evaluate(locale => history.replaceState(null, '', `/${locale === 'zh' ? 'zh-CN' : 'en'}/app/session/fixture`), locale);
      await menu(target); await choose(target, 1);
      await page.waitForFunction(() => window.__SESSION_MENU__.downloads.length === 1);
      const download = await page.evaluate(() => window.__SESSION_MENU__.downloads[0]);
      const url = new URL(download.url);
      assert.equal(url.pathname, '/api/session.export'); assert.equal(url.searchParams.get('sessionId'), 'session-menu-中文'); assert.equal(url.searchParams.get('includeDescendants'), 'true');
      assert.equal(download.filename, 'dsh-session-session-menu-__.zip');
      assert.equal(target.requests.at(-1).method, 'HEAD');
      await page.waitForSelector('[role="dialog"]');
    }
    await compare(`${label}-download`, reference, adapted);
    for (const target of [reference, adapted]) {
      await target.page.bringToFront();
      const { page } = target;
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await menu(target);
      const feedback = await page.evaluateHandle(label => [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent.trim() === label), target.words['menu.feedback']);
      await feedback.asElement().click();
      assert.deepEqual(await page.evaluate(() => window.__SESSION_MENU__.feedback), ['session-menu-中文'], 'feedback is delegated once to the existing official controller');
      assert.equal(target.requests.length, 2, 'opening feedback never submits data');
      target.failMarkdown(true);
      await menu(target); await choose(target, 0);
      await page.waitForFunction(() => window.__SESSION_MENU__.copyState().notice?.kind === 'preparationFailed');
      assert.deepEqual(await page.evaluate(() => window.__SESSION_MENU__.copies), [], 'failed Host reads never copy partial text');
      target.failMarkdown(false); await page.evaluate(() => window.__SESSION_MENU__.failClipboard(true));
      await menu(target); await choose(target, 0);
      await page.waitForFunction(() => window.__SESSION_MENU__.copyState().notice?.kind === 'clipboardFailed');
      assert.deepEqual(await page.evaluate(() => window.__SESSION_MENU__.copies), [], 'clipboard failure stays an error');
      await page.evaluate(() => { window.__SESSION_MENU__.clear(); window.__SESSION_MENU__.failClipboard(false); });
      target.failExport(true); await menu(target); await choose(target, 1);
      await page.waitForFunction(() => Object.values(window.__SESSION_MENU__.downloadState().bySession)[0]?.status === 'error');
      assert.deepEqual(await page.evaluate(() => window.__SESSION_MENU__.downloads), [], 'failed preflight never starts a download');
      await page.keyboard.press('Escape');
      target.failExport(false);
      const count = target.requests.length;
      await page.evaluate(() => window.__SESSION_MENU__.command('error'));
      assert.equal(target.requests.length, count, 'failed /export commands do not download');
      await page.evaluate(() => window.__SESSION_MENU__.command());
      await page.waitForFunction(() => window.__SESSION_MENU__.downloads.length === 1);
      assert.equal(target.requests.length, count + 1, 'successful /export uses the same official download controller');
      assert.ok(target.requests.every(request => request.sessionId === 'session-menu-中文'), 'all export operations retain the selected Session');
    }
    cases.push({ locale, theme, width, exactComparisons: 4, checks: ['production activation', 'official registration', 'unavailable native open remains disabled', 'available native open preserves official behavior', 'menu rows', 'Escape/focus return', 'keyboard Markdown copy', 'deep-link HEAD/download', 'feedback delegation', 'HTTP/clipboard failures', '/export success/error'] });
    await reference.page.close(); await adapted.page.close();
    console.log(`session menu ${label}: official pixels and export interactions passed`);
  }
  assert.deepEqual(errors, []);
  report.upstream = JSON.parse(await readFile(resolve(root, 'dsh-source.lock.json'), 'utf8')).commit;
  report.ok = true; console.log(JSON.stringify({ ok: true, cases: cases.length, comparisons: cases.reduce((sum, row) => sum + row.exactComparisons, 0), output }));
} catch (error) { report.error = String(error?.stack ?? error); throw error; }
finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  try { await closeAcceptanceBrowser(browser); await server?.close(); }
  finally { clearTimeout(watchdog); }
}
