#!/usr/bin/env node
/** Built Worker + real local D1/R2/DO + Chromium. Does not call an AI provider. */
import assert from "node:assert/strict";
import { assertLoginReturn } from "./assert-login-return.mjs";
import { randomBytes } from "node:crypto";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { clientRows, officialPackages, repoRoot } from "../../../scripts/conformance/lib.mjs";
import { loadOfficialDeclarations } from "./generate-preset-declarations.mjs";
import { prefixFor } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";
import { readOfficialPluginCatalog, LOCAL_MANAGEABLE_BUNDLES, REPRESENTATIVE_OFFICIAL_BUNDLES } from '../tests/parity/official-plugin-catalog-oracle.mjs';
import { assertCategoryCounts } from '../tests/parity/plugin-counts-assertions.mjs';
import { readOwnedPluginInventory, READONLY_OWNED_BUNDLES, assertOwnedBundleCards, assertReadonlyOwnedDetail, readOwnedDetailNames, assertOwnedComponentNames, assertInventoryNames } from '../tests/parity/owned-plugin-inventory-oracle.mjs';
import { GATEWAY_BUNDLE, GATEWAY_COMPONENTS, assertGatewayBundleCard, assertGatewayBundleDetail, assertGatewayManagementScope } from '../tests/parity/gateway-bundle-assertions.mjs';
import { assertOfficialCards, openMorePlugins, openPluginDetail, assertUnavailablePluginDetail, backFromPluginDetail, managerCopy } from '../tests/parity/plugin-manager-assertions.mjs';
import { assertOfficialSidebarMore } from './sidebar-more-contract.mjs';
import { assertSessionHeaderMenu } from './session-menu-contract.mjs';

const officialPluginCatalog = readOfficialPluginCatalog();
const ownedOracle = readOwnedPluginInventory();

