#!/usr/bin/env node
/** Deployed inventory/read-only acceptance; never grants roles or publishes site values. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { remoteAcceptanceConfig, acceptanceLaunchOptions, assertHttpStatus, closeAcceptanceBrowser, recordHttpFailure } from './acceptance-config.mjs';
import { readOwnedPluginInventory } from '../tests/parity/owned-plugin-inventory-oracle.mjs';
import { managerCopy } from '../tests/parity/plugin-manager-assertions.mjs';
import { localizePath } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';

const { base, credentials } = remoteAcceptanceConfig();
const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
assert.ok(expectedVersion, 'An exact deployed version is required');
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT ?? new URL('../../../.artifacts/acceptance/global-settings-staging', import.meta.url).pathname);
mkdirSync(artifacts, { recursive: true });
const report = { ok: false, base, expectedVersion, cases: [], errors: [], httpFailures: [], mutations: [], adminWritesTested: false };
const responseDiagnostics = [];
const request = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) });
let browser, page, restoreLocale;
const checkedJson = async (response, label) => {
  await assertHttpStatus(response, 200, report.httpFailures, label);
  return response.json();
};
async function clickText(selector, label) {
  const handle = await page.evaluateHandle(({ selector, label }) => [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === label), { selector, label });
  const element = handle.asElement(); assert.ok(element, `Missing control: ${label}`);
  try { await element.scrollIntoView(); await element.click(); } finally { await handle.dispose(); }
}
try {
  const response = await request('/api/auth/sign-in/username', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) });
  const login = await checkedJson(response, 'dedicated acceptance login');
  assert.ok(login.user?.id, 'login must identify the dedicated account');
  const match = response.headers.getSetCookie().join('; ').match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/u);
  assert.ok(match);
  const headers = { cookie: `${match[1]}=${match[2]}`, origin: base, 'content-type': 'application/json' };
  const host = async (method, params = {}) => { const reply = await checkedJson(await request('/api/session-host', { method: 'POST', headers, body: JSON.stringify({ method, params }) }), method); assert.equal(reply.error, undefined); return reply.result; };
  for (let attempt = 0; ; attempt++) {
    const runtime = await host('runtimeInfo');
    if (runtime.versionId === expectedVersion) { report.version = runtime.versionId; break; }
    assert.ok(attempt < 24, 'The new Worker version must reach the Host');
    console.log('[global-staging] waiting for deployed Host version');
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
  // The workbench opens these reads together. Keep the guest and account
  // requests in flight at the same time to exercise Worker request isolation.
  const [before, signedInSession, guestSession, guestSettings] = await Promise.all([
    request('/api/site-settings', { headers }).then(reply => checkedJson(reply, 'reader site settings')),
    request('/api/auth/get-session', { headers }).then(reply => checkedJson(reply, 'reader session')),
    request('/api/auth/get-session').then(reply => checkedJson(reply, 'guest session')),
    request('/api/site-settings'),
  ]);
  assert.ok(signedInSession?.user?.id === login.user.id, 'session must belong to the signed-in account');
  assert.ok(guestSession === null, 'guest session must be anonymous');
  await assertHttpStatus(guestSettings, 401, report.httpFailures, 'guest site settings');
  report.concurrentGuestAndReaderReads = true;
  assert.equal(before.canEdit, false, 'The dedicated acceptance account must remain a reader');
  const publicBefore = await checkedJson(await request('/api/site-config'), 'public site values');
  report.analytics = { enabled: publicBefore.analytics?.google?.enabled === true, ready: publicBefore.analytics?.google?.ready === true };
  assert.equal(publicBefore.brand.name, before.values.seo.site.name);
  // A denied write uses unchanged values and proves the server—not disabled UI—owns permission.
  const denied = await request('/api/site-settings', { method: 'PUT', headers, body: JSON.stringify({ expectedRevision: before.revision, values: before.values }) });
  await assertHttpStatus(denied, 403, report.httpFailures, 'reader site settings write'); assert.equal((await denied.json()).error, 'site_admin_required');
  const original = (await host('settingsDescribe')).values?.locale ?? {};
  const hadPreference = Object.hasOwn(original, 'preference');
  restoreLocale = async () => {
    await host('settingsMutate', { ns: 'locale', ops: [hadPreference ? { op: 'set', path: ['preference'], value: original.preference } : { op: 'unset', path: ['preference'] }] });
    const restored = (await host('settingsDescribe')).values?.locale ?? {};
    assert.equal(Object.hasOwn(restored, 'preference'), hadPreference); assert.deepEqual(restored.preference, original.preference);
  };
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === base && url.pathname.startsWith('/api/') && response.status() >= 500) {
      responseDiagnostics.push(recordHttpFailure(report.httpFailures, response, { path: url.pathname }));
    }
  });
  page.on('request', outgoing => { if (['/api/plugin-manager', '/api/site-settings'].includes(new URL(outgoing.url()).pathname) && !['GET', 'HEAD'].includes(outgoing.method())) report.mutations.push(outgoing.method()); });
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, secure: true, sameSite: 'Lax' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  const oracle = readOwnedPluginInventory();
  for (const locale of ['en', 'zh']) {
    await host('settingsUpdate', { ns: 'locale', patch: { preference: locale } });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base + localizePath('/', locale), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === 'active'), { timeout: 45_000 });
    await page.waitForFunction(() => document.querySelector('[data-plugin-panel]') !== null || document.querySelector('[contenteditable="true"]') !== null, { timeout: 45_000 });
    if (await page.$('[data-plugin-panel]') === null) await clickText('button', locale === 'zh' ? '插件' : 'Plugins');
    await page.waitForFunction(() => document.querySelector('[data-plugin-detail]') !== null || document.querySelector('[data-plugin-package="dsh-base:global"]') !== null, { timeout: 30_000 });
    if (await page.$('[data-plugin-detail]') !== null) await page.click(`[data-plugin-panel] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`);
    await page.waitForSelector('[data-plugin-package="dsh-base:global"]');
    const bundles = await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]', rows => rows.map(row => row.getAttribute('data-plugin-package')));
    assert.deepEqual(bundles.sort(), oracle.bundles.map(bundle => bundle.name).sort());
    await page.click('[data-plugin-package="dsh-base:global"] button[aria-describedby]');
    await page.waitForSelector('[data-global-settings][data-state="ready"]', { timeout: 30_000 });
    assert.equal(await page.$eval('[data-global-field="seo.site.name"] input', input => input.value), before.values.seo.site.name);
    assert.ok(await page.$$eval('[data-global-field] input, [data-global-field] textarea', inputs => inputs.length > 10 && inputs.every(input => input.disabled || input.readOnly)));
    const fiber = await page.evaluate(() => window.__DSH_BASE_PLUGINS__.find(row => row.moduleName === '@dsh-base/client-global-settings'));
    assert.equal(fiber?.fiberPhase, 'active');
    for (const width of [1440, 720]) {
      await page.setViewport({ width, height: 1000 });
      await page.$eval('[data-plugin-body]', body => { body.scrollTop = 0; });
      const overflow = await page.$eval('[data-plugin-body]', body => body.scrollWidth - body.clientWidth);
      assert.ok(overflow <= 1, 'configuration must not overflow its panel');
      await page.screenshot({ path: resolve(artifacts, `${locale}-${width}.png`), captureBeyondViewport: false });
      await page.$eval('[data-global-page-path]', control => control.scrollIntoView({ block: 'center' }));
      const selector = await page.$eval('[data-global-page-path]', control => {
        const rect = control.getBoundingClientRect(), style = getComputedStyle(control);
        return { width: rect.width, height: rect.height, paddingRight: style.paddingRight, appearance: style.appearance, arrowPosition: style.backgroundPosition, disabled: control.disabled, labels: control.labels.length };
      });
      assert.ok(selector.width > 100 && selector.width <= 240, 'page selector retains official enum width');
      assert.equal(selector.height, 32); assert.equal(selector.paddingRight, '32px');
      assert.equal(selector.appearance, 'none'); assert.equal(selector.arrowPosition, 'calc(100% - 12px) 50%');
      assert.equal(selector.disabled, true); assert.equal(selector.labels, 1);
      assert.equal(await page.$eval('[data-global-language]', control => control.disabled), false, 'readers can view other languages');
      await page.screenshot({ path: resolve(artifacts, `${locale}-${width}-page-selector.png`), captureBeyondViewport: false });
      report.cases.push({ locale, width, bundles: bundles.length, components: oracle.rows.length, readerReadonly: true, overflow, selector });
    }
    const scoped = [
      ['cloudflare:worker:seo', 'seo'], ['cloudflare:worker:sitemap', 'sitemap'], ['cloudflare:worker:robots', 'robots'],
      ['cloudflare:worker:manifest', 'manifest'], ['cloudflare:worker:llms', 'llms'],
      ['client:google-analytics', 'googleAnalytics'], ['cloudflare:worker:google-analytics', 'googleAnalytics'],
    ];
    for (const [id, scope] of scoped) {
      const control = `[data-plugin-row=${JSON.stringify(id)}] button[class*="rowOpen"]`;
      await page.$eval(control, button => button.scrollIntoView({ block: 'center' })); await page.click(control);
      await page.waitForSelector(`[data-global-scope=${JSON.stringify(scope)}][data-state="ready"]`);
      assert.ok(await page.$$eval('[data-global-field] input, [data-global-field] textarea, [data-global-field] [role="switch"]', inputs => inputs.every(input => input.disabled || input.readOnly)), `${id}: scoped reader controls stay disabled`);
      assert.equal(await page.$eval('[data-global-settings] button[class*="_save_"]', button => button.disabled), true, `${id}: a reader cannot save even an empty scope`);
      report.cases.push({ locale, component: id, scope, readerReadonly: true });
      const title = locale === 'zh' ? 'Dsh-base 全局' : 'Dsh-base Global';
      const back = `[data-plugin-row-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToPackage.replace('{name}', title))}]`;
      await page.click(back);
      await page.waitForSelector('[data-global-scope="global"][data-state="ready"]');
    }
  }
  assert.deepEqual(await checkedJson(await request('/api/site-settings', { headers }), 'unchanged site document'), before);
  assert.deepEqual(await checkedJson(await request('/api/site-config'), 'unchanged public document'), publicBefore);
  for (const path of ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/favicon.svg', '/llms.txt', localizePath('/llms.txt', 'zh')]) {
    const response = await request(path); assert.equal(response.status, 200, path);
  }
  const analyticsRoute = await request('/api/site-analytics/google');
  assert.equal(analyticsRoute.status, 405, 'the measurement plugin is mounted but GET never sends an event');
  assert.equal(analyticsRoute.headers.get('allow'), 'POST');
  await Promise.all(responseDiagnostics);
  assert.deepEqual(report.httpFailures, []);
  assert.deepEqual(report.mutations, []); assert.deepEqual(report.errors, []);
  report.siteConfigurationUnchanged = true; report.readerPutDenied = true; report.ok = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  await page?.screenshot({ path: resolve(artifacts, 'failure.png'), captureBeyondViewport: false }).catch(() => {});
  throw error;
} finally {
  try { await closeAcceptanceBrowser(browser); await Promise.all(responseDiagnostics); }
  finally {
    try { if (restoreLocale) { await restoreLocale(); report.localeRestored = true; } }
    catch (error) { report.ok = false; report.restoreFailure = String(error); throw error; }
    finally { writeFileSync(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  }
}
console.log(JSON.stringify(report));
