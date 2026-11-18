#!/usr/bin/env node
/** Read-only release acceptance: deployed assets, complete plugin inventory and public publications. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, assertHttpStatus, closeAcceptanceBrowser, recordHttpFailure, remoteAcceptanceConfig } from './acceptance-config.mjs';
import { assertBaseRegistry, assertNoRetiredLinks, retiredDocuments } from './acceptance-public-routes.mjs';
import { readDeploymentConfig } from './deployment-config.mjs';
import { publicCatalogFromDeployment } from '../../../packages/boot/dsh-base-payment-catalog/src/index.ts';
import { readCatalog } from '../../../packages/client/dsh-base-client-waffo/src/client/payment-store.ts';
import { localizePath } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import { FIXED_AGENT_PRESET_ID } from '../../../packages/boot/dsh-base-agent-presets/src/index.ts';
import { readOwnedPluginInventory, OWNED_BUNDLE_TITLES, READONLY_OWNED_BUNDLES, assertOwnedComponentNames } from '../tests/parity/owned-plugin-inventory-oracle.mjs';

const root = resolve(import.meta.dirname, '../../..'), app = join(root, 'apps/web');
const out = resolve(process.env.DSH_ACCEPTANCE_OUTPUT ?? join(root, '.artifacts/acceptance/plugins-staging-new'));
const inventory = readOwnedPluginInventory();
const counts = { bundles: inventory.bundles.length, components: inventory.rows.length };
const assets = join(app, '.cloudflare/output/v0/workers/default/assets');
const entry = readFileSync(join(assets, 'index.html'), 'utf8').match(/<script[^>]+src="([^"]+)"/u)?.[1];
assert.ok(entry?.startsWith('/assets/'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const entryHash = digest(readFileSync(join(assets, entry.slice(1))));
const newTitles = {
  'cloudflare:worker:public-pages': { en: 'Cloudflare Public page registry', zh: 'Cloudflare 公开页面目录' },
  'cloudflare:worker:open-in-app-availability': { en: 'Cloudflare Local application availability', zh: 'Cloudflare 本地应用状态' },
};
mkdirSync(out, { recursive: true });
if (process.argv.includes('--prepare')) {
  writeFileSync(join(out, 'prepared.json'), JSON.stringify({ prepared: true, networkRequests: 0, ...counts,
    entry, entryHash, publicPages: ['/'], requiredEnv: ['DSH_ACCEPTANCE_CONFIG', 'DSH_EXPECTED_DEPLOYMENT_VERSION'] }, null, 2));
  console.log(JSON.stringify({ prepared: true, ...counts, publicPages: 1, out }));
  process.exit(0);
}
const { base, credentials } = remoteAcceptanceConfig();
assert.match(new URL(base).hostname, /(?:^|-)staging\./u, 'Explicit Staging target required');
const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION; assert.ok(expectedVersion, 'Exact deployed Worker version required');
const report = { ok: false, base, expectedVersion, entry, entryHash, readOnly: true, cases: [], retiredRoutes: [], checks: [],
  operationPolicy: 'Read APIs and official reconnect of one preverified existing blank idle Session; its identity and full exposed state must remain unchanged. New Session creation, business writes, payments and model calls are blocked.',
  errors: [], consoleErrors: [], failedRequests: [], directReadFailures: [], deniedReads: [], blockedExternalRequests: [], blockedMutations: [], rpcReads: [], existingSessionEnsures: [], screenshots: [] };
let browser, page, cookie, existingSessionId, existingWorkspaceId, sessionBefore;
const allowedEnsures = new WeakSet(), ensureChecks = [], responseDiagnostics = [];
const fetchRead = (path, init = {}) => {
  const url = new URL(path, base); assert.equal(url.origin, base, 'Acceptance requests must stay on the configured origin');
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
};
const json = async (response, label) => {
  await assertHttpStatus(response, 200, report.directReadFailures, label);
  return response.json();
};
const privateHeaders = () => ({ cookie, origin: base, 'content-type': 'application/json' });
const HOST_READS = new Set(['runtimeInfo', 'list', 'state', 'page', 'history', 'projections', 'models', 'modelAccess', 'pendingApprovals', 'live', 'permissionCatalog', 'permissionCommands',
  'permissionSnapshot', 'workspaceState', 'directoryList', 'workspaceFileList', 'workspaceFileStat', 'workspaceFileRead', 'workspaceFileReadBytes',
  'maintenanceList', 'maintenanceHistory', 'scheduleDeliveryLimits', 'scheduleList', 'scheduleCatalog', 'scheduleView', 'scheduleHistory', 'settingsDescribe', 'credentialsDescribe']);
const RPC_READS = new Set(['session/list', 'session/state', 'session/page', 'session/projections', 'session/modelCatalog', 'settings/describe',
  'permissionPresets/catalog', 'commands/list', 'workspaceFiles/list', 'workspaceFiles/stat', 'workspaceFiles/read', 'workspaceFiles/readBytes',
  'schedule/list', 'schedule/catalog', 'schedule/view', 'schedule/history', 'directoryPicker/list']);
async function hostRead(method, params = {}) {
  assert.ok(HOST_READS.has(method));
  const body = await json(await fetchRead('/api/session-host', { method: 'POST', headers: privateHeaders(), body: JSON.stringify({ method, params }) }), method);
  assert.equal(body.error, undefined, `${method}: Host read failed`); return body.result;
}
async function sessionSnapshot() {
  const params = { sessionId: existingSessionId };
  return { list: await hostRead('list'), workspace: await hostRead('workspaceState'), state: await hostRead('state', params),
    history: await hostRead('history', params), projections: await hostRead('projections', params), permissions: await hostRead('permissionSnapshot', params) };
}
const canonical = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(canonical)
  : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
const fingerprint = value => digest(JSON.stringify(canonical(value)));
async function verifySessionUnchanged() {
  await Promise.all(ensureChecks);
  const sessionAfter = await sessionSnapshot();
  report.existingSessionUnchanged = { beforeSha256: fingerprint(sessionBefore), afterSha256: fingerprint(sessionAfter),
    fields: ['list including identities and timestamps', 'workspace memberships and flags', 'state including title and model', 'history and turns', 'projections', 'permissions'] };
  assert.equal(report.existingSessionUnchanged.afterSha256, report.existingSessionUnchanged.beforeSha256, 'Existing Session ensure must preserve all exposed Session and Workspace state');
}
function exactExistingEnsure(body) {
  const payload = body?.payload, args = payload?.args, request = args?.request;
  return body?.type === 'client-request' && body?.method === 'session/create'
    && payload && Object.keys(payload).length === 1 && args && Object.keys(args).length === 1
    && request && typeof request === 'object' && !Array.isArray(request)
    && Object.keys(request).every(key => ['sessionId', 'workspaceId', 'agentPreset'].includes(key))
    && request.sessionId === existingSessionId && request.workspaceId === existingWorkspaceId
    && (request.agentPreset === undefined || request.agentPreset === FIXED_AGENT_PRESET_ID);
}
async function observe(target, identity) {
  await target.setRequestInterception(true);
  target.on('pageerror', error => report.errors.push({ identity, message: error.message.slice(0, 500) }));
  target.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ identity, message: message.text().slice(0, 500) }); });
  target.on('response', response => {
    if (allowedEnsures.has(response.request())) {
      ensureChecks.push((async () => {
        assert.equal(response.status(), 200, 'Existing Session reconnect must succeed');
        const body = await response.json();
        assert.equal(body?.result?.ok, true, 'Existing Session reconnect returned a business error');
        assert.equal(body.result.value?.sessionId === existingSessionId, true, 'Reconnect must not create or select another Session');
        report.existingSessionEnsures.push({ identity, status: response.status(), exactExistingSession: true, responseIdentityUnchanged: true });
      })().catch(error => { report.errors.push({ identity, message: String(error.message).slice(0, 500) }); }));
    }
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname, item = { identity, path, status: response.status() };
    if (identity === 'account' && [401, 403].includes(response.status()) && ['/api/operations-dashboard', '/api/user-admin/users', '/api/saas/newsletter/reconcile', '/api/site-analytics/conversions'].includes(path)) report.deniedReads.push(item);
    else responseDiagnostics.push(recordHttpFailure(report.failedRequests, response, { identity, path }));
  });
  target.on('request', async request => {
    const url = new URL(request.url()), method = request.method();
    if (['data:', 'blob:'].includes(url.protocol)) { await request.continue(); return; }
    if (url.origin !== base) {
      report.blockedExternalRequests.push({ identity, origin: url.origin, path: url.pathname, method });
      await request.abort('blockedbyclient'); return;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) { await request.continue(); return; }
    let body; try { body = JSON.parse(request.postData() ?? '{}'); } catch {}
    if (identity === 'account' && method === 'POST' && url.pathname === '/api/session/create' && exactExistingEnsure(body)) {
      allowedEnsures.add(request); await request.continue(); return;
    }
    const read = url.origin === base && identity === 'account' && method === 'POST' && (url.pathname === '/api/session-host' && HOST_READS.has(body?.method)
      || url.pathname === `/api/${body?.method}` && body?.type === 'client-request' && RPC_READS.has(body?.method));
    if (read) { report.rpcReads.push({ path: url.pathname, method: body.method }); await request.continue(); return; }
    report.blockedMutations.push({ identity, path: url.pathname, method, rpc: typeof body?.method === 'string' ? body.method : undefined,
      ...(body?.method === 'session/create' ? { namedExistingSession: body.payload?.args?.request?.sessionId === existingSessionId,
        existingWorkspaceMatches: body.payload?.args?.request?.workspaceId === existingWorkspaceId } : {}) });
    await request.abort('blockedbyclient');
  });
}
async function click(selector) { await page.$eval(selector, element => element.scrollIntoView({ block: 'center' })); await page.click(selector); }
async function screenshot(name) { const path = join(out, `${name}.png`); await page.screenshot({ path, captureBeyondViewport: false }); report.screenshots.push(path); }
async function pluginCase(identity, locale, width, theme) {
  const context = await browser.createBrowserContext(); page = await context.newPage(); page.setDefaultTimeout(45000);
  await page.setViewport({ width, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (identity === 'account') {
    const at = cookie.indexOf('='); await page.setCookie({ name: cookie.slice(0, at), value: cookie.slice(at + 1), url: base, httpOnly: true, secure: true, sameSite: 'Lax' });
  }
  await observe(page, identity);
  const startPath = identity === 'account' ? `/app/session/${encodeURIComponent(existingSessionId)}` : '/';
  const response = await page.goto(base + localizePath(startPath, locale), { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200); assert.ok((await response.text()).includes(entry), 'deployed document selects verified build');
  await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === 'active'));
  if (identity === 'account') {
    if (ensureChecks.length === 0) await page.waitForResponse(incoming => allowedEnsures.has(incoming.request()));
    await Promise.all(ensureChecks);
    assert.equal(report.existingSessionEnsures.length, 1, 'Official startup must reconnect precisely the existing blank Session once');
    await page.waitForFunction(sessionId => location.pathname.endsWith(`/app/session/${encodeURIComponent(sessionId)}`), {}, existingSessionId);
    await page.waitForSelector('[contenteditable="true"]');
    await page.waitForFunction(sessionId => document.querySelector(`[data-row-key="session:${CSS.escape(sessionId)}"]`)?.getAttribute('aria-selected') === 'true', {}, existingSessionId);
    // The official workspace restore applies the selection after the HTTP
    // reconnect completes. Wait for its finite startup reads before choosing a
    // global panel; the long-lived Remote WebSocket is not an HTTP request.
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 30000 });
  } else await page.waitForSelector('[contenteditable]');
  const actualLocale = await page.evaluate(() => document.documentElement.lang.startsWith('zh') ? 'zh' : 'en');
  if (width < 600) { await page.click('[data-sidebar-opener]'); await page.waitForSelector('[data-sidebar-drawer]:not([data-sidebar-collapsed])'); }
  await page.click(`button[aria-label="${actualLocale === 'zh' ? '插件' : 'Plugins'}"]`);
  await page.waitForSelector('[data-plugin-package="dsh-base:base"]');
  const cards = await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]', elements => elements.map(element => ({ name: element.dataset.pluginPackage,
    title: element.querySelector('button[aria-describedby]')?.textContent.trim(), disabled: element.querySelector('[role="switch"]')?.matches(':disabled') })));
  assert.deepEqual(cards.map(row => row.name).sort(), inventory.bundles.map(row => row.name).sort());
  for (const card of cards) { assert.equal(card.title, OWNED_BUNDLE_TITLES[card.name][actualLocale]); assert.equal(card.disabled, READONLY_OWNED_BUNDLES.includes(card.name)); }
  const count = await page.$eval('[data-plugin-category-count="bundles"]', element => ({ bundles: Number(element.dataset.count), components: Number(element.dataset.componentCount) }));
  assert.deepEqual(count, counts);
  assert.ok(!cards.some(card => card.name === 'dsh-base:public-content'));
  assertNoRetiredLinks(await page.$$eval('a[href]', anchors => anchors.map(anchor => anchor.href)), base);
  const components = [];
  for (const bundle of inventory.bundles) {
    await click(`[data-plugin-package=${JSON.stringify(bundle.name)}] button[aria-describedby]`);
    await page.waitForSelector(`[data-plugin-detail=${JSON.stringify(bundle.name)}]`);
    const detail = await page.$eval('[data-plugin-detail]', element => ({ title: element.querySelector('h3')?.textContent.trim(),
      rows: [...element.querySelectorAll('[data-plugin-row]')].map(row => ({ id: row.dataset.pluginRow, title: row.querySelector('[class*="rowId"]')?.textContent.trim(),
        text: row.textContent, disabled: [...row.querySelectorAll('[role="switch"]')].every(toggle => toggle.matches(':disabled')) })) }));
    assert.equal(detail.title, OWNED_BUNDLE_TITLES[bundle.name][actualLocale]); assertOwnedComponentNames(detail.rows, bundle);
    for (const row of detail.rows) {
      const source = bundle.rows.find(item => item.entryId === row.id); assert.ok(row.text.includes(source.moduleName), 'official detail retains module provenance');
      if (READONLY_OWNED_BUNDLES.includes(bundle.name)) assert.equal(row.disabled, true, 'component visibility does not grant enablement permission');
      if (newTitles[row.id]) assert.equal(row.title, newTitles[row.id][actualLocale]);
      components.push({ id: row.id, title: row.title, module: source.moduleName, origin: source.origin, enablementDisabled: row.disabled });
    }
    if (bundle.name === 'dsh-base:global' && identity === 'account') {
      await page.waitForSelector('[data-global-settings][data-state="ready"]');
      const fields = await page.$$eval('[data-global-field] input, [data-global-field] textarea, [data-global-field] select, [data-global-field] [role="switch"]', elements => elements.map(element => element.disabled || element.readOnly === true));
      assert.ok(fields.length > 10);
      if (!report.account.canEditSiteSettings) assert.ok(fields.every(Boolean), 'ordinary account sees site settings without edit permission');
      report.account.siteSettingsFields = fields.length; report.account.siteSettingsReadOnly = fields.every(Boolean);
    }
    if (bundle.name === 'dsh-base:base') await screenshot(`${identity}-${actualLocale}-${width}-${bundle.name.split(':')[1]}`);
    await click('[data-plugin-detail] [data-window-drag] > button'); await page.waitForSelector('[data-plugin-group="bundles"]');
  }
  assert.deepEqual(components.map(row => row.id).sort(), inventory.rows.map(row => row.entryId).sort(), 'every declared component appears once in the catalog');
  if (identity === 'anonymous') {
    await click('[data-plugin-package="@dsh-base/cloudflare-think-fetch"] [role="switch"]');
    await page.waitForSelector('[data-auth-dialog]'); await screenshot(`${identity}-${actualLocale}-${width}-login-gate`);
    await page.keyboard.press('Escape'); await page.waitForSelector('[data-auth-dialog]', { hidden: true });
  }
  const fibers = await page.evaluate(() => window.__DSH_BASE_PLUGINS__.filter(row => ['@dsh-base/client-open-in-app-availability', '@dsh-base/client-plugin-manager', '@deepseek-ai/dsh-client-ui-open-in-app'].includes(row.moduleName))
    .map(({ moduleName, origin, fiberPhase, enabled }) => ({ moduleName, origin, fiberPhase, enabled })));
  assert.equal(fibers.length, 3); assert.ok(fibers.every(row => row.enabled && row.fiberPhase === 'active'));
  assert.equal(await page.evaluate(() => window.__DSH_BASE_PLUGINS__.some(row => row.moduleName === '@dsh-base/client-public-content')), false);
  report.cases.push({ identity, requestedLocale: locale, locale: actualLocale, width, theme, cards, components, fibers, loginGated: identity === 'anonymous' });
  await Promise.all(responseDiagnostics);
  await context.close();
}

try {
  const remoteEntry = await fetchRead(entry); assert.equal(remoteEntry.status, 200);
  assert.equal(digest(Buffer.from(await remoteEntry.arrayBuffer())), entryHash, 'served entry bytes match verified local release');
  const publicBefore = await json(await fetchRead('/api/site-config'), 'site config');
  const controlBefore = await json(await fetchRead('/api/plugin-control'), 'deployment controls');
  const registry = await json(await fetchRead('/api/public-pages'), 'public pages');
  assertBaseRegistry(registry.pages);
  for (const locale of ['en', 'zh']) {
    for (const route of retiredDocuments) {
      const path = localizePath(route, locale);
      const response = await fetchRead(path, {headers: {accept: 'text/html'}});
      await assertHttpStatus(response, 404, report.directReadFailures, path);
      assert.doesNotMatch(await response.text(), /rel="canonical"|id="root"/u);
      report.retiredRoutes.push(path);
    }
  }
  const deploymentPath = resolve(process.env.DSH_ACCEPTANCE_DEPLOYMENT_CONFIG ?? join(app, 'deployment.local.json'));
  const deployment = readDeploymentConfig({}, deploymentPath);
  assert.equal(deployment.authBaseUrl, base, 'Expected catalog must come from the target deployment');
  const expectedCatalog = publicCatalogFromDeployment(deployment.saas);
  const catalog = readCatalog(await json(await fetchRead('/api/payments'), 'public payments catalog'));
  assert.ok(catalog, 'valid public payments catalog');
  assert.deepEqual(catalog.plans, expectedCatalog.plans, 'declared plans, prices, periods and features');
  assert.equal(catalog.priceSource, 'deployment');
  if (!deployment.saas.waffoEnabled) assert.equal(catalog.ready, false);
  const account = await fetchRead('/api/payments/account');
  await assertHttpStatus(account, catalog.ready ? 401 : 503, report.directReadFailures, 'anonymous billing');
  const denied = await account.json();
  assert.equal(denied.error, catalog.ready ? 'unauthenticated' : 'payments_unavailable');
  assert.equal(denied.orders, undefined);
  report.checks.push({catalogMatches: true, anonymousBilling: account.status});
  for (const method of ['GET', 'HEAD']) {
    const response = await fetchRead('/open-in-app/apps', { method }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), method === 'HEAD' ? '' : '{"apps":[]}');
  }
  report.checks.push({ publicRegistry: registry.pages.length, nativeApplicationCatalog: 'empty', nativeCatalogMethods: ['GET', 'HEAD'] });
  for (const path of ['/api/plugin-manager', '/api/plugin-manager/inventory', '/api/site-settings', '/api/operations-dashboard', '/api/saas/account-profile', '/api/entitlements']) {
    const response = await fetchRead(path); await assertHttpStatus(response, 401, report.directReadFailures, path);
    report.checks.push({ privatePath: path, anonymousStatus: response.status });
  }
  const signIn = await fetchRead('/api/auth/sign-in/username', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) });
  await assertHttpStatus(signIn, 200, report.directReadFailures, 'existing isolated acceptance account sign-in; no retry or account creation');
  const match = signIn.headers.getSetCookie().join('; ').match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/u); assert.ok(match); cookie = `${match[1]}=${match[2]}`;
  for (let attempt = 0; ; attempt++) {
    const runtime = await hostRead('runtimeInfo');
    if (runtime.versionId === expectedVersion) { report.actualVersion = runtime.versionId; break; }
    assert.ok(attempt < 24, 'new deployment must reach the owner Host within six minutes');
    console.log('[plugin-publication] waiting for the exact deployed Host version'); await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const ownerBefore = await json(await fetchRead('/api/plugin-manager', { headers: privateHeaders() }), 'owner plugin settings');
  const siteBefore = await json(await fetchRead('/api/site-settings', { headers: privateHeaders() }), 'site settings permissions');
  report.account = { authenticated: true, canEditSiteSettings: siteBefore.canEdit === true };
  const existing = await hostRead('list');
  const workspaceBefore = await hostRead('workspaceState');
  const available = existing.sessions.filter(session => session.blank && !session.running && !session.archived
    && !workspaceBefore.archivedSessionIds.includes(session.sessionId) && workspaceBefore.items.some(workspace => workspace.sessionIds.includes(session.sessionId)));
  existingSessionId = available[0]?.sessionId;
  assert.ok(typeof existingSessionId === 'string' && existingSessionId, 'Account UI acceptance requires an existing blank idle Session; never create one');
  existingWorkspaceId = workspaceBefore.items.find(workspace => workspace.sessionIds.includes(existingSessionId)).workspaceId;
  sessionBefore = await sessionSnapshot();
  assert.equal(sessionBefore.state.running, false); assert.equal(sessionBefore.state.archived, false);
  assert.equal(sessionBefore.history.records.length, 0); assert.equal(sessionBefore.history.turns.length, 0);
  report.account.existingBlankIdleSession = true;
  const workerInventory = await json(await fetchRead('/api/plugin-manager/inventory', { headers: privateHeaders() }), 'Worker plugin inventory');
  assert.ok(!workerInventory.entries.some(row => row.entryId === 'cloudflare:worker:public-content'));
  for (const id of Object.keys(newTitles).filter(id => id.startsWith('cloudflare:worker:'))) {
    const item = workerInventory.entries.find(row => row.entryId === id); assert.ok(item, id); assert.equal(item.enabled, true); assert.equal(item.fiberPhase, 'active');
  }
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  await pluginCase('anonymous', 'en', 1280, 'light'); await pluginCase('anonymous', 'zh', 390, 'dark'); await pluginCase('account', 'en', 1280, 'dark');
  await verifySessionUnchanged();
  assert.deepEqual(await json(await fetchRead('/api/plugin-manager', { headers: privateHeaders() }), 'unchanged owner plugin settings'), ownerBefore);
  assert.deepEqual(await json(await fetchRead('/api/site-settings', { headers: privateHeaders() }), 'unchanged site settings'), siteBefore);
  assert.deepEqual(await json(await fetchRead('/api/site-config'), 'unchanged public config'), publicBefore);
  assert.deepEqual(await json(await fetchRead('/api/plugin-control'), 'unchanged deployment controls'), controlBefore);
  assert.deepEqual(report.blockedExternalRequests, [], 'no external scripts, telemetry or other requests');
  assert.deepEqual(report.blockedMutations, [], 'no attempted business writes'); assert.deepEqual(report.errors, []); assert.deepEqual(report.failedRequests, []);
  // Chromium reports expected 403 GETs as console errors; retain their recorded
  // responses separately and reject every other error rather than hiding them.
  const expectedDenied = report.deniedReads.length;
  const forbiddenConsole = report.consoleErrors.filter(row => /Failed to load resource: the server responded with a status of (?:401|403)\b/u.test(row.message));
  assert.ok(forbiddenConsole.length <= expectedDenied);
  assert.deepEqual(report.consoleErrors.filter(row => !forbiddenConsole.includes(row)), []);
  report.configurationUnchanged = true; report.ok = true;
  console.log(JSON.stringify({ ok: true, ...counts, cases: report.cases.length, retiredRoutes: report.retiredRoutes.length, version: report.actualVersion, out }));
} catch (error) {
  report.failure = String(error.stack ?? error); await page?.screenshot({ path: join(out, 'failure.png'), captureBeyondViewport: false }).catch(() => {}); throw error;
} finally {
  let verificationError;
  if (sessionBefore && !report.existingSessionUnchanged) {
    try { await verifySessionUnchanged(); } catch (error) { verificationError = error; report.ok = false; report.stateVerificationFailure = String(error.message); }
  }
  await Promise.all(responseDiagnostics);
  await closeAcceptanceBrowser(browser); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (verificationError && !report.failure) throw verificationError;
}
