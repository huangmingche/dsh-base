#!/usr/bin/env node
/** Staging acceptance for the read-only official Settings session/global plugin inventory. */
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser, waitForHostReadiness } from "./acceptance-config.mjs";
import { loadOfficialDeclarations } from "./generate-preset-declarations.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const { base, credentials } = remoteAcceptanceConfig();
const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
assert.ok(expectedVersion, "DSH_EXPECTED_DEPLOYMENT_VERSION is required");
const { officialRows, thinkRows, lock } = await loadOfficialDeclarations();
const appVersion = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version;
const upstreamRepository = lock.repository.replace(/\.git$/u, "");
const upstreamRelease = `${upstreamRepository}/releases/tag/${encodeURIComponent(lock.tag)}`;
const suffix = Date.now().toString(36);
const cookieName = "__Secure-better-auth.session_token";
const output = resolve(import.meta.dirname, "../../../.artifacts/acceptance/session-plugins-deployed");
mkdirSync(output, { recursive: true });

async function fetchRetry(url, init = {}) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { last = error; if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_000 * attempt)); }
  }
  throw last;
}
const signIn = await fetchRetry(`${base}/api/auth/sign-in/username`, {
  method: "POST", headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ username: credentials.username, password: credentials.password }),
});
assert.equal(signIn.status, 200, "private acceptance sign-in failed");
const token = (((signIn.headers.getSetCookie?.() ?? []).join("; ")) || (signIn.headers.get("set-cookie") ?? "")).match(/__Secure-better-auth[^=]*=([^;]+)/u)?.[1];
assert.ok(token, "private acceptance sign-in returned no cookie");
const headers = { "content-type": "application/json", origin: base, cookie: `${cookieName}=${token}` };
async function hostCall(method, params = {}) {
  const response = await fetchRetry(`${base}/api/session-host`, { method: "POST", headers, body: JSON.stringify({ method, params }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function rpc(method, request) {
  const rpcId = crypto.randomUUID();
  const response = await fetchRetry(`${base}/api/${method}`, { method: "POST", headers, body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args: { request } } }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body.result?.ok, true, `${method}: ${JSON.stringify(body.result?.error)}`);
  return body.result.value;
}
async function listAllSessions() {
  const sessions = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await hostCall("list", cursor === undefined ? {} : { cursor });
    sessions.push(...result.sessions);
    cursor = result.cursor;
    if (cursor === undefined || result.sessions.length === 0) break;
  }
  return sessions;
}
const testSessions = await listAllSessions();
const modelSessionId = testSessions.find(session => session.blank === false)?.sessionId;
assert.ok(modelSessionId, "deployed acceptance account has no non-blank test Session for Models validation");
const created = await rpc("session/create", { title: `Session plugin acceptance ${suffix}`, agentPreset: "dsh-base-think" });
const sessionId = created.sessionId;
const readiness = await waitForHostReadiness((method, params) => hostCall(method, params).then(result => ({ status: 200, body: { result } })), sessionId, { expectedVersion, timeoutMs: 360_000 });
const initialSettings = await hostCall("settingsDescribe");
const initialLocale = initialSettings.values?.locale?.preference;

const browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, userDataDir: mkdtempSync(join(tmpdir(), "dsh-session-plugins-")), protocolTimeout: 240_000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: cookieName, value: token, url: base, httpOnly: true, sameSite: "Lax" });
const consoleErrors = [], pageErrors = [], promptRequests = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400)); });
page.on("pageerror", error => pageErrors.push(String(error).slice(0, 400)));
page.on("request", request => { if (new URL(request.url()).pathname === "/api/session/prompt") promptRequests.push(request.url()); });

