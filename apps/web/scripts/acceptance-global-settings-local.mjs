#!/usr/bin/env node
/** Full built Worker, real Better Auth and isolated D1: official plugin UI to public site metadata. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { pluginSchemas, applyPluginSchema } from './plugin-schemas.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(app, '../..');
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT ?? join(root, '.artifacts/acceptance/global-settings-local'));
mkdirSync(artifacts, { recursive: true });
const output = join(app, '.cloudflare/output/v0/workers/default');
const config = JSON.parse(readFileSync(join(output, 'worker.config.json'), 'utf8'));
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const directory = mkdtempSync(join(tmpdir(), 'dsh-global-settings-'));
const port = Number(process.env.DSH_LOCAL_PORT ?? 5188);
assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536, 'local port must be valid');
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString('base64url');
const bindings = Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === 'text').map(([key, row]) => [key, row.value]));
Object.assign(bindings, {
  AUTH_BASE_URL: base, AUTH_SECRET: randomBytes(32).toString('hex'), CREDENTIALS_KEY: randomBytes(32).toString('base64'),
  AUTH_SIGNUP_ENABLED: 'false', AUTH_REGISTRATION_TOKEN: registrationToken, SITE_ADMIN_USER_IDS: '[]',
  SITE_SEO_JSON: '{}', SITE_BRAND_NAME: 'Local acceptance site', SITE_ENVIRONMENT_LABEL: 'Local acceptance',
  SITE_DEPLOYMENT_ENVIRONMENT: 'development', SITE_INDEXING_ENABLED: 'false',
  PLATFORM_AI_ENABLED: 'false',
});
// This script accepts no remote target or deployed credentials. All resources,
// users, administrator authority and writes are confined to this temp directory.
const report = { ok: false, base, realAuth: true, adminUiSaved: false, persistedAfterReload: false, readerReadonly: false,
  pluginMutations: [], siteWrites: [], siteResponses: [], diagnostics: [], browserErrors: [], outboundRequests: [], publicResponses: [], checks: [] };
const options = () => convertV4MiniflareOptions({
  host: '127.0.0.1', port, modulesRoot: join(output, 'bundle'),
  modules: ['index.js', ...readdirSync(join(output, 'bundle'), { recursive: true }).filter(file => file.endsWith('.js') && file !== 'index.js')]
    .map(file => ({ type: 'ESModule', path: join(output, 'bundle', file) })),
  compatibilityDate: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? '2026-10-30',
  compatibilityFlags: config.compatibilityFlags, bindings,
  outboundService: async request => {
    report.outboundRequests.push(new URL(request.url).origin);
    return new Response('Outbound network is forbidden in local acceptance', { status: 503 });
  },
  durableObjects: Object.fromEntries(Object.entries(config.env).filter(([, row]) => row.type === 'durable-object')
    .map(([name, row]) => [name, { className: row.exportName, useSQLite: true }])),
  durableObjectsPersist: join(directory, 'do'), d1Databases: ['AUTH_DB'], d1Persist: join(directory, 'd1'),
  r2Buckets: ['FILES'], r2Persist: join(directory, 'r2'),
  assets: { directory: join(output, 'assets'), binding: 'ASSETS', run_worker_first: true,
    routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
});
const controller = new AbortController();
const watchdog = setTimeout(() => controller.abort(new Error('global settings local acceptance exceeded 300 seconds')), 300_000);
const request = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
const checkedJson = async (response, label) => {
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}; ${response.status === 200 ? '' : await response.text()}`);
  return response.json();
};
let mf, browser, adminPage, readerPage;

async function register(label) {
  const suffix = randomBytes(8).toString('hex');
  const response = await request('/api/auth/sign-up/email', { method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', 'x-dsh-registration-token': registrationToken },
    body: JSON.stringify({ username: `gs${suffix}`, name: `Global settings ${label}`, email: `gs-${suffix}@example.test`, password: randomBytes(32).toString('base64url') }),
  });
  const body = await checkedJson(response, `${label} real Better Auth registration`);
  assert.equal(typeof body.user?.id, 'string');
  const match = response.headers.getSetCookie().join('; ').match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/u);
  assert.ok(match, 'Better Auth must return an actual session cookie');
  const auth = { id: body.user.id, cookie: `${match[1]}=${match[2]}`, cookieName: match[1], cookieValue: match[2] };
  const session = await checkedJson(await request('/api/auth/get-session', { headers: { cookie: auth.cookie } }), `${label} real cookie verification`);
  assert.equal(session.user.id, auth.id);
  return auth;
}
async function readSettings(auth) {
  return checkedJson(await request('/api/site-settings', { headers: { cookie: auth.cookie } }), 'read site settings');
}
async function readControls(auth) {
  return checkedJson(await request('/api/plugin-manager', { headers: { cookie: auth.cookie } }), 'read plugin controls');
}
async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle(({ selector, text }) => [...document.querySelectorAll(selector)].find(element => element.textContent.trim() === text) ?? null, { selector, text });
  const element = handle.asElement();
  assert.ok(element, `missing visible control ${text}`);
  try { await element.scrollIntoView(); await element.click(); } finally { await handle.dispose(); }
}
async function capturePageState(page, label) {
  const state = await page.evaluate(() => {
    const form = document.querySelector('[data-global-settings]');
    const detail = document.querySelector('[data-plugin-detail="dsh-base:global"]');
    const rect = element => { if (!element) return null; const box = element.getBoundingClientRect(), style = getComputedStyle(element); return { x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, visibility: style.visibility }; };
    return { url: location.href, title: document.title, language: document.documentElement.lang,
      viewport: { width: innerWidth, height: innerHeight }, bodyScrollTop: document.querySelector('[data-plugin-body]')?.scrollTop,
      globalState: form?.getAttribute('data-state'), formRect: rect(form), detailRect: rect(detail),
      formHtml: form?.outerHTML, detailText: detail?.textContent?.slice(0, 4000),
      fibers: (window.__DSH_BASE_PLUGINS__ ?? []).filter(row => /global-settings|site-config|client-brand|plugin-manager/u.test(row.moduleName ?? row.id ?? '')).map(row => ({ id: row.id, moduleName: row.moduleName, enabled: row.enabled, origin: row.origin, fiberPhase: row.fiberPhase })),
    };
  }).catch(error => ({ diagnosticError: String(error) }));
  report.diagnostics.push({ label, ...state });
  await page.screenshot({ path: join(artifacts, `${label}.png`), captureBeyondViewport: false }).catch(() => {});
}
async function waitGlobalReady(page) {
  await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('[data-global-settings]')?.getAttribute('data-state')), { timeout: 30_000 });
  assert.equal(await page.$eval('[data-global-settings]', form => form.getAttribute('data-state')), 'ready', 'site settings form must load successfully');
}
async function openGlobal(page) {
  try {
    // The official layout restores its panel on reload. Its sidebar entry is a
    // toggle, so wait for that restored surface or the real Session composer.
    await page.waitForFunction(() => document.querySelector('[data-plugin-panel]') !== null || document.querySelector('[contenteditable="true"]') !== null, { timeout: 45_000 });
    if (await page.$('[data-plugin-panel]') === null) await clickText(page, 'button', 'Plugins');
    const selector = '[data-plugin-package="dsh-base:global"] button[aria-describedby]';
    await page.waitForFunction(selector => document.querySelector('[data-global-settings]') !== null || document.querySelector(selector) !== null, { timeout: 30_000 }, selector);
    if (await page.$('[data-global-settings]') !== null) { await waitGlobalReady(page); return; }
    await page.click(selector);
    await page.waitForSelector('[data-plugin-detail="dsh-base:global"]', { visible: true });
    await waitGlobalReady(page);
  } catch (error) { await capturePageState(page, 'open-global-failure'); throw error; }
}
async function newPage(auth, label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (label === 'administrator') adminPage = page; else readerPage = page;
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => report.browserErrors.push({ account: label, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.browserErrors.push({ account: label, message: message.text() }); });
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/site-settings') return;
    const body = await response.json().catch(() => undefined);
    report.siteResponses.push({ account: label, method: response.request().method(), status: response.status(), state: body && { revision: body.revision, source: body.source, canEdit: body.canEdit, error: body.error, issues: body.issues } });
  });
  page.on('request', outgoing => {
    const pathname = new URL(outgoing.url()).pathname;
    if (pathname === '/api/plugin-manager' && !['GET', 'HEAD'].includes(outgoing.method())) report.pluginMutations.push({ account: label, method: outgoing.method() });
    if (pathname === '/api/site-settings' && outgoing.method() === 'PUT') report.siteWrites.push({ account: label, method: outgoing.method() });
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setCookie({ name: auth.cookieName, value: auth.cookieValue, url: base, httpOnly: true, secure: false, sameSite: 'Lax' });
  const locale = await request('/api/session-host', { method: 'POST', headers: { cookie: auth.cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'settingsUpdate', params: { ns: 'locale', patch: { preference: 'en' } } }) });
  const localeReply = await checkedJson(locale, 'local English preference'); assert.equal(localeReply.error, undefined);
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await openGlobal(page);
    return page;
  } catch (error) { await capturePageState(page, `${label}-entry-failure`); throw error; }
}
const fieldSelector = path => `[data-global-field=${JSON.stringify(path)}] input, [data-global-field=${JSON.stringify(path)}] textarea`;
async function fill(page, path, text) {
  const field = await page.waitForSelector(fieldSelector(path), { visible: true });
  assert.equal(await field.evaluate(element => element.matches(':disabled') || element.readOnly), false, `${path} must be editable for the site administrator`);
  await field.scrollIntoView(); await field.click();
  // Select existing text without changing its value; typing below still uses
  // browser keyboard/input events and the real controlled React field.
  await field.evaluate(element => { element.focus(); element.select(); });
  assert.equal(await field.evaluate(element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), true, `${path}: target field owns the complete selection`);
  await page.keyboard.type(text);
  assert.equal(await field.evaluate(element => element.value), text, `${path} accepts real keyboard input`);
}
async function screenshotTop(page, name) {
  await page.$eval('[data-plugin-body]', body => { body.scrollTop = 0; });
  await page.screenshot({ path: join(artifacts, name), captureBeyondViewport: false });
}

try {
  mf = new Miniflare(options()); await mf.ready;
  const database = await mf.getD1Database('AUTH_DB');
  const schemas = readdirSync(join(app, 'migrations')).filter(name => name.endsWith('.sql')).sort().map(name => join(app, 'migrations', name));
  for (const file of schemas) {
    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';').filter(value => value.trim())) await database.prepare(statement).run();
  }
  for (const schema of pluginSchemas(root)) await applyPluginSchema(schema, async sql => (await database.prepare(sql).all()).results);
  const admin = await register('administrator'), reader = await register('reader');
  assert.equal((await readSettings(admin)).canEdit, false, 'fresh users do not gain administrator authority');
  bindings.SITE_ADMIN_USER_IDS = JSON.stringify([admin.id]);
  await mf.setOptions(options()); await mf.ready;
  const initial = await readSettings(admin);
  assert.equal(initial.canEdit, true); assert.equal(initial.revision, 0); assert.equal(initial.source, 'deployment');
  assert.equal((await readSettings(reader)).canEdit, false);
  const beforeControls = { admin: await readControls(admin), reader: await readControls(reader) };
  report.checks.push('real Better Auth identities; server-only administrator binding; isolated D1');

  browser = await puppeteer.launch(acceptanceLaunchOptions());
  adminPage = await newPage(admin, 'administrator');
  await screenshotTop(adminPage, 'administrator-before.png');
  await fill(adminPage, 'seo.site.name', 'Local published site');
  await fill(adminPage, 'links.docs', base + '/docs');
  await fill(adminPage, 'seo.locales.en.title', 'Global settings saved title');
  await fill(adminPage, 'seo.locales.en.description', 'Public information saved through the official plugin page.');
  await fill(adminPage, 'seo.locales.en.keywords', 'site settings\nlocal verification');
  await fill(adminPage, 'seo.icons.svg', '/favicon.svg?global-settings=1');
  await fill(adminPage, 'seo.icons.icon192', '/icon-192.png?global-settings=1');
  await fill(adminPage, 'seo.manifest.shortName', 'Global test');
  await fill(adminPage, 'seo.robots.disallow', '/private-global-test');
  await fill(adminPage, 'seo.robots.extraLines', '# local site settings verification');
  // Page overrides use the actual Add page control, not a direct API mutation.
  await adminPage.select('[data-global-page-path]', '/');
  await clickText(adminPage, '[data-global-settings] button', 'Add page');
  await fill(adminPage, 'seo.pages./.lastmod', '2026-11-14');
  const savedResponse = adminPage.waitForResponse(response => new URL(response.url()).pathname === '/api/site-settings' && response.request().method() === 'PUT');
  await clickText(adminPage, '[data-global-settings] button', 'Save');
  const saved = await savedResponse; assert.equal(saved.status(), 200, await saved.text());
  const accepted = await saved.json(); assert.equal(accepted.revision, 1); assert.equal(accepted.canEdit, true); assert.equal(accepted.source, 'saved');
  assert.deepEqual(accepted.values.seo.locales.zh, initial.values.seo.locales.zh, 'saving the English page retains other locales');
  assert.equal(accepted.values.seo.icons.png32, initial.values.seo.icons.png32, 'untouched configuration fields remain intact');
  report.adminUiSaved = true;
  const publishedBrand = await checkedJson(await request('/api/site-config'), 'public brand after UI save');
  assert.equal(publishedBrand.brand.name, accepted.values.seo.site.name);
  await adminPage.waitForFunction(name => document.querySelector('[class*="brandIdentity"]')?.textContent.trim() === name,
    { timeout: 15_000 }, publishedBrand.brand.name);
  report.sidebarBrandAfterSave = await adminPage.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
  assert.equal(report.sidebarBrandAfterSave, 'Local published site');
  await adminPage.waitForFunction(title => document.title === title, { timeout: 15_000 }, 'Global settings saved title');
  report.hydratedTitleAfterSave = await adminPage.title();
  await screenshotTop(adminPage, 'administrator-saved.png');

  report.documentRouteProbe = [];
  for (const path of ['/', '/sitemap.xml', '/robots.txt', new URL(adminPage.url()).pathname]) {
    const response = await request(path, { headers: { cookie: admin.cookie, accept: 'text/html' } });
    const text = await response.text();
    report.documentRouteProbe.push({ path, status: response.status, contentType: response.headers.get('content-type'), language: response.headers.get('content-language'), robots: response.headers.get('x-robots-tag'), title: text.match(/<title>([\s\S]*?)<\/title>/iu)?.[1], hasSavedIcon: text.includes('/favicon.svg?global-settings=1') });
  }
  const reloadResponse = await adminPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  assert.equal(reloadResponse.status(), 200);
  const reloadedHtml = await reloadResponse.text();
  writeFileSync(join(artifacts, 'reloaded-document.html'), reloadedHtml);
  report.reloadResponse = { url: reloadResponse.url(), status: reloadResponse.status(), title: reloadedHtml.match(/<title>([\s\S]*?)<\/title>/iu)?.[1], contentType: reloadResponse.headers()['content-type'] };
  assert.ok(reloadedHtml.includes('<title>Global settings saved title</title>'), 'reloaded document head reflects the saved site title');
  assert.ok(reloadedHtml.includes('/favicon.svg?global-settings=1'), 'private app document uses the saved icon too');
  assert.ok(reloadedHtml.includes('rel="manifest"'), 'private app document retains its manifest');
  report.reloadedDocumentTitle = 'Global settings saved title';
  await openGlobal(adminPage);
  await adminPage.waitForFunction(name => document.querySelector('[class*="brandIdentity"]')?.textContent.trim() === name,
    { timeout: 15_000 }, publishedBrand.brand.name);
  await adminPage.waitForFunction(title => document.title === title, { timeout: 15_000 }, 'Global settings saved title');
  report.hydratedTitleAfterReload = await adminPage.title();
  assert.equal(await adminPage.$eval(fieldSelector('seo.site.name'), input => input.value), 'Local published site');
  assert.equal(await adminPage.$eval(fieldSelector('seo.locales.en.title'), input => input.value), 'Global settings saved title');
  const persisted = await readSettings(admin); assert.equal(persisted.revision, 1); assert.deepEqual(persisted.values, accepted.values);
  report.persistedAfterReload = true;
  await screenshotTop(adminPage, 'administrator-reloaded.png');

  readerPage = await newPage(reader, 'reader');
  const readerFields = await readerPage.$$eval('[data-global-field] input, [data-global-field] textarea', inputs => inputs.map(input => ({ disabled: input.matches(':disabled'), readOnly: input.readOnly })));
  assert.ok(readerFields.length > 10, 'ordinary account sees the same configuration fields');
  assert.ok(readerFields.every(field => field.disabled || field.readOnly), 'every configuration field is readonly for ordinary accounts');
  assert.equal(await readerPage.$eval(fieldSelector('seo.site.name'), input => input.value), 'Local published site');
  const readerSave = await readerPage.$$eval('[data-global-settings] button', buttons => buttons.filter(button => button.textContent.trim() === 'Save').map(button => button.matches(':disabled')));
  assert.ok(readerSave.every(Boolean), 'ordinary users have no enabled Save action');
  const deniedValues = structuredClone(persisted.values); deniedValues.seo.site.name = 'Unauthorized replacement';
  const denied = await request('/api/site-settings', { method: 'PUT', headers: { cookie: reader.cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: persisted.revision, values: deniedValues }) });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'site_admin_required');
  assert.deepEqual((await readSettings(reader)).values, persisted.values);
  assert.equal((await request('/api/site-settings')).status, 401);
  report.readerReadonly = true;
  await screenshotTop(readerPage, 'reader-readonly.png');

  const publicConfig = await checkedJson(await request('/api/site-config'), 'public site config');
  assert.equal(publicConfig.brand.name, 'Local published site'); assert.equal(publicConfig.links.docs, base + '/docs');
  assert.equal(Object.hasOwn(publicConfig, 'canEdit'), false); assert.equal(Object.hasOwn(publicConfig, 'revision'), false);
  const document = await request('/', { headers: { accept: 'text/html' } }); assert.equal(document.status, 200);
  const html = await document.text();
  for (const text of ['<title>Global settings saved title</title>', 'content="Public information saved through the official plugin page."', 'content="site settings, local verification"', '/favicon.svg?global-settings=1']) assert.ok(html.includes(text), text);
  writeFileSync(join(artifacts, 'public.html'), html);
  const icon = await request('/favicon.svg?global-settings=1'); assert.equal(icon.status, 200); assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
  const manifest = await checkedJson(await request('/manifest.webmanifest'), 'public manifest');
  assert.equal(manifest.name, 'Local published site'); assert.equal(manifest.short_name, 'Global test');
  assert.ok(manifest.icons.some(icon => icon.src.endsWith('/icon-192.png?global-settings=1')));
  const sitemap = await request('/sitemap.xml'), robots = await request('/robots.txt');
  for (const [name, response] of [['sitemap', sitemap], ['robots', robots]]) { assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/); report.publicResponses.push({ name, status: response.status }); }
  const sitemapText = await sitemap.text(), robotsText = await robots.text();
  assert.equal(persisted.values.seo.pages['/'].lastmod, '2026-11-14', 'page metadata remains persisted independently of indexing');
  assert.doesNotMatch(sitemapText, /<url>|<loc>|<lastmod>/u, 'local acceptance must never publish indexable URLs');
  assert.match(html, /name="robots" content="noindex, nofollow"/u);
  assert.doesNotMatch(robotsText, /^Sitemap:/imu, 'disabled indexing must not advertise a sitemap');
  assert.ok(robotsText.includes('Disallow: /private-global-test')); assert.ok(robotsText.includes('# local site settings verification'));
  writeFileSync(join(artifacts, 'sitemap.xml'), sitemapText); writeFileSync(join(artifacts, 'robots.txt'), robotsText);
  writeFileSync(join(artifacts, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  assert.deepEqual(await readControls(admin), beforeControls.admin); assert.deepEqual(await readControls(reader), beforeControls.reader);
  assert.deepEqual(report.pluginMutations, []); assert.deepEqual(report.siteWrites, [{ account: 'administrator', method: 'PUT' }]);
  assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.outboundRequests, []);
  report.checks.push('administrator keyboard edits and real Save', 'sidebar brand refresh without reload and saved document title after reload', 'reload persistence', 'ordinary account readonly UI and PUT 403', 'shared public head/icons/manifest/robots/sitemap', 'plugin controls unchanged; no outbound AI request');
  report.revision = persisted.revision; report.upstream = JSON.parse(readFileSync(join(root, 'dsh-source.lock.json'), 'utf8')).commit;
  report.ok = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  await (readerPage ?? adminPage)?.screenshot({ path: join(artifacts, 'failure.png'), captureBeyondViewport: false }).catch(() => {});
  throw error;
} finally {
  clearTimeout(watchdog);
  let cleanupFailure;
  try { await closeAcceptanceBrowser(browser); } catch (error) { cleanupFailure = error; }
  try { await mf?.dispose(); } catch (error) { cleanupFailure ??= error; }
  rmSync(directory, { recursive: true, force: true });
  if (cleanupFailure) { report.ok = false; report.cleanupFailure = String(cleanupFailure); }
  report.generatedAt = new Date().toISOString();
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (cleanupFailure) throw cleanupFailure;
}
console.log(JSON.stringify({ ok: true, output: artifacts, checks: report.checks, revision: report.revision }));
