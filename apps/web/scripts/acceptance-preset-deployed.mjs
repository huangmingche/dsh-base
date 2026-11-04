#!/usr/bin/env node
/**
 * Deployed Agent-preset acceptance (zero model calls).
 *
 * Uses the private DSH_ACCEPTANCE_CONFIG account, verifies the exact Worker
 * version, creates only blank test Sessions, checks the official fork roster /
 * declarations / Coding Tools / pointer+keyboard guards in en+zh, and archives
 * its blank Sessions afterwards. It never submits a prompt.
 */
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser, waitForHostReadiness } from "./acceptance-config.mjs";
import { loadOfficialDeclarations } from "./generate-preset-declarations.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const { base, credentials } = remoteAcceptanceConfig();
const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
assert.ok(expectedVersion, "DSH_EXPECTED_DEPLOYMENT_VERSION is required for deployed preset acceptance");
const suffix = Date.now().toString(36);
const cookieName = "__Secure-better-auth.session_token";
const { declarations } = await loadOfficialDeclarations();
const output = resolve(import.meta.dirname, "../../../.artifacts/acceptance/preset-deployed");
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
  const response = await fetchRetry(`${base}/api/session-host`, {
    method: "POST", headers, body: JSON.stringify({ method, params }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function rpc(method, request, expectError = false) {
  const rpcId = crypto.randomUUID();
  const response = await fetchRetry(`${base}/api/${method}`, {
    method: "POST", headers,
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args: { request } } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body.rpcId, rpcId);
  assert.equal(body.result?.ok, !expectError, `${method}: unexpected result`);
  if (expectError) return body.result.error;
  return body.result.value;
}

// Direct RPC availability guards: canonical and unspecified succeed; every
// official id is refused and creates nothing.
const canonical = await rpc("session/create", { title: `Preset deployed canonical ${suffix}`, agentPreset: "dsh-base-think" });
const canonicalSession = canonical.sessionId;
const unspecified = await rpc("session/create", { title: `Preset deployed default ${suffix}` });
const defaultSession = unspecified.sessionId;
for (const id of ["standard", "ptc", "minimal", "cordis"]) {
  const refused = await rpc("session/create", { title: `rejected ${id} ${suffix}`, agentPreset: id }, true);
  assert.equal(refused.code, "gateway/endpoint-unavailable", `${id}: must be refused, not aliased`);
}
const readiness = await waitForHostReadiness(
  (method, params) => hostCall(method, params).then(result => ({ status: 200, body: { result } })),
  canonicalSession,
  { expectedVersion, timeoutMs: 360_000 },
);
const runtime = await hostCall("runtimeInfo");
assert.equal(runtime.versionId, expectedVersion);

const browser = await puppeteer.launch({
  executablePath: chromeExecutable(), headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "dsh-preset-deployed-")),
  protocolTimeout: 240_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: cookieName, value: token, url: base, httpOnly: true, sameSite: "Lax" });
const consoleErrors = [], pageErrors = [], promptRequests = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400)); });
page.on("pageerror", error => pageErrors.push(String(error).slice(0, 400)));
page.on("request", request => {
  if (new URL(request.url()).pathname === "/api/session/prompt") promptRequests.push(request.url());
});

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