const clickVisible = async pattern => {
  await page.waitForFunction(source => {
    const re = new RegExp(source, "iu");
    return [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].some(element => {
      const labels = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")];
      return labels.some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled");
    });
  }, { timeout: 20_000 }, pattern);
  await page.evaluate(source => {
    const re = new RegExp(source, "iu");
    [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].find(element => {
      const labels = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")];
      return labels.some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled");
    })?.click();
  }, pattern);
};
const openBuiltIn = async prefix => {
  await page.goto(`${base}${prefix}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
  await clickVisible("account menu|账号菜单");
  await clickVisible("^settings\\b|^设置");
  await page.waitForSelector('[role="dialog"] nav button', { timeout: 20_000 });
  await clickVisible("^built-in plugins$|^内置插件$");
  await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 20_000 });
};
const openSwitcher = async () => {
  const target = '[data-plugin-scope="preset"] button[aria-haspopup="menu"]';
  await page.waitForSelector(target, { visible: true, timeout: 20_000 });
  await page.evaluate(selector => { document.querySelector(selector)?.click(); }, target);
  await page.waitForSelector('[role="menuitem"]', { visible: true, timeout: 20_000 });
};
const thinkModules = () => page.$$eval('[data-plugin-scope="preset"] [data-plugin-module]', elements => elements.map(element => element.dataset.pluginModule));
const screenshots = [];
const evidence = [];
try {
  for (const locale of ["en", "zh"]) {
    const prefix = locale === "zh" ? "/zh-CN" : "";
    await hostCall("settingsUpdate", { ns: "locale", patch: { preference: locale } });
    await openBuiltIn(prefix);
    // Official General version row: app version + pinned upstream tag.
    await clickVisible("^general$|^通用设置$");
    const expectedVersionLine = locale === "zh"
      ? `当前版本：dsh-base ${appVersion} · 上游 DeepSeek Harness：${lock.tag}`
      : `Current version: dsh-base ${appVersion} · Upstream DeepSeek Harness: ${lock.tag}`;
    assert.ok((await page.$eval('[role="dialog"]', element => element.innerText)).includes(expectedVersionLine), `${locale}: version row must name app and pinned upstream versions`);
    await page.evaluate(text => {
      const row = [...document.querySelectorAll("div")].find(element => element.textContent?.trim() === text);
      row?.scrollIntoView({ block: "center" });
    }, expectedVersionLine);
    const versionShot = join(output, `version-${locale}-${suffix}.png`);
    await page.screenshot({ path: versionShot }); screenshots.push(versionShot);
    const versionLinks = await page.$$eval('[role="dialog"] a[href]', elements => elements.map(element => ({
      text: element.textContent, href: element.href, target: element.target, rel: element.rel,
    })));
    const repoLink = versionLinks.find(link => link.text === "DeepSeek Harness");
    const tagLink = versionLinks.find(link => link.text === lock.tag);
    assert.equal(repoLink?.href, upstreamRepository, `${locale}: DeepSeek Harness link must target the pinned repository`);
    assert.equal(repoLink?.target, "_blank"); assert.match(repoLink?.rel ?? "", /noopener/u); assert.match(repoLink?.rel ?? "", /noreferrer/u);
    assert.equal(tagLink?.href, upstreamRelease, `${locale}: tag link must target the pinned release`);
    assert.equal(tagLink?.target, "_blank"); assert.match(tagLink?.rel ?? "", /noopener/u);
    assert.equal(await page.evaluate(href => {
      const link = [...document.querySelectorAll('[role="dialog"] a[href]')].find(element => element.href === href);
      link?.focus();
      return document.activeElement === link;
    }, upstreamRelease), true, `${locale}: release link must be keyboard focusable`);
    const [external] = await Promise.all([
      browser.waitForTarget(target => target.opener() === page.target(), { timeout: 15_000 }),
      page.evaluate(href => [...document.querySelectorAll('[role="dialog"] a[href]')].find(element => element.href === href)?.click(), upstreamRepository),
    ]);
    assert.ok(external, `${locale}: repository link click must open an external target`);
    await (await external.page())?.close();
    await page.setViewport({ width: 1024, height: 900 });
    await openBuiltIn(prefix);
    await clickVisible("^general$|^通用设置$");
    assert.equal(await page.evaluate(text => document.body.innerText.includes(text), expectedVersionLine), true, `${locale}: version row missing at narrow width`);
    const narrow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewport: window.innerWidth,
    }));
    assert.ok(narrow.documentWidth <= narrow.viewport + 1 && narrow.bodyWidth <= narrow.viewport + 1, `${locale}: version row overflows narrow Settings pane`);
    await page.evaluate(text => {
      const row = [...document.querySelectorAll("div")].find(element => element.textContent?.trim() === text);
      row?.scrollIntoView({ block: "center" });
    }, expectedVersionLine);
    const narrowShot = join(output, `version-narrow-${locale}-${suffix}.png`);
    await page.screenshot({ path: narrowShot }); screenshots.push(narrowShot);
    await page.setViewport({ width: 1440, height: 900 });
    await openBuiltIn(prefix);
    // Official Models page on a non-blank acceptance-account Session (so the
    // official first-run onboarding does not replace the Settings panel).
    await page.goto(`${base}${prefix}/agent/${encodeURIComponent(modelSessionId)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element => /account menu|账号菜单/u.test(`${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`)), { timeout: 120_000 });
    await clickVisible("account menu|账号菜单");
    await clickVisible("^settings\b|^设置");
    await page.waitForSelector('[role="dialog"] nav button', { timeout: 20_000 });
    await page.evaluate(label => {
      const button = [...document.querySelectorAll('[role="dialog"] nav button')].find(item => (item.textContent ?? "").trim() === label);
      button?.click();
    }, locale === "zh" ? "模型" : "Models");
    await page.waitForSelector('[data-model-access]', { timeout: 20_000 });
    const modelsText = await page.$eval('[role="dialog"]', element => element.innerText);
    assert.ok(modelsText.includes("Cloudflare AI Gateway"), `${locale}: platform gateway status missing`);
    assert.ok(modelsText.includes("DeepSeek-V4.1-Flash") && modelsText.includes("DeepSeek-V4-Pro"), `${locale}: actual Host catalog missing`);
    assert.equal(modelsText.includes("DEEPSEEK_OFFICIAL_API_KEY") || /Could not detect|未检测到|Anthropic Messages/u.test(modelsText), false, `${locale}: misleading local key/Anthropic prompt`);
    const modelShot = join(output, `models-${locale}-${suffix}.png`);
    await page.screenshot({ path: modelShot }); screenshots.push(modelShot);
    const modelAccess = await page.$eval('[data-model-access]', element => element.getAttribute('data-model-access'));
    await clickVisible("^built-in plugins$|^内置插件$");
    await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 20_000 });
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
    assert.equal(brand, "dsh-base");
    const groupTitle = await page.$eval('[data-plugin-scope="preset"] span[class*="groupTitle"]', element => element.textContent.trim());
    assert.equal(groupTitle, locale === "zh" ? "会话插件" : "Session plugins");
    const expectedThink = locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think";
    assert.ok((await page.$eval('[data-plugin-scope="preset"]', element => element.textContent)).includes(expectedThink));
    assert.deepEqual(await thinkModules(), thinkRows.map(row => row.moduleName));
    const sessionShot = join(output, `session-plugins-${locale}-${suffix}.png`);
    await page.screenshot({ path: sessionShot }); screenshots.push(sessionShot);

    // Selector expanded: all five presets, then one official read-only composition.
    await openSwitcher();
    const switcherShot = join(output, `session-plugins-switcher-${locale}-${suffix}.png`);
    await page.screenshot({ path: switcherShot }); screenshots.push(switcherShot);
    assert.equal((await page.$$('[role="menuitem"]')).length, 5);
    const standardLabel = locale === "zh" ? "标准模式" : "Standard mode";
    const selected = await page.evaluate(label => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => (element.textContent ?? "").trim().startsWith(label));
      if (item === undefined) return false;
      item.click(); return true;
    }, standardLabel);
    assert.equal(selected, true);
    await page.waitForFunction(() => document.querySelector('[data-plugin-scope="preset"]')?.getAttribute("data-preset-id") === "standard", { timeout: 15_000 });
    assert.deepEqual(await thinkModules(), officialRows.standard.map(row => row.moduleName));
    const standardShot = join(output, `session-plugins-standard-${locale}-${suffix}.png`);
    await page.screenshot({ path: standardShot }); screenshots.push(standardShot);

    // Expand/collapse with a real keyboard on a fresh Settings surface.
    await openBuiltIn(prefix);
    const toggle = '[data-plugin-scope="preset"] button[class*="groupToggle"]';
    await page.evaluate(selector => {
      const button = document.querySelector(selector);
      if (button?.getAttribute("aria-expanded") === "true") button.click();
    }, toggle);
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-expanded") === "false", { timeout: 15_000 }, toggle);
    await page.$eval(toggle, button => button.focus());
    await page.keyboard.press("Enter");
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-expanded") === "true", { timeout: 15_000 }, toggle);

    // Search hit and no-result copy on a fresh surface.
    await openBuiltIn(prefix);
    const search = 'input[type="search"]';
    await page.click(search);
    await page.type(search, "ai-gateway");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-plugin-scope="preset"] [data-plugin-module]')].every(element => (element.getAttribute("data-plugin-module") ?? "").includes("ai-gateway")), { timeout: 15_000 });
    await page.$eval(search, input => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.type(search, "no-such-plugin-xyz");
    await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 15_000 }, locale === "zh" ? "没有匹配的插件。" : "No matching plugins.");

    // Global inventory is real client Loader data; no session is required.
    await openBuiltIn(prefix);
    const openedGlobal = await page.evaluate(() => {
      const button = document.querySelector('[data-plugin-scope="global"] button[class*="groupToggle"]');
      if (button === null) return false;
      if (button.getAttribute("aria-expanded") !== "true") button.click();
      return true;
    });
    assert.equal(openedGlobal, true);
    await page.waitForSelector('[data-plugin-scope="global"] [data-plugin-module]', { timeout: 20_000 });
    const globalShot = join(output, `session-plugins-global-${locale}-${suffix}.png`);
    await page.screenshot({ path: globalShot }); screenshots.push(globalShot);
    const globalModules = await page.$$eval('[data-plugin-scope="global"] [data-plugin-module]', elements => elements.map(element => element.dataset.pluginModule));
    assert.ok(globalModules.includes("@deepseek-ai/dsh-client-ui-schedule"));

    // Preserve the gray Agent-preset state and brand, and read-only management.
    await openBuiltIn(prefix);
    await clickVisible("^agent presets?$|^agent 预设$");
    await page.waitForSelector('li[data-agent-preset-id="standard"]', { timeout: 20_000 });
    assert.equal(await page.$eval('li[data-agent-preset-id="standard"]', element => element.dataset.availability), "unavailable");
    const grey = await page.$eval('li[data-agent-preset-id="standard"]', element => ({ alert: element.querySelector('[role="alert"]') !== null, text: element.textContent }));
    assert.equal(grey.alert, false); assert.match(grey.text, /Unavailable|不可用/u);
    await page.keyboard.press("Escape");
    await clickVisible("^plugins$|^插件$");
    const addLabel = locale === "zh" ? "添加插件" : "Add plugin";
    const addControls = await page.$eval(`[role="group"][aria-label=${JSON.stringify(addLabel)}]`, group => [...group.querySelectorAll("button")].map(button => button.disabled));
    assert.ok(addControls.length === 2 && addControls.every(Boolean));

    // Cold reload / no-selected-session reopen.
    await openBuiltIn(prefix);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
    await page.goto(`${base}${prefix}/`, { waitUntil: "domcontentloaded" });
    await openBuiltIn(prefix);
    assert.equal(await page.$eval('[data-plugin-scope="preset"]', element => element.getAttribute("data-preset-id")), "dsh-base-think");

    evidence.push({ locale, modelAccess, versionLine: expectedVersionLine, upstreamLinks: { repository: upstreamRepository, release: upstreamRelease, clickedExternal: true }, brand, groupTitle, thinkRows: thinkRows.length, officialPresets: Object.keys(officialRows), globalModules: globalModules.length, grey: "unavailable", management: "unavailable" });
  }
} finally {
  await hostCall("settingsUpdate", { ns: "locale", patch: { preference: typeof initialLocale === "string" && initialLocale !== "" ? initialLocale : "en" } }).catch(() => undefined);
  await hostCall("workspaceSetFlags", { sessionId, archived: true }).catch(() => undefined);
  await closeAcceptanceBrowser(browser);
}
assert.deepEqual(consoleErrors, []); assert.deepEqual(pageErrors, []);
assert.deepEqual(promptRequests, [], "session inventory acceptance must not submit a prompt");
const report = { ok: true, testedAt: new Date().toISOString(), base, version: expectedVersion, runtimeVersion: expectedVersion, readiness, promptRequests: 0, evidence, screenshots, consoleErrors, pageErrors };
writeFileSync(join(output, "latest.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, version: expectedVersion, locales: evidence.map(item => item.locale), screenshots }));
