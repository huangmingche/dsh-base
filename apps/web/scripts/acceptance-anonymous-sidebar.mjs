#!/usr/bin/env node
/** Focused anonymous shell acceptance; no credentials or account mutations. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { registerOfficialSourceHooks } from '../../../scripts/build/official-source-hook.mjs';
import { LOCALE_IDS, prefixFor } from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import { copy as routeCopy } from '../../../packages/client/dsh-base-client-route-address/src/client/locales.ts';
import { LOGIN_REQUEST_EVENT } from '../../../packages/client/dsh-base-client-auth-login/src/client/request.ts';
import { dialogCopy } from '../../../packages/client/dsh-base-client-auth-login/src/client/dialog-locales.ts';
import { loginReturnPath } from '../../../packages/client/dsh-base-client-auth-login/src/client/return-url.ts';
import { DEPLOYMENT_MODELS, DEEPSEEK_SETTINGS_DEFAULTS } from '../../../packages/boot/dsh-base-model-declarations/src/index.ts';
registerOfficialSourceHooks();
const [sidebarCopy, workspaceCopy, pluginCopy, scheduleCopy, menuCopy, accountCopy, conversationCopy, modelsCopy] = await Promise.all([
  import('@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-schedule/src/client/task-manager-locales.ts'),
  import('@deepseek-ai/dsh-client-ui-entry-customization/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'),
  import('@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts'),
]);
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
const tailOnly = process.env.DSH_SIDEBAR_TAIL_ONLY === '1';
const reportPath = join(output, tailOnly ? 'report-tail.json' : 'report.json');
if (tailOnly) {
  const previous = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(previous.base, base);
  assert.equal(previous.cases.length, 30, 'tail-only run needs the preceding complete matrix evidence');
  for (const key of ['errors', 'failedResponses', 'sockets']) assert.deepEqual(previous[key], []);
  assert.ok(previous.apiRequests.every(request => allowedApis.has(request.path)));
  report.matrixEvidence = { path: join(output, 'report.json'), passedViews: previous.cases.length, priorRunOk: previous.ok, priorError: previous.error };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const byLabel = label => `button[aria-label=${JSON.stringify(label)}]`;

async function visible(selector) { await page.waitForSelector(selector, { visible: true, timeout: 20000 }); }
async function closeMenus() {
  if (await page.$('[role="menu"]')) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[role="menu"]') === null, { timeout: 5000 });
  }
}
async function setMode(mode) {
  const drawer = mode === 'mobile';
  await page.setViewport({ width: drawer ? 390 : 1440, height: 900, deviceScaleFactor: 1 });
  await page.waitForFunction(expected => document.querySelector('[data-sidebar-drawer]') !== null === expected, {}, drawer);
  const collapsed = await page.$('[data-sidebar-collapsed]') !== null;
  if (drawer && collapsed) { await visible('[data-sidebar-opener]'); await page.click('[data-sidebar-opener]'); }
  else if (!drawer && collapsed !== (mode === 'collapsed')) { await visible('[data-sidebar-toggle]'); await page.click('[data-sidebar-toggle]'); }
  await page.waitForFunction(expected => (document.querySelector('[data-signed-out="true"]')?.getAttribute('data-collapsed') === 'true') === expected, {}, mode === 'collapsed');
  await pause(400);
}
const authModal = '[role="dialog"]:has([data-auth-dialog])';
async function revealSidebar() {
  if (await page.$('[data-sidebar-drawer][data-sidebar-collapsed]')) {
    await page.click('[data-sidebar-opener]');
    await page.waitForFunction(() => {
      const drawer = document.querySelector('[data-shortcut-modal="sidebar"]');
      if (!drawer) return false;
      const box = drawer.getBoundingClientRect(); return box.x >= -0.5 && box.width > 0;
    }, { timeout: 5000 });
  }
}
async function loginControl(selector, label, { restoreFocus = false, sidebar = true } = {}) {
  if (sidebar) await revealSidebar(); await visible(selector);
  const before = new URL(page.url());
  const state = await page.$eval(selector, element => {
    const rect = element.getBoundingClientRect();
    return { disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true', rect: [rect.x, rect.y, rect.width, rect.height], icon: element.querySelector('svg') !== null };
  });
  report.currentAction = { label, selector, ...state };
  assert.equal(state.disabled, false, `${label}: anonymous controls remain clickable`);
  await page.evaluate(eventName => {
    window.__sidebarLoginRequest = null;
    window.addEventListener(eventName, event => {
      window.__sidebarLoginRequest = { next: event.detail?.next ?? null, href: location.href };
    }, { once: true });
  }, LOGIN_REQUEST_EVENT);
  await page.click(selector); await visible(authModal);
  assert.equal(await page.$eval(authModal, element => element.getAttribute('aria-modal')), 'true', 'official modal exposes its modal semantics');
  const loginRequest = await page.evaluate(() => window.__sidebarLoginRequest);
  assert.ok(loginRequest, `${label}: action uses the shared login intent`);
  const requestedFrom = new URL(loginRequest.href);
  const loginNext = loginReturnPath(loginRequest.next ?? `${requestedFrom.pathname}${requestedFrom.search}${requestedFrom.hash}`, base);
  assert.equal(requestedFrom.origin, base, `${label}: login stays on the application origin`);
  assert.equal(loginNext, before.pathname + before.search + before.hash, `${label}: login preserves the current return path`);
  const loginTitle = await page.$eval(`${authModal} h2`, element => element.textContent.trim());
  const drawerOpen = await page.$('[data-sidebar-drawer]:not([data-sidebar-collapsed])') !== null;
  await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
  if (drawerOpen) assert.ok(await page.$('[data-sidebar-drawer]:not([data-sidebar-collapsed])'), 'Escape closes login, preserving the underlying mobile drawer');
  if (restoreFocus) assert.equal(await page.$eval(selector, element => document.activeElement === element), true, `${label}: modal restores focus`);
  return { ...state, loginPrompt: true, loginNext, loginTitle };
}
async function clickPanel(label, selector) {
  await revealSidebar();
  const control = byLabel(label); await visible(control);
  assert.equal(await page.$eval(control, element => element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true'), false);
  if (!await page.$(selector)) await page.click(control);
  await visible(selector); assert.equal(await page.$(authModal), null, `${label}: browsing needs no login`);
  if (await page.$('[data-sidebar-drawer]:not([data-sidebar-collapsed])')) { await page.click('[data-sidebar-toggle]'); await pause(300); }
}
async function clickText(selector, label) {
  const handle = await page.evaluateHandle(({ selector, label }) => [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === label && element.getBoundingClientRect().width > 0) ?? null, { selector, label });
  assert.ok(handle.asElement(), `missing ${label}`); try { await handle.asElement().click(); } finally { await handle.dispose(); }
}
function assertCleanTraffic() {
  assert.deepEqual(apiRequests.filter(request => !allowedApis.has(request.path)), [], 'anonymous sidebar must issue zero private API requests');
  assert.ok(apiRequests.every(request => request.method === 'GET'), 'anonymous browsing sends only public reads');
  assert.deepEqual(failedResponses, [], 'no failed browser request, including 401, is ignored');
  assert.deepEqual(sockets, [], 'anonymous shell must not open the private Gateway');
  assert.deepEqual(errors, [], 'no browser errors are ignored');
}

async function verifyAnonymousModels(locale, mode) {
  const words = modelsCopy[locale], root = '[data-anonymous-models]', deepseek = `${root} [data-public-provider="deepseek-official"]`;
  const gateway = `${root} [data-public-provider="cloudflare-ai-gateway"]`;
  await revealSidebar(); await page.click('[data-signed-out="true"]'); await visible('[role="menu"]');
  await clickText('[role="menuitem"]', accountCopy[locale].settings);
  await page.waitForFunction(() => document.querySelector('[role="menu"]') === null);
  await clickText('[role="dialog"] nav button', words.nav); await visible(root);
  assert.deepEqual(await page.$$eval(`${root} [data-public-provider]`, rows => rows.map(row => row.dataset.publicProvider)), ['deepseek-official', 'cloudflare-ai-gateway']);
  assert.equal(await page.$eval(`${root} h2`, element => element.textContent.trim()), words.title);
  await page.click(`${deepseek} details[class*="customized"] > summary`);
  const fields = await page.$eval(deepseek, (provider, names) => Object.fromEntries(names.map(name => {
    const input = [...provider.querySelectorAll('input')].find(input => input.getAttribute('aria-label') === name);
    return [name, input ? { value: input.value, placeholder: input.placeholder, disabled: input.disabled } : null];
  })), [words.keyInput, words.baseUrl]);
  assert.equal(fields[words.keyInput]?.value, '', 'public API-key field is empty');
  assert.equal(fields[words.keyInput]?.disabled, true, 'public API-key field is unavailable');
  assert.deepEqual(fields[words.baseUrl], { value: '', placeholder: DEEPSEEK_SETTINGS_DEFAULTS.baseURL, disabled: true }, 'official editor shows public defaults as hints without fabricating owner overrides');
  await clickText(`${deepseek} button`, words.cancel);
  assert.equal(await page.$(`${deepseek} input`), null, 'official cancel collapses the read-only editor');
  assert.equal(await page.$(`${root} [class*="credentialDotConfigured"], ${root} [class*="credentialDotMissing"]`), null, 'public declarations do not infer private credential availability or absence');
  await clickText(`${deepseek} button`, words.edit);
  await visible(`${deepseek} input`); assert.equal(await page.$(authModal), null, 'opening an existing provider is public browsing');
  await page.click(`${gateway} button[aria-expanded]`);
  await visible(`${gateway} [role="region"]:not([hidden])`);
  const gatewayView = await page.$eval(gateway, row => ({
    state: row.querySelector('[data-gateway-provider]')?.getAttribute('data-gateway-provider'),
    text: row.querySelector('[role="region"]')?.textContent.trim(),
    status: row.querySelector('[role="status"]')?.textContent.trim(),
    configuredDots: row.querySelectorAll('[data-gateway-status="available"], [class*="credentialDotConfigured"]').length,
  }));
  assert.equal(gatewayView.state, 'signed-out'); assert.equal(gatewayView.status, locale === 'zh' ? '登录后查看' : 'Sign in to view');
  assert.equal(gatewayView.configuredDots, 0);
  for (const model of DEPLOYMENT_MODELS) assert.ok(gatewayView.text.includes(model.label), 'Gateway models are public declarations');
  assert.equal(await page.$(`${deepseek} input`), null, 'official page keeps one provider editor open');
  await page.screenshot({ path: join(output, `models-${locale}-${mode}.png`), captureBeyondViewport: false });
  const add = `${root} button[class*="addButton"]`;
  await loginControl(add, words.add, { sidebar: false, restoreFocus: true });
  assert.equal(await page.$(`${root} [class*="addCard"]`), null, 'Add provider gates before a draft is opened');
  await loginControl('[data-anonymous-models-sign-in]', 'models local sign-in', { sidebar: false, restoreFocus: true });
  assert.ok(await page.$(root), 'closing login preserves Models settings');
  await page.keyboard.press('Escape'); await page.waitForSelector(root, { hidden: true });
  assertCleanTraffic();
  return { fields, gatewayView, readOnlyEditor: true, addGated: true, footerGated: true, restoredFocus: true, privateRequests: 0 };
}

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
  for (const locale of tailOnly ? [] : LOCALE_IDS) {
    for (const scheme of ['light', ...(['en', 'zh'].includes(locale) ? ['dark'] : [])]) {
      if (page.url().startsWith(base)) await page.evaluate(() => localStorage.clear());
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(`${base}${prefixFor(locale)}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await visible('[data-signed-out="true"]');
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, {}, scheme === 'dark');
      await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === 'active'), { timeout: 25000 });
      const sidebar = sidebarCopy[locale], workspace = workspaceCopy[locale];
      const labels = [sidebar['session.new.label'], pluginCopy[locale].panel, scheduleCopy[locale].panel];
      for (const mode of ['wide', 'collapsed', 'mobile']) {
        await setMode(mode);
        const beforeUrl = page.url(), requestMark = apiRequests.length;
        const controls = [];
        for (const label of [sidebar['session.new.label'], workspace['search.sessions.aria'], ...(mode === 'collapsed' ? [] : [workspace['viewOptions.label']]), workspace['workspace.add']]) {
          const selector = byLabel(label) + (label === sidebar['session.new.label'] ? '[class*="newSession"]' : '');
          controls.push({ label, ...await loginControl(selector, label, { restoreFocus: mode !== 'mobile' }) });
        }
        if (locale === 'en' && scheme === 'light' && mode === 'wide') {
          const primary = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control');
          for (const key of ['n', 'k', 'o']) {
            await page.keyboard.down(primary); await page.keyboard.down('Alt');
            try { await page.keyboard.press(key); } finally { await page.keyboard.up('Alt'); await page.keyboard.up(primary); }
            await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
          }
          report.shortcuts = { primary, keys: ['Alt+N', 'Alt+K', 'Alt+O'], sharedLogin: true, privateRequests: 0 };
        }
        const nav = await page.$$eval('nav button[aria-label]', rows => rows.map(row => row.getAttribute('aria-label')));
        assert.deepEqual(nav, [pluginCopy[locale].panel, scheduleCopy[locale].panel, sidebar['panels.more']], `${locale}/${mode}: original navigation order`);
        await clickPanel(pluginCopy[locale].panel, '[data-plugin-panel]');
        await page.waitForFunction(() => document.querySelectorAll('[data-plugin-package]').length >= 7);
        assert.ok(await page.$$eval('[data-plugin-package]', rows => rows.length >= 7), 'public installed inventory remains browsable');
        await loginControl(byLabel(pluginCopy[locale].addPlugin), pluginCopy[locale].addPlugin, { sidebar: false });
        if (locale === 'en' && scheme === 'light' && mode === 'wide') {
          const toggle = '[data-plugin-package="@dsh-base/cloudflare-think-fetch"] [role="switch"]';
          const beforeToggle = await page.$eval(toggle, element => element.getAttribute('aria-checked'));
          await loginControl(toggle, 'optional plugin toggle', { sidebar: false });
          assert.equal(await page.$eval(toggle, element => element.getAttribute('aria-checked')), beforeToggle, 'login gate does not mutate deployment defaults');
          await page.click('[data-plugin-package="dsh-base:global"] button[aria-describedby]');
          await visible('[data-plugin-detail="dsh-base:global"]');
          assert.equal(await page.$('[data-global-settings]'), null, 'public detail never loads private site settings');
          assert.ok(await page.$('[data-plugin-rows]'), 'public component descriptors stay visible');
          await loginControl('[data-public-plugin-configuration] button', 'site configuration sign-in', { sidebar: false, restoreFocus: true });
          assertCleanTraffic();
          await page.click('[data-plugin-detail="dsh-base:global"] [data-window-drag] > button');
          await visible('[data-plugin-package="dsh-base:global"]');
          report.publicDetail = { componentsVisible: true, ownerConfigurationMounted: false, optionalToggleGated: true };
        }

        await clickPanel(scheduleCopy[locale].panel, '[data-testid="task-manager-page"]');
        const newTask = await page.evaluateHandle(label => [...document.querySelectorAll('[data-testid="task-manager-page"] button')].find(button => button.textContent.trim() === label), scheduleCopy[locale]['new.action']);
        assert.ok(newTask.asElement(), 'official new-task control is visible'); await newTask.asElement().click(); await newTask.dispose();
        await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
        await clickText('[data-testid="task-manager-page"] button', scheduleCopy[locale]['empty.action']);
        await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
        await page.click(byLabel(scheduleCopy[locale]['host.createMethod'])); await visible('[role="menu"]');
        await clickText('[role="menuitem"]', scheduleCopy[locale]['host.manualCreate']);
        await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
        await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), { timeout: 2000 }, byLabel(scheduleCopy[locale]['host.createMethod']));
        assert.equal(await page.$('[data-testid="task-manager-page"] aside'), null, 'anonymous manual creation opens login before any private task editor');
        await revealSidebar();
        const more = `${byLabel(sidebar['panels.more'])}[aria-haspopup="menu"]`;
        await page.click(more); await visible('[role="menu"]');
        const menuRows = await page.$$eval('[role="menuitem"]', rows => rows.map(row => ({ text: row.textContent.trim(), disabled: row.matches(':disabled') || row.getAttribute('aria-disabled') === 'true' })));
        assert.deepEqual(menuRows, [menuCopy[locale].install, menuCopy[locale].create].map(text => ({ text, disabled: false })));
        await (await page.$$('[role="menuitem"]'))[0].click(); await visible('[data-plugin-panel]');
        assert.equal(await page.$(authModal), null, 'Browse plugins is public');
        await revealSidebar(); await page.click(more); await visible('[role="menu"]');
        await (await page.$$('[role="menuitem"]'))[1].click(); await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
        await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), { timeout: 2000 }, more);
        assert.equal(await page.$eval(more, element => document.activeElement === element), true, 'More action restores focus to persistent menu trigger');
        const models = ['en', 'zh'].includes(locale) && scheme === 'light' && ['wide', 'mobile'].includes(mode)
          ? await verifyAnonymousModels(locale, mode) : undefined;
        await revealSidebar();
        assert.equal(await page.$('[data-workspace-access], [data-workspace-sign-in]'), null, 'anonymous workspaces have no extra sign-in prompt');
        const workspaceList = await page.$eval(byLabel(workspace['workspace.add']), element => {
          const region = element.closest('[class*="root"]');
          const list = region?.querySelector('[class*="listArea"]');
          return { present: !!list, children: list?.childElementCount, text: list?.textContent.trim(), heading: region?.querySelector('[class*="sectionLabel"]')?.textContent.trim() ?? null };
        });
        assert.equal(workspaceList.present, true, 'official workspace list region remains mounted');
        assert.equal(workspaceList.children, 0, 'anonymous workspace list contains no icon, message or sign-in control');
        assert.equal(workspaceList.text, '', 'anonymous workspace list stays empty');
        assert.equal(workspaceList.heading, mode === 'collapsed' ? null : workspace['section.workspaces'], 'official workspace heading is preserved');
        for (const control of controls) assert.equal(control.loginTitle, dialogCopy(locale).title, `${control.label}: login uses the current locale`);
        assert.equal(page.url(), beforeUrl, 'gated actions preserve the page');
        assert.deepEqual(apiRequests.slice(requestMark).filter(request => !allowedApis.has(request.path)), []);
        const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, sidebar: document.querySelector('[data-sidebar-toggle]')?.closest('[class*="root"]')?.getBoundingClientRect().width, dark: document.body.hasAttribute('data-ds-dark-theme') }));
        assert.equal(geometry.dark, scheme === 'dark', `${locale}/${mode}: requested theme is actually active`);
        assert.ok(geometry.scrollWidth <= geometry.viewport + 1, `${locale}/${mode}: no horizontal page overflow`);
        await page.mouse.move(900, 850); await pause(150);
        await page.screenshot({ path: join(output, `${locale}-${scheme}-${mode}.png`), captureBeyondViewport: false });
        cases.push({ locale, scheme, mode, controls, menuRows, workspaceList, geometry, ...(models ? { models } : {}), privateRequests: 0 });
        assertCleanTraffic();
        console.log(`anonymous sidebar: ${locale}-${scheme}-${mode} passed`);
      }
    }
  }
  // The conversation owns this trigger; the forked workspace picker must guard
  // the alternate route into the same private directory flow.
  if (page.url().startsWith(base)) await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); await visible('[data-signed-out="true"]');
  const hero = await page.evaluateHandle(label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label), conversationCopy.en['hero.chooseWorkspace']);
  assert.ok(hero.asElement(), 'official Hero workspace trigger exists'); await hero.asElement().click(); await hero.dispose();
  await visible(authModal);
  assert.equal(await page.$('[role="dialog"] [data-workspace-sign-in]'), null, 'Hero opens shared login instead of a directory error');
  assertCleanTraffic();
  await page.screenshot({ path: join(output, 'en-hero-sign-in.png'), captureBeyondViewport: false });
  await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
  report.hero = { sharedLogin: true, closed: true, privateRequests: 0 };
  // A direct protected document remains behind the server authentication gate.
  await page.setViewport({ width: 1440, height: 900 });
  const deepPath = `${prefixFor('zh')}/app/session/00000000-0000-4000-8000-000000000099?test=sidebar#step`;
  await page.goto(`${base}${deepPath}`, { waitUntil: 'domcontentloaded' });
  await visible(authModal);
  const redirected = new URL(page.url());
  assert.equal(redirected.pathname, '/login');
  assert.equal(redirected.searchParams.get('next'), deepPath.split('#')[0], 'server preserves the request pathname and query; fragments are not sent over HTTP');
  assert.equal(redirected.hash, '#step', 'browser retains the fragment across the login redirect');
  assert.equal(await page.$('[data-sidebar-toggle]'), null);
  report.protectedDocument = { url: redirected.href, next: redirected.searchParams.get('next'), hash: redirected.hash };
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click(`${authModal} button[aria-label=${JSON.stringify(dialogCopy('zh').close)}]`)]);
  await visible('[data-signed-out="true"]');
  assert.equal(new URL(page.url()).pathname.replace(/\/$/u, ''), prefixFor('zh'), 'closing a protected deep-link login returns to its public locale home');
  assert.equal(await page.$(authModal), null, 'closing login never loops through the protected return address');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN', 'closing a Chinese deep-link login preserves language');
  report.protectedDocument.closedToPublicHome = page.url();

  // Exercise the client route timer inside the public shell without bypassing
  // the document authentication boundary or requesting a protected document.
  await page.evaluate(() => localStorage.clear());
  const publicPath = `${prefixFor('zh')}/?test=sidebar#step`;
  await page.goto(`${base}${publicPath}`, { waitUntil: 'domcontentloaded' });
  await visible('[data-signed-out="true"]'); await setMode('wide');
  assert.equal(await page.$('[data-workspace-access], [data-workspace-sign-in]'), null, 'localized public workspaces have no extra sign-in prompt');
  const publicUrl = new URL(page.url());
  assert.equal(publicUrl.pathname.replace(/\/$/u, ''), prefixFor('zh'));
  assert.equal(publicUrl.search + publicUrl.hash, '?test=sidebar#step');
  const publicLogin = await loginControl(byLabel(workspaceCopy.zh['workspace.add']), workspaceCopy.zh['workspace.add'], { restoreFocus: true });
  assert.equal(publicLogin.loginTitle, dialogCopy('zh').title, 'public-shell login preserves its locale');
  assert.equal(publicLogin.loginNext, publicUrl.pathname + publicUrl.search + publicUrl.hash, 'public-shell login preserves the canonical pathname, query and fragment');
  assert.equal(page.url(), publicUrl.href, 'closing public-shell login preserves the canonical pathname, query and fragment');
  await page.evaluate(({ path, notices }) => {
    window.__sidebarRouteNotices = [];
    window.__sidebarNoticeObserver = new MutationObserver(() => {
      for (const notice of notices) if (document.body.textContent.includes(notice)) window.__sidebarRouteNotices.push(notice);
    });
    window.__sidebarNoticeObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'));
  }, { path: deepPath, notices: Object.values(routeCopy).map(row => row.invalidAddress) });
  const deepBefore = page.url(); await pause(22_000);
  assert.equal(page.url(), deepBefore, 'anonymous route timer must preserve the original deep link');
  assert.equal(new URL(deepBefore).pathname + new URL(deepBefore).search + new URL(deepBefore).hash, deepPath);
  const routeNotices = await page.evaluate(() => { window.__sidebarNoticeObserver.disconnect(); return window.__sidebarRouteNotices; });
  assert.deepEqual(routeNotices, [], 'anonymous route timer never displays a transient missing-session notice');
  assertCleanTraffic();
  report.deepLink = { path: deepPath, observationMs: 22000, unchanged: true, publicLoginNext: publicLogin.loginNext, routeNotices, privateRequests: 0 };
  await page.screenshot({ path: join(output, 'zh-deep-link.png'), captureBeyondViewport: false });
  // Preserve the two distinct More menus: Settings and login remain available.
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); await visible('[data-signed-out="true"]');
  await page.click('[data-signed-out="true"]'); await visible('[role="menu"]');
  const accountRows = await page.$$eval('[role="menuitem"]', rows => rows.map(row => ({ text: row.textContent.trim(), disabled: row.matches(':disabled') || row.getAttribute('aria-disabled') === 'true' })));
  assert.deepEqual(accountRows, [{ text: accountCopy.en.settings, disabled: false }, { text: accountCopy.en.contactUs, disabled: true }, { text: accountCopy.en.signIn, disabled: false }]);
  await (await page.$$('[role="menuitem"]'))[0].click(); await visible('[role="dialog"] nav');
  assert.equal(await page.$$eval('[role="dialog"] nav button', rows => rows.length), 5);
  await (await page.$$('[role="dialog"] nav button'))[0].click(); await visible('[data-anonymous-account-page]');
  const platformAccount = await page.$eval('[data-anonymous-platform-account]', platform => ({
    presentation: platform.querySelector('section')?.getAttribute('data-account-presentation'),
    disabled: platform.matches('fieldset:disabled'),
    signedOutPlaceholder: platform.querySelector('[class*="signedOutContent"]') !== null,
    identity: platform.querySelector('[class*="identityCopy"] [class*="name"]')?.textContent.trim(),
    status: platform.querySelector('[class*="identityCopy"] [class*="status"]')?.textContent.trim(),
    avatar: platform.querySelector('[class*="avatar"]') !== null,
    balance: platform.querySelector('[class*="balanceCard"]')?.textContent.trim() ?? '',
    fabricatedAmounts: platform.querySelectorAll('[class*="amount"]').length,
    links: [...platform.querySelectorAll('a')].map(link => ({ text: link.textContent.trim(), href: link.getAttribute('href'), disabled: link.getAttribute('aria-disabled'), tabIndex: link.tabIndex })),
  }));
  assert.equal(platformAccount.disabled, true, 'unconnected Platform remains unavailable');
  assert.equal(platformAccount.presentation, 'full-unavailable');
  assert.equal(platformAccount.signedOutPlaceholder, false, 'full account card replaces the large signed-out placeholder');
  assert.equal(platformAccount.identity, accountCopy.en.signedOut, 'full presentation preserves truthful signed-out identity');
  assert.equal(platformAccount.status, accountCopy.en.signInDescription);
  assert.equal(platformAccount.avatar, true, 'official account identity remains visible');
  assert.ok(platformAccount.balance.includes(accountCopy.en.balance));
  assert.ok(platformAccount.balance.includes(accountCopy.en.bonusBalance));
  assert.equal(platformAccount.fabricatedAmounts, 0, 'anonymous presentation must not fabricate account balances');
  assert.deepEqual(platformAccount.links.map(link => link.text), [accountCopy.en.accountInfo, accountCopy.en.usage, accountCopy.en.topUp]);
  assert.ok(platformAccount.links.every(link => link.href === null && link.disabled === 'true' && link.tabIndex === -1), 'all Platform links remain visible without navigation or keyboard activation');
  const platformUrl = page.url(), platformPopups = [];
  const onPlatformPopup = popup => { platformPopups.push(popup.url()); };
  page.on('popup', onPlatformPopup);
  try {
    for (const link of await page.$$('[data-anonymous-platform-account] a')) await link.click();
    await pause(200);
    assert.deepEqual(platformPopups, [], 'unavailable Platform actions never open external pages');
    assert.equal(page.url(), platformUrl, 'unavailable Platform actions never navigate');
    assert.equal(await page.$(authModal), null, 'official Platform actions never open local login');
  } finally { page.off('popup', onPlatformPopup); }
  report.platformAccount = platformAccount;
  await page.click('[data-dsh-base-sign-in]');
  await visible(authModal); await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
  assert.ok(await page.$('[role="dialog"] nav'), 'Escape dismisses login only; underlying settings stays open');
  assert.equal(await page.$eval('[data-dsh-base-sign-in]', element => document.activeElement === element), true, 'Settings login restores focus to the appended local action');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null);
  await page.click('[data-signed-out="true"]'); await visible('[role="menu"]');
  const accountUrl = page.url();
  await (await page.$$('[role="menuitem"]'))[2].click(); await visible(authModal);
  assert.equal(page.url(), accountUrl, 'account-menu sign-in opens in place');
  assert.ok(await page.$('[data-sidebar-toggle]'), 'public shell remains behind modal');
  await page.keyboard.press('Escape'); await page.waitForSelector(authModal, { hidden: true });
  assert.equal(await page.$eval('[data-signed-out="true"]', element => document.activeElement === element), true, 'account sign-in restores focus to persistent launcher');
  await pause(750); assertCleanTraffic();
  // Direct unauthenticated requests must still be rejected. These are outside
  // the browser traffic ledger: UI availability never grants backend authority.
  const direct = [];
  for (const endpoint of ['directoryPicker/list', 'session/create', 'pluginManager/listBundles', 'schedule/catalog']) {
    const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'anonymous-sidebar-audit', method: endpoint, payload: { args: {} } }), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 401, `${endpoint}: visibility does not grant access`); direct.push({ endpoint, status: response.status });
  }
  Object.assign(report, { ok: true, direct, accountRows, browserProfile: 'isolated and discarded; no account preferences changed' });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, base, cases: cases.length, privateRequests: 0, output }));
} catch (error) {
  report.error = String(error?.stack ?? error); report.serverLog = serverLog; report.url = page?.url();
  report.focusAtFailure = await page?.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), cls: document.activeElement?.className })).catch(() => undefined);
  try { await page?.screenshot({ path: join(output, 'failure.png'), captureBeyondViewport: false }); } catch {}
  writeFileSync(reportPath, JSON.stringify(report, null, 2)); throw error;
} finally { await closeAcceptanceBrowser(browser); server?.kill('SIGTERM'); }