const initialSettings = await hostCall("settingsDescribe");
const initialCodingTools = initialSettings.values?.["ui-settings"]?.enabled !== false;
const initialLocale = initialSettings.values?.locale?.preference;
const screenshots = [];
const results = [];
try {
  for (const locale of ["en", "zh"]) {
    const prefix = locale === "zh" ? "/zh-CN" : "";
    await hostCall("settingsUpdate", { ns: "locale", patch: { preference: locale } });
    const loadSession = async sessionId => {
      await page.goto(`${base}${prefix}/agent/${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
      await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__ !== undefined, { timeout: 60_000 });
      await page.waitForFunction(expected => document.documentElement.lang.toLowerCase().startsWith(expected), { timeout: 30_000 }, locale === "zh" ? "zh" : "en");
    };
    await loadSession(canonicalSession);
    const inventory = await page.evaluate(() => window.__DSH_BASE_PLUGINS__);
    const fork = inventory.find(entry => entry.moduleName === "@dsh-base/client-agent-preset");
    const original = inventory.find(entry => entry.moduleName === "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(fork?.origin, "custom"); assert.equal(fork?.enabled, true); assert.equal(fork?.fiberPhase, "active");
    assert.equal(fork?.replaces, "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(original?.origin, "upstream"); assert.equal(original?.enabled, false); assert.equal(original?.fiberPhase, null);
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
    assert.equal(brand, "dsh-base", "sidebar brand must stay the approved code name");
    assert.ok(!/dsh-base\s+0\.1\.0/u.test(await page.evaluate(() => document.body.innerText)), "sidebar version must stay hidden");

    const clickNav = async pattern => {
      await page.waitForFunction(source => {
        const re = new RegExp(source, "iu");
        return [...document.querySelectorAll('[role="dialog"] nav button')].some(button => re.test((button.textContent ?? "").trim()));
      }, { timeout: 20_000 }, pattern);
      await page.evaluate(source => {
        const re = new RegExp(source, "iu");
        [...document.querySelectorAll('[role="dialog"] nav button')].find(button => re.test((button.textContent ?? "").trim()))?.click();
      }, pattern);
    };
    const presetCards = () => page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => element.dataset.agentPresetId));
    const openSettingsPresets = async () => {
      await clickVisible("account menu|账号菜单");
      await clickVisible("^settings\\b|^设置");
      await page.waitForSelector('[role="dialog"] nav button', { timeout: 20_000 });
      await clickNav("^agent presets?$|^agent 预设$");
      await page.waitForFunction(() => document.querySelectorAll("li[data-agent-preset-id]").length > 0, { timeout: 20_000 });
    };
    const setCodingTools = async enabled => {
      await hostCall("settingsUpdate", { ns: "ui-settings", patch: { enabled } });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await hostCall("settingsDescribe");
        if (current.values?.["ui-settings"]?.enabled === enabled) return;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error(`${locale}: Coding Tools setting did not become ${String(enabled)}`);
    };

    // Coding Tools on: full official five-row catalog and declarations.
    await setCodingTools(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
    await openSettingsPresets();
    await page.waitForFunction(() => document.querySelectorAll("li[data-agent-preset-id]").length === 5, { timeout: 8_000 }).catch(() => undefined);
    const fivePresetCards = await presetCards();
    assert.deepEqual(fivePresetCards, ["standard", "ptc", "minimal", "cordis", "dsh-base-think"], `${locale}: five preset rows`);
    const expectedThinkName = locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think";
    assert.ok((await page.$eval('li[data-agent-preset-id="dsh-base-think"]', element => element.textContent ?? "")).includes(expectedThinkName), `${locale}: Settings default card uses the Cloudflare Think name`);
    const grayCards = await page.$$eval("li[data-agent-preset-id]", elements => elements.map(element => ({
      id: element.dataset.agentPresetId,
      availability: element.dataset.availability,
      alert: element.querySelector('[role="alert"]') !== null,
      className: element.className,
      text: element.textContent ?? "",
      pressed: element.querySelector('button[aria-pressed]')?.getAttribute("aria-disabled"),
    })));
    for (const card of grayCards.slice(0, 4)) {
      assert.equal(card.availability, "unavailable", `${locale}:${card.id}: platform limitation is gray unavailable`);
      assert.equal(card.alert, false, `${locale}:${card.id}: must not be a role=alert load failure`);
      assert.match(card.className, /cardUnavailable/u);
      assert.doesNotMatch(card.className, /cardBroken/u);
      assert.match(card.text, /Unavailable in this deployment|当前部署不可用/u);
      assert.doesNotMatch(card.text, /Failed to load|加载失败/u);
      assert.equal(card.pressed, "true");
    }
    assert.equal(grayCards.at(-1).availability, "available");
    const settingsGrayShot = join(output, `settings-gray-${locale}-${suffix}.png`);
    await page.screenshot({ path: settingsGrayShot }); screenshots.push(settingsGrayShot);
    const declarationDigests = {};
    for (const id of ["standard", "ptc", "minimal", "cordis"]) {
      await page.evaluate(id => document.querySelector(`li[data-agent-preset-id="${id}"] button[data-tip]`)?.click(), id);
      await page.waitForSelector('[role="dialog"] pre', { visible: true, timeout: 20_000 });
      const content = await page.$eval('[role="dialog"] pre', element => element.textContent);
      assert.equal(content, declarations[id].content, `${locale}:${id}: declaration differs from pinned export`);
      declarationDigests[id] = createHash("sha256").update(content).digest("hex");
      await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        const viewer = dialogs.at(-1);
        const close = [...(viewer?.querySelectorAll("button") ?? [])].find(button => /^close$|^关闭$/i.test((button.textContent ?? "").trim()) || /close|关闭/i.test(button.getAttribute("aria-label") ?? ""));
        close?.click();
      });
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] pre'), { timeout: 15_000 });
    }
    // Official mode guides remain readable even though the mode cannot run here.
    for (const guideLabel of locale === "zh" ? ["模式说明", "如何使用"] : ["Mode details", "How to use"]) {
      const opened = await page.evaluate(label => {
        const card = document.querySelector('li[data-agent-preset-id="standard"]');
        const button = [...(card?.querySelectorAll("button") ?? [])].find(candidate => (candidate.textContent ?? "").trim() === label);
        if (button === undefined) return false;
        button.click();
        return true;
      }, guideLabel);
      assert.equal(opened, true, `${locale}: guide trigger ${guideLabel} missing`);
      await page.waitForSelector('[class*="guideDialog"], [class*="guideLayout"], [class*="guideHeader"]', { visible: true, timeout: 20_000 });
      const guideSelector = '[class*="guideDialog"], [class*="guideLayout"], [class*="guideHeader"]';
      const guideText = await page.$eval(guideSelector, element => element.innerText);
      assert.ok(guideText.length > 40, `${locale}: official ${guideLabel} guide is readable`);
      const guideClose = await page.$('button[class*="guideClose"]');
      if (guideClose !== null) await guideClose.click();
      else await page.click(guideSelector + ' button[aria-label]');
      await page.waitForFunction(() => !document.querySelector('[class*="guideDialog"], [class*="guideLayout"], [class*="guideHeader"]'), { timeout: 15_000 });
      if (await page.$('li[data-agent-preset-id="standard"]') === null) await openSettingsPresets();
    }
    const thinkView = await page.$eval('li[data-agent-preset-id="dsh-base-think"] button[data-tip]', button => ({ disabled: button.disabled, title: button.title }));
    assert.equal(thinkView.disabled, true); assert.ok(thinkView.title.length > 0);
    const creator = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(candidate => String(candidate.className).includes("creatorButton"));
      return button === undefined ? null : { disabled: button.disabled, title: button.title };
    });
    assert.notEqual(creator, null); assert.equal(creator.disabled, true); assert.ok(creator.title.length > 0);
    const unavailableDefault = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("li[data-agent-preset-id]")];
      const pressed = cards.find(card => card.querySelector('button[aria-pressed="true"]'));
      const fallback = cards.find(card => /New task default|新任务默认/.test(card.textContent ?? ""));
      const unavailable = cards.find(card => card.dataset.agentPresetId === "standard");
      return { active: (pressed ?? fallback)?.dataset.agentPresetId, disabled: unavailable?.querySelector('button[aria-pressed]')?.getAttribute("aria-disabled") };
    });
    assert.equal(unavailableDefault.active, "dsh-base-think", `${locale}: fixed Think remains the default`);
    assert.equal(unavailableDefault.disabled, "true", `${locale}: unavailable card is aria-disabled`);

    // Coding Tools off follows the official filter in the real Settings roster.
    await setCodingTools(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
    await openSettingsPresets();
    await page.waitForFunction(() => document.querySelectorAll("li[data-agent-preset-id]").length === 3, { timeout: 8_000 }).catch(() => undefined);
    assert.deepEqual(await presetCards(), ["standard", "cordis", "dsh-base-think"], `${locale}: Coding Tools off shows three rows`);
    await page.keyboard.press("Escape");
    await setCodingTools(true);

    // Composer: real blank-session hero chip, real pointer/keyboard guards.
    // The preset seat filters against the Session's frozen composition config,
    // so create the composer Session after the Coding Tools setting is on.
    const composerSession = (await rpc("session/create", { title: `Preset deployed composer ${suffix}` })).sessionId;
    await loadSession(composerSession);
    const chipLabel = locale === "zh" ? "Cloudflare Think 模式" : "Cloudflare Think";
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), { timeout: 30_000 }, chipLabel);
    const openComposerMenu = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const point = await page.evaluate(label => {
          const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(candidate => (candidate.textContent ?? "").includes(label));
          const rect = button.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, chipLabel);
        await page.mouse.click(point.x, point.y);
        try {
          await page.waitForFunction(() => document.querySelectorAll('[role="menuitem"]').length === 5, { timeout: 5_000 }).catch(() => undefined);
          if ((await page.$$('[role="menuitem"]')).length === 5) return;
        } catch { /* retry real pointer activation */ }
      }
      throw new Error(`${locale}: composer preset menu did not stay open`);
    };
    await openComposerMenu();
    if ((await page.$$('[role="menuitem"]')).length !== 5) {
      // A persisted settings push can land just after this page's first boot;
      // reassert the private account's on state and reload once before judging.
      await page.keyboard.press("Escape");
      await setCodingTools(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
      await page.waitForFunction(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), { timeout: 30_000 }, chipLabel);
      await openComposerMenu();
    }
    const menu = await page.$$eval('[role="menuitem"]', elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent ?? "", disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true", point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
    }));
    assert.equal(menu.length, 5, `${locale}: composer must show five rows`);
    for (const [index, id] of ["standard", "ptc", "minimal", "cordis"].entries()) {
      assert.equal(menu[index].disabled, true, `${locale}: composer ${id} must be disabled`);
      assert.ok(menu[index].text.length > 20, `${locale}: composer ${id} must explain the gap`);
    }
    assert.equal(menu[4].disabled, false, `${locale}: Cloudflare Think must be enabled`);
    assert.ok(menu[4].text.includes(expectedThinkName), `${locale}: composer menu uses the Cloudflare Think name`);
    const composerMenuShot = join(output, `composer-menu-${locale}-${suffix}.png`);
    await page.screenshot({ path: composerMenuShot }); screenshots.push(composerMenuShot);
    await page.mouse.click(menu[0].point.x, menu[0].point.y);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.evaluate(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), chipLabel), true, `${locale}: pointer selected an unavailable preset`);
    await page.keyboard.press("Escape");
    await openComposerMenu();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.evaluate(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), chipLabel), true, `${locale}: keyboard selected an unavailable preset`);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 120_000 });
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(button => (button.textContent ?? "").includes(label)), { timeout: 30_000 }, chipLabel);
    const screenshot = join(output, `preset-${locale}-${suffix}.png`);
    await page.screenshot({ path: screenshot }); screenshots.push(screenshot);
    results.push({ locale, thinkName: expectedThinkName, brand, inventory: { fork, original }, presetCards: fivePresetCards, unavailableRows: 4, brokenRows: 0, composerRows: 5, composerCodingToolsOffRows: 3, creatorDisabled: true, reloadDefault: "dsh-base-think", declarationDigests });
  }
} finally {
  // Restore the private account's Coding Tools preference and archive only the
  // blank Sessions this run created; no prompts or user data were touched.
  await hostCall("settingsUpdate", { ns: "ui-settings", patch: { enabled: initialCodingTools } }).catch(() => undefined);
  if (typeof initialLocale === "string" && initialLocale !== "") {
    await hostCall("settingsUpdate", { ns: "locale", patch: { preference: initialLocale } }).catch(() => undefined);
  }
  for (const sessionId of [canonicalSession, defaultSession]) await hostCall("workspaceSetFlags", { sessionId, archived: true }).catch(() => undefined);
  await closeAcceptanceBrowser(browser);
}
assert.deepEqual(consoleErrors, [], "browser console errors");
assert.deepEqual(pageErrors, [], "browser page errors");
assert.deepEqual(promptRequests, [], "zero-model acceptance must not submit a prompt");
const report = {
  ok: true, testedAt: new Date().toISOString(), base, version: expectedVersion,
  runtimeVersion: runtime.versionId, readiness, promptRequests: 0,
  aiExecutionTested: false, consoleErrors, pageErrors, screenshots, results,
  credentials: "private DSH_ACCEPTANCE_CONFIG account; values never logged",
};
writeFileSync(join(output, `report-${suffix}.json`), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(output, "latest.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, version: expectedVersion, runtimeVersion: runtime.versionId, locales: results.map(result => result.locale), promptRequests: 0, screenshots }));
