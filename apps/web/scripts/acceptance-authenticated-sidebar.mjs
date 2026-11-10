#!/usr/bin/env node
/** Real authenticated shell: read-only remote acceptance; isolated local signup is explicit. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { remoteAcceptanceConfig, acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { registerOfficialSourceHooks } from '../../../scripts/build/official-source-hook.mjs';
import { localPackages } from '../../../scripts/conformance/lib.mjs';
import { readWorkerMetadataRows } from '../../../scripts/composition/metadata-roster.mjs';
registerOfficialSourceHooks();
const officialMore = await import('@deepseek-ai/dsh-client-ui-entry-customization/src/client/locales.ts');

const raw = process.env.DSH_BASE_URL;
const local = raw !== undefined && /^http:\/\/127\.0\.0\.1:\d+$/u.test(raw);
const config = local ? { base: raw, credentials: undefined } : remoteAcceptanceConfig();
const { base } = config;
const root = resolve(import.meta.dirname, '../../..');
const clientForks = localPackages(root).filter(({ manifest }) => manifest.dshBase?.client && manifest.dshBase?.reuse?.mode === 'fork' && manifest.dshBase?.forkOf)
  .map(({ manifest }) => ({ name: manifest.name, original: manifest.dshBase.forkOf.package }));
assert.equal(clientForks.length, 13, 'all marked client forks are covered by runtime acceptance');
const workerRoster = readWorkerMetadataRows(root);
assert.equal(workerRoster.length, 15, 'complete Worker composition is covered');
assert.equal(workerRoster.filter(row => row.origin === 'fork').length, 3, 'all marked Worker forks are covered');
const output = resolve(process.env.DSH_ACCEPTANCE_OUTPUT ?? process.env.DSH_ACCEPTANCE_OUT ?? join(root, `.artifacts/acceptance/sidebar-authenticated-${local ? 'local' : 'staging'}`));
mkdirSync(output, { recursive: true });
const report = { ok: false, base, checks: [], browserErrors: [], failedRequests: [], businessWrites: [] };
const request = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) });
const account = local ? { username: `sidebar${randomBytes(6).toString('hex')}`, name: 'Sidebar acceptance', email: `sidebar-${randomBytes(6).toString('hex')}@example.test`, password: randomBytes(24).toString('base64url') } : config.credentials;
let browser, page, cookie, selectionScript;
// Settle only the observed menu/dialog's finite entry animation, not global
// activity (the real app intentionally keeps live streams and timers open).
const waitForSurface = selector => page.waitForFunction(selector => {
  const target = [...document.querySelectorAll(selector)].find(element => element.getBoundingClientRect().width > 0);
  if (!target) return false;
  for (let element = target; element && element !== document.body; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') return false;
    if (element.getAnimations().some(animation => ['running', 'pending'].includes(animation.playState) && animation.effect?.getTiming().iterations !== Infinity)) return false;
  }
  return true;
}, { timeout: 10_000 }, selector);

// Observe both the legacy Host envelope and official generated endpoint paths.
function mutationOf(request) {
  const path = new URL(request.url()).pathname;
  if (!path.startsWith('/api/')) return undefined;
  if (['PUT', 'PATCH', 'DELETE'].includes(request.method())) return { path, method: request.method() };
  if (request.method() !== 'POST') return undefined;
  let method = path.split('/').at(-1) ?? '';
  if (path === '/api/session-host') {
    try { method = JSON.parse(request.postData() ?? '{}').method ?? ''; }
    catch { return { path, method: 'unreadable Host envelope' }; }
  }
  return /create|initializeDefault|mutate|update|delete|submit|prompt|write|rename|archive|insert|fork|selectModel|^set|^pin|^unpin|^stop|^cancel|^put|^retract/iu.test(method) ? { path, method } : undefined;
}
try {
  assert.ok(!local || process.env.DSH_LOCAL_REGISTRATION_TOKEN, 'explicit local registration token required');
  const login = await request(local ? '/api/auth/sign-up/email' : '/api/auth/sign-in/username', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(local ? { 'x-dsh-registration-token': process.env.DSH_LOCAL_REGISTRATION_TOKEN } : {}) }, body: JSON.stringify(account),
  });
  assert.equal(login.status, 200, 'acceptance account sign-in');
  cookie = login.headers.getSetCookie().join('; ').match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/u);
  assert.ok(cookie, 'session cookie');
  const headers = { origin: base, 'content-type': 'application/json', cookie: `${cookie[1]}=${cookie[2]}` };
  const host = async (method, params = {}) => {
    const response = await request('/api/session-host', { method: 'POST', headers, body: JSON.stringify({ method, params }) });
    assert.equal(response.status, 200, method);
    const body = await response.json(); assert.equal(body.error, undefined, method); return body.result;
  };
  const listAll = async () => {
    const sessions = [], seen = new Set(); let cursor;
    do {
      const page = await host('list', cursor === undefined ? {} : { cursor });
      sessions.push(...page.sessions); cursor = page.cursor;
      if (cursor !== undefined) { assert.ok(!seen.has(cursor), 'session-list cursor advances'); seen.add(cursor); }
    } while (cursor !== undefined);
    return sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  };
  const controls = async () => {
    const response = await request('/api/plugin-manager', { headers });
    assert.equal(response.status, 200, 'read plugin controls'); return response.json();
  };
  const before = local ? undefined : { list: await listAll(), settings: await host('settingsDescribe'), controls: await controls() };
  const existing = before?.list.find(row => !row.archived && !row.running && !row.blank);
  if (!local) assert.ok(existing, 'read-only remote acceptance requires an existing nonblank idle session');
  const runtime = await host('runtimeInfo');
  report.versionId = runtime.versionId;
  if (process.env.DSH_EXPECTED_DEPLOYMENT_VERSION) assert.equal(runtime.versionId, process.env.DSH_EXPECTED_DEPLOYMENT_VERSION, 'expected deployed Host version');
  const workerResponse = await request('/api/plugin-manager/inventory', { headers });
  assert.equal(workerResponse.status, 200, 'authenticated read-only Worker inventory');
  const workerEntries = (await workerResponse.json()).entries;
  assert.ok(Array.isArray(workerEntries), 'Worker inventory contains observed entries');
  assert.deepEqual(workerEntries.map(row => row.moduleName).sort(), workerRoster.map(row => row.name).sort(), 'all 15 Worker entries come from the actual loader');
  const workerComposition = workerEntries.map(({ entryId, moduleName, enabled, fiberPhase, origin }) => ({ entryId, moduleName, enabled, fiberPhase, origin }));
  for (const expected of workerRoster) {
    const row = workerComposition.find(row => row.moduleName === expected.name);
    assert.deepEqual(row, { entryId: expected.id, moduleName: expected.name, enabled: true, fiberPhase: 'active', origin: expected.origin }, `${expected.name}: observed Worker source and active fiber`);
  }
  report.checks.push({ workerComposition });
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, secure: !local, sameSite: 'Lax' });
  // Isolated browser state only: open a known conversation instead of asking
  // the official initial-restoration policy to create/reuse a new blank.
  if (existing) selectionScript = await page.evaluateOnNewDocument(({ sessionId, origin }) => {
    if (location.origin === origin) localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }));
  }, { sessionId: existing.sessionId, origin: base });
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) report.failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  let observeWrites = !local;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const mutation = observeWrites ? mutationOf(request) : undefined;
    if (mutation) { report.businessWrites.push(mutation); void request.abort('blockedbyclient'); }
    else void request.continue();
  });
  await page.goto(base + (existing ? '/app/session/' + encodeURIComponent(existing.sessionId) : '/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const forkNames = clientForks.map(row => row.name);
  await page.waitForFunction(names => names.every(name => window.__DSH_BASE_PLUGINS__?.some(row => row.moduleName === name && row.fiberPhase === 'active')), { timeout: 45_000 }, forkNames);
  await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label]')].some(button => /^(Account menu|账号菜单|账户菜单)$/u.test(button.getAttribute('aria-label'))), { timeout: 30_000 });
  const composition = await page.evaluate(names => names.map(moduleName => {
    const row = window.__DSH_BASE_PLUGINS__.find(row => row.moduleName === moduleName);
    return { moduleName, enabled: row?.enabled, fiberPhase: row?.fiberPhase, origin: row?.origin, ...(row?.replaces === undefined ? {} : { replaces: row.replaces }) };
  }), [...forkNames, ...clientForks.map(row => row.original)]);
  for (const expected of clientForks) {
    const fork = composition.find(row => row.moduleName === expected.name);
    const original = composition.find(row => row.moduleName === expected.original);
    assert.deepEqual(fork, { moduleName: expected.name, enabled: true, fiberPhase: 'active', origin: 'fork', replaces: expected.original }, `${expected.name}: marked fork has the correct live origin`);
    assert.deepEqual(original, { moduleName: expected.original, enabled: false, fiberPhase: null, origin: 'upstream' }, `${expected.original}: replaced official original stays disabled and unevaluated`);
  }
  report.checks.push({ composition });
  const byLabel = async expression => {
    const handle = await page.evaluateHandle(source => [...document.querySelectorAll('button')].find(button => new RegExp(source).test(button.getAttribute('aria-label') ?? '') && button.getBoundingClientRect().width > 0 && getComputedStyle(button).visibility !== 'hidden') ?? null, expression);
    const button = handle.asElement(); assert.ok(button, expression); return button;
  };
  const controlsToCheck = ['^(New [Ss]ession|新建会话)$', '^(Plugins|插件)$', '^(Automation tasks|自动化任务)$', '^(Search sessions|搜索会话)$', '^(View options|视图选项)$', '^(Add workspace|添加工作区)$'];
  // Account-name presence alone may precede the checked RemoteAccess baseline.
  await page.waitForFunction(expressions => expressions.every(source => [...document.querySelectorAll('button')].some(button => new RegExp(source).test(button.getAttribute('aria-label') ?? '') && button.getBoundingClientRect().width > 0 && !button.disabled && button.getAttribute('aria-disabled') !== 'true')), { timeout: 30_000 }, controlsToCheck);
  for (const expression of controlsToCheck) {
    const button = await byLabel(expression);
    assert.equal(await button.evaluate(element => element.disabled || element.getAttribute('aria-disabled') === 'true'), false, `${expression}: authenticated action available`);
  }
  report.language = await page.evaluate(() => document.documentElement.lang);
  report.checks.push({ sidebar: await page.evaluate(() => {
    let sidebar = document.querySelector('[data-sidebar-toggle]');
    while (sidebar?.parentElement && !(sidebar.querySelector('nav') && sidebar.querySelector('button[aria-haspopup="menu"]'))) sidebar = sidebar.parentElement;
    return [...sidebar.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).map(button => ({ label: button.getAttribute('aria-label') ?? '', text: button.textContent.trim(), disabled: button.disabled || button.getAttribute('aria-disabled') === 'true' }));
  }) });
  // Local signup is isolated; allow its normal first-workspace bootstrap to
  // settle before the same read-only UI sequence used against Staging.
  if (local) await page.waitForFunction(() => document.querySelector('[data-workspace-access]') === null && document.querySelector('[class*="groupSection"]') !== null, { timeout: 30_000 });
  observeWrites = true;
  const settled = { list: await listAll(), settings: await host('settingsDescribe'), controls: await controls() };
  await (await byLabel('^(More|更多)$')).click();
  await page.waitForSelector('[role="menu"]', { visible: true });
  const locale = report.language.toLowerCase().split('-')[0];
  assert.ok(officialMore[locale], 'pinned official More dictionary');
  const expectedMore = [officialMore[locale].install, officialMore[locale].create];
  await page.waitForFunction(labels => labels.every(label => [...document.querySelectorAll('[role="menuitem"]')].some(element => element.textContent.trim() === label)), { timeout: 15_000 }, expectedMore);
  const menu = await page.$$eval('[role="menuitem"]', elements => elements.filter(element => element.getBoundingClientRect().width > 0).map(element => ({ text: element.textContent.trim(), disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' })));
  assert.deepEqual(menu.map(row => row.text), expectedMore, 'exact pinned official More entries and order');
  assert.ok(menu.every(row => !row.disabled)); report.checks.push({ more: menu, actionsInvoked: false });
  await waitForSurface('[role="menu"]');
  await page.screenshot({ path: join(output, 'sidebar-more.png'), captureBeyondViewport: false });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="menu"]', { hidden: true });
  const directoryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/directoryPicker/list', { timeout: 20_000 });
  await (await byLabel('^(Add workspace|添加工作区)$')).click();
  const listingResponse = await directoryResponse;
  assert.equal(listingResponse.status(), 200, 'real directory list HTTP response');
  const listingBody = await listingResponse.json();
  assert.equal(listingBody.type, 'server-response', 'official directory carrier envelope');
  assert.equal(listingBody.result?.ok, true, 'directory list succeeds, not only dialog visibility');
  await page.waitForSelector('[role="dialog"]', { visible: true });
  assert.equal(await page.$eval('[role="dialog"]', dialog => dialog.querySelector('[role="alert"]') !== null), false, 'directory picker has no error');
  await waitForSurface('[role="dialog"]');
  await page.screenshot({ path: join(output, 'directory-picker.png'), captureBeyondViewport: false });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  report.checks.push({ directoryPicker: 'real directory listing succeeded; no create/open action invoked' });
  await page.screenshot({ path: join(output, 'sidebar.png'), captureBeyondViewport: false });
  const after = { list: await listAll(), settings: await host('settingsDescribe'), controls: await controls() };
  assert.deepEqual(after, before ?? settled, 'read-only UI preserves sessions, settings and plugin controls');
  report.checks.push({ stateUnchanged: true });
  assert.deepEqual(report.businessWrites, [], 'no attempted business mutation from read-only UI');
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.failedRequests, []);
  report.ok = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  if (page) await page.screenshot({ path: join(output, 'failure.png'), captureBeyondViewport: false }).catch(() => {});
  throw error;
} finally {
  if (page && cookie) {
    if (selectionScript) await page.removeScriptToEvaluateOnNewDocument(selectionScript.identifier);
    await page.goto('about:blank').catch(() => {});
    await page.deleteCookie({ name: cookie[1], url: base }).catch(() => {});
  }
  await closeAcceptanceBrowser(browser);
  const cleanupFailed = report.ok && (report.browserErrors.length > 0 || report.failedRequests.length > 0 || report.businessWrites.length > 0);
  if (cleanupFailed) { report.ok = false; report.failure = 'Unexpected browser activity during acceptance cleanup'; }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (cleanupFailed) throw new Error(report.failure);
}
console.log(`Authenticated sidebar: all 13 client forks, 15 Worker entries including 3 forks, disabled originals, six enabled entries, exact official More and real directory read passed (${local ? 'local' : 'remote'})`);
