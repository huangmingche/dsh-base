#!/usr/bin/env node
/** Approved full anonymous layout from official styles, with real signed-out Host state. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../scripts/acceptance-config.mjs';
import { settle, stableCompare, stableScreenshot } from './stability.mjs';

const app = resolve(import.meta.dirname, '../..'), require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer-core'), vite = await import(require.resolve('vite'));
const configFile = resolve(app, 'vite.parity.config.ts');
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, 'dist/parity-evidence/anonymous-account'));
const cases = [], errors = [], apiRequests = [];
const report = { ok: false, scope: 'Approved anonymous full-layout extension, independently composed from pinned exported AccountSection styles and primitives. This is not the original signed-out renderer. Default auto parity is covered separately by run-account.mjs.', cases, errors, apiRequests };
let browser, server;
const actualSelector = '[data-anonymous-platform-account]', referenceSelector = '[data-reference-platform-account]';
const snapshot = (page, selector) => page.$eval(selector, fieldset => {
  const section = fieldset.querySelector('section');
  const elements = [section, ...section.querySelectorAll('*')];
  const rect = fieldset.getBoundingClientRect();
  return { text: section.textContent, label: section.getAttribute('aria-label'), disabled: fieldset.matches(':disabled'),
    reason: fieldset.getAttribute('title'), description: fieldset.getAttribute('aria-description'),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    elements: elements.map(element => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return { tag: element.tagName, text: element.children.length ? null : element.textContent, disabled: element.matches(':disabled'),
        rect: [r.x, r.y, r.width, r.height], styles: Object.fromEntries(['display', 'alignItems', 'justifyContent', 'font', 'color', 'backgroundColor', 'border', 'borderRadius', 'cornerShape', 'padding', 'margin', 'gap', 'minHeight', 'opacity'].map(key => [key, s[key]])) };
    }) };
});

try {
  await mkdir(output, { recursive: true }); await vite.build({ configFile, logLevel: 'error' });
  server = await vite.preview({ configFile, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`, launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--disable-gpu'] });
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const label = `${locale}-${theme}-${width}`, pages = [];
    for (const side of ['reference', 'adapted']) {
      const page = await browser.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push({ label, side, message: error.message }));
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push({ label, side, path: new URL(request.url()).pathname }); });
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.goto(`${origin}/?${new URLSearchParams({ surface: 'anonymous-account', locale, side })}`, { waitUntil: 'networkidle0' });
      await page.evaluate(theme => document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'), theme);
      await page.waitForSelector(side === 'reference' ? referenceSelector : actualSelector, { visible: true }); pages.push(page);
    }
    const [reference, adapted] = pages;
    const allocatedHeight = await adapted.$eval(actualSelector, element => element.getBoundingClientRect().height);
    await reference.evaluate(height => window.__ANONYMOUS_ACCOUNT_PARITY__.setHeight(height), allocatedHeight);
    for (const page of pages) { await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await settle(page); }
    const actual = await snapshot(adapted, actualSelector), official = await snapshot(reference, referenceSelector);
    assert.deepEqual(actual, official, `${label}: independent full-layout structure and official shared styles`);
    const pair = await stableCompare(label,
      () => stableScreenshot(reference, { clip: official.rect, captureBeyondViewport: false }),
      () => stableScreenshot(adapted, { clip: actual.rect, captureBeyondViewport: false }));
    await writeFile(resolve(output, `${label}-official.png`), pair.a); await writeFile(resolve(output, `${label}-adapted.png`), pair.b);
    assert.ok(pair.equal, `${label}: exact independent shared-style layout pixels`);
    const addition = await adapted.evaluate(() => {
      const platform = document.querySelector('[data-anonymous-platform-account]'), local = document.querySelector('[data-dsh-base-account-sign-in]');
      const p = platform.getBoundingClientRect(), l = local.getBoundingClientRect(), button = local.querySelector('[data-dsh-base-sign-in]');
      const { copy } = window.__ANONYMOUS_ACCOUNT_PARITY__;
      return { title: local.querySelector('[class*="name"]')?.textContent, description: local.querySelector('[class*="status"]')?.textContent,
        button: button.textContent, expected: copy, enabled: button.matches(':enabled'), appended: !!(platform.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING),
        separated: l.top >= p.bottom, noOverflow: document.documentElement.scrollWidth <= innerWidth,
        oldRows: document.querySelectorAll('[data-anonymous-account-extras], [data-anonymous-account-row]').length };
    });
    assert.equal(addition.title, addition.expected.title); assert.equal(addition.description, addition.expected.description); assert.equal(addition.button, addition.expected.signIn);
    for (const key of ['enabled', 'appended', 'separated', 'noOverflow']) assert.equal(addition[key], true, `${label}: ${key}`);
    assert.equal(addition.oldRows, 0);
    const anonymous = await adapted.evaluate(() => {
      const { reads, snapshot, officialCopy } = window.__ANONYMOUS_ACCOUNT_PARITY__;
      const platform = document.querySelector('[data-anonymous-platform-account]'), section = platform.querySelector('section');
      return { reads, frozen: Object.isFrozen(snapshot) && Object.isFrozen(snapshot.view),
        status: snapshot.view.status, attempt: snapshot.view.attempt, detailsAbsent: snapshot.details === undefined, avatarAbsent: snapshot.avatar === undefined,
        presentation: section.getAttribute('data-account-presentation'),
        expected: officialCopy, title: section.querySelector('[class*="name"]')?.textContent,
        statusText: section.querySelector('[role="status"]')?.textContent,
        labels: [...section.querySelectorAll('[class*="row"] > span:first-child')].map(element => element.textContent),
        placeholderCount: [...section.querySelectorAll('span')].filter(element => element.children.length === 0 && element.textContent === officialCopy.balanceSignedOut).length,
        actionCount: section.querySelectorAll('[class*="actions"], button').length,
        links: [...section.querySelectorAll('a')].map(element => ({ label: element.textContent, href: element.getAttribute('href'), disabled: element.getAttribute('aria-disabled'), tabIndex: element.tabIndex, opacity: getComputedStyle(element).opacity, cursor: getComputedStyle(element).cursor })),
      };
    });
    assert.equal(anonymous.status, 'signed-out'); assert.equal(anonymous.attempt, null); assert.equal(anonymous.frozen, true);
    assert.equal(anonymous.detailsAbsent, true); assert.equal(anonymous.avatarAbsent, true);
    assert.ok(anonymous.reads.length > 0 && anonymous.reads.every(read => read.status === 'signed-out' && read.attempt === null && read.detailsAbsent && read.avatarAbsent));
    assert.equal(anonymous.presentation, 'full-unavailable');
    assert.equal(anonymous.title, anonymous.expected.signedOut); assert.equal(anonymous.statusText, anonymous.expected.signInDescription);
    assert.deepEqual(anonymous.labels, [anonymous.expected.balance, anonymous.expected.bonusBalance, anonymous.expected.more]);
    assert.equal(anonymous.placeholderCount, 2, 'both balances explicitly require sign-in; no invented amounts or loading state');
    assert.equal(anonymous.actionCount, 0, 'no fake active authentication, cancel button, or Platform sign-in entry');
    assert.deepEqual(anonymous.links.map(link => link.label), [anonymous.expected.accountInfo, anonymous.expected.usage, anonymous.expected.topUp]);
    assert.ok(anonymous.links.every(link => link.href === null && link.disabled === 'true' && link.tabIndex === -1 && link.opacity === '0.4' && link.cursor === 'not-allowed'));
    await adapted.bringToFront();
    const before = adapted.url(), popups = []; adapted.on('popup', popup => popups.push(popup));
    for (const anchor of await adapted.$$(`${actualSelector} a`)) {
      await anchor.click(); await anchor.focus(); await adapted.keyboard.press('Enter'); await adapted.keyboard.press('Space');
      await anchor.click({ button: 'middle' });
      await anchor.evaluate(element => { element.click(); for (const type of ['auxclick', 'contextmenu']) element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'auxclick' ? 1 : 2 })); });
    }
    assert.equal(adapted.url(), before); assert.equal(popups.length, 0);
    assert.deepEqual(await adapted.evaluate(() => window.__ANONYMOUS_ACCOUNT_PARITY__.calls), [], 'unavailable Platform entries never navigate or authenticate');
    await adapted.focus('[data-dsh-base-sign-in]');
    await adapted.keyboard.down('Shift'); await adapted.keyboard.press('Tab'); await adapted.keyboard.up('Shift');
    assert.equal(await adapted.$eval(actualSelector, element => element.contains(document.activeElement)), false, 'keyboard traversal skips the unavailable official control');
    await adapted.focus('[data-dsh-base-sign-in]'); await adapted.keyboard.press('Enter');
    assert.deepEqual(await adapted.evaluate(() => window.__ANONYMOUS_ACCOUNT_PARITY__.calls), ['local/signIn'], 'only the appended local action authenticates');
    await adapted.evaluate(() => window.scrollTo(0, 0));
    await adapted.screenshot({ path: resolve(output, `${label}-complete.png`), captureBeyondViewport: false });
    cases.push({ locale, theme, width, allocatedHeight, exactSharedStylePixels: true, directOfficialSignedOutReference: false, approvedDifference: 'Expose complete official layout from signed-out state with disabled account actions', officialStyleRegion: actual, anonymous, addition, platformCalls: 0, localCalls: 1 });
    for (const page of pages) await page.close(); console.log(`anonymous account: ${label} passed`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []); report.ok = true;
  console.log(JSON.stringify({ ok: true, cases: cases.length, output }));
} catch (error) { report.error = String(error?.stack ?? error); throw error; }
finally {
  try { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); }
  finally {
    try { await closeAcceptanceBrowser(browser); }
    finally { await server?.httpServer.close(); }
  }
}
