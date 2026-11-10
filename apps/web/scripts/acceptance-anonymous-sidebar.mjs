#!/usr/bin/env node
/** Focused anonymous shell acceptance; no credentials or account mutations. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { LOCALE_IDS, localizePath } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
const app = resolve(import.meta.dirname, '..'), root = resolve(app, '../..');
const remote = process.env.DSH_BASE_URL;
if (remote) { const url = new URL(remote); assert.equal(url.protocol, 'https:'); assert.equal(url.origin, remote.replace(/\/$/u, '')); }
const port = process.env.DSH_LOCAL_PORT ?? '5191';
const base = remote?.replace(/\/$/u, '') ?? `http://127.0.0.1:${port}`;
const output = process.env.DSH_ACCEPTANCE_OUTPUT ?? join(root, '.artifacts/acceptance/anonymous-sidebar', remote ? 'staging' : 'local');
mkdirSync(output, { recursive: true });
let server, browser, page, serverLog = '';
const errors = [], apiRequests = [], failedResponses = [], sockets = [], cases = [];
const allowedApis = new Set(['/api/auth/get-session', '/api/site-config', '/api/auth-policy']);
const report = { ok: false, base, anonymous: true, cases, errors, apiRequests, sockets, failedResponses };
const reportPath = join(output, 'report.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (!remote) {
    server = spawn(process.execPath, [join(app, 'scripts/serve-local.mjs')], {
      cwd: app, env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_FORBID_OUTBOUND: '1', DSH_LOCAL_COMPATIBILITY_DATE: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? '2026-10-30' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog = (serverLog + chunk).slice(-12000); });
    for (let i = 0; !serverLog.includes('Local Worker ready:'); i++) {
      if (server.exitCode !== null || i >= 150) throw new Error(`Local Worker did not start: ${serverLog}`);
      await pause(100);
    }
  }
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({ ...launch, args: [...launch.args, '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && url.pathname.startsWith('/api/')) apiRequests.push({ method: request.method(), path: url.pathname }); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', event => sockets.push(new URL(event.url).pathname));
  for (const locale of LOCALE_IDS) {
    for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 900 });
      const response = await page.goto(base + localizePath('/', locale), { waitUntil: 'networkidle0' });
      assert.equal(response.status(), 200);
      await page.waitForSelector('[data-auth-dialog]', { visible: true });
      assert.equal(await page.$('[data-signed-out], [contenteditable="true"]'), null);
      const fibers = await page.evaluate(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled && row.fiberPhase === 'active').map(row => row.moduleName).sort());
      assert.deepEqual(fibers, ['@dsh-base/client-auth-login', '@dsh-base/client-newsletter']);
      cases.push({ locale, width, fibers });
      await page.screenshot({ path: join(output, `${locale}-${width}-login.png`), captureBeyondViewport: false });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResponses, []);
  assert.deepEqual(sockets, []);
  assert.ok(apiRequests.every(request => request.method === 'GET' && allowedApis.has(request.path)));
  // Direct unauthenticated requests must still be rejected. These are outside
  // the browser traffic ledger: UI availability never grants backend authority.
  const direct = [];
  for (const endpoint of ['directoryPicker/list', 'session/create', 'pluginManager/listBundles', 'schedule/catalog']) {
    const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'anonymous-sidebar-audit', method: endpoint, payload: { args: {} } }), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 401, `${endpoint}: visibility does not grant access`); direct.push({ endpoint, status: response.status });
  }
  Object.assign(report, { ok: true, direct, browserProfile: 'isolated and discarded; no account preferences changed' });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, base, cases: cases.length, privateRequests: 0, output }));
} catch (error) {
  report.error = String(error?.stack ?? error); report.serverLog = serverLog; report.url = page?.url();
  report.focusAtFailure = await page?.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), cls: document.activeElement?.className })).catch(() => undefined);
  try { await page?.screenshot({ path: join(output, 'failure.png'), captureBeyondViewport: false }); } catch {}
  writeFileSync(reportPath, JSON.stringify(report, null, 2)); throw error;
} finally { await closeAcceptanceBrowser(browser); server?.kill('SIGTERM'); }
