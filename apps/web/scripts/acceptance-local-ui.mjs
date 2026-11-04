#!/usr/bin/env node
/** Built Worker + real local D1/R2/DO + Chromium. Does not call an AI provider. */
import assert from "node:assert/strict";
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
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app, env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser;
let cleanupCredential;
const errors = [];
const observations = [];
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
  assert.deepEqual(await (await request("/api/auth-policy")).json(), { signUpEnabled: false });
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
  // Owner-level plugin control was removed in Commit 1 together with the
  // `control` Worker plugin, so the route no longer exists: a same-origin
  // request falls through to 404. The cross-origin assertion above still
  // expects 403 because origin policy rejects before routing.
  assert.equal((await request("/api/plugin-control", { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: "{}" })).status, 404, "plugin-control was removed in Commit 1; same-origin requests fall through to 404");
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
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
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
    await page.waitForFunction(() => /Public registration is disabled|此部署未开放公开注册/.test(document.querySelector("#dsh-base-login")?.textContent ?? ""), { timeout: 20000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 });
    assert.equal(await page.$eval(".dsh-login-switch", element => element.disabled), true);
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
      const palette = await page.$eval("#dsh-base-login", surface => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--dsw-alias-bg-base)";
        probe.style.color = "var(--dsw-alias-label-primary)";
        document.body.append(probe);
        const result = { background: getComputedStyle(surface).backgroundColor, foreground: getComputedStyle(surface.querySelector("h1")).color,
          expectedBackground: getComputedStyle(probe).backgroundColor, expectedForeground: getComputedStyle(probe).color,
          dark: document.body.hasAttribute("data-ds-dark-theme"), source: document.documentElement.getAttribute("data-ds-theme-source") };
        probe.remove(); return result;
      });
      assert.equal(palette.background, palette.expectedBackground, "public login must use the official background token");
      assert.equal(palette.foreground, palette.expectedForeground);
      assert.notEqual(palette.background, palette.foreground, "public login foreground cannot disappear into its background");
      assert.equal(palette.dark, scheme === "dark"); assert.equal(palette.source, "system");
      palettes.push({ scheme, ...palette });
      await page.screenshot({ path: join(artifacts, scheme === "light" ? `login-${locale}.png` : `login-${locale}-dark.png`) });
    }
    assert.deepEqual(publicRequests, ["/api/auth-policy"], "system theme changes must not fetch private settings");
    assert.deepEqual(publicSockets, [], "public theme must not start a private connection");
    publicDocuments.push({ locale, apiRequests: [...publicRequests], webSockets: [...publicSockets], inventory, palettes });
  }
  page.off("request", recordRequest);
  await network.detach();
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
  const otherTab = await browser.newPage();
  await otherTab.setViewport({ width: 1440, height: 900 });
  otherTab.on("pageerror", error => errors.push(`second tab: ${error.message}`));
  otherTab.on("console", message => { if (message.type() === "error") errors.push(`second tab: ${message.text()}`); });
  await otherTab.goto(`${base}/agent/${encodeURIComponent(editorSessionId)}`, { waitUntil: "domcontentloaded" });
  await otherTab.waitForSelector('[contenteditable="true"]', { timeout: 20000 });
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
  const inspect = async () => {
    const inventory = await page.evaluate(() => window.__DSH_BASE_PLUGINS__);
    assert.ok(Array.isArray(inventory));
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
    }
    for (const name of ['@deepseek-ai/dsh-api-remote-access', '@deepseek-ai/dsh-typert-registry']) {
      const entry = inventory.find(row => row.moduleName === name);
      assert.equal(entry?.origin, 'upstream', `${name} uses the unchanged official composition entry`);
      assert.equal(entry?.enabled, true);
      assert.equal(entry?.fiberPhase, 'active');
    }
    const retiredGeneration = inventory.find(row => row.moduleName === '@dsh-base/client-wire-bootstrap');
    assert.equal(retiredGeneration?.enabled, false, 'the unchanged Gateway owns the sole generation loop');
    assert.equal(retiredGeneration?.fiberPhase, null);
    return inventory;
  };
  const click = async pattern => {
    await page.waitForFunction(source => {
      const re = new RegExp(source, "iu");
      return [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].some(element =>
        [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled"));
    }, { timeout: 10000 }, pattern);
    const count = await page.evaluate(source => {
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
  const clickDialogNav = async (pattern, readySelector) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const clicked = await page.evaluate(re => {
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
        if (await page.$(readySelector) === null) { stable = false; break; }
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
    await gotoSessionPage(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(blank.sessionId)}`);
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
  // the Cloudflare AI Gateway provider card removed with Commit 1 is not rendered.
  {
    for (const locale of ['en', 'zh']) {
      await call("settingsUpdate", { ns: "locale", patch: { preference: locale } });
      await page.bringToFront();
      await gotoSessionPage(`${base}${locale === 'zh' ? '/zh-CN' : ''}/agent/${encodeURIComponent(editorSessionId)}`);
      await click('account menu|账号菜单');
      await click('^settings\\b|^设置');
      await page.waitForSelector('[role="dialog"] nav button', { timeout: 20000 });
      await page.evaluate(label => {
        [...document.querySelectorAll('[role="dialog"] nav button')].find(item => (item.textContent ?? '').trim() === label)?.click();
      }, locale === 'zh' ? '模型' : 'Models');
      await page.waitForFunction(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').includes('DeepSeek'), { timeout: 20000 });
      const settingsText = await page.$eval('[role="dialog"]', element => element.innerText);
      assert.match(settingsText, /DeepSeek/u, `${locale}: official DeepSeek provider remains`);
      assert.equal(await page.$('[data-gateway-provider]'), null, `${locale}: removed Cloudflare Gateway provider card is not rendered`);
      await page.screenshot({ path: join(artifacts, `models-providers-${locale}.png`) });
      await page.setViewport({ width: 720, height: 800 });
      await page.screenshot({ path: join(artifacts, `models-providers-narrow-${locale}.png`) });
      await page.setViewport({ width: 1440, height: 900 });
      await page.keyboard.press('Escape');
    }
  }

  for (const locale of ["en", "zh"]) {
    // Commit 1 removed the URL locale plugin, so the official locale plugin
    // reads the persisted preference; set it before loading each locale page.
    await call("settingsUpdate", { ns: "locale", patch: { preference: locale } });
    // Keep the document receiving real pointer/keyboard interaction foreground.
    // Background tab mutations below use fetch without changing focus.
    await page.bringToFront();
    await gotoSessionPage(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(editorSessionId)}`);
    try { await page.waitForSelector('[contenteditable="true"]', { timeout: 20000 }); }
    catch (error) { throw new Error(`boot failed: ${(await page.evaluate(() => document.body.innerText)).slice(0,1800)}\n${errors.join("\n")}`, { cause: error }); }
    const inventory = await inspect();
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
    // User-approved brand seam (2026-11-13): only the official name slot is
    // occupied, so the sidebar displays the short code name `dsh-base` in
    // every locale; the official mark fallback stays and the name no longer
    // carries a version. The product display name stays in README/docs.
    assert.equal(brand, "dsh-base", `sidebar brand uses the approved code name: ${brand}`);
    const forkEntry = inventory.find(row => row.moduleName === "@dsh-base/client-agent-preset");
    const replacedEntry = inventory.find(row => row.moduleName === "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(forkEntry?.origin, "custom", "active preset UI comes from the marked custom fork");
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
    // Commit 1 removed the zh display-label fork: the official locale plugin
    // renders "中文" while the internal id and /zh-CN route stay zh.
    const languageLabels = await page.$$eval('[role="dialog"] button', buttons => buttons.map(button => (button.textContent ?? '').trim()).filter(Boolean));
    const activeLanguage = languageLabels.find(label => ['中文', 'English'].includes(label));
    assert.equal(activeLanguage, locale === 'zh' ? '中文' : 'English', `${locale}: language current value`);
    await page.evaluate(label => {
      [...document.querySelectorAll('[role="dialog"] button')].find(button => (button.textContent ?? '').trim() === label)?.click();
    }, activeLanguage);
    await page.waitForSelector('[role="menuitem"]', { timeout: 10000 });
    const languageMenu = await page.$$eval('[role="menuitem"]', items => items.map(item => (item.textContent ?? '').trim()));
    assert.ok(languageMenu.includes('中文'), `${locale}: language menu offers the official 中文 label`);
    assert.equal(languageMenu.includes('简体中文'), false, `${locale}: removed 简体中文 label absent`);
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
    await click("^plugins$|^插件$");
    // Commit 1 runs without a manageable profile: the official Plugins page must
    // open and render its official unavailable state instead of listing a
    // switchable bundle (the inventory seam reports managementAvailable: false).
    // Official unavailable copy (manager-store short-circuits when the Host
    // reports managementAvailable:false); accept either locale wording.
    const pluginUnavailable = "本部署没有可管理的 profile|This deployment runs without a manageable profile";
    await page.waitForFunction(source => new RegExp(source, "u").test(document.body.innerText), { timeout: 20000 }, pluginUnavailable);
    assert.equal(await page.$("[data-plugin-package]"), null, "no managed plugin bundle is listed");
    await page.screenshot({ path: join(artifacts, `plugins-${locale}.png`) });
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
    for (const name of displayedModules) assert.ok(inventory.some(entry => entry.moduleName === name), `invented plugin inventory: ${name}`);
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
    await gotoSessionPage(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(editorSessionId)}`);
    await click("account menu|账号菜单");
    await click("^settings\\b|^设置");
    await click("^built-in plugins$|^内置插件$");
    await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 15000 });
    assert.equal(await page.$eval('[data-plugin-scope="preset"]', element => element.getAttribute("data-preset-id")), "dsh-base-think");
    await page.keyboard.press("Escape");
    // Missing-session home surface: the same global Settings inventory must
    // not require a selected session.
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120000 });
    await click("account menu|账号菜单");
    await click("^settings\\b|^设置");
    await click("^built-in plugins$|^内置插件$");
    await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 15000 });
    assert.equal(await page.$eval('[data-plugin-scope="preset"]', element => element.getAttribute("data-preset-id")), "dsh-base-think");
    await page.keyboard.press("Escape");
    const agentPresets = await agentPresetChecks(locale, editorSessionId);
    observations.push({ locale, versionLine: agentPresets.versionLine, upstreamLinks: { repository: upstreamRepository, release: upstreamRelease }, inventory, composerInput, scheduleTaskVisible: true, manualTaskCreated: true, settingsPersistedAfterReload: true, crossTabSettings: true, crossTabModelEffort: true, crossTabPermissions: true, crossTabScheduleCreateDelete: true, terminalDisabled: true, pluginInventoryVisible: true, pluginInventorySession: { groupTitle: presetGroupLabel, defaultPreset: "dsh-base-think", thinkRows: thinkPresetRows.length, officialPresets: Object.keys(officialPresetRows) }, versionLine: agentPresets.versionLine, installationDisabled: true, directoryCreated: true, workspaceConfirmed: true, agentPresets, agentPresetInventory: { fork: forkEntry, replacedOriginal: replacedEntry } });
  }
  for (const id of ["standard", "ptc", "minimal", "cordis"]) {
    assert.equal(presetDeclarationText.en[id], presetDeclarationText.zh[id], `${id}: declaration content is locale-independent`);
    assert.equal(presetDeclarationText.en[id], officialPresetDeclarations[id].content, `${id}: declaration content matches pinned export`);
  }
  assert.equal((await call("scheduleEdit", { id: task.id, action: "delete" })).deleted, true);
  await cleanupCredential();
  cleanupCredential = undefined;
  assert.deepEqual(await call("history", { sessionId: editorSessionId }), editorHistory, "cross-tab configuration changes must not execute a model or mutate history");
  assert.equal(serverLog.includes("LOCAL_OUTBOUND_REQUEST"), false, "zero-model local acceptance must issue no outbound provider requests");
  assert.deepEqual(errors, [], "browser must have no plugin/runtime errors");
  const report = { ok: true, testedAt: new Date().toISOString(), upstream: JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")).commit, browser: await browser.version(), scope: "built local Worker cold auth, isolated public login with no private RPC/WebSockets, real plugin fibers/provenance, official inventory, shell, desktop history composer rapid HTTPS typing and clearing without submission, rightbar, settings durability and real cross-tab push for settings/Schedule/model/effort/permission, manual Schedule creation, read-only plugin management, and real official Agent preset roster/declarations/composer with Coding Tools and reload behavior en/zh", compatibilityDate: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? "deployment config", aiExecutionTested: false, modelSelection: { unconfiguredRejected: true, credential: "local sentinel configured then removed", providerAuthenticationTested: false, inferenceTested: false, outboundRequests: 0 }, publicDocuments, observations };
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, observations: observations.map(({ inventory, ...result }) => ({ ...result, plugins: inventory.length })) }));
} catch (error) {
  if (browser !== undefined) {
    const pages = await browser.pages();
    for (const [index, page] of pages.entries()) {
      if (page.url() === "about:blank") continue;
      const screenshot = index === 1 ? "failure.png" : `failure-tab-${index}.png`;
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: join(artifacts, screenshot) }).catch(() => {});
      observations.push({ failedUrl: page.url(), screenshot, failedPage: (await page.evaluate(() => document.body.innerText).catch(() => "unavailable")).slice(0,8000) });
    }
  }
  writeFileSync(join(artifacts, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, browserErrors: errors, serverLog, observations }, null, 2));
  throw error;
} finally {
  clearTimeout(watchdog);
  try { await cleanupCredential?.(); }
  finally {
    try { await closeAcceptanceBrowser(browser); }
    finally { server.kill("SIGTERM"); }
  }
}
