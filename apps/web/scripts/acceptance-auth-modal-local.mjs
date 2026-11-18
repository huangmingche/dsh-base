#!/usr/bin/env node
/** Real Better Auth and temporary D1: no deployed credentials or remote account writes. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { pluginSchemas, applyPluginSchema } from './plugin-schemas.mjs';
import { registerOfficialSourceHooks } from '../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const { en: sidebarCopy } = await import('@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts');
const newSessionLabel = sidebarCopy['session.new.label'];
const newSessionSelector = `button[aria-label=${JSON.stringify(newSessionLabel)}][class*="newSession"]`;

const app = resolve(import.meta.dirname, '..'), root = resolve(app, '../..');
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUTPUT ?? join(root, '.artifacts/acceptance/auth-modal-local'));
mkdirSync(artifacts, { recursive: true });
const output = join(app, '.cloudflare/output/v0/workers/default');
const config = JSON.parse(readFileSync(join(output, 'worker.config.json'), 'utf8'));
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const directory = mkdtempSync(join(tmpdir(), 'dsh-auth-modal-'));
const port = Number(process.env.DSH_LOCAL_PORT ?? 5197), base = `http://127.0.0.1:${port}`;
assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536);
const registrationToken = randomBytes(32).toString('base64url');
const bindings = Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === 'text').map(([key, row]) => [key, row.value]));
Object.assign(bindings, { AUTH_BASE_URL: base, AUTH_SECRET: randomBytes(32).toString('hex'), CREDENTIALS_KEY: randomBytes(32).toString('base64'), AUTH_SIGNUP_ENABLED: 'false', AUTH_REGISTRATION_TOKEN: registrationToken, SITE_ADMIN_USER_IDS: '[]', PLATFORM_AI_ENABLED: 'false' });
const report = { ok: false, base, realAuth: true, checks: [], layouts: [], browserErrors: [], outboundRequests: [], authResponses: [], directDenials: [] };
const options = () => convertV4MiniflareOptions({
  host: '127.0.0.1', port, modulesRoot: join(output, 'bundle'),
  modules: ['index.js', ...readdirSync(join(output, 'bundle'), { recursive: true }).filter(file => file.endsWith('.js') && file !== 'index.js')].map(file => ({ type: 'ESModule', path: join(output, 'bundle', file) })),
  compatibilityDate: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? '2026-10-30', compatibilityFlags: config.compatibilityFlags, bindings,
  outboundService: async request => { report.outboundRequests.push(new URL(request.url).origin); return new Response('Forbidden in local acceptance', { status: 503 }); },
  durableObjects: Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === 'durable-object').map(([name, row]) => [name, { className: row.exportName, useSQLite: true }])),
  durableObjectsPersist: join(directory, 'do'), d1Databases: ['AUTH_DB'], d1Persist: join(directory, 'd1'), r2Buckets: ['FILES'], r2Persist: join(directory, 'r2'),
  assets: { directory: join(output, 'assets'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
});
const request = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(25000) });
const identity = label => { const suffix = randomBytes(8).toString('hex'); return { username: `am${suffix}`, name: label, email: `am-${suffix}@example.test`, password: randomBytes(24).toString('base64url') }; };
const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let mf, browser, page;
const modal = '[role="dialog"]:has([data-auth-dialog])';
const visible = selector => page.waitForSelector(selector, { visible: true });
async function clickText(selector, text) {
  const handle = await page.evaluateHandle(({ selector, text }) => [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text && element.getBoundingClientRect().width > 0) ?? null, { selector, text });
  assert.ok(handle.asElement(), `missing ${selector}: ${text}`);
  try { await handle.asElement().click(); } finally { await handle.dispose(); }
}
async function fill(selector, value) { await visible(selector); await page.$eval(selector, element => { element.focus(); element.select(); }); await page.keyboard.type(value); }
async function submit() { await page.click(`${modal} button[type="submit"]`); }
async function openGate() {
  await page.waitForFunction(mobile => Boolean(document.querySelector('[data-sidebar-drawer]')) === mobile, {}, page.viewport().width === 390);
  if (await page.$('[data-sidebar-drawer][data-sidebar-collapsed]')) { await page.click('[data-sidebar-opener]'); }
  await page.waitForFunction(selector => {
    const button = document.querySelector(selector); if (!button) return false;
    const box = button.getBoundingClientRect();
    return !button.disabled && !button.closest('[inert]') && !document.querySelector('[data-sidebar-drawer][data-sidebar-collapsed]')
      && button.getAttribute('aria-disabled') !== 'true' && box.width > 0 && box.x >= 0 && box.right <= innerWidth;
  }, {}, newSessionSelector);
  await page.click(newSessionSelector); await visible(modal);
}
async function closeGate() { await page.keyboard.press('Escape'); await page.waitForSelector(modal, { hidden: true }); }
async function checkFocusTrap() {
  await page.focus(`${modal} button`);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:has([data-auth-dialog])')), true, 'Tab stays inside modal');
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:has([data-auth-dialog])')), true, 'Shift+Tab stays inside modal');
  }
}
async function anonymousPage() {
  const context = await browser.createBrowserContext();
  page = await context.newPage(); page.setDefaultTimeout(30000); await page.bringToFront();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  // Expected invalid-password responses are asserted below, not suppressed globally.
  page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/auth/')) report.authResponses.push({ path, method: response.request().method(), status: response.status() }); });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await visible('[data-signed-out="true"]');
  return context;
}

try {
  mf = new Miniflare(options()); await mf.ready;
  const database = await mf.getD1Database('AUTH_DB');
  const schemas = readdirSync(join(app, 'migrations')).filter(name => name.endsWith('.sql')).sort().map(name => join(app, 'migrations', name));
  for (const file of schemas) for (const sql of readFileSync(file, 'utf8').replace(/--[^\n]*/g, '').split(';').filter(value => value.trim())) await database.prepare(sql).run();
  for (const schema of pluginSchemas(root)) await applyPluginSchema(schema, async sql => (await database.prepare(sql).all()).results);
  const user = identity('Modal acceptance');
  assert.equal((await post('/api/auth/sign-up/email', user)).status, 403, 'closed signup remains enforced server-side');
  const seeded = await post('/api/auth/sign-up/email', user, { 'x-dsh-registration-token': registrationToken });
  assert.equal(seeded.status, 200); const userId = (await seeded.json()).user.id;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  const context = await anonymousPage();
  for (const scheme of ['light', 'dark']) for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 }); await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await openGate();
    const geometry = await page.$eval(modal, element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      const controls = [
        ['submit', element.querySelector('button[type="submit"]')],
        ['input', element.querySelector('input').parentElement],
        ['provider', element.querySelector('button[title]:disabled')],
      ].map(([kind, node]) => {
        const css = getComputedStyle(node), rect = node.getBoundingClientRect();
        const verticalEdges = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'].reduce((total, key) => total + parseFloat(css[key]), 0);
        return { kind, borderRadius: css.borderRadius, cornerShape: css.cornerShape, height: rect.height, cssHeight: css.height,
          boxSizing: css.boxSizing, verticalEdges, font: css.font, background: css.backgroundColor };
      });
      return { controls, x: box.x, y: box.y, width: box.width, height: box.height, viewport: innerWidth, background: style.backgroundColor, radius: style.borderRadius,
        controlRadius: style.getPropertyValue('--dsw-radius-md').trim(), panelRadius: style.getPropertyValue('--dsw-radius-panel').trim(),
        ariaModal: element.getAttribute('aria-modal'), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.width, Math.min(380, width - 48), 'official Modal width and outer spacing');
    assert.ok(geometry.x >= 24 && geometry.y >= 24, 'modal stays within official viewport insets'); assert.equal(geometry.overflow, false);
    assert.equal(geometry.ariaModal, 'true'); assert.equal(geometry.radius, geometry.panelRadius);
    for (const control of geometry.controls) {
      assert.equal(control.borderRadius, geometry.controlRadius, `${control.kind}: official control radius token`);
      const officialHeight = control.kind === 'input' ? 32 : 36;
      assert.equal(control.cssHeight, `${officialHeight}px`, `${control.kind}: official primitive CSS height`);
      assert.equal(control.height, officialHeight + (control.boxSizing === 'border-box' ? 0 : control.verticalEdges), `${control.kind}: official box model determines rendered height`);
    }

    assert.ok(await page.$(`${modal} [data-auth-step="identifier"]`), 'one shared entry surface');
    assert.equal(await page.$$eval(`${modal} button:disabled`, rows => rows.length >= 3), true, 'unimplemented social providers remain unavailable');
    await checkFocusTrap(); await page.screenshot({ path: join(artifacts, `${scheme}-${width}.png`), captureBeyondViewport: false });
    report.layouts.push({ scheme, width, geometry });
    await page.click(`${modal} button[aria-label="Close"]`); await page.waitForSelector(modal, { hidden: true });
    await openGate(); await page.mouse.click(1, 1); await page.waitForSelector(modal, { hidden: true });
    await openGate(); await closeGate();
    if (width === 1280) assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), newSessionLabel, 'close restores trigger focus');
  }
  await page.setViewport({ width: 390, height: 360 }); await openGate();
  const shortScreen = await page.$eval(modal, element => {
    const box = element.getBoundingClientRect(), content = element.querySelector('.dsh-auth-scroll'), close = element.querySelector('button[aria-label="Close"]').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, viewportHeight: innerHeight, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
      closeVisible: close.top >= 24 && close.bottom <= innerHeight - 24 };
  });
  assert.ok(shortScreen.y >= 24 && shortScreen.y + shortScreen.height <= shortScreen.viewportHeight - 24, 'short-screen modal retains official vertical insets');
  assert.ok(shortScreen.scrollHeight > shortScreen.clientHeight, 'short screen scrolls within the official modal content');
  assert.equal(shortScreen.closeVisible, true, 'close is visible before scrolling');
  await page.click(`${modal} button[aria-label="Close"]`); await page.waitForSelector(modal, { hidden: true });
  await openGate(); await fill(`${modal} input[name="username"]`, 'short-screen-layout'); await submit();
  await visible(`${modal} [data-auth-step="password"]`);
  await clickText(`${modal} button`, 'Back');
  await clickText(`${modal} button`, 'Create an account'); await visible(`${modal} [data-auth-step="register"]`);
  await page.$eval(`${modal} .dsh-auth-scroll`, element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(artifacts, 'short-screen-register.png'), captureBeyondViewport: false });
  await page.click(`${modal} button[aria-label="Close"]`); await page.waitForSelector(modal, { hidden: true });
  report.shortScreen = { ...shortScreen, submitAndCreateReachable: true, closed: true };
  report.checks.push('short-screen modal scroll, visible close and reachable submit/create actions');
  await page.setViewport({ width: 1280, height: 900 });
  await openGate();
  await clickText(`${modal} button`, 'Create an account');
  await visible(`${modal} [data-auth-step="register"]`);
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Public registration is disabled'), {}, modal);
  assert.equal(await page.$eval(`${modal} button[type="submit"]`, el => el.disabled), true, 'closed registration submit remains disabled');
  await clickText(`${modal} button`, 'I already have an account');
  await fill(`${modal} input[name="username"]`, user.username); await submit();
  await visible(`${modal} [data-auth-step="password"]`);
  await fill(`${modal} input[name="password"]`, 'deliberately-wrong-password');
  const failure = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/username' && response.request().method() === 'POST');
  await submit(); assert.equal((await failure).status(), 401);
  await visible(`${modal} [role="alert"]`);
  assert.equal((await page.evaluate(async () => (await fetch('/api/auth/get-session')).json()))?.user, undefined, 'invalid credentials do not authenticate');
  await closeGate(); await openGate();
  assert.equal(await page.$eval(`${modal} input[name="username"]`, el => el.value), '', 'reopening clears identifier');
  assert.equal(await page.$(`${modal} input[name="password"]`), null, 'reopening clears password step');
  assert.equal(await page.$(`${modal} [role="alert"]`), null, 'reopening clears prior failure');
  await fill(`${modal} input[name="username"]`, user.username); await submit();
  await fill(`${modal} input[name="password"]`, user.password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), submit()]);
  await page.waitForSelector('[data-signed-out="true"]', { hidden: true });
  const session = await page.evaluate(async () => (await fetch('/api/auth/get-session')).json());
  assert.equal(session.user.id, userId, 'UI login uses the seeded actual Better Auth identity');
  assert.equal(await page.$(modal), null);
  await context.close();
  report.checks.push('responsive modal, keyboard focus containment and restoration', 'unavailable providers and closed registration', 'invalid password 401 with visible error', 'successful username login returns to app with real cookie');

  const emailContext = await anonymousPage();
  await page.goto(`${base}/login?next=${encodeURIComponent('https://example.com/unsafe-return')}`, { waitUntil: 'domcontentloaded' });
  await visible(modal); await fill(`${modal} input[name="username"]`, user.email); await submit(); await fill(`${modal} input[name="password"]`, user.password);
  const emailResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), submit()]);
  assert.equal((await emailResponse).status(), 200, 'email login uses the actual email endpoint');
  assert.equal(new URL(page.url()).origin, base, 'external next never changes origin');
  assert.equal(new URL(page.url()).pathname, '/', 'unsafe next falls back to public root');
  const emailSession = await page.evaluate(async () => (await fetch('/api/auth/get-session')).json()); assert.equal(emailSession.user.id, userId);
  await emailContext.close(); report.checks.push('email login', 'external next rejected', 'dismiss/reopen clears entered credentials and errors');

  for (const path of ['/api/site-settings', '/api/plugin-manager', '/api/session/list', '/api/directoryPicker/list', '/api/schedule/catalog']) {
    const response = await request(path, path.endsWith('/list') || path.includes('/schedule/') ? { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' } : {});
    assert.equal(response.status, 401, `${path}: anonymous access still denied`); report.directDenials.push({ path, status: response.status });
  }

  bindings.AUTH_SIGNUP_ENABLED = 'true'; await mf.setOptions(options()); await mf.ready;
  const registrationContext = await anonymousPage(); await openGate();
  await clickText(`${modal} button`, 'Create an account');
  await visible(`${modal} [data-auth-step="register"]`);
  const fresh = identity('Public registration acceptance');
  await fill(`${modal} input[name="username"]`, fresh.username); await fill(`${modal} input[name="email"]`, fresh.email); await fill(`${modal} input[name="password"]`, fresh.password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), submit()]);
  const registered = await page.evaluate(async () => (await fetch('/api/auth/get-session')).json());
  assert.equal(registered.user.username, fresh.username); assert.notEqual(registered.user.id, userId);
  await registrationContext.close();
  report.checks.push('registration policy enables actual signup only when configured', 'private endpoints stay 401 without cookies');
  assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.outboundRequests, []); report.ok = true;
  console.log(JSON.stringify({ ok: true, checks: report.checks, artifacts }));
} catch (error) {
  report.failure = String(error?.stack ?? error); await page?.screenshot({ path: join(artifacts, 'failure.png'), captureBeyondViewport: false }).catch(() => {}); throw error;
} finally {
  await closeAcceptanceBrowser(browser); await mf?.dispose(); rmSync(directory, { recursive: true, force: true }); writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
