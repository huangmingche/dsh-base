#!/usr/bin/env node
/** Exact-version staging acceptance for the two independent model providers. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser, waitForHostReadiness } from "./acceptance-config.mjs";

const { base, credentials } = remoteAcceptanceConfig();
const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
assert.ok(expectedVersion, "DSH_EXPECTED_DEPLOYMENT_VERSION is required");
const repoRoot = resolve(import.meta.dirname, "../../..");
const appVersion = JSON.parse(readFileSync(join(repoRoot, "apps/web/package.json"), "utf8")).version;
const lock = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8"));
const suffix = Date.now().toString(36);
const output = resolve(import.meta.dirname, "../../../.artifacts/acceptance/model-settings-deployed");
mkdirSync(output, { recursive: true });
const fetchRetry = async (url, init = {}) => {
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { last = error; if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_000 * attempt)); }
  }
  throw last;
};
const signIn = await fetchRetry(`${base}/api/auth/sign-in/username`, {
  method: "POST", headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ username: credentials.username, password: credentials.password }),
});
assert.equal(signIn.status, 200);
const token = (((signIn.headers.getSetCookie?.() ?? []).join("; ")) || (signIn.headers.get("set-cookie") ?? "")).match(/__Secure-better-auth[^=]*=([^;]+)/u)?.[1];
assert.ok(token);
const headers = { "content-type": "application/json", origin: base, cookie: `__Secure-better-auth.session_token=${token}` };
async function hostCall(method, params = {}) {
  const response = await fetchRetry(`${base}/api/session-host`, { method: "POST", headers, body: JSON.stringify({ method, params }) });
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.error, undefined);
  return body.result;
}
let cursor;
const sessions = [];
for (let page = 0; page < 20; page += 1) {
  const result = await hostCall("list", cursor === undefined ? {} : { cursor });
  sessions.push(...result.sessions);
  cursor = result.cursor;
  if (cursor === undefined) break;
}
const settingsSession = sessions.find(candidate => candidate.blank === false);
assert.ok(settingsSession, "acceptance account needs an existing non-blank test Session for Settings");
const readiness = await waitForHostReadiness(
  (method, params = {}) => hostCall(method, params).then(result => ({ status: 200, body: { result } })),
  settingsSession.sessionId,
  { expectedVersion },
);
const runtime = await hostCall("runtimeInfo");
assert.equal(runtime.versionId, expectedVersion, "runtimeInfo must report the exact deployment version");
const testSession = await hostCall("create", { title: `Provider acceptance ${suffix}` });
assert.ok(typeof testSession.sessionId === "string");
const browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, userDataDir: mkdtempSync(join(tmpdir(), "dsh-provider-settings-")), protocolTimeout: 240_000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: "__Secure-better-auth.session_token", value: token, url: base, httpOnly: true, sameSite: "Lax" });
const consoleErrors = [], pageErrors = [], promptRequests = [], claimRequests = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400)); });
page.on("pageerror", error => pageErrors.push(String(error).slice(0, 400)));
page.on("request", request => {
  const path = new URL(request.url()).pathname;
  if (path === "/api/session/prompt") promptRequests.push(request.url());
  if (path === "/api/session-host/claim") claimRequests.push(request.url());
});
const clickVisible = async pattern => {
  await page.waitForFunction(source => {
    const re = new RegExp(source, "iu");
    return [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].some(element => {
      const labels = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")];
      return labels.some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled");
    });
  }, { timeout: 30_000 }, pattern);
  await page.evaluate(source => {
    const re = new RegExp(source, "iu");
    [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')].find(element => {
      const labels = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")];
      return labels.some(label => re.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled");
    })?.click();
  }, pattern);
};
const clickDialogNav = async label => {
  const selected = await page.evaluate(text => {
    const button = [...document.querySelectorAll('[role="dialog"] nav button')].find(item => (item.textContent ?? "").trim() === text);
    if (button === undefined) return false;
    button.click(); return true;
  }, label);
  assert.equal(selected, true, `Settings navigation missing: ${label}`);
};
const openSettingsPanel = async () => {
  if (await page.$('[role="dialog"] nav button') !== null) return;
  await clickVisible("account menu|账号菜单");
  await clickVisible("^settings\\b|^设置");
  await page.waitForSelector('[role="dialog"] nav button', { timeout: 30_000 });
};
const openSettingsModels = async (locale) => {
  await hostCall("settingsUpdate", { ns: "locale", patch: { preference: locale } });
  await page.bringToFront();
  await page.goto(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(settingsSession.sessionId)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
  // The official first-run coordinator can dismiss Settings once while its
  // registrants finish deciding; reopen once, then verify the real section.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await openSettingsPanel();
    await clickDialogNav(locale === "zh" ? "模型" : "Models");
    try {
      await page.waitForSelector('[data-gateway-provider]', { timeout: 10_000 });
      return;
    } catch (error) {
      if (await page.$('[role="dialog"]') !== null) throw error;
    }
  }
  throw new Error("Models section did not remain open after onboarding coordinator settled");
};
const modelAccess = await hostCall("modelAccess");
assert.equal(modelAccess.providers?.["cloudflare-ai-gateway"]?.available, true, "staging platform Gateway must be available");
assert.equal(modelAccess.ownerKeyConfigured, false, "acceptance account must not need an owner key for this UI run");
const screenshots = [];
const locales = [];
const setTheme = async theme => page.evaluate(value => {
  if (value === "dark") document.body.dataset.dsDarkTheme = "";
  else delete document.body.dataset.dsDarkTheme;
}, theme);
const clickGatewayButton = async label => page.evaluate(text => {
  const button = [...(document.querySelector('[data-gateway-row]')?.querySelectorAll('button') ?? [])].find(item => (item.textContent ?? "").trim() === text);
  button?.click();
}, label);
const clickOfficialButton = async label => page.evaluate(text => {
  const official = document.querySelector('[data-gateway-row]')?.previousElementSibling;
  const button = [...(official?.querySelectorAll('button') ?? [])].find(item => (item.textContent ?? "").trim() === text);
  button?.click();
}, label);
const gatewayPanel = () => page.evaluate(() => document.querySelector('[data-gateway-row] [role="region"]'));
const gatewayExpanded = () => page.evaluate(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute("hidden") === false);
const deepSeekEditing = () => page.evaluate(() => document.querySelector('[role="dialog"] input[type="password"]') !== null);
const rowStyle = async () => page.evaluate(() => {
  const gateway = document.querySelector('[data-gateway-row]');
  const official = gateway?.previousElementSibling;
  const inspect = row => {
    if (!row) return null;
    const style = getComputedStyle(row); const button = row.querySelector('button'); const bs = button ? getComputedStyle(button) : null;
    return {
      height: Math.round(row.getBoundingClientRect().height * 100) / 100,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(" "),
      radius: style.borderRadius, border: style.borderTopWidth, gap: style.gap,
      buttonHeight: button?.getBoundingClientRect().height ?? null,
      buttonPadding: bs === null ? null : [bs.paddingTop, bs.paddingRight, bs.paddingBottom, bs.paddingLeft].join(" "),
      buttonFont: bs?.fontSize ?? null, buttonRadius: bs?.borderRadius ?? null,
    };
  };
  return { official: inspect(official), gateway: inspect(gateway) };
});
const externalGap = async () => page.evaluate(() => {
  const gateway = document.querySelector('[data-gateway-row]');
  const official = gateway?.previousElementSibling;
  const measured = row => {
    if (!row) return null;
    const head = row.querySelector('[class*="rowHead"]');
    const editor = row.querySelector('[class*="editor"]');
    return head && editor ? Math.round(editor.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null;
  };
  return { official: measured(official), gateway: measured(gateway) };
});
try {
  for (const locale of ["en", "zh"]) {
    await openSettingsModels(locale);
    const modelsText = await page.$eval('[role="dialog"]', element => element.innerText);
    assert.match(modelsText, /DeepSeek/u, `${locale}: original DeepSeek provider card`);
    assert.match(modelsText, /Cloudflare AI Gateway/u, `${locale}: independent Gateway card`);
    assert.equal(await page.$eval('[data-gateway-provider]', element => element.getAttribute('data-gateway-provider')), 'available', `${locale}: Gateway available`);
    assert.equal(/cordis\.patch\.yml|其余字段|Other fields live/u.test(modelsText), false, `${locale}: no fake YAML editor`);
    // Both providers are collapsed by default and the Gateway slot exposes no
    // independent open state in production.
    assert.equal(await gatewayExpanded(), false, `${locale}: Gateway defaults collapsed`);
    assert.equal(await deepSeekEditing(), false, `${locale}: DeepSeek defaults collapsed`);
    const compact = await rowStyle();
    for (const key of ["height", "padding", "radius", "border", "gap", "buttonHeight", "buttonPadding", "buttonFont", "buttonRadius"]) {
      assert.equal(compact.gateway[key], compact.official[key], `${locale}: Gateway compact ${key} must match official DeepSeek row`);
    }
    assert.ok(compact.gateway.height <= 56, `${locale}: Gateway compact row height ${compact.gateway.height}`);
    const compactShot = join(output, `gateway-compact-${locale}-light-1440-${suffix}.png`);
    await page.screenshot({ path: compactShot }); screenshots.push(compactShot);
    // DeepSeek editor remains the original official form, including endpoint/catalog.
    await clickOfficialButton(locale === "zh" ? "编辑" : "Edit");
    await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 20_000 });
    const editorText = await page.$eval('[role="dialog"]', element => element.innerText);
    assert.match(editorText, /API|密钥|API key/u);
    assert.doesNotMatch(editorText, /Anthropic Messages|cordis\.patch\.yml/u);
    await page.evaluate(label => {
      const dialog = document.querySelector('[role="dialog"]');
      const summary = [...(dialog?.querySelectorAll('summary') ?? [])].find(item => (item.textContent ?? "").trim() === label);
      summary?.click(); summary?.parentElement?.setAttribute('open', '');
    }, locale === "zh" ? "自定义设置" : "Customized settings");
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] input[aria-label]')].some(input => /Base URL|API 地址/u.test(input.getAttribute('aria-label') ?? '')), { timeout: 20_000 });
    const modelInputs = await page.$$eval('input[aria-label]', inputs => inputs.map(input => ({ label: input.getAttribute('aria-label'), disabled: input.disabled })));
    assert.ok(modelInputs.some(input => /Base URL|API 地址/u.test(input.label ?? '') && input.disabled === false), `${locale}: DeepSeek endpoint stays editable`);
    assert.ok(modelInputs.some(input => /Model ID|模型 ID/u.test(input.label ?? '') && input.disabled === false), `${locale}: DeepSeek model directory stays editable`);
    const editShot = join(output, `deepseek-editor-${locale}-${suffix}.png`);
    await page.screenshot({ path: editShot }); screenshots.push(editShot);
    // DeepSeek -> Gateway: the official edit closes Gateway; Gateway -> DeepSeek
    // is exercised immediately after, so both directions are checked.
    assert.equal(await gatewayExpanded(), false, `${locale}: DeepSeek editor keeps Gateway collapsed`);
    const officialGap = await externalGap();
    assert.equal(officialGap.official, 12, `${locale}: official editor external gap is 12px`);
    await clickGatewayButton(locale === "zh" ? "详情" : "Details");
    await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === false, { timeout: 20_000 });
    assert.equal(await deepSeekEditing(), false, `${locale}: Gateway Details closes official DeepSeek editor`);
    assert.equal(await page.$$eval('[data-gateway-row] input,[data-gateway-row] textarea,[data-gateway-row] select,[data-gateway-row] [contenteditable="true"]', nodes => nodes.length), 0, `${locale}: Gateway has no fake editable fields`);
    const gatewayGap = await externalGap();
    assert.equal(gatewayGap.gateway, officialGap.official, `${locale}: Gateway editor external gap matches official`);
    const expandedShot = join(output, `gateway-expanded-${locale}-light-1440-${suffix}.png`);
    await page.screenshot({ path: expandedShot }); screenshots.push(expandedShot);
    // Light/dark and 1440/720 compact+expanded evidence.
    await setTheme("dark");
    const darkExpanded = join(output, `gateway-expanded-${locale}-dark-1440-${suffix}.png`);
    await page.screenshot({ path: darkExpanded }); screenshots.push(darkExpanded);
    await clickGatewayButton(locale === "zh" ? "收起详情" : "Hide details");
    await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === true, { timeout: 20_000 });
    const darkCompact = join(output, `gateway-compact-${locale}-dark-1440-${suffix}.png`);
    await page.screenshot({ path: darkCompact }); screenshots.push(darkCompact);
    await setTheme("light");
    await page.setViewport({ width: 720, height: 800 });
    const narrowCompact = join(output, `gateway-compact-${locale}-light-720-${suffix}.png`);
    await page.screenshot({ path: narrowCompact }); screenshots.push(narrowCompact);
    await clickGatewayButton(locale === "zh" ? "详情" : "Details");
    await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === false, { timeout: 20_000 });
    const narrowExpanded = join(output, `gateway-expanded-${locale}-light-720-${suffix}.png`);
    await page.screenshot({ path: narrowExpanded }); screenshots.push(narrowExpanded);
    await setTheme("dark");
    const narrowDark = join(output, `gateway-expanded-${locale}-dark-720-${suffix}.png`);
    await page.screenshot({ path: narrowDark }); screenshots.push(narrowDark);
    await clickGatewayButton(locale === "zh" ? "收起详情" : "Hide details");
    await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === true, { timeout: 20_000 });
    const narrowDarkCompact = join(output, `gateway-compact-${locale}-dark-720-${suffix}.png`);
    await page.screenshot({ path: narrowDarkCompact }); screenshots.push(narrowDarkCompact);
    await clickGatewayButton(locale === "zh" ? "详情" : "Details");
    await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === false, { timeout: 20_000 });
    await setTheme("light");
    await page.setViewport({ width: 1440, height: 900 });
    // Gateway -> DeepSeek again while Gateway is open: mutual exclusion.
    await clickOfficialButton(locale === "zh" ? "编辑" : "Edit");
    await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 20_000 });
    assert.equal(await gatewayExpanded(), false, `${locale}: official Edit closes an open Gateway Details`);
    await clickOfficialButton(locale === "zh" ? "取消" : "Cancel");
    // Reopen Settings: both cards return collapsed.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] nav'), { timeout: 20_000 });
    await openSettingsModels(locale);
    assert.equal(await gatewayExpanded(), false, `${locale}: reopening Settings restores collapsed Gateway`);
    assert.equal(await deepSeekEditing(), false, `${locale}: reopening Settings does not reopen DeepSeek editor`);
    await page.setViewport({ width: 1440, height: 900 });
    // General: language display, app/upstream version and real links.
    await clickDialogNav(locale === "zh" ? "通用设置" : "General");
    await page.waitForFunction(() => /dsh-base 0\.1\.0 · (Upstream|上游) DeepSeek Harness/u.test(document.querySelector('[role="dialog"]')?.innerText ?? ""), { timeout: 20_000 });
    const generalText = await page.$eval('[role="dialog"]', element => element.innerText);
    assert.match(generalText, locale === "zh" ? /当前版本：dsh-base 0\.1\.0 · 上游 DeepSeek Harness：dsh-v0\.2\.2-rc\.1/u : /Current version: dsh-base 0\.1\.0 · Upstream DeepSeek Harness: dsh-v0\.2\.2-rc\.1/u);
    const languageButton = await page.evaluate(() => {
      const button = [...document.querySelectorAll('[role="dialog"] button')].find(item => ["中文", "简体中文", "English"].includes((item.textContent ?? "").trim()));
      if (button === undefined) return null;
      const text = (button.textContent ?? "").trim(); button.click(); return text;
    });
    assert.equal(languageButton, locale === "zh" ? "简体中文" : "English", `${locale}: language current value`);
    await page.waitForSelector('[role="menuitem"]', { timeout: 10_000 });
    const languageMenu = await page.$$eval('[role="menuitem"]', items => items.map(item => (item.textContent ?? "").trim()));
    assert.ok(languageMenu.includes("简体中文"), `${locale}: language menu offers 简体中文`);
    assert.equal(languageMenu.includes("中文"), false, `${locale}: obsolete 中文 label absent`);
    const languageShot = join(output, `general-language-${locale}-${suffix}.png`);
    await page.screenshot({ path: languageShot }); screenshots.push(languageShot);
    await page.keyboard.press("Escape");
    const links = await page.$$eval('[role="dialog"] a[href]', elements => elements.map(element => ({ href: element.getAttribute('href'), text: element.textContent?.trim() })));
    const repoLink = links.find(link => link.text === "DeepSeek Harness");
    const tagLink = links.find(link => link.text === lock.tag);
    assert.ok(repoLink?.href.includes("github.com/deepseek-ai/deepseek-harness"));
    assert.ok(tagLink?.href.endsWith(`/releases/tag/${lock.tag}`));
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent?.trim() ?? "");
    assert.equal(brand, "dsh-base", `${locale}: sidebar brand has no version suffix`);
    const versionLine = locale === "zh" ? `当前版本：dsh-base ${appVersion} · 上游 DeepSeek Harness：${lock.tag}` : `Current version: dsh-base ${appVersion} · Upstream DeepSeek Harness: ${lock.tag}`;
    await page.evaluate(text => {
      const row = [...document.querySelectorAll('[role="dialog"] div')].find(element => element.textContent?.trim() === text);
      row?.scrollIntoView({ block: "center" });
    }, versionLine);
    await new Promise(resolve => setTimeout(resolve, 300));
    const generalShot = join(output, `general-language-version-${locale}-${suffix}.png`);
    await page.screenshot({ path: generalShot }); screenshots.push(generalShot);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] nav'), { timeout: 20_000 });
    // New independent test Session: only two selectable providers, default Gateway,
    // explicit Gateway selection survives reload, then restore the initial Gateway choice.
    await page.goto(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(testSession.sessionId)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
    const openModelMenu = async () => {
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-haspopup="menu"]')].some(item => /Select model|选择模型|DeepSeek-V4\.1-Flash/u.test(`${item.getAttribute("aria-label") ?? ""} ${item.textContent ?? ""}`)), { timeout: 60_000 });
      const chip = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(item => /Select model|选择模型|DeepSeek-V4\.1-Flash/u.test(`${item.getAttribute("aria-label") ?? ""} ${item.textContent ?? ""}`));
        if (button === undefined) return false;
        button.click(); return true;
      });
      assert.equal(chip, true, "composer model chip present");
      await new Promise(resolve => setTimeout(resolve, 300));
      const nested = await page.evaluate(() => {
        const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menuitem"]')].find(entry => /^Model|^模型/u.test((entry.textContent ?? "").trim()));
        if (item === undefined) return false;
        item.click(); return true;
      });
      if (nested) await page.waitForSelector('[data-menu-group]', { timeout: 20_000 });
      else await page.waitForSelector('[data-menu-group]', { timeout: 20_000 });
    };
    const groupState = () => page.evaluate(() => {
      const groups = [...document.querySelectorAll('[data-menu-group]')].map(section => ({
        label: section.querySelector('[data-menu-group-heading]')?.textContent?.trim() ?? "",
        items: [...section.querySelectorAll('[role="menuitemradio"]')].map(item => ({ label: item.textContent?.trim() ?? "", selected: item.getAttribute("aria-checked") === "true" })),
      }));
      const selected = [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map(item => ({ label: item.textContent?.trim() ?? "", group: item.closest('[data-menu-group]')?.querySelector('[data-menu-group-heading]')?.textContent?.trim() ?? "" }));
      return { groups, selected };
    });
    const selectModel = async (groupLabel, modelLabel) => {
      const picked = await page.evaluate((group, model) => {
        const section = [...document.querySelectorAll('[data-menu-group]')].find(item => (item.querySelector('[data-menu-group-heading]')?.textContent ?? "").trim() === group);
        const button = [...(section?.querySelectorAll('[role="menuitemradio"]') ?? [])].find(item => (item.textContent ?? "").includes(model));
        if (button === undefined) return false;
        button.click(); return true;
      }, groupLabel, modelLabel);
      assert.equal(picked, true, `select ${groupLabel}/${modelLabel}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    };
    await openModelMenu();
    const initial = await groupState();
    assert.deepEqual(initial.groups.map(group => group.label), ["DeepSeek", "Cloudflare AI Gateway"], `${locale}: exactly two provider groups`);
    assert.equal(initial.groups.some(group => /legacy/u.test(group.label)), false, `${locale}: legacy is not selectable`);
    assert.equal(initial.selected.length, 1, `${locale}: one selected model`);
    assert.equal(initial.selected[0].group, "Cloudflare AI Gateway", `${locale}: new session defaults to Gateway`);
    const menuShot = join(output, `composer-two-groups-${locale}-${suffix}.png`);
    await page.screenshot({ path: menuShot }); screenshots.push(menuShot);
    await selectModel("Cloudflare AI Gateway", "DeepSeek-V4-Pro");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
    await openModelMenu();
    const afterReload = await groupState();
    assert.equal(afterReload.selected.length, 1);
    assert.equal(afterReload.selected[0].group, "Cloudflare AI Gateway", `${locale}: Gateway selection survives reload`);
    assert.match(afterReload.selected[0].label, /DeepSeek-V4-Pro/u);
    await selectModel("Cloudflare AI Gateway", "DeepSeek-V4.1-Flash");
    await page.keyboard.press("Escape");
    locales.push({ locale, groups: initial.groups.map(group => group.label), defaultProvider: initial.selected[0].group, reloadProvider: afterReload.selected[0].group, compactRowHeight: compact.gateway.height, compactButtonHeight: compact.gateway.buttonHeight, officialExternalGap: officialGap.official, gatewayExternalGap: gatewayGap.gateway });
  }
} finally {
  await hostCall("settingsUpdate", { ns: "locale", patch: { preference: "en" } }).catch(() => undefined);
  await closeAcceptanceBrowser(browser);
}
assert.deepEqual(consoleErrors, [], "browser console errors");
assert.deepEqual(pageErrors, [], "browser page errors");
assert.deepEqual(promptRequests, [], "acceptance must send no prompt");
assert.deepEqual(claimRequests, [], "acceptance must not claim/start a model");
const report = {
  ok: true, testedAt: new Date().toISOString(), base, version: expectedVersion,
  runtimeVersion: runtime.versionId, readiness, appVersion, upstreamTag: lock.tag,
  settingsSessionId: settingsSession.sessionId, testSessionId: testSession.sessionId,
  providers: { gatewayAvailable: modelAccess.providers["cloudflare-ai-gateway"].available, deepseekAvailable: modelAccess.providers["deepseek-official"].available },
  locales, promptRequests: 0, claimRequests: 0, screenshots, consoleErrors, pageErrors,
};
writeFileSync(join(output, "latest.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, version: expectedVersion, runtimeVersion: runtime.versionId, locales: locales.map(item => item.locale), screenshots }));