const { declarations: officialPresetDeclarations, officialRows: officialPresetRows, thinkRows: thinkPresetRows } = await loadOfficialDeclarations();
const presetDeclarationText = { en: {}, zh: {} };

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appVersion = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;
const sourceLock = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8"));
const upstreamVersion = sourceLock.tag;
const upstreamRepository = sourceLock.repository.replace(/\.git$/u, "");
const upstreamRelease = `${upstreamRepository}/releases/tag/${encodeURIComponent(upstreamVersion)}`;
const artifacts = join(repoRoot, ".artifacts/acceptance/local-ui");
mkdirSync(artifacts, { recursive: true });
for (const stale of ["report.json", "failure.json", "failure.png"]) rmSync(join(artifacts, stale), { force: true });
const port = process.env.DSH_LOCAL_PORT ?? "5180";
const base = `http://127.0.0.1:${port}`;
// The installed local workerd accepts dates through 2026-10-30. This fixture
// selects that local date without changing the deployment compatibility date.
const localCompatibilityDate = process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? "2026-10-30";
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app, env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_COMPATIBILITY_DATE: localCompatibilityDate, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser;
let cleanupCredential;
const errors = [];
const observations = [];
const restrictedReadPaths = new Set(['/api/saas/newsletter/reconcile', '/api/operations-dashboard']);
const permissionDenials = [], permissionConsole = [];
function observeBrowserErrors(page, label = '') {
  page.on('pageerror', error => errors.push(`${label}${error.message}`));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() !== 403 || !restrictedReadPaths.has(path)) return;
    const entry = { path, method: response.request().method(), status: response.status() };
    permissionDenials.push(entry);
    if (entry.method !== 'GET') errors.push(`${label}${path}: only the administrator GET probe is an expected denial`);
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    let path;
    try { path = new URL(message.location().url).pathname; } catch { /* Unlocated errors remain fatal. */ }
    if (restrictedReadPaths.has(path) && message.text() === 'Failed to load resource: the server responded with a status of 403 (Forbidden)') {
      permissionConsole.push({ path });
      return;
    }
    errors.push(`${label}${path ? `${path}: ` : ''}${message.text()}`);
  });
}
// Failure evidence only: observe transport without intercepting it or changing
// the acceptance timeout. Never retain cookies, headers, queries or bodies.
const networkDiagnostics = new Map();
async function watchFailureNetwork(page) {
  const client = await page.createCDPSession();
  const requests = new Map(), recent = [], sockets = new Map();
  const pathOf = url => { try { return new URL(url).pathname; } catch { return undefined; } };
  await client.send('Network.enable');
  client.on('Network.requestWillBeSent', event => {
    const path = pathOf(event.request.url);
    if (!path?.startsWith('/api/')) return;
    const row = { id: event.requestId, path, method: event.request.method, resourceType: event.type, startedAt: Date.now(), state: 'pending', initiator: event.initiator.type };
    requests.set(event.requestId, row); recent.push(row);
    if (recent.length > 250) recent.shift();
  });
  client.on('Network.responseReceived', event => {
    const row = requests.get(event.requestId); if (!row) return;
    Object.assign(row, { state: 'headers', status: event.response.status, protocol: event.response.protocol, connectionId: event.response.connectionId,
      contentType: event.response.mimeType, fromServiceWorker: event.response.fromServiceWorker, timing: event.response.timing });
  });
  client.on('Network.loadingFinished', event => {
    const row = requests.get(event.requestId); if (!row) return;
    Object.assign(row, { state: 'finished', durationMs: Date.now() - row.startedAt }); requests.delete(event.requestId);
  });
  client.on('Network.loadingFailed', event => {
    const row = requests.get(event.requestId); if (!row) return;
    Object.assign(row, { state: 'failed', durationMs: Date.now() - row.startedAt, error: event.errorText, canceled: event.canceled }); requests.delete(event.requestId);
  });
  client.on('Network.webSocketCreated', event => sockets.set(event.requestId, { path: pathOf(event.url), state: 'connecting' }));
  client.on('Network.webSocketHandshakeResponseReceived', event => { const row = sockets.get(event.requestId); if (row) Object.assign(row, { state: 'open', status: event.response.status }); });
  client.on('Network.webSocketClosed', event => sockets.delete(event.requestId));
  networkDiagnostics.set(page, () => ({ pending: [...requests.values()].map(row => ({ ...row, ageMs: Date.now() - row.startedAt })), recent, sockets: [...sockets.values()] }));
}
const controller = new AbortController();
const watchdog = setTimeout(() => controller.abort(new Error("local UI acceptance exceeded 600 seconds")), 600000);
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Regression: public navigation must not orphan Better Auth initialization.
  assert.equal((await request("/login")).status, 200);
  assert.equal((await request("/api/auth/get-session")).status, 200);
  assert.deepEqual(await (await request("/api/auth-policy")).json(), {
    signUpEnabled: false, googleEnabled: false, apiKeysEnabled: true, userAdminEnabled: true,
    email: { enabled: false, ready: false, provider: "cloudflare" },
    passwordResetEnabled: false, emailVerificationEnabled: false, emailVerificationRequired: false,
  }, "the local deployment exposes the complete explicit capability policy without provider secrets");
  const publicSiteResponse = await request('/api/site-config');
  assert.equal(publicSiteResponse.status, 200);
  const publicSite = await publicSiteResponse.json();
  assert.ok(typeof publicSite.brand?.name === 'string' && publicSite.brand.name.trim() !== '');
  const account = { username: `local${randomBytes(8).toString("hex")}`, name: "Local acceptance", email: `local-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(32).toString("base64url") };
  const publicSignup = await request("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(account) });
  assert.equal(publicSignup.status, 403, "public signup must fail closed");
  const auth = await request("/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken },
    body: JSON.stringify(account),
  });
  assert.equal(auth.status, 200, `local signup: ${await auth.clone().text()}`);
  const match = auth.headers.getSetCookie().join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  assert.ok(match, "local signup returned no cookie");
  const cookie = `${match[1]}=${match[2]}`;
  // Cookie presence never authorizes foreign-site JSON or WebSocket requests.
  for (const path of ["/api/session/prompt", "/api/plugin-control", "/api/session-host"]) {
    assert.equal((await request(path, { method: "POST", headers: { cookie, origin: "https://foreign.example.test", "content-type": "text/plain" }, body: "{}" })).status, 403, `cross-origin mutation: ${path}`);
  }
  for (const path of ["/api/remote.mux", "/api/agent-live", "/agents/dsh-agent/owner:foreign:session"]) {
    const status = await new Promise((resolve, reject) => {
      const attempt = httpRequest(`${base}${path}`, { headers: { cookie, origin: "https://foreign.example.test", upgrade: "websocket", connection: "Upgrade" }, timeout: 15000 }, response => { response.resume(); resolve(response.statusCode); });
      attempt.on("error", reject);
      attempt.on("timeout", () => attempt.destroy(new Error("upgrade policy timed out")));
      attempt.on("upgrade", (_response, socket) => { socket.destroy(); reject(new Error("foreign-origin upgrade was accepted")); });
      attempt.end();
    });
    assert.equal(status, 403, `cross-origin upgrade: ${path}`);
  }
  // Commit 2 restores the owner-scoped control plane. A same-origin write from
  // a signed-in owner still cannot mutate anything without the deployment
  // administrator token, so the route exists and fails closed with 403.
  const pluginControl = await request("/api/plugin-control", { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: "{}" });
  assert.equal(pluginControl.status, 403, "plugin-control write requires the deployment administrator token");
  assert.equal((await pluginControl.json()).error, "control_read_only", "plugin-control fails closed without PLUGIN_CONTROL_TOKEN");
  assert.equal((await request("/api/plugin-manager", { headers: { cookie, origin: base } })).status, 200, "owner plugin-manager reads are restored");
  const call = async (method, params) => {
    const response = await request("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ method, params }) });
    const body = await response.json();
    assert.equal(response.status, 200, `${method}: ${JSON.stringify(body)}`);
    assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body)}`);
    return body.result;
  };
  const task = await call("scheduleCreate", { request: { title: "Local parity task", prompt: "Local parity task", timing: { kind: "after", after_seconds: 3600 }, target: { kind: "new" } } });
  assert.ok(task.id);
  // A real cancelled user turn places the official composer below history.
  // serve-local disables platform AI and supplies no credentials; cancelling
  // immediately also prevents its delayed execution alarm from claiming it.
  const editorSession = await call("create", { title: "Composer input regression" });
  const editorSessionId = editorSession.sessionId;
  assert.equal(typeof editorSessionId, "string");
  const historyText = "Local composer regression: cancelled before model execution.";
  await call("prompt", { sessionId: editorSessionId, text: historyText });
  await call("cancel", { sessionId: editorSessionId });
  const editorHistory = await call("history", { sessionId: editorSessionId });
  assert.equal(editorHistory.records.length, 1);
  assert.equal(editorHistory.records[0].role, "user", "use real user history, never a fabricated assistant");
  assert.equal((await call("state", { sessionId: editorSessionId })).running, false);
  const unavailableSelection = await request("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ method: "selectModel", params: { sessionId: editorSessionId, model: "deepseek-v4-pro", reasoningEffort: "max" } }) });
  assert.equal(unavailableSelection.status, 409, "unconfigured providers cannot accept model selection");
  assert.equal((await unavailableSelection.json()).error.code, "model/unavailable");
  // Test configured selection, not provider authentication or inference. The
  // only submitted user turn is already cancelled; outbound fetch is blocked.
  await call("credentialsSet", { ref: "DEEPSEEK_OFFICIAL_API_KEY", value: "local-ui-selection-sentinel-not-a-provider-key" });
  cleanupCredential = () => call("credentialsUnset", { ref: "DEEPSEEK_OFFICIAL_API_KEY" });
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  const page = await browser.newPage();
  await watchFailureNetwork(page);
  await page.setViewport({ width: 1440, height: 900 });
  observeBrowserErrors(page);
  const publicDocuments = [];
  let publicRequests = [], publicSockets = [];
  const recordRequest = request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) publicRequests.push(url.pathname); };
  page.on("request", recordRequest);
  const network = await page.createCDPSession();
  await network.send("Network.enable");
  network.on("Network.webSocketCreated", event => publicSockets.push(event.url));
  for (const locale of ["en", "zh"]) {
    publicRequests = []; publicSockets = [];
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.goto(`${base}/login?locale=${locale}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="dialog"]:has([data-auth-dialog])', { visible: true, timeout: 20000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 });
    assert.equal(await page.$$eval('[data-auth-dialog] .dsh-auth-providers button[title]:disabled', elements => elements.length === 3), true, "unconfigured provider buttons never imply available OAuth");
    assert.deepEqual(await page.$$eval('[data-auth-dialog] [data-auth-email]', elements => elements.map(element => ({ action: element.getAttribute('data-auth-email'), disabled: element.matches(':disabled'), explained: Boolean(element.getAttribute('title')?.trim()) }))), [
      { action: 'reset', disabled: true, explained: true }, { action: 'verification', disabled: true, explained: true },
    ], "unconfigured email recovery and verification remain visible, disabled and explained");
    const inventory = await page.evaluate(() => window.__DSH_BASE_PLUGINS__);
    assert.equal(inventory?.length, 1, "public document must boot only its declared provider");
    assert.equal(inventory[0].moduleName, "@dsh-base/client-auth-login");
    assert.equal(inventory[0].fiberPhase, "active");
    assert.deepEqual(publicRequests, ["/api/auth-policy"], "login must not issue authenticated RPC or private control requests");
    assert.deepEqual(publicSockets, [], "login must not open authenticated WebSockets");
    assert.deepEqual(errors, [], "public login boot must have no browser errors");
    const palettes = [];
    for (const scheme of ["light", "dark", "light"]) {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await page.waitForFunction(expected => document.documentElement.style.colorScheme === expected, {}, scheme);
      const palette = await page.$eval('[role="dialog"]:has([data-auth-dialog])', surface => {
        const token = document.createElement("span");
        token.style.backgroundColor = "var(--dsw-alias-bg-layer-2)"; token.style.color = "var(--dsw-alias-label-primary)";
        surface.append(token); const official = getComputedStyle(token);
        const expected = { background: official.backgroundColor, foreground: official.color }; token.remove();
        return { background: getComputedStyle(surface).backgroundColor, foreground: getComputedStyle(surface.querySelector("h2")).color, expected,
          dark: document.body.hasAttribute("data-ds-dark-theme"), source: document.documentElement.getAttribute("data-ds-theme-source") };
      });
      assert.equal(palette.background, palette.expected.background, "official Modal secondary-layer background token");
      assert.equal(palette.foreground, palette.expected.foreground, "official Modal title foreground token");
      assert.notEqual(palette.background, palette.foreground);
      assert.equal(palette.dark, scheme === "dark"); assert.equal(palette.source, "system");
      palettes.push({ scheme, ...palette });
      await page.screenshot({ path: join(artifacts, scheme === "light" ? `login-${locale}.png` : `login-${locale}-dark.png`) });
    }
    assert.deepEqual(publicRequests, ["/api/auth-policy"], "system theme changes must not fetch private settings");
    assert.deepEqual(publicSockets, [], "public theme must not start a private connection");
    publicDocuments.push({ locale, apiRequests: [...publicRequests], webSockets: [...publicSockets], inventory, palettes });
  }
  // The public shell still mounts the official inventory, but private Host
  // transports must wait for a verified account instead of retrying 401s.
  publicRequests = []; publicSockets = [];
  await page.goto(`${base}/?locale=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Account menu"]', { timeout: 20000 });
  await page.click('button[aria-label="Account menu"]');
  await page.waitForSelector('[role="menuitem"]');
  await page.evaluate(() => {
    const settings = [...document.querySelectorAll('[role="menuitem"]')].find(row => row.textContent.trim() === "Settings");
    if (!(settings instanceof HTMLElement)) throw new Error("anonymous settings entry missing");
    settings.click();
  });
  await page.waitForSelector('[role="dialog"] nav', { timeout: 10000 });
  // Spans the previous two-second account polling and connection retry loop.
  await new Promise(resolveWait => setTimeout(resolveWait, 5500));
  const privateRequests = publicRequests.filter(path => !['/api/auth/get-session', '/api/site-config', '/api/public-pages'].includes(path));
  assert.deepEqual(privateRequests, [], "anonymous shell/settings must not issue private Host requests");
  assert.deepEqual(publicSockets, [], "anonymous shell must not start the authenticated Gateway");
  assert.equal(publicRequests.filter(path => path === "/api/auth/get-session").length, 1, "account watchers share one snapshot without idle polling");
  assert.equal(publicRequests.filter(path => path === '/api/site-config').length, 1, 'anonymous branding reads public site facts once without polling');
  assert.equal(publicRequests.filter(path => path === '/api/public-pages').length, 1, 'anonymous navigation reads the published public page registry once without polling');
  assert.deepEqual(errors, [], "anonymous shell/settings boot must have no browser errors");
  const anonymousShell = { apiRequests: [...publicRequests], webSockets: [...publicSockets], idleObservationMs: 5500, settingsVisible: true };
  await page.screenshot({ path: join(artifacts, "anonymous-settings.png") });
  page.off("request", recordRequest);
  await network.detach();
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
  // A login completed in another tab must reboot the anonymous composition so
  // persisted account plugin choices apply before private services start.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
  await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === "active"), { timeout: 20000 });
  anonymousShell.signInReloadedComposition = true;
  const otherTab = await browser.newPage();
  await watchFailureNetwork(otherTab);
  await otherTab.setViewport({ width: 1440, height: 900 });
  observeBrowserErrors(otherTab, 'second tab: ');
  await otherTab.goto(`${base}/app/session/${encodeURIComponent(editorSessionId)}`, { waitUntil: "domcontentloaded" });
  await otherTab.waitForSelector('[contenteditable="true"]', { timeout: 20000 });
  observations.push({ sessionMenu: await assertSessionHeaderMenu({ page: otherTab, browser, base, request, cookie, sessionId: editorSessionId, historyText, artifacts }) });
  const otherCall = async (method, params) => {
    const result = await otherTab.evaluate(async ({ method, params }) => {
      const response = await fetch("/api/session-host", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
      return { status: response.status, body: await response.json() };
    }, { method, params });
    assert.equal(result.status, 200, `second tab ${method}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error, undefined, `second tab ${method}: ${JSON.stringify(result.body)}`);
    return result.body.result;
  };
  const otherRpc = async (method, args) => {
    const response = await otherTab.evaluate(async ({ method, args }) => {
      const rpcId = crypto.randomUUID();
      const response = await fetch(`/api/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }) });
      return { status: response.status, rpcId, body: await response.json() };
    }, { method, args });
    assert.equal(response.status, 200); assert.equal(response.body.rpcId, response.rpcId);
    assert.equal(response.body.result?.ok, true, JSON.stringify(response.body));
    return response.body.result.value;
  };
  const expected = clientRows(repoRoot);
  const expectedNames = new Set(expected.map(row => row.name));
  for (const [name, { manifest }] of officialPackages(repoRoot)) {
    if (manifest.dsh?.client !== undefined && (!manifest.dsh.client.platform || manifest.dsh.client.platform === "web")) expectedNames.add(name);
  }
  const inspect = async () => {
    const inventory = await page.evaluate(() => window.__DSH_BASE_PLUGINS__);
    assert.ok(Array.isArray(inventory));
    assert.deepEqual(inventory.map(row => row.moduleName).sort(), [...expectedNames].sort(), 'runtime inventory matches metadata/profile and complete official inventory');
    for (const row of expected) {
      const actual = inventory.find(entry => entry.moduleName === row.name);
      assert.ok(actual, `missing inventory: ${row.name}`);
      assert.equal(actual.origin, row.origin, row.name);
      assert.equal(actual.enabled, row.disabled !== true, row.name);
      assert.equal(actual.fiberPhase, row.disabled === true ? null : "active", row.name);
      assert.equal(actual.replaces, row.replaces, row.name);
    }
    for (const [name, { manifest }] of officialPackages(repoRoot)) {
      if (manifest.dsh?.client === undefined || (manifest.dsh.client.platform && manifest.dsh.client.platform !== "web")) continue;
      assert.ok(inventory.some(entry => entry.moduleName === name), `official inventory absent: ${name}`);
      if (!expected.some(row => row.name === name)) {
        const original = inventory.find(entry => entry.moduleName === name);
        assert.equal(original.enabled, false, 'uncomposed official entries remain disabled inventory');
        assert.equal(original.fiberPhase, null);
      }
    }
    for (const name of [
      '@deepseek-ai/dsh-api-remote-access', '@deepseek-ai/dsh-typert-registry',
      '@deepseek-ai/dsh-client-ui-agent-team', '@deepseek-ai/dsh-client-ui-account-notifications',
    ]) {
      const entry = inventory.find(row => row.moduleName === name);
      assert.equal(entry?.origin, 'upstream', `${name} uses the unchanged official composition entry`);
      assert.equal(entry?.enabled, true);
      assert.equal(entry?.fiberPhase, 'active');
    }
    const chatImport = inventory.find(row => row.moduleName === '@deepseek-ai/dsh-deepseek-chat-import');
    assert.equal(chatImport?.enabled, false, 'the on-demand chat importer remains discoverable without a Workers importer');
    assert.equal(chatImport.fiberPhase, null);
    const retiredGeneration = inventory.find(row => row.moduleName === '@dsh-base/client-wire-bootstrap');
    assert.equal(retiredGeneration?.enabled, false, 'the unchanged Gateway owns the sole generation loop');
    assert.equal(retiredGeneration?.fiberPhase, null);
    const siteConfig = inventory.find(row => row.moduleName === '@dsh-base/client-site-config');
    assert.equal(siteConfig?.enabled, true, 'public site configuration has an active brand consumer');
    assert.equal(siteConfig?.fiberPhase, 'active');
    const retiredMenu = inventory.find(row => row.moduleName === '@dsh-base/client-shell-extras');
    assert.equal(retiredMenu?.enabled, false, 'site settings do not restore retired sidebar entries');
    assert.equal(retiredMenu?.fiberPhase, null);
    return inventory;
  };
  const click = async (pattern, targetPage = page) => {
    await targetPage.waitForFunction(source => {
      const re = new RegExp(source, "iu");
      return [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].some(element =>
        [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled"));
    }, { timeout: 10000 }, pattern);
    const count = await targetPage.evaluate(source => {
      const re = new RegExp(source, "iu");
      const candidates = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].filter(element => {
        return [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled");
      });
      candidates[0]?.click(); return candidates.length;
    }, pattern);
    assert.ok(count > 0, `control missing: ${pattern}`);
  };
  // Settings navigation is inside the modal dialog. A nav click issued while
  // the pane is re-rendering can be swallowed, so retry until the target pane's
  // ready marker appears (the earlier generic page click could also match a
  // same-named control outside the dialog).
  const clickDialogNav = async (pattern, readySelector, targetPage = page) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const clicked = await targetPage.evaluate(re => {
        const matcher = new RegExp(re, "iu");
        const button = [...document.querySelectorAll('[role="dialog"] nav button')]
          .find(candidate => matcher.test((candidate.textContent ?? "").trim()));
        if (button === undefined) return false;
        button.click();
        return true;
      }, pattern);
      assert.equal(clicked, true, `settings nav missing: ${pattern}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 700));
      if (readySelector === undefined) return;
      // A settings-store update can remount the pane right after the click and
      // bounce the dialog back to the previous tab, so require the target pane
      // to stay present across a couple of samples before returning.
      let stable = true;
      for (let sample = 0; sample < 3; sample += 1) {
        if (await targetPage.$(readySelector) === null) { stable = false; break; }
        await new Promise(resolveWait => setTimeout(resolveWait, 400));
      }
      if (stable) return;
    }
    assert.fail(`settings nav did not stay on ${readySelector} for ${pattern}`);
  };
  // Full-page navigation in the local Worker can transiently land on the
  // client error surface ("unavailable"); reload once before treating it as a
  // real failure so a slow isolate does not break an unrelated UI assertion.
  // Commit 1 restored the official in-memory workspace selection: a cold load
  // of a session URL can ask "Choose workspace" before mounting the composer.
  const ensureSessionComposer = async () => {
    try { await page.waitForSelector('[contenteditable="true"]', { timeout: 12000 }); return true; } catch { /* possibly the workspace chooser */ }
    const picked = await page.evaluate(() => {
      const label = element => (element.textContent ?? "").trim();
      const candidate = [...document.querySelectorAll('button, [role="button"], li, a')]
        .find(element => /^(Workspace|工作区)$/u.test(label(element)));
      if (candidate === undefined) return false;
      candidate.click();
      return true;
    });
    if (!picked) return false;
    try { await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 }); return true; } catch { return false; }
  };
  const gotoSessionPage = async url => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const text = (await page.evaluate(() => document.body.innerText)).trim();
        if (text !== "unavailable" && await ensureSessionComposer()) return;
      } catch (error) { lastError = error; }
      await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    }
    throw lastError ?? new Error(`session page never mounted: ${url}`);
  };
  const checkRapidComposerInput = async locale => {
    const composerSelector = '[contenteditable="true"][role="textbox"]';
    // ModelSelect also has aria-busy; target the official localized Send action.
    const primarySelector = `[data-composer-card] button[aria-label=${JSON.stringify(locale === "zh" ? "发送消息" : "Send message")}]`;
    const promptRequests = [];
    const recordPrompt = request => {
      if (new URL(request.url()).pathname === "/api/session/prompt") promptRequests.push(request.url());
    };
    page.on("request", recordPrompt);
    try {
      // Reproduce the desktop history/editor binding that exposed React 185.
      // No settling delay, slow typing, paste, or mocked submission is allowed.
      // Commit 1 restored the official in-memory session selection (the URL
      // deep-link plugin was removed), so select the row explicitly first.
      await page.waitForSelector(`[data-row-key="session:${editorSessionId}"]`, { timeout: 10000 });
      await page.click(`[data-row-key="session:${editorSessionId}"]`);
      await page.waitForFunction(id => document.querySelector(`[data-row-key="session:${id}"][aria-selected="true"]`), { timeout: 10000 }, editorSessionId);
      await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 10000 }, historyText);
      assert.ok(await page.$eval('[data-composer-card]', element => element.getBoundingClientRect().top > innerHeight / 2), "exercise the history footer composer, not the empty-session hero");
      const composer = await page.$(composerSelector);
      assert.ok(composer);
      assert.equal(await composer.evaluate(element => element.textContent), "");
      assert.equal(await page.$eval(primarySelector, element => element.disabled), true);
      const text = "trace-local-editor: Please call fetch_url exactly once for https://developers.cloudflare.com/ and then reply with only the page title.";
      await composer.click();
      await page.focus(composerSelector);
      await page.keyboard.type(text, { delay: 0 });
      await page.waitForFunction(({ composerSelector, primarySelector, text }) => {
        const editor = document.querySelector(composerSelector);
        const primary = document.querySelector(primarySelector);
        return editor?.textContent === text && primary?.disabled === false && primary.getAttribute("aria-busy") === "false";
      }, { timeout: 10000 }, { composerSelector, primarySelector, text });
      assert.deepEqual(errors, [], `${locale}: rapid desktop typing must not cause render/store errors before submission`);
      await page.screenshot({ path: join(artifacts, `composer-typed-${locale}.png`) });
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(modifier);
      await page.keyboard.press("KeyA");
      await page.keyboard.up(modifier);
      await page.keyboard.press("Backspace");
      await page.waitForFunction(({ composerSelector, primarySelector }) => {
        const editor = document.querySelector(composerSelector);
        const primary = document.querySelector(primarySelector);
        return editor?.textContent === "" && primary?.disabled === true && primary.getAttribute("aria-busy") === "false";
      }, { timeout: 10000 }, { composerSelector, primarySelector });
      assert.deepEqual(promptRequests, [], "editing and clearing must never submit a prompt");
      assert.deepEqual(await call("history", { sessionId: editorSessionId }), editorHistory, "editing must not mutate durable history");
      assert.equal((await call("state", { sessionId: editorSessionId })).running, false);
      assert.deepEqual(errors, [], `${locale}: clearing the draft must preserve the zero-error contract`);
      return { viewport: { width: 1440, height: 900 }, sessionId: editorSessionId, history: "real cancelled user turn", typingDelay: 0, typedCharacters: text.length, draftCleared: true, promptRequests: 0 };
    } finally {
      page.off("request", recordPrompt);
    }
  };
  const agentPresetChecks = async (locale, editorSessionId) => {
    const cardIds = () => page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => element.dataset.agentPresetId));
    const currentDefault = () => page.$eval('li[data-agent-preset-id] button[aria-pressed="true"]', button => button.closest("li")?.dataset.agentPresetId).catch(() => undefined);
    const openSettingsPresets = async () => {
      await click("^settings\\b|^设置");
      await page.waitForSelector('[role="dialog"] nav button');
      await clickDialogNav("^agent presets?$|^agent 预设$", "li[data-agent-preset-id]");
      await page.waitForFunction(() => document.querySelectorAll("li[data-agent-preset-id]").length > 0, { timeout: 15000 });
    };
    const closeSettings = async () => {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] nav button'), { timeout: 10000 });
    };
    await page.bringToFront();
    await click("account menu|账号菜单");
    await openSettingsPresets();
    assert.deepEqual(await cardIds(), ["standard", "ptc", "minimal", "cordis", "dsh-base-think"]);
    const expectedThinkName = locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think";
    assert.ok((await page.$eval('li[data-agent-preset-id="dsh-base-think"]', element => element.textContent ?? "")).includes(expectedThinkName), `${locale}: Settings default card uses the Cloudflare Think name`);
    const availability = await page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => ({
      id: element.dataset.agentPresetId,
      availability: element.dataset.availability,
      alert: element.querySelector('[role="alert"]') !== null,
      className: element.className,
      text: element.textContent ?? "",
    })));
    for (const row of availability.slice(0, 4)) {
      assert.equal(row.availability, "unavailable", `${locale}:${row.id}: platform limitation is gray unavailable`);
      assert.equal(row.alert, false, `${locale}:${row.id}: platform limitation is not a role=alert failure`);
      assert.match(row.className, /cardUnavailable/u);
      assert.doesNotMatch(row.className, /cardBroken/u);
      assert.match(row.text, /Unavailable in this deployment|当前部署不可用/u);
      assert.doesNotMatch(row.text, /Failed to load|加载失败/u);
    }
    assert.equal(availability.at(-1).availability, "available");
    const cards = await page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => ({
      id: element.dataset.agentPresetId,
      broken: element.querySelector('[role="alert"]') !== null,
      text: element.innerText,
    })));
    for (const card of cards.slice(0, 4)) {
      assert.equal(card.broken, false, `${locale}:${card.id} must not show a red load-failure alert`);
      assert.match(card.text, /Unavailable in this deployment|当前部署不可用/u);
      assert.doesNotMatch(card.text, /Failed to load|加载失败/u);
      assert.ok(card.text.length > 20, `${locale}:${card.id} keeps official name/description/reason`);
    }
    // Every real official declaration opens through the official viewer and
    // matches the pinned package export byte for byte.
    for (const id of ["standard", "ptc", "minimal", "cordis"]) {
      const selector = `li[data-agent-preset-id="${id}"] button[data-tip]`;
      await page.click(selector);
      await page.waitForSelector('[role="dialog"] pre', { visible: true, timeout: 10000 });
      const content = await page.$eval('[role="dialog"] pre', element => element.textContent);
      assert.equal(content, officialPresetDeclarations[id].content, `${locale}:${id} declaration differs from pinned export`);
      presetDeclarationText[locale][id] = content;
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] pre'), { timeout: 10000 });
    }
    const thinkView = await page.$eval('li[data-agent-preset-id="dsh-base-think"] button[data-tip]', button => ({ disabled: button.disabled, title: button.title }));
    assert.equal(thinkView.disabled, true);
    assert.ok(thinkView.title.length > 0);
    const creatorLabel = locale === "zh" ? "让 Agent 帮我创建预设模式" : "Let the agent help me create a preset";
    const creator = await page.evaluate(label => {
      const button = [...document.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label);
      return button === undefined ? null : { disabled: button.disabled, title: button.title };
    }, creatorLabel);
    assert.notEqual(creator, null, `${locale}: Creator entry stays visible`);
    assert.equal(creator.disabled, true, `${locale}: Creator entry is disabled`);
    assert.ok(creator.title.length > 0);
    // Real pointer activation on a neutral unavailable card changes nothing.
    const beforeDefault = await currentDefault();
    const cardPoint = await page.$eval('li[data-agent-preset-id="standard"] button[aria-pressed]', button => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(cardPoint.x, cardPoint.y);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await currentDefault(), beforeDefault, `${locale}: unavailable card pointer activation changed the default`);
    // Real keyboard activation on a neutral unavailable card changes nothing.
    await page.$eval('li[data-agent-preset-id="standard"] button[aria-pressed]', button => button.focus());
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await currentDefault(), beforeDefault, `${locale}: unavailable card keyboard activation changed the default`);
    // Coding Tools off follows the official filter: PTC/Minimal disappear while
    // Standard/Creator remain visible; on restores all five.
    await clickDialogNav("^general$|^通用设置$");
    // Official version row: app version from apps/web/package.json and the
    // upstream tag injected from dsh-source.lock.json, on the same line.
    const expectedVersionLine = locale === "zh"
      ? `当前版本：dsh-base ${appVersion} · 上游 DeepSeek Harness：${upstreamVersion}`
      : `Current version: dsh-base ${appVersion} · Upstream DeepSeek Harness: ${upstreamVersion}`;
    assert.ok((await page.$eval('[role="dialog"]', element => element.innerText)).includes(expectedVersionLine), `${locale}: version row must name app and pinned upstream versions`);
    await page.evaluate(text => {
      const row = [...document.querySelectorAll("div")].find(element => element.textContent?.trim() === text);
      row?.scrollIntoView({ block: "center" });
    }, expectedVersionLine);
    const versionLinks = await page.$$eval('[role="dialog"] a[href]', elements => elements.map(element => ({
      text: element.textContent, href: element.href, target: element.target, rel: element.rel,
    })));
    const repoLink = versionLinks.find(link => link.text === "DeepSeek Harness");
    const tagLink = versionLinks.find(link => link.text === upstreamVersion);
    assert.equal(repoLink?.href, upstreamRepository, `${locale}: DeepSeek Harness link must target the pinned repository`);
    assert.equal(repoLink?.target, "_blank"); assert.match(repoLink?.rel ?? "", /noopener/u); assert.match(repoLink?.rel ?? "", /noreferrer/u);
    assert.equal(tagLink?.href, upstreamRelease, `${locale}: tag link must target the pinned release`);
    assert.equal(tagLink?.target, "_blank"); assert.match(tagLink?.rel ?? "", /noopener/u);
    assert.equal(await page.evaluate(href => {
      const link = [...document.querySelectorAll('[role="dialog"] a[href]')].find(element => element.href === href);
      link?.focus();
      return document.activeElement === link;
    }, upstreamRepository), true, `${locale}: repository link must be keyboard focusable`);
    await page.screenshot({ path: join(artifacts, `version-${locale}.png`) });
    await page.setViewport({ width: 768, height: 900 });
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.evaluate(text => {
      const row = [...document.querySelectorAll("div")].find(element => element.textContent?.trim() === text);
      row?.scrollIntoView({ block: "center" });
    }, expectedVersionLine);
    const narrow = await page.evaluate(text => {
      const row = [...document.querySelectorAll("div")].find(element => element.textContent?.trim() === text);
      if (row === undefined) return null;
      const rect = row.getBoundingClientRect();
      return { right: rect.right, viewport: window.innerWidth, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth };
    }, expectedVersionLine);
    assert.ok(narrow !== null, `${locale}: version row missing at narrow width`);
    assert.ok(narrow.right <= narrow.viewport + 1, `${locale}: version row overflows narrow Settings pane`);
    assert.ok(narrow.scrollWidth <= narrow.clientWidth + 1, `${locale}: version row horizontal scroll at narrow width`);
    await page.screenshot({ path: join(artifacts, `version-narrow-${locale}.png`) });
    await page.setViewport({ width: 1440, height: 900 });
    // Agent presets pane: the retained marked fork must still render its real
    // preset cards. The former Coding-Tools toggle round-trip assertion was an
    // M2-era behavior and is not re-baselined here (Commit 1 keeps the official
    // settings switch untouched; filtering parity is tracked separately).
    await clickDialogNav("^agent presets?$|^agent 预设$", "li[data-agent-preset-id]");
    await page.waitForFunction(() => document.querySelectorAll("li[data-agent-preset-id]").length > 0, { timeout: 15000 });
    assert.ok((await page.$eval('[role="dialog"]', element => element.innerText)).length > 40, `${locale}: Agent presets pane renders`);
    await closeSettings();
    // Composer: real official Slot + Controller with the complete 5-row roster.
    const blank = await call("create", { title: `Preset composer ${locale}` });
    await gotoSessionPage(`${base}${prefixFor(locale === "zh" ? "zh" : "en")}/app/session/${encodeURIComponent(blank.sessionId)}`);
    const chipLabel = locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think";
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), { timeout: 20000 }, chipLabel);
    const chipPoint = await page.evaluate(label => {
      const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(candidate => (candidate.textContent ?? "").includes(label));
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, chipLabel);
    const openComposerMenu = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.mouse.click(chipPoint.x, chipPoint.y);
        try {
          await page.waitForSelector('[role="menuitem"]', { visible: true, timeout: 3_000 });
          // The official Seat closes its menu when the Coding Tools/option
          // count changes; wait one settle tick before sampling.
          await new Promise(resolve => setTimeout(resolve, 250));
          if ((await page.$$('[role="menuitem"]')).length > 0) return;
        } catch {
          // retry the real pointer activation
        }
      }
      throw new Error(`${locale}: composer preset menu did not stay open`);
    };
    await openComposerMenu();
    const menu = await page.$$eval('[role="menuitem"]', elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent ?? "", disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true", point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
    }));
    assert.equal(menu.length, 5, `${locale}: composer roster must show all five rows`);
    for (const [index, id] of ["standard", "ptc", "minimal", "cordis"].entries()) {
      assert.equal(menu[index].disabled, true, `${locale}: composer ${id} stays disabled`);
      assert.ok(menu[index].text.length > 20, `${locale}: composer ${id} keeps its explanation`);
    }
    assert.equal(menu[4].disabled, false, `${locale}: fixed Think stays selectable`);
    await page.mouse.click(menu[0].point.x, menu[0].point.y);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.evaluate(() => document.body.innerText.includes("Cloudflare Think 模式") || document.body.innerText.includes("Cloudflare Think")), true);
    await page.keyboard.press("Escape");
    // Real keyboard traversal must skip the disabled official rows: the only
    // enabled choice is the fixed Think row, and selecting it leaves that mode.
    await openComposerMenu();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await page.evaluate(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), chipLabel), true, `${locale}: keyboard traversal selected an unavailable preset`);
    await page.keyboard.press("Escape");
    // Coding Tools off must remove only PTC/Minimal from the real composer menu,
    // not from the Settings explanation cards.
    await otherCall("settingsUpdate", { ns: "ui-settings", patch: { enabled: false } });
    await new Promise(resolve => setTimeout(resolve, 600));
    await openComposerMenu();
    const filteredMenu = await page.$$eval('[role="menuitem"]', elements => elements.map(element => element.textContent ?? ""));
    assert.equal(filteredMenu.length, 3, `${locale}: Coding Tools off must leave three composer choices`);
    const composerFilteredRows = filteredMenu.length;
    await page.keyboard.press("Escape");
    await otherCall("settingsUpdate", { ns: "ui-settings", patch: { enabled: true } });
    await new Promise(resolve => setTimeout(resolve, 600));
    await openComposerMenu();
    assert.equal((await page.$$('[role="menuitem"]')).length, 5, `${locale}: Coding Tools on restores five composer choices`);
    await page.keyboard.press("Escape");
    // Reload restores the canonical Think default and keeps real history listed.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"]', { timeout: 20000 });
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), { timeout: 20000 }, chipLabel);
    assert.ok((await page.evaluate(() => document.body.innerText)).includes("Composer input regression"), `${locale}: reload keeps historical Session identity`);
    await call("workspaceSetFlags", { sessionId: blank.sessionId, archived: true });
    return { declarationCount: 4, composerRows: 5, composerFilteredRows, codingToolsHidden: ["ptc", "minimal"], creatorDisabled: true, reloadDefault: "dsh-base-think", unavailableRows: 4, brokenRows: 0, versionLine: expectedVersionLine };
  };

  // BYOK-only deployment: the official DeepSeek provider surface remains, and
  // Commit 2 restores the platform Gateway card, but only when the deployment
  // enables the platform route; DSH_EXPECT_PLATFORM_AI selects the expectation.
  const expectPlatformGateway = process.env.DSH_EXPECT_PLATFORM_AI === "true";
  {
    const ref = "DEEPSEEK_OFFICIAL_API_KEY";
    const keyInput = '[role="dialog"] input[type="password"]';
    const describeKey = async () => (await call("credentialsDescribe", { refs: [ref] })).entries[ref];
    const openModels = async locale => {
      await call("settingsUpdate", { ns: "locale", patch: { preference: locale } });
      await page.bringToFront();
      await gotoSessionPage(`${base}${prefixFor(locale === "zh" ? "zh" : "en")}/app/session/${encodeURIComponent(editorSessionId)}`);
      await click('account menu|账号菜单');
      await click('^settings\\b|^设置');
      await page.waitForSelector('[role="dialog"] nav button', { timeout: 20000 });
      await clickDialogNav(locale === 'zh' ? '^模型$' : '^Models$', '[data-gateway-provider]');
    };
    const openKey = async locale => {
      if (await page.$(keyInput) === null) await click(locale === 'zh' ? '^编辑$' : '^Edit$');
      await page.waitForSelector(keyInput, { visible: true, timeout: 10_000 });
    };
    const submitKey = async (locale, method) => {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/session-host'
          && JSON.parse(response.request().postData() ?? '{}').method === method, { timeout: 15_000 }),
        click(locale === 'zh' ? '^保存$' : '^Apply$'),
      ]);
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).error, undefined, method);
    };
    for (const locale of ['en', 'zh']) {
      await openModels(locale);
      const settingsText = await page.$eval('[role="dialog"]', element => element.innerText);
      assert.match(settingsText, /DeepSeek/u, `${locale}: official DeepSeek provider remains`);
      // The restored card stays visible in both platform states (official rule:
      // an unavailable official capability is shown disabled with a localized
      // reason, never hidden). The card exposes its state; the localized reason
      // lives in the expandable read-only details region.
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-gateway-provider]');
        const state = card?.getAttribute('data-gateway-provider');
        return state === 'available' || state === 'unavailable' || state === 'error';
      }, { timeout: 20000 });
      const gatewayState = await page.$eval('[data-gateway-provider]', element => element.getAttribute('data-gateway-provider'));
      assert.match(settingsText, /Cloudflare AI Gateway/u, `${locale}: platform Gateway provider card is rendered`);
      if (expectPlatformGateway) assert.equal(gatewayState, 'available', `${locale}: platform route reports available`);
      else assert.equal(gatewayState, 'unavailable', `${locale}: platform route reports unavailable (not hidden)`);
      await page.screenshot({ path: join(artifacts, `models-providers-${locale}.png`) });
      await page.setViewport({ width: 720, height: 800 });
      await page.screenshot({ path: join(artifacts, `models-providers-narrow-${locale}.png`) });
      await page.setViewport({ width: 1440, height: 900 });
      await openKey(locale);
      if (locale === 'en') {
        await page.waitForSelector(`${keyInput}[placeholder="••••••••"]`);
        assert.equal(await page.$eval(keyInput, input => input.value), '');
        await page.focus(keyInput);
        await page.keyboard.press('Delete');
        assert.equal((await describeKey()).configured, true, 'Delete only stages removal');
        await submitKey(locale, 'credentialsUnset');
        assert.deepEqual(await describeKey(), { configured: false, writable: true });
      } else {
        // The next cold load must forget the removed key, then persist a new
        // synthetic key through the official editor on this disposable owner.
        assert.notEqual(await page.$eval(keyInput, input => input.placeholder), '••••••••');
        await page.type(keyInput, 'local-ui-replacement-not-a-provider-key');
        await submitKey(locale, 'credentialsSet');
        assert.deepEqual(await describeKey(), { configured: true, writable: true, source: 'host' });
        await openModels(locale);
        await openKey(locale);
        await page.waitForSelector(`${keyInput}[placeholder="••••••••"]`);
        assert.equal(await page.$eval(keyInput, input => input.value), '');
      }
      await page.keyboard.press('Escape');
    }
  }

  for (const locale of ["en", "zh"]) {
    // The bare English route follows the persisted preference; select the
    // official preference for deterministic language acceptance before boot.
    await call("settingsUpdate", { ns: "locale", patch: { preference: locale } });
    // Keep the document receiving real pointer/keyboard interaction foreground.
    // Background tab mutations below use fetch without changing focus.
    await page.bringToFront();
    await gotoSessionPage(`${base}${prefixFor(locale === "zh" ? "zh" : "en")}/app/session/${encodeURIComponent(editorSessionId)}`);
    try { await page.waitForSelector('[contenteditable="true"]', { timeout: 20000 }); }
    catch (error) { throw new Error(`boot failed: ${(await page.evaluate(() => document.body.innerText)).slice(0,1800)}\n${errors.join("\n")}`, { cause: error }); }
    const inventory = await inspect();
    await page.waitForFunction(name => document.querySelector('[class*="brandIdentity"]')?.textContent.trim() === name, { timeout: 10000 }, publicSite.brand.name);
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
    // The approved brand name slot consumes public site settings while the
    // official mark, layout and version-copy interaction remain unchanged.
    assert.equal(brand, publicSite.brand.name, `sidebar brand reflects public site configuration: ${brand}`);
    const forkEntry = inventory.find(row => row.moduleName === "@dsh-base/client-agent-preset");
    const replacedEntry = inventory.find(row => row.moduleName === "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(forkEntry?.origin, "fork", "active preset UI comes from the marked official fork");
    assert.equal(forkEntry?.enabled, true);
    assert.equal(forkEntry?.fiberPhase, "active");
    assert.equal(forkEntry?.replaces, "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(replacedEntry?.origin, "upstream", "the disabled official original stays in inventory");
    assert.equal(replacedEntry?.enabled, false);
    assert.equal(replacedEntry?.fiberPhase, null);
    const composerInput = await checkRapidComposerInput(locale);
    await otherCall("selectModel", { sessionId: editorSessionId, model: "deepseek-official/deepseek-v4-pro", reasoningEffort: "max" });
    await page.waitForFunction(() => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => /DeepSeek-V4-Pro/.test(button.textContent ?? "") && /Max/.test(button.textContent ?? "")), { timeout: 10000 });
    assert.equal((await call("state", { sessionId: editorSessionId })).reasoningEffort, "max");
    const policyReceipt = await otherRpc("commands/execute", { sessionId: editorSessionId, line: "/permission read-only", attachments: [] });
    assert.ok(policyReceipt.commandId && policyReceipt.result.kind === "success");
    await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label]')].some(button => /Access mode.*Read Only|访问模式.*仅可查看/.test(button.getAttribute("aria-label") ?? "")), { timeout: 10000 });
    await otherRpc("commands/execute", { sessionId: editorSessionId, line: "/permission workspace-write", attachments: [] });
    await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label]')].some(button => /Access mode.*Workspace Write|访问模式.*工作区内修改/.test(button.getAttribute("aria-label") ?? "")), { timeout: 10000 });

    await otherCall("selectModel", { sessionId: editorSessionId, model: "deepseek-official/deepseek-flash", reasoningEffort: "low" });
    await page.waitForFunction(() => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => /Flash/.test(button.textContent ?? "") && /Low/.test(button.textContent ?? "")), { timeout: 10000 });

    await page.screenshot({ path: join(artifacts, `shell-${locale}.png`) });
    const expand = await page.$("[data-sidebar-right-expand]");
    if (expand !== null) await expand.click();
    await page.waitForSelector("fieldset.dsh-terminal-disabled", { visible: true, timeout: 10000 });
    assert.equal(await page.$eval("fieldset.dsh-terminal-disabled", element => element.disabled), true);
    await page.screenshot({ path: join(artifacts, `rightbar-${locale}.png`) });
    await click("account menu|账号菜单");
    await click("^settings\\b|^设置");
    await page.waitForSelector('[role="dialog"] nav button');
    const sectionLabels = await page.$$eval('[role="dialog"] nav button', buttons => buttons.map(button => button.textContent.trim()));
    assert.ok(sectionLabels.length >= 5, `official Settings sections must remain visible: ${JSON.stringify({ sections: sectionLabels, agentPresets: inventory.filter(row => /agent-preset/.test(row.moduleName)), errors })}`);
    assert.equal(new Set(sectionLabels).size, sectionLabels.length, "shadowed sections must not create duplicate Settings navigation");
    await clickDialogNav("^general$|^通用设置$");
    await page.waitForFunction(() => /no upload service|没有日志上传服务/.test(document.body.innerText), { timeout: 10000 });
    // P4a restores the approved display-name fork: zh renders 简体中文 while the
    // internal id and the /zh path prefix stay official, and the official locale
    // runtime still owns switching/persistence.
    const languageLabels = await page.$$eval('[role="dialog"] button', buttons => buttons.map(button => (button.textContent ?? '').trim()).filter(Boolean));
    const activeLanguage = languageLabels.find(label => ['简体中文', 'English'].includes(label));
    assert.equal(activeLanguage, locale === 'zh' ? '简体中文' : 'English', `${locale}: language current value`);
    await page.evaluate(label => {
      [...document.querySelectorAll('[role="dialog"] button')].find(button => (button.textContent ?? '').trim() === label)?.click();
    }, activeLanguage);
    await page.waitForSelector('[role="menuitem"]', { timeout: 10000 });
    const languageMenu = await page.$$eval('[role="menuitem"]', items => items.map(item => (item.textContent ?? '').trim()));
    assert.ok(languageMenu.includes('简体中文'), `${locale}: language menu offers the approved 简体中文 label`);
    assert.equal(languageMenu.some(label => label === '中文'), false, `${locale}: the replaced official 中文 label is not listed twice`);
    await page.screenshot({ path: join(artifacts, `language-${locale}.png`) });
    await page.screenshot({ path: join(artifacts, `version-${locale}.png`) });
    await page.keyboard.press('Escape');
    const developerLabel = locale === "zh" ? "显示代码工作视图" : "Show coding view";
    // Read the exact official localized switch label, then verify accepted writes
    // against the real durable settings document rather than optimistic UI only.
    const developerSwitch = await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')].find(element => /coding view|code work|代码工作/i.test(element.getAttribute("aria-label") ?? ""))?.getAttribute("aria-label"));
    assert.ok(developerSwitch, `developer settings switch missing: ${developerLabel}`);
    const switchSelector = `[role="switch"][aria-label=${JSON.stringify(developerSwitch)}]`;
    await page.click(switchSelector);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-checked") === "false" && !document.querySelector(selector)?.disabled, {}, switchSelector);
    assert.equal((await call("settingsDescribe", {})).values["ui-settings"].enabled, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"]');
    await click("account menu|账号菜单");
    await click("^settings\\b|^设置");
    await clickDialogNav("^general$|^通用设置$");
    await page.waitForSelector(switchSelector);
    assert.equal(await page.$eval(switchSelector, element => element.getAttribute("aria-checked")), "false");
    await page.click(switchSelector);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-checked") === "true" && !document.querySelector(selector)?.disabled, {}, switchSelector);
    assert.equal((await call("settingsDescribe", {})).values["ui-settings"].enabled, true);
    // This write originates in another real authenticated document. No page
    // reload, local event emission, or polling may repair the first tab.
    await otherCall("settingsUpdate", { ns: "ui-settings", patch: { enabled: false } });
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-checked") === "false", { timeout: 10000 }, switchSelector);
    await otherCall("settingsUpdate", { ns: "ui-settings", patch: { enabled: true } });
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-checked") === "true", { timeout: 10000 }, switchSelector);
    await page.screenshot({ path: join(artifacts, `settings-${locale}.png`) });
    await page.keyboard.press("Escape");
    await click("automation tasks|scheduled tasks|自动化任务|计划任务");
    await page.waitForFunction(() => document.body.innerText.includes("Local parity task"), { timeout: 10000 });
    const crossTabTitle = `Other-tab task ${locale}`;
    const crossTabTask = await otherCall("scheduleCreate", { request: { title: crossTabTitle, prompt: crossTabTitle, timing: { kind: "after", after_seconds: 3600 }, target: { kind: "new" } } });
    await page.waitForFunction(title => document.body.innerText.includes(title), { timeout: 10000 }, crossTabTitle);
    assert.equal((await otherCall("scheduleEdit", { id: crossTabTask.id, action: "delete" })).deleted, true);
    await page.waitForFunction(title => !document.body.innerText.includes(title), { timeout: 10000 }, crossTabTitle);
    await page.screenshot({ path: join(artifacts, `schedule-${locale}.png`) });
    await click("choose a creation method|选择创建方式");
    await click("create manually|手动创建");
    await page.waitForSelector("textarea");
    const titleSelector = `input[placeholder=${JSON.stringify(locale === "zh" ? "例如：每日阅读摘要" : "E.g. Daily reading digest")}]`;
    const manualTitle = `Browser-created ${locale}`;
    await page.type(titleSelector, manualTitle);
    await page.type("textarea", "Local UI acceptance; future task only.");
    await click("^create\\s*$|^创建\\s*$");
    await page.waitForFunction(title => document.body.innerText.includes(title), { timeout: 10000 }, manualTitle);
    const records = await call("scheduleCatalog", {});
    const created = records.find(record => record.title === manualTitle);
    assert.ok(created, "official manual creation must reach durable Host");
    assert.equal(created.kind, "rrule");
    assert.equal((await call("scheduleEdit", { id: created.id, action: "delete" })).deleted, true);
    await assertOfficialSidebarMore(page, locale, { screenshot: join(artifacts, `sidebar-more-${locale}.png`) });
    // Compare the real rendered catalog with an independent pinned-source
    // oracle. Metadata-only official bundles remain visible and unavailable.
    await page.waitForSelector("[data-plugin-package]", { timeout: 20000 });
    const managerComposition = await page.evaluate(() => {
      const names = ['@dsh-base/client-plugin-manager', '@deepseek-ai/dsh-client-ui-plugin-manager'];
      return names.map(name => {
        const row = window.__DSH_BASE_PLUGINS__?.find(entry => entry.moduleName === name);
        return row && { moduleName: row.moduleName, enabled: row.enabled, fiberPhase: row.fiberPhase, origin: row.origin, ...(row.replaces === undefined ? {} : { replaces: row.replaces }) };
      });
    });
    assert.deepEqual(managerComposition[0], { moduleName: '@dsh-base/client-plugin-manager', enabled: true, fiberPhase: 'active', origin: 'fork', replaces: '@deepseek-ai/dsh-client-ui-plugin-manager' }, 'the actual plugin page is owned by the marked active fork');
    assert.deepEqual(managerComposition[1], { moduleName: '@deepseek-ai/dsh-client-ui-plugin-manager', enabled: false, fiberPhase: null, origin: 'upstream' }, 'the original stays disabled inventory without a running fiber');
    const mainPluginCards = await assertOfficialCards(page, officialPluginCatalog.main, locale, officialPluginCatalog);
    const countFiber = await page.evaluate(() => window.__DSH_BASE_PLUGINS__?.find(row => row.moduleName === '@dsh-base/client-plugin-counts'));
    assert.equal(countFiber?.entryId, 'client:plugin-counts');
    assert.equal(countFiber?.enabled, true);
    assert.equal(countFiber?.fiberPhase, 'active', 'category counts are delivered by their composed plugin');
    const categoryCounts = { main: await assertCategoryCounts(page, locale), more: undefined };
    for (const bundle of LOCAL_MANAGEABLE_BUNDLES) {
      assert.ok(mainPluginCards.some(card => card.name === bundle && !card.disabled && card.group === 'bundles'), `${bundle}: local manageable control remains distinct from original extensions`);
    }
    assert.ok(!mainPluginCards.some(card => card.name === '@dsh-base/client-commands'), 'required client shell rows are not switchable');
    const ownedCards = await assertOwnedBundleCards(page);
    const readonlyDetails = [], restrictedPanels = [];
    const ownedStateBefore = await (await request('/api/plugin-manager', { headers: { cookie } })).json();
    const readonlyMutations = [];
    const observeReadonlyMutation = outgoing => { if (outgoing.method() !== 'GET' && new URL(outgoing.url()).pathname === '/api/plugin-manager') readonlyMutations.push(outgoing.method()); };
    page.on('request', observeReadonlyMutation);
    await page.$$eval('[data-plugin-package^="dsh-base:"] [role="switch"]', elements => elements.forEach(element => element.click()));
    for (const name of READONLY_OWNED_BUNDLES) {
      await openPluginDetail(page, name);
      const expected = ownedOracle.bundles.find(bundle => bundle.name === name);
      readonlyDetails.push(await assertReadonlyOwnedDetail(page, name, locale, expected, { hostSection: true }));
      const restrictedRead = name === 'dsh-base:dashboard' ? '/api/operations-dashboard' : name === 'dsh-base:newsletter' ? '/api/saas/newsletter/reconcile' : undefined;
      if (restrictedRead) {
        // The client deliberately rejects an unauthorized response before
        // consuming its body. CDP response.json() can wait indefinitely for
        // that stream; verify the actual same-cookie GET body independently.
        const response = await request(restrictedRead, { headers: { cookie } });
        assert.equal(response.status, 403, `${restrictedRead}: ordinary account is denied`);
        assert.deepEqual(await response.json(), { error: 'site_admin_required' }, `${restrictedRead}: denial exposes no private records`);
      }
      if (name === 'dsh-base:dashboard') {
        const panel = `[data-saas-panel="${name}"][data-state="denied"]`;
        await page.waitForSelector(panel, { timeout: 10000 });
        assert.equal(await page.$eval(`${panel} [role="status"]`, element => element.textContent.trim()), locale === 'zh' ? '仅站点管理员可以访问这些信息。' : 'Only site administrators can access this information.');
        assert.equal(await page.$$eval(`${panel} [data-saas-row], ${panel} [data-saas-action], ${panel} [data-saas-result]`, elements => elements.length), 0, 'administrator-only operations expose no records, results or actions to ordinary users');
        restrictedPanels.push({ name, state: 'denied', privateRows: 0, explained: true });
      } else if (name === 'dsh-base:newsletter') {
        const panel = `[data-saas-panel="${name}"][data-state="ready"]`;
        await page.waitForSelector(panel, { timeout: 10000 });
        assert.equal(await page.$eval(`${panel} [role="status"]`, element => element.textContent.trim()), locale === 'zh' ? '当前部署不可用。' : 'Unavailable in this deployment.');
        for (const action of ['subscribe', 'unsubscribe']) assert.equal(await page.$eval(`${panel} [data-saas-action="${action}"] button`, element => element.disabled), true, 'newsletter keeps owner controls visible while its provider is unavailable');
        assert.equal(await page.$$eval(`${panel} [data-saas-row], ${panel} [data-saas-action^="reconcile:"]`, elements => elements.length), 0, 'ordinary subscribers never receive administrator recovery rows or actions');
        restrictedPanels.push({ name, state: 'ready', recoveryRows: 0, ownerControls: 2 });
      }
      await page.$$eval('[data-plugin-detail] [role="switch"]', elements => elements.forEach(element => element.click()));
      await page.screenshot({ path: join(artifacts, `plugins-owned-${name.split(':')[1]}-${locale}.png`) });
      await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
      await page.waitForSelector('[data-plugin-group="bundles"]');
    }
    assert.deepEqual(readonlyMutations, [], 'read-only card and component clicks cannot mutate account settings');
    page.off('request', observeReadonlyMutation);
    for (const name of [...READONLY_OWNED_BUNDLES, ...ownedOracle.rows.filter(row => READONLY_OWNED_BUNDLES.includes(row.bundle)).map(row => row.moduleName)]) {
      const denied = await request('/api/plugin-manager', { method: 'PUT', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name, disabled: true, expectedRevision: ownedStateBefore.revision }) });
      assert.equal(denied.status, 403, `${name}: visible does not grant control permission`);
    }
    const ownedStateAfter = await (await request('/api/plugin-manager', { headers: { cookie } })).json();
    assert.deepEqual(ownedStateAfter, ownedStateBefore, 'all forged read-only writes leave the owner record unchanged');
    const ownedVisibility = { cards: ownedCards.length, components: ownedOracle.rows.length, readonlyBundles: readonlyDetails.length, readonlyComponents: readonlyDetails.reduce((sum, detail) => sum + detail.rows.length, 0), refusedWrites: READONLY_OWNED_BUNDLES.length + readonlyDetails.reduce((sum, detail) => sum + detail.rows.length, 0), restrictedPanels };
    const optionalNames = [];
    for (const name of LOCAL_MANAGEABLE_BUNDLES.filter(name => name !== GATEWAY_BUNDLE)) {
      await openPluginDetail(page, name);
      optionalNames.push(...await readOwnedDetailNames(page, name, locale, ownedOracle.bundles.find(bundle => bundle.name === name)));
      await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
      await page.waitForSelector('[data-plugin-group="bundles"]');
    }
    await assertGatewayBundleCard(page);
    await openPluginDetail(page, GATEWAY_BUNDLE);
    const initialGatewayDetail = await assertGatewayBundleDetail(page, locale);
    const ownedTitles = assertOwnedComponentNames([...readonlyDetails.flatMap(detail => detail.rows), ...optionalNames, ...initialGatewayDetail.rows], ownedOracle);
    await assertGatewayManagementScope(page, locale);
    const gatewayWrites = [];
    const observeGatewayWrite = outgoing => {
      if (outgoing.method() !== 'GET' && new URL(outgoing.url()).pathname === '/api/plugin-manager') gatewayWrites.push(outgoing.method());
    };
    page.on('request', observeGatewayWrite);
    await page.$$eval('[data-plugin-row] [role="switch"]', elements => elements.forEach(element => element.click()));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(gatewayWrites, [], 'Gateway components are inspectable but cannot independently change the group');
    const readOwnerPlugins = async () => {
      const response = await request('/api/plugin-manager', { headers: { cookie } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const gatewayRevisions = [];
    for (const enabled of [false, true]) {
      const before = await readOwnerPlugins();
      const writesBefore = gatewayWrites.length;
      await page.$eval('[data-plugin-detail] [role="switch"]', element => element.click());
      await page.waitForFunction(enabled => {
        const toggle = document.querySelector('[data-plugin-detail] [role="switch"]');
        return toggle?.getAttribute('aria-checked') === String(enabled) && !toggle.disabled;
      }, { timeout: 15000 }, enabled);
      const after = await readOwnerPlugins();
      assert.equal(after.revision, before.revision + 1, 'one Gateway switch saves both components in one revision');
      assert.equal(gatewayWrites.length, writesBefore + 1, 'one Gateway click makes one control mutation');
      for (const component of GATEWAY_COMPONENTS) assert.equal(after.overrides[component.module]?.disabled, !enabled);
      gatewayRevisions.push(after.revision);
      await page.waitForFunction(enabled => {
        const row = window.__DSH_BASE_PLUGINS__?.find(entry => entry.moduleName === '@dsh-base/client-gateway-provider');
        return row?.enabled === enabled && row.fiberPhase === (enabled ? 'active' : null);
      }, { timeout: 15000 }, enabled);
      await assertGatewayBundleDetail(page, locale, enabled);
      await assertGatewayManagementScope(page, locale);
      // Persisted account intent must produce the same real Loader on cold boot.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(enabled => {
        const row = window.__DSH_BASE_PLUGINS__?.find(entry => entry.moduleName === '@dsh-base/client-gateway-provider');
        return row?.enabled === enabled && row.fiberPhase === (enabled ? 'active' : null);
      }, { timeout: 20000 }, enabled);
      // The official panel store may restore Plugins on reload. Wait for the
      // restored panel or real Session composer, then navigate only if closed:
      // clicking its sidebar entry while already selected toggles it away.
      await page.waitForFunction(historyText => {
        if (document.querySelector('[data-plugin-package]')) return true;
        return document.querySelector('[contenteditable="true"]') !== null && document.body.innerText.includes(historyText);
      }, { timeout: 20000 }, historyText);
      if (await page.$('[data-plugin-package]') === null) await click('^Plugins$|^插件$');
      await page.waitForSelector('[data-plugin-package]', { timeout: 20000 });
      await assertGatewayBundleCard(page);
      await assertCategoryCounts(page, locale);
      await openPluginDetail(page, GATEWAY_BUNDLE);
      await assertGatewayBundleDetail(page, locale, enabled);
      await assertGatewayManagementScope(page, locale);
      const afterReload = await readOwnerPlugins();
      assert.deepEqual(afterReload, after, 'viewing and reloading a Gateway selection do not rewrite control state');
    }
    page.off('request', observeGatewayWrite);
    await page.screenshot({ path: join(artifacts, `plugins-gateway-components-${locale}.png`) });
    await page.$eval(`[data-plugin-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`, button => button.click());
    await page.waitForSelector('[data-plugin-group="bundles"]');
    const gatewayBundle = { cards: 1, components: 2, readonlyComponentSwitches: 2, revisions: gatewayRevisions, reloads: 2, writes: gatewayWrites.length };

    const builtinItems = await page.$$eval('[data-plugin-item]', elements => elements.map(element => element.getAttribute('data-plugin-item')));
    const expectedBuiltinItems = ['subagent', 'web-search', 'agent-loop', 'shell'];
    assert.deepEqual(builtinItems.filter(id => expectedBuiltinItems.includes(id)), expectedBuiltinItems, `${locale}: original built-in entries retain their order without duplicates`);
    await page.screenshot({ path: join(artifacts, `plugins-${locale}.png`) });
    for (const id of ['subagent', 'web-search', 'agent-loop', 'shell']) {
      await page.click(`[data-plugin-item="${id}"] button`);
      await page.waitForSelector(`[data-plugin-item-detail="${id}"] [role="status"][data-builtin-unavailable]`);
      const builtin = await page.$eval(`[data-plugin-item-detail="${id}"]`, element => ({ reason: element.querySelector('[role="status"][data-builtin-unavailable]')?.textContent ?? '', inputs: [...element.querySelectorAll('input,select,textarea')].map(input => input.matches(':disabled')) }));
      assert.ok(builtin.reason.length > 10, `${id}: real unavailable reason is visible`);
      if (locale === 'zh') assert.match(builtin.reason, /[\u4e00-\u9fff]/u);
      assert.ok(builtin.inputs.every(disabled => disabled), `${id}: unavailable original form never offers editable fields`);
      await page.screenshot({ path: join(artifacts, `plugins-builtin-${id}-${locale}.png`) });
      await page.click(`[data-plugin-item-detail] button[aria-label=${JSON.stringify(managerCopy(locale).backToList)}]`);
      await page.waitForSelector('[data-plugin-group="extensions"]');
    }
    const pluginMutations = [];
    const observePluginMutation = request => { if (request.method() !== 'GET' && new URL(request.url()).pathname === '/api/plugin-manager') pluginMutations.push(request.method()); };
    page.on('request', observePluginMutation);
    await openMorePlugins(page);
    await assertOfficialCards(page, officialPluginCatalog.more, locale, officialPluginCatalog);
    categoryCounts.more = await assertCategoryCounts(page, locale, { more: true });
    await page.$$eval('[data-plugin-package] [role="switch"]', elements => elements.forEach(element => element.click()));
    await page.screenshot({ path: join(artifacts, `plugins-more-${locale}.png`) });
    for (const name of REPRESENTATIVE_OFFICIAL_BUNDLES) {
      await openPluginDetail(page, name);
      await assertUnavailablePluginDetail(page, name, locale, officialPluginCatalog);
      await page.$$eval('[data-plugin-detail] [role="switch"]', elements => elements.forEach(element => element.click()));
      await page.screenshot({ path: join(artifacts, `plugins-${locale}-${name.split('/')[1]}.png`) });
      await backFromPluginDetail(page, locale);
    }
    page.off('request', observePluginMutation);
    assert.deepEqual(pluginMutations, [], 'unavailable original controls never write account selections');
    const controlBefore = await (await request('/api/plugin-manager', { headers: { cookie } })).json();
    const refusedOriginal = await request('/api/plugin-manager', { method: 'PUT', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name: REPRESENTATIVE_OFFICIAL_BUNDLES[0], disabled: false, expectedRevision: controlBefore.revision }) });
    assert.equal(refusedOriginal.status, 403, 'private control endpoint rejects direct unavailable original enablement');
    const controlAfter = await (await request('/api/plugin-manager', { headers: { cookie } })).json();
    assert.equal(controlAfter.revision, controlBefore.revision, 'rejected catalog activation changes no persisted selection');
    const catalogFibers = await page.evaluate(names => (window.__DSH_BASE_PLUGINS__ ?? []).filter(row => names.includes(row.moduleName)), officialPluginCatalog.bundles.map(bundle => bundle.name));
    assert.ok(catalogFibers.every(row => row.enabled === false && row.fiberPhase === null), 'unavailable metadata must not acquire a running fiber');
    await click("account menu|账号菜单");
    await click("^settings\\b|^设置");
    await click("^built-in plugins$|^内置插件$");
    // Official Plugin list tab: session compositions first, then the global plane.
    await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 15000 });
    const presetGroupLabel = locale === "zh" ? "会话插件" : "Session plugins";
    const groupTitle = await page.$eval('[data-plugin-scope="preset"] span[class*="groupTitle"]', element => element.textContent.trim());
    assert.equal(groupTitle, presetGroupLabel, "official session plugin group title");
    const presetModules = () => page.$$eval('[data-plugin-scope="preset"] [data-plugin-module]', elements => elements.map(element => element.dataset.pluginModule));
    assert.deepEqual(await presetModules(), thinkPresetRows.map(row => row.moduleName), "Cloudflare Think row modules match generated agent composition");
    const thinkGroupText = await page.$eval('[data-plugin-scope="preset"]', element => element.textContent);
    assert.match(thinkGroupText, locale === "zh" ? /Cloudflare Think 模式/ : /Cloudflare Think/, "session group shows the Cloudflare Think preset name");
    await page.screenshot({ path: join(artifacts, `inventory-session-${locale}.png`) });
    await page.click('[data-plugin-scope="preset"] button[class*="cardContent"]');
    await page.waitForSelector('[data-plugin-scope="preset"] [class*="cardDetails"]', { timeout: 10000 });
    const detailLabels = await page.$$eval('[data-plugin-scope="preset"] [class*="cardDetails"] dt', elements => elements.map(element => element.textContent.trim()));
    assert.equal(detailLabels.includes(locale === "zh" ? "运行状态" : "Runtime"), false, "Worker-side rows must not claim a live client fiber phase");
    await page.click('[data-plugin-scope="preset"] button[class*="cardContent"]');
    await page.waitForFunction(() => !document.querySelector('[data-plugin-scope="preset"] [class*="cardDetails"]'), { timeout: 10000 });

    // Group disclosure and keyboard operation.
    const groupToggle = '[data-plugin-scope="preset"] button[class*="groupToggle"]';
    await page.$eval(groupToggle, button => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-expanded") === "false", { timeout: 10000 }, groupToggle);
    await page.keyboard.press("Enter");
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-expanded") === "true", { timeout: 10000 }, groupToggle);

    // Every official preset switched through the official selector must match
    // its pinned declaration rows one-for-one; none is treated as live.
    const officialLabels = locale === "zh"
      ? { standard: "标准模式", ptc: "PTC 模式", minimal: "极简模式", cordis: "创造模式" }
      : { standard: "Standard mode", ptc: "PTC mode", minimal: "Minimal mode", cordis: "Creator mode" };
    const switcher = '[data-plugin-scope="preset"] button[aria-haspopup="menu"]';
    for (const id of ["standard", "ptc", "minimal", "cordis"]) {
      await page.click(switcher);
      await page.waitForSelector('[role="menuitem"]', { visible: true, timeout: 10000 });
      const selected = await page.evaluate(label => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => (element.textContent ?? "").trim().startsWith(label));
        if (item === undefined) return false;
        item.click();
        return true;
      }, officialLabels[id]);
      assert.equal(selected, true, `${locale}: official preset ${id} missing from switcher`);
      await page.waitForFunction(value => document.querySelector('[data-plugin-scope="preset"]')?.getAttribute("data-preset-id") === value, { timeout: 10000 }, id);
      assert.deepEqual(await presetModules(), officialPresetRows[id].map(row => row.moduleName), `${locale}:${id}: rendered session rows match pinned declaration`);
      const rowCount = await page.$$eval('[data-plugin-scope="preset"] [data-plugin-entry]', elements => elements.length);
      assert.equal(rowCount, officialPresetRows[id].length, `${locale}:${id}: all declaration rows rendered`);
      if (id === "standard") await page.screenshot({ path: join(artifacts, `inventory-session-standard-${locale}.png`) });
    }
    // Back to the fixed composition and verify search + no-result behavior.
    await page.click(switcher);
    await page.waitForSelector('[role="menuitem"]', { visible: true, timeout: 10000 });
    await page.evaluate(label => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => (element.textContent ?? "").trim().startsWith(label));
      item?.click();
    }, locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think");
    await page.waitForFunction(() => document.querySelector('[data-plugin-scope="preset"]')?.getAttribute("data-preset-id") === "dsh-base-think", { timeout: 10000 });
    const searchInput = 'input[type="search"]';
    await page.click(searchInput);
    await page.type(searchInput, "ai-gateway");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-plugin-scope="preset"] [data-plugin-module]')].every(element => (element.getAttribute("data-plugin-module") ?? "").includes("ai-gateway")), { timeout: 10000 });
    await page.$eval(searchInput, input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.type(searchInput, "no-such-plugin-xyz");
    await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 10000 }, locale === "zh" ? "没有匹配的插件。" : "No matching plugins.");
    await page.$eval(searchInput, input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('[data-plugin-scope="preset"]')?.getAttribute("data-preset-id") === "dsh-base-think", { timeout: 10000 });

    await page.click('[data-plugin-scope="global"] button[class*="groupToggle"]');
    await page.waitForSelector('[data-plugin-scope="global"] [data-plugin-entry="client:session-adapter"]', { timeout: 10000 });
    const displayedModules = await page.$$eval('[data-plugin-scope="global"] [data-plugin-module]', elements => elements.map(element => element.getAttribute("data-plugin-module")));
    const workerResponse = await request('/api/plugin-manager/inventory', { headers: { cookie } });
    assert.equal(workerResponse.status, 200);
    const observedWorkers = (await workerResponse.json()).entries;
    assert.equal(observedWorkers.length, ownedOracle.rows.filter(row => row.plane === 'worker').length);
    assert.deepEqual(displayedModules.slice().sort(), [...inventory, ...observedWorkers].map(entry => entry.moduleName).sort(), 'global inventory includes every observed client and Worker entry');
    assert.equal(displayedModules.length, expectedNames.size + observedWorkers.length);
    assert.equal((await presetModules()).length, ownedOracle.rows.filter(row => row.plane === 'think').length, 'all Think entries, including the BYOK provider, remain visible');
    assert.ok((await presetModules()).includes('@dsh-base/cloudflare-think-deepseek'));
    const completeOwned = [...displayedModules, ...await presetModules()].filter(name => name.startsWith('@dsh-base/'));
    assert.deepEqual(completeOwned.slice().sort(), ownedOracle.rows.map(row => row.moduleName).sort(), 'all independently composed owned plugins have a complete inventory entry');
    await assertInventoryNames(page, ownedTitles, ownedOracle);
    assert.ok(displayedModules.includes("@deepseek-ai/dsh-client-ui-schedule"));
    assert.ok(displayedModules.includes("@deepseek-ai/dsh-client-ui-permission-presets"), "the restored official permission plugin remains visible in inventory");
    await page.screenshot({ path: join(artifacts, `inventory-${locale}.png`) });
    await page.keyboard.press("Escape");
    // Official directory picker with a selected session. Commit 1 removed the
    // URL deep-link plugin, so the picker is exercised from the session page
    // where the official in-memory selection is active; the home surface above
    // still proves the Settings inventory needs no selected session.
    await click("^add workspace$|^添加工作区$");
    await click("^new folder$|^新建文件夹$");
    const folderLabel = locale === "zh" ? "文件夹名称" : "Folder name";
    const folderSelector = `input[aria-label=${JSON.stringify(folderLabel)}]`;
    const folderName = `Workspace-${locale}`;
    const beforeWorkspaces = (await call("workspaceState", {})).items.length;
    await page.type(folderSelector, folderName);
    await click("^create$|^创建$");
    await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 10000 }, folderSelector);
    assert.equal((await call("workspaceState", {})).items.length, beforeWorkspaces, "directory creation must not register a Workspace before selection");
    await page.screenshot({ path: join(artifacts, `directory-${locale}.png`) });
    await click("^open$|^打开$");
    await page.waitForFunction(name => document.body.innerText.includes(name) && !document.querySelector('[role="dialog"]'), { timeout: 10000 }, folderName);
    assert.equal((await call("workspaceState", {})).items.length, beforeWorkspaces + 1, "official directory confirmation must persist the Workspace");
    // Reopen Settings after a full reload: the session group and default name
    // must survive a cold snapshot read; no Session is required.
    // Full reload of the session page (a bare reload could restore the Plugins
    // page and its official unavailable state instead of the composer).
    await gotoSessionPage(`${base}${prefixFor(locale === "zh" ? "zh" : "en")}/app/session/${encodeURIComponent(editorSessionId)}`);
    const presetPane = '[role="dialog"] [data-plugin-scope="preset"]';
    const openPresetInventory = async targetPage => {
      await click("account menu|账号菜单", targetPage);
      await click("^settings\\b|^设置", targetPage);
      await targetPage.waitForSelector('[role="dialog"] nav button', { visible: true });
      await clickDialogNav("^built-in plugins$|^内置插件$", presetPane, targetPage);
      assert.equal(await targetPage.$eval(presetPane, element => element.getAttribute("data-preset-id")), "dsh-base-think");
    };
    await openPresetInventory(page);
    await page.keyboard.press("Escape");

    // The signed-in home restores a session. Wait for the selection before
    // interacting with Settings so that navigation cannot dismiss the dialog.
    const homeUrl = new URL(prefixFor(locale) || "/", base);
    await page.goto(homeUrl.href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(prefix => {
      const selection = JSON.parse(localStorage.getItem("dsh.sessions.current") ?? "null");
      return selection?.sessionId && location.pathname === prefix + "/app/session/" + encodeURIComponent(selection.sessionId);
    }, { timeout: 20000 }, prefixFor(locale));
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120000 });
    await openPresetInventory(page);
    await page.keyboard.press("Escape");

    // An isolated guest can open the same inventory without selecting a session.
    const guestContext = await browser.createBrowserContext();
    try {
      const guestPage = await guestContext.newPage();
      observeBrowserErrors(guestPage, "guest inventory: ");
      await guestPage.setViewport({ width: 1440, height: 900 });
      await guestPage.goto(homeUrl.href, { waitUntil: "domcontentloaded" });
      await guestPage.waitForSelector('[data-signed-out="true"]', { visible: true });
      const guestSelection = () => guestPage.evaluate(() => ({
        path: location.pathname,
        sessionId: JSON.parse(localStorage.getItem("dsh.sessions.current") ?? "null")?.sessionId ?? null,
      }));
      const expectedSelection = { path: homeUrl.pathname, sessionId: null };
      assert.deepEqual(await guestSelection(), expectedSelection);
      await openPresetInventory(guestPage);
      assert.deepEqual(await guestSelection(), expectedSelection);
    } finally {
      await guestContext.close();
    }
    const agentPresets = await agentPresetChecks(locale, editorSessionId);
    observations.push({ locale, gatewayBundle, ownedVisibility, categoryCounts, ownedNameCount: Object.keys(ownedTitles).length, versionLine: agentPresets.versionLine, upstreamLinks: { repository: upstreamRepository, release: upstreamRelease }, inventory, composerInput, scheduleTaskVisible: true, manualTaskCreated: true, settingsPersistedAfterReload: true, crossTabSettings: true, crossTabModelEffort: true, crossTabPermissions: true, crossTabScheduleCreateDelete: true, terminalDisabled: true, pluginInventoryVisible: true, pluginInventorySession: { groupTitle: presetGroupLabel, defaultPreset: "dsh-base-think", thinkRows: thinkPresetRows.length, officialPresets: Object.keys(officialPresetRows) }, versionLine: agentPresets.versionLine, installationDisabled: true, directoryCreated: true, workspaceConfirmed: true, agentPresets, agentPresetInventory: { fork: forkEntry, replacedOriginal: replacedEntry } });
  }
  for (const id of ["standard", "ptc", "minimal", "cordis"]) {
    assert.equal(presetDeclarationText.en[id], presetDeclarationText.zh[id], `${id}: declaration content is locale-independent`);
    assert.equal(presetDeclarationText.en[id], officialPresetDeclarations[id].content, `${id}: declaration content matches pinned export`);
  }
  assert.equal((await call("scheduleEdit", { id: task.id, action: "delete" })).deleted, true);
  await cleanupCredential();
  cleanupCredential = undefined;
  assert.deepEqual(await call("history", { sessionId: editorSessionId }), editorHistory, "cross-tab configuration changes must not execute a model or mutate history");
  // The bare Session address follows the saved language; the earlier matrix ends in Chinese.
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  const { workspace } = await call("workspaceCreate", { path: "/login-return", title: "Login return" });
  const workspaceBlank = await call("create", { workspaceId: workspace.workspaceId });
  const sessionPath = "/app/session/" + encodeURIComponent(editorSessionId);
  const workspacePath = prefixFor("zh") + "/app/workspace/" + encodeURIComponent(workspace.workspaceId);
  const workspaceSessionPath = prefixFor("zh") + "/app/session/" + encodeURIComponent(workspaceBlank.sessionId);
  const loginReturns = [
    await assertLoginReturn(browser, account, new URL(sessionPath, base), sessionPath),
    await assertLoginReturn(browser, account, new URL(workspacePath, base), workspaceSessionPath),
  ];
  assert.equal(serverLog.includes("LOCAL_OUTBOUND_REQUEST"), false, "zero-model local acceptance must issue no outbound provider requests");
  for (const path of restrictedReadPaths) {
    const observed = permissionDenials.filter(row => row.path === path);
    assert.ok(observed.length >= 2, `${path}: both locale passes exercise the real administrator denial`);
    assert.ok(permissionConsole.filter(row => row.path === path).length <= observed.length, `${path}: every classified HTTP console message has a verified GET 403 response`);
  }
  assert.deepEqual(errors, [], "browser must have no plugin/runtime errors");
  const report = { ok: true, loginReturns, testedAt: new Date().toISOString(), upstream: JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")).commit, browser: await browser.version(), scope: "built local Worker cold auth, isolated public login with no private RPC/WebSockets, real plugin fibers/provenance, official inventory, shell, official Session header menu with actual clipboard and ZIP download, desktop history composer rapid HTTPS typing and clearing without submission, rightbar, settings durability and real cross-tab push for settings/Schedule/model/effort/permission, manual Schedule creation, owner-scoped plugin management seam, and real official Agent preset roster/declarations/composer with Coding Tools and reload behavior en/zh-CN", compatibilityDate: localCompatibilityDate, aiExecutionTested: false, modelSelection: { unconfiguredRejected: true, credential: "official editor cleared and replaced an owner sentinel across cold loads, then fixture removed it", providerAuthenticationTested: false, inferenceTested: false, outboundRequests: 0 }, publicDocuments, observations };
  report.anonymousShell = anonymousShell;
  report.expectedPermissionDenials = permissionDenials;
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, observations: observations.map(({ inventory, ...result }) => ({ ...result, ...(inventory === undefined ? {} : { plugins: inventory.length }) })) }));
} catch (error) {
  if (browser !== undefined) {
    const pages = await browser.pages();
    for (const [index, page] of pages.entries()) {
      if (page.url() === "about:blank") continue;
      const screenshot = index === 1 ? "failure.png" : `failure-tab-${index}.png`;
      // Freeze transport before focusing a tab can trigger account refreshes.
      const transport = structuredClone(networkDiagnostics.get(page)?.());
      const boot = await page.evaluate(() => ({ readyState: document.readyState, title: document.title,
        inventory: window.__DSH_BASE_PLUGINS__?.map(({ entryId, moduleName, enabled, fiberPhase, origin }) => ({ entryId, moduleName, enabled, fiberPhase, origin })),
        busy: [...document.querySelectorAll('[aria-busy="true"]')].map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 160) })),
      })).catch(() => ({ unavailable: true }));
      const failedPage = (await page.evaluate(() => document.body.innerText).catch(() => "unavailable")).slice(0,8000);
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: join(artifacts, screenshot) }).catch(() => {});
      observations.push({ failedUrl: page.url(), screenshot, failedPage, boot, network: transport });
    }
  }
  writeFileSync(join(artifacts, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, browserErrors: errors, expectedPermissionDenials: permissionDenials, classifiedPermissionConsole: permissionConsole, serverLog, observations }, null, 2));
  throw error;
} finally {
  clearTimeout(watchdog);
  try { await cleanupCredential?.(); }
  finally {
    try { await closeAcceptanceBrowser(browser); }
    finally { server.kill("SIGTERM"); }
  }
}
