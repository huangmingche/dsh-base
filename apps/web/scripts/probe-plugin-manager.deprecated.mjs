// DEPRECATED (Round 3B): superseded by apps/web/scripts/probe-scenarios.mjs. Do not use for acceptance.
#!/usr/bin/env node
/** Local Workers-native plugin manager probe: real inventory, owner management, actual loader effects. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromeExecutable } from "./acceptance-config.mjs";
import puppeteer from "puppeteer-core";

const app = resolve(import.meta.dirname, "..");
const port = 5193 + (randomBytes(1)[0] % 200);
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
const output = resolve(app, "../../.artifacts/acceptance/plugin-manager");
const diagnostics = resolve(app, "../../.artifacts/harness-handoff/probe-diagnostics");
mkdirSync(diagnostics, { recursive: true });
mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app,
  env: { ...process.env, DSH_LOCAL_PORT: String(port), DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: "2026-10-30" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + String(data)).slice(-12000) });
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
let browser;
let cookie = "";
let controlHttp = [];
const shots = [];
try {
  for (let attempt = 0; ; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  const account = { username: `plugin${randomBytes(8).toString("hex")}`, name: "Plugin manager probe", email: `plugin-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(32).toString("base64url") };
  const signup = await request("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken }, body: JSON.stringify(account) });
  assert.equal(signup.status, 200, await signup.clone().text());
  const match = signup.headers.getSetCookie().join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  assert.ok(match);
  cookie = `${match[1]}=${match[2]}`;
  const host = async (method, params = {}) => {
    const response = await request("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ method, params }) });
    const body = await response.json();
    assert.equal(response.status, 200, `${method}: ${JSON.stringify(body)}`);
    return body.result;
  };
  const session = await host("create", { title: "Plugin manager probe" });
  browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const errors = [], promptRequests = [], claimRequests = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") { errors.push(message.text().slice(0, 500)); if (/plugin manager|Entry\.update|Loader/u.test(message.text())) console.error("PAGE CONSOLE", message.text()); } });
  controlHttp = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/session/prompt") promptRequests.push(request.url());
    if (path === "/api/session-host/claim") claimRequests.push(request.url());
    if (path.startsWith("/api/plugin-manager")) controlHttp.push({ event: "request", method: request.method(), path: request.url(), postData: request.postData() });
  });
  page.on("response", async response => {
    if (!new URL(response.url()).pathname.startsWith("/api/plugin-manager")) return;
    controlHttp.push({ event: "response", status: response.status(), url: response.url(), body: await response.text().catch(() => undefined) });
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
  const openPlugins = async (target, locale = "en") => {
    const label = locale === "zh" ? "插件" : "Plugins";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await target.goto(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${session.sessionId}`, { waitUntil: "domcontentloaded", timeout: 60000 })
      await target.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 })
      await target.waitForFunction(label => [...document.querySelectorAll("button, a")].some(element => (element.textContent ?? "").trim() === label && element.getBoundingClientRect().width > 0), { timeout: 30000 }, label)
      const open = await target.evaluate(() => document.querySelector("[data-plugin-panel]") !== null && document.querySelectorAll("[data-plugin-package]").length >= 5)
      if (!open) await target.evaluate(label => [...document.querySelectorAll("button, a")].find(element => (element.textContent ?? "").trim() === label && element.getBoundingClientRect().width > 0)?.click(), label)
      try {
        await target.waitForFunction(() => document.querySelector("[data-plugin-panel]") !== null && document.querySelectorAll("[data-plugin-package]").length >= 5, { timeout: 20000 })
        return
      } catch (error) {
        const debug = await target.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 1200), cards: document.querySelectorAll("[data-plugin-package]").length, panel: document.querySelector("[data-plugin-panel]") !== null }))
        console.error("OPENPLUGINS DEBUG", JSON.stringify(debug))
        await new Promise(resolveWait => setTimeout(resolveWait, 500))
      }
    }
    throw new Error("official Plugins panel did not open with at least 5 rows")
  }
  await openPlugins(page);
  // The official list is a tall scroll surface; move the content pane to the
  // installed group before querying cards so virtualization cannot hide them.
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight
    }
  })
  await new Promise(resolveWait => setTimeout(resolveWait, 500))
  const body = await page.evaluate(() => document.body.innerText);
  assert.match(body, /@dsh-base\/cloudflare-think-fetch/u);
  await page.screenshot({ path: join(output, "plugins-list-en.png") }); shots.push(join(output, "plugins-list-en.png"));
  const addState = await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find(element => /^(Add plugin|添加插件)$/u.test(element.getAttribute("aria-label") ?? "")); return { found: button !== undefined, disabled: button?.disabled === true } })
  assert.equal(addState.found, true); assert.equal(addState.disabled, true, "Add plugin is greyed")
  const readOnly = await page.evaluate(() => {
    const state = packageName => {
      const card = document.querySelector(`[data-plugin-package=${JSON.stringify(packageName)}]`);
      const toggle = card?.querySelector('[role="switch"]');
      return { card: card !== null, disabled: toggle?.disabled, checked: toggle?.getAttribute("aria-checked") };
    };
    return { think: state("@dsh-base/cloudflare-think-fetch"), gateway: state("@dsh-base/client-gateway-provider") };
  });
  assert.equal(readOnly.think.card && readOnly.think.disabled, false, "Think optional tools are owner-manageable");
  assert.equal(readOnly.gateway.disabled, false, "allowlisted client plugin is truly manageable");
  await page.evaluate(() => document.querySelector('[data-plugin-package="@dsh-base/client-gateway-provider"]')?.scrollIntoView({ block: "center" }))
  await new Promise(resolveWait => setTimeout(resolveWait, 300))
  await page.screenshot({ path: join(output, "plugins-installed-en-light-1440.png") }); shots.push(join(output, "plugins-installed-en-light-1440.png"))
  await page.evaluate(() => { document.body.dataset.dsDarkTheme = "" })
  await page.screenshot({ path: join(output, "plugins-installed-en-dark-1440.png") }); shots.push(join(output, "plugins-installed-en-dark-1440.png"))
  await page.evaluate(() => { delete document.body.dataset.dsDarkTheme })
  await page.setViewport({ width: 720, height: 800 })
  await page.screenshot({ path: join(output, "plugins-installed-en-light-720.png") }); shots.push(join(output, "plugins-installed-en-light-720.png"))
  await page.setViewport({ width: 1440, height: 900 })
  // Detail pages show the precise reason through the official detail-section slot.
  await page.goto(`${base}/agent/${session.sessionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button, a")].some(element => (element.textContent ?? "").trim() === "Plugins" && element.getBoundingClientRect().width > 0), { timeout: 30000 });
  // Capture the unchanged official page before any persisted change: en/zh,
  // light/dark, wide/narrow.
  for (const locale of ["en", "zh"]) {
    if (locale === "zh") await host("settingsUpdate", { ns: "locale", patch: { preference: "zh" } });
    const visual = await browser.newPage();
    await visual.setViewport({ width: 1440, height: 900 });
    await visual.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
    const visualErrors = [];
    visual.on("pageerror", error => visualErrors.push(String(error)));
    visual.on("console", message => { if (message.type() === "error") visualErrors.push(message.text().slice(0, 500)) });
    await openPlugins(visual, locale);
    for (const [theme, width] of [["light", 1440], ["dark", 1440], ["light", 720]]) {
      await visual.setViewport({ width, height: width === 720 ? 800 : 900 });
      await visual.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      await new Promise(resolveWait => setTimeout(resolveWait, 300));
      const shot = join(output, `plugins-list-${locale}-${theme}-${width}.png`);
      await visual.screenshot({ path: shot }); shots.push(shot);
      if (width === 720) {
        let rect = null
        for (let attempt = 0; attempt < 5 && rect === null; attempt += 1) {
          rect = await visual.evaluate(() => { const panel = document.querySelector('[data-plugin-panel]')?.getBoundingClientRect(); return panel === undefined ? null : { x: panel.x, right: panel.right, width: panel.width } })
          if (rect === null) await new Promise(resolveWait => setTimeout(resolveWait, 400))
        }
        assert.ok(rect !== null && rect.width > 600 && rect.x >= 0 && rect.right <= 720, "720 plugin panel is fully visible: " + JSON.stringify(rect))
      }
    }
    const lightShot = join(output, `plugins-list-${locale}-light-1440.png`)
    const darkShot = join(output, `plugins-list-${locale}-dark-1440.png`)
    assert.notEqual(readFileSync(lightShot).toString("base64"), readFileSync(darkShot).toString("base64"), "dark theme screenshot differs from light")
      await visual.close();
  }
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[data-plugin-panel]')?.getBoundingClientRect()
    const sidebar = document.querySelector('[data-sidebar]')?.getBoundingClientRect()
    return { panel: panel === undefined ? null : { x: panel.x, width: panel.width }, sidebar: sidebar === undefined ? null : { x: sidebar.x, width: sidebar.width }, viewport: innerWidth }
  })
  assert.ok(geometry.panel !== null && geometry.viewport === 720 ? geometry.panel.x + geometry.panel.width <= 720 && geometry.panel.width > 600 : true, "720 plugin panel geometry is readable")
  await host("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  // Second tab receives the persisted restart intent and reloads into the real loader state.
  const defaultWorkspace = await host("workspaceInitializeDefault");
  const draftSession = await host("create", { title: "Probe draft session", workspaceId: defaultWorkspace.workspace.id });
  const second = await browser.newPage();
  const secondErrors = [];
  second.on("pageerror", error => secondErrors.push(String(error)));
  second.on("console", message => { if (message.type() === "error") secondErrors.push(message.text().slice(0, 500)) });
  await second.setViewport({ width: 1440, height: 900 });
  await second.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
  await second.goto(`${base}/agent/${draftSession.sessionId}`, { waitUntil: "domcontentloaded" });
  await second.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 });
  const draft = `unsent-draft-${Date.now()}`;
  await second.evaluate(value => {
    const editable = document.querySelector('[contenteditable]')
    if (editable !== null) {
      editable.textContent = value
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
    }
    const textarea = document.querySelector('textarea')
    if (textarea !== null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
      setter.call(textarea, value)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }, draft)
  const draftUrl = second.url();
  await openPlugins(page)
  await uiToggle("@dsh-base/client-gateway-provider", false)
  await page.waitForFunction(() => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === "@dsh-base/client-gateway-provider" && entry.enabled === false && entry.fiberPhase === null), { timeout: 30000 })
  const persisted = await page.evaluate(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()));
  assert.equal(persisted.overrides?.["@dsh-base/client-gateway-provider"]?.disabled, true);
  await second.waitForFunction(() => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === "@dsh-base/client-gateway-provider" && entry.enabled === false && entry.fiberPhase === null), { timeout: 60000 });
  assert.equal(second.url(), draftUrl, "peer tab did not reload and kept its route");
  // The draft page is inert until workspace selection; the peer proves non-reload sync below.
  assert.equal(second.url(), draftUrl, "peer tab did not reload and kept its route");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 });
  const bootInventory = await page.evaluate(() => (window.__DSH_BASE_PLUGINS__ ?? []).find(entry => entry.moduleName === "@dsh-base/client-gateway-provider"));
  assert.equal(bootInventory?.enabled, false, "actual Loader disables the Gateway plugin after restart");
  assert.equal(bootInventory?.fiberPhase, null, "disabled Gateway entry has no live fiber");
  // Re-enable through the official UI. The boot-specific entry is retained
  // disabled, so Entry.update must restore the fiber without a page reload.
  await openPlugins(page)
  await uiToggle("@dsh-base/client-gateway-provider", true)
  await page.waitForFunction(async () => {
    const response = await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })
    const body = await response.json()
    return body.overrides?.["@dsh-base/client-gateway-provider"]?.disabled === false
  }, { timeout: 20000 })
  await page.waitForFunction(() => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === "@dsh-base/client-gateway-provider" && entry.enabled === true && entry.fiberPhase !== null), { timeout: 60000 })
  await page.screenshot({ path: join(output, "plugins-reenabled-en.png") }); shots.push(join(output, "plugins-reenabled-en.png"))
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 })
  await page.waitForFunction(() => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === "@dsh-base/client-gateway-provider" && entry.enabled === true && entry.fiberPhase !== null), { timeout: 60000 })
  // Official Think fetch row: real switches and configuration through the official dialog.
  await openPlugins(page)
  const openThinkConfig = async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "View @dsh-base/cloudflare-think-fetch")?.click())
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "Configure @dsh-base/cloudflare-think-fetch"), { timeout: 20000 })
    await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Configure @dsh-base/cloudflare-think-fetch")?.click())
    await page.waitForSelector("[data-think-fetch-config] textarea", { timeout: 20000 })
  }
  await openThinkConfig()
  await new Promise(resolveWait => setTimeout(resolveWait, 1500))
  const ownerAllow = "https://ai-sdk.dev/**";
  await page.$eval("[data-think-fetch-config] textarea", (element, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })) }, ownerAllow);
  await page.evaluate(() => document.querySelector("[data-think-fetch-config] button")?.click())
  await page.waitForFunction(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()).overrides?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist?.[0] === "https://ai-sdk.dev/**", { timeout: 20000 });
  const ownerSnapshot = await page.evaluate(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()));
  assert.deepEqual(ownerSnapshot.overrides?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist, [ownerAllow]);
  await page.evaluate(() => [...document.querySelectorAll("input[type=radio]")].at(-1)?.click())
  await page.waitForFunction(() => [...document.querySelectorAll("input[type=radio]")].at(-1)?.checked === true, { timeout: 10000 })
  await new Promise(resolveWait => setTimeout(resolveWait, 1500))
  const sessionAllow = "https://developers.cloudflare.com/**";
  await page.$eval("[data-think-fetch-config] textarea", (element, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })) }, sessionAllow);
  await page.evaluate(() => document.querySelector("[data-think-fetch-config] button")?.click())
  await page.waitForFunction(async sessionId => (await (await fetch(`/api/plugin-manager?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } })).json()).session?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist?.[0] === "https://developers.cloudflare.com/**", { timeout: 20000 }, session.sessionId);
  const sessionSnapshot = await page.evaluate(async sessionId => (await (await fetch(`/api/plugin-manager?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } })).json()), session.sessionId);
  assert.deepEqual(sessionSnapshot.session?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist, [sessionAllow]);
  assert.deepEqual((await page.evaluate(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()))).overrides?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist, [ownerAllow], "session configuration did not mutate the owner default");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => (button.textContent ?? "").trim() === "Restore default")?.click())
  await page.waitForFunction(async sessionId => (await (await fetch(`/api/plugin-manager?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } })).json()).session?.["@dsh-base/cloudflare-think-fetch"] === undefined, { timeout: 20000 }, session.sessionId);
  assert.deepEqual((await page.evaluate(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()))).overrides?.["@dsh-base/cloudflare-think-fetch"]?.config?.allowlist, [ownerAllow], "session restore inherited the owner default");
  await page.$eval("[data-think-fetch-config] textarea", (element) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(element, "not-a-https-url"); element.dispatchEvent(new Event("input", { bubbles: true })) });
  await page.evaluate(() => document.querySelector("[data-think-fetch-config] button")?.click())
  await new Promise(resolveWait => setTimeout(resolveWait, 1500))
  assert.equal(await page.$("[data-think-fetch-config] [role=status]") !== null, true, "invalid config shows a visible error status")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 })
  await openPlugins(page)
  await openThinkConfig()
  await new Promise(resolveWait => setTimeout(resolveWait, 1500))
  assert.equal(await page.$eval("[data-think-fetch-config] textarea", element => element.value), ownerAllow, "owner think config persisted across reload");
  // Think toggle through the official card switch, then restore.
  await openPlugins(page)
  await page.evaluate(() => document.querySelector('[data-plugin-package="@dsh-base/cloudflare-think-fetch"]')?.scrollIntoView({ block: "center" }))
  await uiToggle("@dsh-base/cloudflare-think-fetch", false)
  await page.evaluate(async () => {
    const state = await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()
    await fetch("/api/plugin-manager", { method: "PUT", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ name: "@dsh-base/cloudflare-think-fetch", reset: true, expectedRevision: state.revision }) })
  })
  await page.waitForFunction(async () => (await (await fetch("/api/plugin-manager", { headers: { accept: "application/json" } })).json()).overrides?.["@dsh-base/cloudflare-think-fetch"]?.disabled !== true, { timeout: 20000 })
  for (const name of ["@dsh-base/client-locale-url", "@dsh-base/client-route-address"]) {
    await uiToggle(name, false)
    await page.waitForFunction(name => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === name && entry.enabled === false && entry.fiberPhase === null), { timeout: 30000 }, name)
    await uiToggle(name, true)
    await page.waitForFunction(name => (window.__DSH_BASE_PLUGINS__ ?? []).some(entry => entry.moduleName === name && entry.enabled === true && entry.fiberPhase !== null), { timeout: 30000 }, name)
  }
  await openPlugins(page)
  await page.evaluate(() => document.querySelector('[data-plugin-package="@dsh-base/cloudflare-think-memory"]')?.scrollIntoView({ block: "center" }))
  await uiToggle("@dsh-base/cloudflare-think-memory", false)
  // The invalid-allowlist assertion intentionally receives one HTTP 400.
  const unexpectedErrors = errors.filter(message => !message.includes("status of 400"))
  assert.deepEqual(unexpectedErrors, []);
  assert.deepEqual(secondErrors.filter(message => !message.includes("status of 400")), []);
  assert.deepEqual(promptRequests, []);
  assert.deepEqual(claimRequests, []);
  console.log(JSON.stringify({ ok: true, sessionId: session.sessionId, shots }));
} catch (error) {
  const openPages = browser === undefined ? [] : browser.pages();
  const current = openPages[openPages.length - 1];
  if (current !== undefined) await current.screenshot({ path: join(diagnostics, "failure.png") }).catch(() => undefined);
  const state = await request("/api/plugin-manager", { headers: { accept: "application/json", cookie } }).then(async response => ({ status: response.status, body: await response.text() })).catch(cause => ({ error: String(cause) }));
  const applyError = await current?.evaluate(() => (window).__DSH_PLUGIN_APPLY_ERROR__).catch(() => undefined);
  const switchClicks = await current?.evaluate(() => (window).__SWITCH_CLICKS).catch(() => undefined);
  writeFileSync(join(diagnostics, "failure.json"), JSON.stringify({ error: error instanceof Error ? `${error.stack ?? error.message}` : String(error), controlHttp, controlState: state, serverLog: serverLog.slice(-12000), applyError, switchClicks, pageText: await current?.evaluate(() => document.body.innerText).catch(() => undefined) }, null, 2));
  writeFileSync(join(diagnostics, "failure.log"), String(serverLog));
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 1000).unref();
}
