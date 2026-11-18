#!/usr/bin/env node
/** Isolated local Worker acceptance for the anonymous account launcher. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { DEPLOYMENT_MODELS } from "../../../packages/boot/dsh-base-model-declarations/src/index.ts";
import { prefixFor, LOCALE_IDS } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";
import { accountSignInCopy, unavailableReason } from "../../../packages/client/dsh-base-client-account-launcher/src/client/locales.ts";
import * as settingsCopy from "../../../packages/client/dsh-base-client-settings-navigation/src/client/locales.ts";
import { registerOfficialSourceHooks } from "../../../scripts/build/official-source-hook.mjs";
import {
  FIXED_AGENT_PRESET_ID,
  OFFICIAL_AGENT_PRESET_IDS,
} from "../../../packages/boot/dsh-base-agent-presets/src/index.ts";
import { fixedAgentPresetCopy } from "../../../packages/boot/dsh-base-agent-presets/src/availability.ts";
registerOfficialSourceHooks();
const officialAccountCopy = await import('@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts');
const officialModelsCopy = await import('@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts');

// Exact official settings.account labels for the two review locales; other
// locales assert binding by rejecting raw keys and untranslated English.
const EXPECTED = {
  en: { more: "More", menu: "Account menu", settings: "Settings", contactUs: "Feedback", signIn: "Sign in" },
  zh: { more: "更多", menu: "账号菜单", settings: "设置", contactUs: "意见反馈", signIn: "登录" },
};
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appVersion = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;
const versionLabel = locale => settingsCopy[locale]["general.currentVersion"].replace("{version}", appVersion);
const repoRoot = resolve(app, "../..");
const output = resolve(process.env.DSH_ACCEPTANCE_OUTPUT ?? join(repoRoot, ".artifacts/acceptance/account-launcher"));
mkdirSync(output, { recursive: true });
for (const stale of readdirSync(output)) if (/\.(png|json)$/u.test(stale)) rmSync(join(output, stale), { force: true });
const port = process.env.DSH_LOCAL_PORT ?? "5190";
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app, env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? "2026-10-30" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser, page;
const errors = [];
const observations = [];
const settingsTraffic = [];
const forbiddenPanelTraffic = [];
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
const urlFor = locale => `${base}${prefixFor(locale)}/`;

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Headless Chrome reports no hover capability; the desktop product always has
  // one, and the official Tooltip gates hover copy on (any-hover: hover).
  const launchOptions = acceptanceLaunchOptions();
  browser = await puppeteer.launch({
    ...launchOptions,
    args: [...(launchOptions.args ?? []), "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", error => errors.push(error.message));
  // Deterministic screenshots: pin both media features together. Emulating
  // prefers-color-scheme alone drops prefers-reduced-motion, which replays the
  // sidebar/panel enter animations mid-capture (half-transparent evidence).
  const setMedia = async scheme => {
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  };
  const settle = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));
  // The collapse animates the layout grid track; capture only at the 56px rail.
  const waitCollapsedRail = async () => {
    await page.waitForFunction(() => {
      const frame = document.querySelector("[data-sidebar-collapsed]");
      if (frame === null) return false;
      const track = Number.parseFloat(getComputedStyle(frame).gridTemplateColumns);
      return Number.isFinite(track) && Math.abs(track - 56) <= 0.5;
    }, { timeout: 15000 });
    // The rail content fades in after the track lands; stay past that fade.
    await settle(450);
  };
  await setMedia("light");
  assert.equal(await page.evaluate(() => matchMedia("(any-hover: hover)").matches), true,
    "hover-capability emulation is active for the disabled-tooltip evidence");
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (request.url().includes("/api/settings/")) settingsTraffic.push(request.url().replace(base, "")); });
  // P12 red line: opening/switching the anonymous panel must not touch owner APIs.
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(settings|account|plugin-manager|llm|credentials)(\/|$)/u.test(path)) forbiddenPanelTraffic.push(path);
  });

  const waitLauncher = async (locale, expectCollapsed = false) => {
    await page.waitForSelector('[data-signed-out="true"]', { timeout: 45000 });
    const trigger = await page.$eval('[data-signed-out="true"]', element => ({
      text: element.textContent.trim(),
      ariaLabel: element.getAttribute("aria-label"),
      ariaHaspopup: element.getAttribute("aria-haspopup"),
      collapsed: element.getAttribute("data-collapsed"),
      inSettingsArea: element.closest('[class*="settingsArea"]') !== null,
    }));
    const expected = EXPECTED[locale];
    assert.equal(trigger.collapsed, expectCollapsed ? "true" : "false", `${locale}: ${expectCollapsed ? "collapsed rail" : "wide sidebar"}`);
    const wideLabel = trigger.collapsed === "false";
    if (!wideLabel) assert.equal(trigger.text, "", `${locale}: collapsed rail shows the icon only`);
    if (expected !== undefined) {
      if (wideLabel) assert.equal(trigger.text, expected.more, `${locale}: More label comes from the official dictionary`);
      assert.equal(trigger.ariaLabel, expected.menu, `${locale}: aria-label comes from the official dictionary`);
    } else {
      assert.ok(trigger.text.length > 0 && trigger.text !== "more" && trigger.text !== "More", `${locale}: More label is translated`);
      assert.ok(trigger.ariaLabel.length > 0 && trigger.ariaLabel !== "menu", `${locale}: aria-label is translated`);
    }
    assert.equal(trigger.ariaHaspopup, "menu");
    assert.equal(trigger.inSettingsArea, true, `${locale}: launcher occupies sidebar.settings`);
    return trigger;
  };

  const openMenu = async (locale) => {
    await page.click('[data-signed-out="true"]');
    await page.waitForSelector('[role="menu"]', { timeout: 10000 });
    const menu = await page.evaluate(() => {
      const list = document.querySelector('[role="menu"]');
      const rows = [...list.querySelectorAll('[role="menuitem"]')].map(row => {
        const descriptionId = row.getAttribute("aria-describedby");
        return {
          text: row.textContent.trim(),
          ariaDisabled: row.getAttribute("aria-disabled"),
          nativeDisabled: row.hasAttribute("disabled"),
          description: descriptionId === null ? null : document.getElementById(descriptionId)?.textContent ?? null,
        };
      });
      return { className: list.className, rows };
    });
    const expected = EXPECTED[locale];
    assert.match(menu.className, /signedOutMenu/u, `${locale}: official signedOutMenu class`);
    if (expected !== undefined) {
      assert.deepEqual(menu.rows.map(row => row.text), [expected.settings, expected.contactUs, expected.signIn], `${locale}: official row order`);
    } else {
      assert.equal(menu.rows.length, 3, `${locale}: three rows`);
      for (const [index, key] of ["settings", "contactUs", "signIn"].entries()) {
        const text = menu.rows[index].text;
        assert.ok(text.length > 0, `${locale}: row ${index} has copy`);
        assert.notEqual(text, key, `${locale}: row ${index} is translated, not a raw key`);
      }
    }
    assert.deepEqual(menu.rows.map(row => row.ariaDisabled), [null, "true", null], `${locale}: only feedback is aria-disabled`);
    assert.deepEqual(menu.rows.map(row => row.nativeDisabled), [false, false, false], `${locale}: explained row stays hoverable`);
    assert.equal(menu.rows[1].description, unavailableReason(locale), `${locale}: localized disabled reason`);
    return menu;
  };

  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[role="menu"]') === null, { timeout: 5000 });
  };

  // Start at the origin so the stored anonymous preferences can be reset per case.
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  // Anonymous: 8 locales × light/dark, menu open on the light capture.
  for (const locale of LOCALE_IDS) {
    await page.evaluate(() => localStorage.clear());
    await setMedia("light");
    await page.goto(urlFor(locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    const trigger = await waitLauncher(locale);
    await openMenu(locale);
    await settle();
    await page.screenshot({ path: join(output, `anonymous-${locale}-light.png`) });
    await closeMenu();
    await setMedia("dark");
    await openMenu(locale);
    await settle();
    await page.screenshot({ path: join(output, `anonymous-${locale}-dark.png`) });
    await closeMenu();
    observations.push({ locale, trigger, menu: "verified" });
  }
  await setMedia("light");

  // Collapsed rail: official toggle, launcher keeps the 36px More row.
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitLauncher("en");
  await page.click("[data-sidebar-toggle]");
  await page.waitForSelector('[data-signed-out="true"][data-collapsed="true"]', { timeout: 10000 });
  await waitCollapsedRail();
  await page.screenshot({ path: join(output, "anonymous-en-collapsed.png") });
  await page.goto(urlFor("zh"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitLauncher("zh");
  await page.click("[data-sidebar-toggle]");
  await page.waitForSelector('[data-signed-out="true"][data-collapsed="true"]', { timeout: 10000 });
  await waitCollapsedRail();
  await page.screenshot({ path: join(output, "anonymous-zh-collapsed.png") });

  // Anonymous settings panel: official 800×800 shell, five sections, twelve General rows.
  const SECTIONS = ["account", "general", "models", "plugins", "agent-presets"];
  const GENERAL_ROWS = ["permission", "language", "appearance", "font-size", "transcript-view", "developer-tools", "shortcuts", "link-opening", "composer-enter", "performance-usage", "session-log", "current-version"];
  const DISABLED_ROWS = ["permission", "session-log"];
  const EDITABLE_ROWS = ["language", "appearance", "font-size", "transcript-view", "developer-tools", "shortcuts", "link-opening", "composer-enter", "performance-usage"];
  const openPanel = async (locale, expectCollapsed = false) => {
    await waitLauncher(locale, expectCollapsed);
    await openMenu(locale);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="menuitem"]:not([aria-disabled])')];
      rows[0].click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    // The panel keeps its React state across open/close, so a previous visit may
    // have left another section active; every probe below reads General.
    await page.evaluate(() => { document.querySelectorAll('[role="dialog"] nav button')[1]?.click(); });
    await page.waitForSelector('[data-anonymous-row="current-version"]', { timeout: 10000 });
    // The launcher menu fades out after the settings row activates; wait for it
    // so the later language-menu lookup cannot match that dismissed list.
    await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length === 0, { timeout: 10000 });
    const reason = unavailableReason(locale);
    const panel = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const described = element => {
        const id = element.getAttribute("aria-describedby");
        return id === null ? null : (document.getElementById(id)?.textContent ?? null);
      };
      const titleId = dialog.getAttribute("aria-labelledby");
      return {
        width: Math.round(dialog.getBoundingClientRect().width),
        title: titleId === null ? null : (document.getElementById(titleId)?.textContent ?? null),
        sections: [...dialog.querySelectorAll("nav button")].map(element => ({
          label: element.textContent.trim(),
          disabled: element.getAttribute("aria-disabled"),
          current: element.getAttribute("aria-current"),
          reason: described(element),
          icon: element.querySelector("svg") !== null,
        })),
        rows: (general => {
          const classify = element => {
            if (element.matches("[data-anonymous-row]")) return element.getAttribute("data-anonymous-row");
            if (element.querySelector("button[aria-pressed]") !== null) return "appearance";
            if (element.querySelector('[class*="stepper"]') !== null) return "font-size";
            if (element.querySelector('[aria-haspopup="menu"]') !== null) return "language";
            return "unknown";
          };
          return [...general.children].map(element => {
            const marked = element.matches("[data-anonymous-row]");
            return {
              id: classify(element),
              disabled: element.getAttribute("data-disabled"),
              editable: element.getAttribute("data-editable") ?? (marked ? null : "true"),
              readonly: element.getAttribute("data-readonly"),
              ariaDisabled: element.getAttribute("aria-disabled"),
              nativeDisabled: element instanceof HTMLFieldSetElement ? element.disabled : null,
              reason: described(element),
              text: (element.textContent ?? "").trim(),
            };
          });
        })(document.querySelector('[data-anonymous-row="current-version"]').parentElement),
      };
    });
    assert.equal(panel.width, 800, `${locale}: official 800px settings panel`);
    assert.equal(panel.sections.length, SECTIONS.length, `${locale}: five sections rendered`);
    assert.deepEqual(panel.sections.map(row => row.disabled), [null, null, null, null, null], `${locale}: all five sections are switchable`);
    assert.equal(panel.sections[1].current, "true", `${locale}: General is the active section`);
    assert.ok(panel.sections.every(row => row.icon), `${locale}: every section renders its official icon`);
    if (EXPECTED[locale] !== undefined) {
      assert.equal(panel.title, EXPECTED[locale].settings, `${locale}: panel title comes from the official settings dictionary`);
    }
    assert.deepEqual(panel.rows.map(row => row.id), GENERAL_ROWS, `${locale}: twelve General rows in official order`);
    assert.deepEqual(panel.rows.filter(row => row.disabled === "true").map(row => row.id), DISABLED_ROWS, `${locale}: two account-scoped rows stay disabled`);
    assert.deepEqual(panel.rows.filter(row => row.editable === "true").map(row => row.id), EDITABLE_ROWS, `${locale}: nine usable rows`);
    assert.deepEqual(panel.rows.filter(row => row.readonly === "true").map(row => row.id), ["current-version"], `${locale}: one read-only row`);
    for (const row of panel.rows.filter(entry => entry.disabled === "true")) {
      assert.equal(row.ariaDisabled, "true", `${locale}: ${row.id} exposes aria-disabled`);
      assert.equal(row.nativeDisabled, true, `${locale}: ${row.id} is inside a disabled fieldset`);
      assert.equal(row.reason, reason, `${locale}: ${row.id} exposes the localized reason`);
    }
    const version = panel.rows.find(row => row.id === "current-version");
    assert.equal(version.text, versionLabel(locale), `${locale}: version row shows the real app version`);
    const structure = await page.evaluate(() => {
      const general = document.querySelector('[data-anonymous-row="current-version"]').parentElement;
      const unmarked = [...general.children].filter(element => !element.matches("[data-anonymous-row]"));
      const language = unmarked.find(element => element.querySelector('[aria-haspopup="menu"]') !== null);
      const appearance = unmarked.find(element => element.querySelector("button[aria-pressed]") !== null);
      const fonts = unmarked.find(element => element.querySelector('[class*="stepper"]') !== null);
      return {
        languageSelectors: language.querySelectorAll('[aria-haspopup="menu"]').length,
        themeCubes: appearance.querySelectorAll("button[aria-pressed]").length,
        stepperArrows: fonts.querySelectorAll('[class*="stepper"] button').length,
      };
    });
    assert.equal(structure.languageSelectors, 1, `${locale}: official language row`);
    assert.equal(structure.themeCubes, 3, `${locale}: official appearance cubes`);
    assert.ok(structure.stepperArrows >= 2, `${locale}: official font stepper`);
    // Every row keeps the official separator; the font group must not lose its
    // bottom border because a wrapper became its parent's last child.
    const separators = await page.evaluate(() => {
      const general = document.querySelector('[data-anonymous-row="current-version"]').parentElement;
      const children = [...general.children];
      const unmarked = element => !element.matches("[data-anonymous-row]");
      const language = children.find(element => unmarked(element) && element.querySelector('[aria-haspopup="menu"]') !== null);
      const fonts = children.find(element => unmarked(element) && element.querySelector('[class*="stepper"]') !== null);
      const border = element => {
        const style = getComputedStyle(element);
        return { width: style.borderBottomWidth, line: style.borderBottomStyle, color: style.borderBottomColor };
      };
      return { language: border(language), fontLast: border(fonts.lastElementChild) };
    });
    assert.ok(Number.parseFloat(separators.fontLast.width) > 0, `${locale}: font row keeps its bottom separator`);
    assert.equal(separators.fontLast.line, "solid", `${locale}: font separator stays an official solid border`);
    assert.equal(separators.fontLast.color, separators.language.color, `${locale}: font separator uses the same border token`);
    observations.push({ locale, sections: panel.sections.map(row => row.label), rows: panel.rows.length, disabledRows: DISABLED_ROWS.length, version, separators });
    return panel;
  };
  for (const locale of LOCALE_IDS) {
    await page.evaluate(() => localStorage.clear());
    await setMedia("light");
    await page.goto(urlFor(locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    await openPanel(locale);
    await page.evaluate(() => { document.querySelector('[role="dialog"] button[aria-pressed]').click(); });
    await page.waitForFunction(() => document.documentElement.style.colorScheme === "light", { timeout: 5000 });
    await settle();
    await page.screenshot({ path: join(output, `panel-${locale}-light.png`) });
    await page.evaluate(() => { document.querySelectorAll('[role="dialog"] button[aria-pressed]')[1].click(); });
    await page.waitForFunction(() => document.documentElement.style.colorScheme === "dark", { timeout: 5000 });
    await settle();
    await page.screenshot({ path: join(output, `panel-${locale}-dark.png`) });
    observations.push({ locale, panel: "verified", light: true, dark: true });
  }
  await setMedia("light");

  // A+B: five sections switch; anonymous Account exposes the full official layout plus separate local sign-in.
  const switchSection = async index => {
    await page.evaluate(position => { document.querySelectorAll('[role="dialog"] nav button')[position].click(); }, index);
    await settle(400);
  };
  const modelObservations = [];
  const verifyAnonymousModels = async locale => {
    const official = officialModelsCopy[locale];
    const modelRoot = '[data-anonymous-models]';
    const provider = `${modelRoot} [data-public-provider="deepseek-official"]`;
    await page.waitForSelector(`${provider} input[type="password"]`, { timeout: 15000 });
    const requestMark = forbiddenPanelTraffic.length;
    const state = await page.$eval(modelRoot, root => ({
      title: root.querySelector('h2')?.textContent.trim(), intro: root.querySelector('h2 + p')?.textContent.trim(),
      providers: [...root.querySelectorAll('[data-public-provider]')].map(element => element.getAttribute('data-public-provider')),
      gateway: root.querySelector('[data-gateway-provider]')?.getAttribute('data-gateway-provider'),
      configuredDots: root.querySelectorAll('[class*="credentialDotConfigured"], [data-tone="success"]').length,
      passwordDisabled: root.querySelector('input[type="password"]')?.disabled,
      writeEnabled: [...root.querySelectorAll('input, select, textarea')].filter(element => !element.disabled).length,
      oldLists: root.querySelectorAll('[data-model-provider], [data-model-id]').length,
    }));
    assert.equal(state.title, official.title); assert.equal(state.intro, official.intro);
    assert.deepEqual(state.providers, ['deepseek-official', 'cloudflare-ai-gateway']);
    assert.equal(state.gateway, 'signed-out'); assert.equal(state.configuredDots, 0);
    assert.equal(state.passwordDisabled, true); assert.equal(state.writeEnabled, 0); assert.equal(state.oldLists, 0);
    const clickLabel = async (scope, label) => {
      const button = await page.$(`${scope} button`);
      assert.ok(button, `${locale}: buttons exist in ${scope}`);
      const clicked = await page.$eval(scope, (root, text) => {
        const button = [...root.querySelectorAll('button')].find(element => element.textContent.trim() === text);
        if (!button) return false; button.click(); return true;
      }, label);
      assert.equal(clicked, true, `${locale}: ${label} is visible`);
    };
    await clickLabel(provider, official.apply);
    assert.equal(await page.$('[data-auth-dialog]'), null, 'disabled save does not issue a mutation or imply success');
    await clickLabel(provider, official.cancel);
    await page.waitForSelector(`${provider} input[type="password"]`, { hidden: true });
    await clickLabel(provider, official.edit);
    await page.waitForSelector(`${provider} input[type="password"]`);
    await page.$eval(`${provider} summary`, element => element.click());
    const expanded = await page.$eval(provider, (root, copy) => ({
      open: root.querySelector('details')?.open,
      controls: [...root.querySelectorAll('input, select, textarea')].map(element => ({ disabled: element.disabled, value: element.value, label: element.getAttribute('aria-label') })),
      modelIds: [...root.querySelectorAll('input[aria-label]')].filter(element => element.getAttribute('aria-label').startsWith(copy.modelId)).map(element => element.value),
      saveDisabled: [...root.querySelectorAll('button')].find(element => element.textContent.trim() === copy.apply)?.disabled,
    }), official);
    assert.equal(expanded.open, true); assert.equal(expanded.saveDisabled, true);
    assert.ok(expanded.controls.length > 3 && expanded.controls.every(control => control.disabled));
    assert.deepEqual(expanded.modelIds, DEPLOYMENT_MODELS.map(model => model.id), `${locale}: only public declared DeepSeek models`);
    const gateway = `${modelRoot} [data-gateway-provider="signed-out"]`;
    await page.click(`${gateway} button`);
    const gatewayDetails = await page.$eval(gateway, element => {
      const button = element.querySelector('button'), region = document.getElementById(button.getAttribute('aria-controls'));
      return { expanded: button.getAttribute('aria-expanded'), hidden: region.hidden, text: region.textContent.trim(),
        status: region.querySelector('[role="status"]')?.textContent.trim(), configuredDots: element.querySelectorAll('[class*="credentialDot"]').length };
    });
    assert.equal(gatewayDetails.expanded, 'true'); assert.equal(gatewayDetails.hidden, false); assert.equal(gatewayDetails.configuredDots, 0);
    assert.ok(gatewayDetails.status.length > 0);
    for (const model of DEPLOYMENT_MODELS) assert.ok(gatewayDetails.text.includes(model.label), `${locale}: declared Gateway model ${model.id}`);
    if (locale !== 'en') assert.notEqual(gatewayDetails.status, 'Sign in to view', `${locale}: Gateway anonymous status is localized`);
    await page.click(`${gateway} button`);
    const before = page.url();
    const add = `${modelRoot} [class*="addButton"]`;
    assert.equal(await page.$eval(add, element => element.disabled), false, 'Add model provider remains a visible login-gated action');
    await page.click(add); await page.waitForSelector('[role="dialog"]:has([data-auth-dialog])', { visible: true });
    assert.equal(page.url(), before);
    assert.equal(await page.$(`${modelRoot} [class*="addCard"]`), null, 'login precedes any new provider draft');
    await page.keyboard.press('Escape'); await page.waitForSelector('[data-auth-dialog]', { hidden: true });
    assert.ok(await page.$('[role="dialog"] nav'), 'closing login retains Settings');
    assert.equal(await page.$eval(add, element => element === document.activeElement), true, 'login returns focus to Add model provider');
    assert.equal(forbiddenPanelTraffic.length, requestMark, 'browsing readonly editors and gated Add never requests owner data');
    modelObservations.push({ locale, state, expanded, gatewayDetails, loginGate: true, privateRequests: 0 });
  };
  const sectionProbe = [];
  for (const locale of LOCALE_IDS) {
    await page.evaluate(() => localStorage.clear());
    await setMedia("light");
    await page.goto(urlFor(locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    await openPanel(locale);
    const requestMark = forbiddenPanelTraffic.length;
    for (const index of [0, 2, 3, 4, 1, 0]) {
      await switchSection(index);
      const state = await page.evaluate(() => ({
        active: document.querySelector('[role="dialog"] nav button[aria-current="true"]')?.textContent.trim() ?? null,
        accountCard: document.querySelector('[data-dsh-base-account-sign-in]') !== null,
      }));
      sectionProbe.push({ locale, switchTo: SECTIONS[index], ...state });
      if (index === 2) await verifyAnonymousModels(locale);
    }
    const account = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const platform = dialog.querySelector('[data-anonymous-platform-account]');
      const official = platform.querySelector('section');
      const local = dialog.querySelector('[data-dsh-base-account-sign-in]');
      const platformBox = platform.getBoundingClientRect(), localBox = local.getBoundingClientRect();
      return {
        title: official.querySelector('[class*="name"]')?.textContent?.trim(),
        description: official.querySelector('[role="status"]')?.textContent?.trim(),
        presentation: official.getAttribute('data-account-presentation'),
        rows: [...official.querySelectorAll('[class*="row"] > span:first-child')].map(element => element.textContent.trim()),
        placeholders: [...official.querySelectorAll('[class*="unavailable"]')].map(element => element.textContent.trim()),
        controls: [...official.querySelectorAll('a')].map(element => ({ label: element.textContent.trim(), href: element.getAttribute('href'), disabled: element.getAttribute('aria-disabled'), tabIndex: element.tabIndex, opacity: getComputedStyle(element).opacity })),
        unexpectedAuth: official.querySelectorAll('[class*="actions"], button, [class*="signedOutContent"]').length,
        platformDisabled: platform.matches('fieldset:disabled'),
        platformReason: platform.getAttribute('title'), platformDescription: platform.getAttribute('aria-description'),
        oldRows: dialog.querySelectorAll('[data-anonymous-account-row], [data-anonymous-account-extras]').length,
        localText: local.textContent.trim(), localSignIn: local.querySelector('[data-dsh-base-sign-in]')?.textContent.trim(),
        localEnabled: local.querySelector('[data-dsh-base-sign-in]')?.matches(':enabled'),
        appended: !!(platform.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING),
        separated: localBox.top >= platformBox.bottom - 0.5,
        officialLayout: { display: getComputedStyle(official).display, flexDirection: getComputedStyle(official).flexDirection, gap: getComputedStyle(official).gap, padding: getComputedStyle(official).padding },
      };
    });
    const officialCopy = officialAccountCopy[locale], localCopy = accountSignInCopy(locale);
    assert.equal(account.title, officialCopy.signedOut, `${locale}: identity truthfully remains signed out`);
    assert.equal(account.description, officialCopy.signInDescription, `${locale}: original official anonymous status`);
    assert.equal(account.presentation, 'full-unavailable');
    assert.deepEqual(account.rows, [officialCopy.balance, officialCopy.bonusBalance, officialCopy.more]);
    assert.deepEqual(account.placeholders, [officialCopy.balanceSignedOut, officialCopy.balanceSignedOut]);
    assert.deepEqual(account.controls.map(control => control.label), [officialCopy.accountInfo, officialCopy.usage, officialCopy.topUp]);
    assert.ok(account.controls.every(control => control.href === null && control.disabled === 'true' && control.tabIndex === -1 && control.opacity === '0.4'), `${locale}: all account-dependent destinations are visible but unavailable`);
    assert.equal(account.unexpectedAuth, 0, 'no fictitious pending authentication or duplicate Platform sign-in');
    assert.equal(account.platformDisabled, true, `${locale}: unconnected Platform remains unavailable`);
    assert.equal(account.platformReason, localCopy.platformUnavailable); assert.equal(account.platformDescription, localCopy.platformUnavailable);
    assert.equal(account.oldRows, 0, `${locale}: obsolete billing placeholders are removed`);
    assert.ok(account.localText.includes(localCopy.title) && account.localText.includes(localCopy.description));
    assert.equal(account.localSignIn, localCopy.signIn); assert.equal(account.localEnabled, true);
    assert.equal(account.appended, true); assert.equal(account.separated, true, `${locale}: local sign-in is below the official region`);
    assert.deepEqual(account.officialLayout, { display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0px' }, 'official full section layout has no host overrides');
    const accountUrl = page.url();
    for (const control of await page.$$('[data-anonymous-platform-account] a')) {
      await control.click(); await control.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
      await control.evaluate(element => element.click());
    }
    assert.equal(await page.$('[data-auth-dialog]'), null, 'unavailable Platform controls do not open local authentication');
    assert.equal(page.url(), accountUrl);
    await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await settle(250);
    await page.screenshot({ path: join(output, `panel-account-${locale}-light.png`) });
    await switchSection(1);
    await page.evaluate(() => { document.querySelectorAll('[role="dialog"] button[aria-pressed]')[1].click(); });
    await page.waitForFunction(() => document.documentElement.style.colorScheme === "dark", { timeout: 5000 });
    await switchSection(0);
    await settle(250);
    await page.screenshot({ path: join(output, `panel-account-${locale}-dark.png`) });
    assert.equal(forbiddenPanelTraffic.length, requestMark, `${locale}: section switching issued no owner-API request`);
    observations.push({ locale, accountSection: account, sectionSwitch: sectionProbe.filter(entry => entry.locale === locale) });
  }
  assert.equal(new Set(modelObservations.map(row => row.gatewayDetails.status)).size, LOCALE_IDS.length, "all eight Gateway anonymous statuses are localized");
  const anonymousModelApis = [];
  for (const [endpoint, args] of [
    ['settings/describe', []],
    ['settings/mutate', ['llm-deepseek', [{ op: 'set', path: ['baseURL'], value: 'https://fixture.invalid/v1' }], 0]],
    ['credentials/describe', [['DEEPSEEK_OFFICIAL_API_KEY']]],
    ['credentials/set', ['DEEPSEEK_OFFICIAL_API_KEY', 'not-a-real-key']],
    ['credentials/unset', ['DEEPSEEK_OFFICIAL_API_KEY']],
    ['llm/discoverModels', ['llm-deepseek', { provider: 'deepseek-official' }]],
  ]) {
    const response = await request(`/api/${endpoint}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'anonymous-models-audit', method: endpoint, payload: { args } }) });
    assert.equal(response.status, 401, `${endpoint}: public declarations grant no account access`);
    anonymousModelApis.push({ endpoint, status: response.status });
  }
  observations.push({ anonymousModels: modelObservations, anonymousModelApis });
  observations.push({ p12PanelTraffic: { settingsRequests: [...settingsTraffic], ownerRequests: [...forbiddenPanelTraffic] } });
  // The appended local-account action owns local authentication; Platform stays separate.
  await page.evaluate(() => localStorage.clear());
  await setMedia("light");
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await openPanel("en");
  await switchSection(0);
  const accountUrl = page.url();
  await page.click('[data-dsh-base-sign-in]');
  await page.waitForSelector('[role="dialog"]:has([data-auth-dialog])', { visible: true });
  assert.equal(page.url(), accountUrl, "account sign-in opens the shared modal in place");
  await page.keyboard.press('Escape'); await page.waitForSelector('[data-auth-dialog]', { hidden: true });
  assert.ok(await page.$('[role="dialog"] nav'), 'closing local login preserves Settings');
  assert.equal(await page.$eval('[data-dsh-base-sign-in]', element => document.activeElement === element), true, 'local login returns focus to its own appended action');
  observations.push({ accountSignIn: "appended local-account action", navigation: false, restoredFocus: true });
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await setMedia("light");

  // The six client-only preferences run on official classes over the shared
  // forms; verify each write, the local document bytes, and the remapped key.
  await page.evaluate(() => localStorage.clear());
  await setMedia("light");
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  // Developer tools is observable on the blank shell: the official Agent-preset
  // menu filters coding-tool presets while the shared preference is off.
  const presetMenu = async () => {
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(element => /cloudflare think/iu.test(element.textContent ?? ""));
      if (button === undefined) return false;
      button.click();
      return true;
    });
    await settle(400);
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(row => row.textContent.trim()));
    await page.keyboard.press("Escape");
    await settle(250);
    return { clicked, items };
  };
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(element => /cloudflare think/iu.test(element.textContent ?? "")), { timeout: 45000 });
  const presetBefore = await presetMenu();
  assert.equal(presetBefore.clicked, true, "the composer preset trigger is present");
  assert.equal(presetBefore.items.length, 5, "developer tools on: all five presets are listed");
  assert.ok(presetBefore.items.some(text => /PTC mode/u.test(text)) && presetBefore.items.some(text => /Minimal mode/u.test(text)), "coding-tool presets are listed while developer tools are on");
  await openPanel("en");
  const chooseOption = async (row, buttonIndex, itemIndex) => {
    const selector = `[data-anonymous-row="${row}"] [aria-haspopup="menu"]`;
    await page.waitForFunction(({ selector, buttonIndex }) => document.querySelectorAll(selector).length > buttonIndex, { timeout: 10000 }, { selector, buttonIndex });
    await page.evaluate(({ selector, buttonIndex }) => { document.querySelectorAll(selector)[buttonIndex].click(); }, { selector, buttonIndex });
    await page.waitForFunction(({ itemIndex }) => document.querySelectorAll('[role="menu"] [role="menuitem"]').length > itemIndex, { timeout: 10000 }, { itemIndex });
    await settle(250);
    await page.evaluate(({ itemIndex }) => { [...document.querySelectorAll('[role="menu"] [role="menuitem"]')][itemIndex].click(); }, { itemIndex });
    await settle(400);
  };
  await chooseOption("transcript-view", 0, 3);
  await chooseOption("link-opening", 0, 1);
  await chooseOption("composer-enter", 0, 1);
  await chooseOption("performance-usage", 0, 0);
  await page.evaluate(() => { document.querySelector('[data-anonymous-row="developer-tools"] [role="switch"]').click(); });
  await settle(500);
  const clientPreferences = await page.evaluate(() => ({
    sections: JSON.parse(localStorage.getItem("dsh-base.anonymous-settings.v1") ?? "null")?.sections ?? null,
    rows: Object.fromEntries([...document.querySelectorAll("[data-anonymous-row]")].map(element => [
      element.getAttribute("data-anonymous-row"), (element.textContent ?? "").trim(),
    ])),
    developerToolsChecked: document.querySelector('[data-anonymous-row="developer-tools"] [role="switch"]')?.getAttribute("aria-checked"),
  }));
  assert.deepEqual(clientPreferences.sections["ui-chat"], {
    transcriptView: "verbose", linkOpening: "new-tab", performanceUsage: "compact",
  }, "chat preferences were accepted into the anonymous local document");
  assert.deepEqual(clientPreferences.sections["ui-conversation"], { busyEnter: "steer" }, "composer preference was accepted");
  assert.deepEqual(clientPreferences.sections["ui-settings"], { enabled: false }, "developer-tools preference was accepted");
  assert.match(clientPreferences.rows["transcript-view"], /Verbose/u);
  assert.match(clientPreferences.rows["link-opening"], /Default Browser/u);
  assert.match(clientPreferences.rows["composer-enter"], /Steer/u);
  assert.match(clientPreferences.rows["performance-usage"], /Compact/u);
  assert.equal(clientPreferences.developerToolsChecked, "false");
  observations.push({ clientPreferences });
  await page.keyboard.press("Escape");
  await settle(400);
  const presetAfter = await presetMenu();
  assert.equal(presetAfter.items.length, 3, "developer tools off: coding-tool presets leave the official list");
  assert.ok(!presetAfter.items.some(text => /PTC mode|Minimal mode/u.test(text)), "PTC and Minimal are filtered when developer tools are off");
  observations.push({ developerToolsEffect: { before: presetBefore.items, after: presetAfter.items } });
  await openPanel("en");
  // Shortcuts: remap through the official reference dialog, then use the new chord.
  await page.evaluate(() => { document.querySelector('[data-anonymous-row="shortcuts"] button').click(); });
  await page.waitForSelector('[aria-label="Close keyboard shortcuts"]', { timeout: 10000 });
  await settle(400);
  await page.evaluate(() => { document.querySelector('[aria-label^="Edit shortcut for"]').click(); });
  await page.waitForSelector('[data-shortcut-modal="shortcut-edit"]', { timeout: 5000 });
  await settle(200);
  await page.keyboard.down("Meta");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyK");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Meta");
  await page.waitForFunction(() => localStorage.getItem("dsh.keybindings.v1") !== null, { timeout: 5000 });
  const keybindings = await page.evaluate(() => JSON.parse(localStorage.getItem("dsh.keybindings.v1")));
  assert.deepEqual(keybindings.profiles["web:macos"]["shortcuts.open"], { code: "KeyK", modifiers: ["shift", "meta"] }, "the official shortcut document stores the new chord");
  await page.evaluate(() => { document.querySelector('[aria-label="Close keyboard shortcuts"]').click(); });
  await page.waitForFunction(() => document.querySelector('[aria-label="Close keyboard shortcuts"]') === null, { timeout: 5000 });
  const pressShortcut = async () => {
    await page.keyboard.down("Meta");
    await page.keyboard.down("Shift");
    await page.keyboard.press("KeyK");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Meta");
  };
  await pressShortcut();
  await page.waitForSelector('[aria-label="Close keyboard shortcuts"]', { timeout: 10000 });
  observations.push({ shortcuts: { chord: "Meta+Shift+K", immediateReopen: true, document: keybindings.profiles["web:macos"]["shortcuts.open"] } });
  await page.evaluate(() => { document.querySelector('[aria-label="Close keyboard shortcuts"]').click(); });
  await settle(400);
  // Persistence across a reload: settings document and the official keybinding file.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(1500);
  await pressShortcut();
  const shortcutAfterReload = await page.evaluate(() => document.querySelector('[aria-label="Close keyboard shortcuts"]') !== null);
  assert.equal(shortcutAfterReload, true, "the remapped chord still opens the reference after reload");
  await page.keyboard.press("Escape");
  await settle(400);
  await openPanel("en");
  const persisted = await page.evaluate(() => ({
    sections: JSON.parse(localStorage.getItem("dsh-base.anonymous-settings.v1") ?? "null")?.sections ?? null,
    rows: Object.fromEntries([...document.querySelectorAll("[data-anonymous-row]")].map(element => [
      element.getAttribute("data-anonymous-row"), (element.textContent ?? "").trim(),
    ])),
    developerToolsChecked: document.querySelector('[data-anonymous-row="developer-tools"] [role="switch"]')?.getAttribute("aria-checked"),
  }));
  assert.match(persisted.rows["transcript-view"], /Verbose/u, "work details survive a reload");
  assert.match(persisted.rows["link-opening"], /Default Browser/u, "link opening survives a reload");
  assert.match(persisted.rows["composer-enter"], /Steer/u, "enter behavior survives a reload");
  assert.match(persisted.rows["performance-usage"], /Compact/u, "performance detail survives a reload");
  assert.equal(persisted.developerToolsChecked, "false", "developer tools survive a reload");
  assert.equal(shortcutAfterReload, true);
  observations.push({ preferencesPersistence: persisted, shortcutAfterReload });
  await page.keyboard.press("Escape");
  await settle(300);

  // Bottom evidence: all twelve rows are reachable and the scroll area keeps its 24px inset.
  const bottomEvidence = [];
  for (const scheme of ["light", "dark"]) {
    await page.evaluate(() => localStorage.clear());
    await setMedia(scheme);
    await page.goto(urlFor("zh"), { waitUntil: "domcontentloaded", timeout: 60000 });
    await openPanel("zh");
    await page.evaluate(dark => {
      document.querySelectorAll('[role="dialog"] button[aria-pressed]')[dark ? 1 : 0].click();
    }, scheme === "dark");
    await page.waitForFunction(expected => document.documentElement.style.colorScheme === expected, { timeout: 5000 }, scheme);
    const scroll = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const options = dialog.lastElementChild;
      options.scrollTop = options.scrollHeight;
      const version = dialog.querySelector('[data-anonymous-row="current-version"]');
      const optionsRect = options.getBoundingClientRect();
      return {
        scrollTop: options.scrollTop,
        scrollHeight: options.scrollHeight,
        clientHeight: options.clientHeight,
        paddingBottom: getComputedStyle(options).paddingBottom,
        versionVisible: version.getBoundingClientRect().bottom <= optionsRect.bottom + 1,
        versionText: version.textContent.trim(),
        disabledRows: dialog.querySelectorAll('[data-anonymous-row][data-disabled="true"]').length,
      };
    });
    assert.ok(scroll.scrollTop > 0, `zh ${scheme}: the General column scrolls`);
    assert.equal(scroll.paddingBottom, "24px", `zh ${scheme}: official 24px bottom inset`);
    assert.equal(scroll.versionVisible, true, `zh ${scheme}: the version row is reachable at the bottom`);
    assert.equal(scroll.disabledRows, 2, `zh ${scheme}: both account-scoped rows stay mounted and disabled`);
    assert.equal(scroll.versionText, versionLabel("zh"), `zh ${scheme}: version row stays readable at the bottom`);
    await settle();
    await page.screenshot({ path: join(output, `panel-zh-bottom-${scheme}.png`) });
    bottomEvidence.push({ scheme, ...scroll });
  }
  observations.push({ panelBottom: bottomEvidence });
  await setMedia("light");

  // Disabled hover evidence: the official Tooltip explains the reason.
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await openPanel("en");
  const permissionBox = await (await page.$('[data-anonymous-row="permission"]')).boundingBox();
  await page.mouse.move(permissionBox.x + 24, permissionBox.y + 20);
  await page.waitForSelector('[role="tooltip"]', { timeout: 10000 });
  assert.equal(await page.$eval('[role="tooltip"]', element => element.textContent.trim()), unavailableReason("en"), "en: disabled row hover shows the localized reason");
  await settle(150);
  await page.screenshot({ path: join(output, "panel-en-disabled-row-hover.png") });
  await page.goto(urlFor("zh"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await openPanel("zh");
  const permissionBoxZh = await (await page.$('[data-anonymous-row="permission"]')).boundingBox();
  await page.mouse.move(permissionBoxZh.x + 24, permissionBoxZh.y + 20);
  await page.waitForSelector('[role="tooltip"]', { timeout: 10000 });
  assert.equal(await page.$eval('[role="tooltip"]', element => element.textContent.trim()), unavailableReason("zh"), "zh: disabled row hover shows the localized reason");
  await settle(150);
  await page.screenshot({ path: join(output, "panel-zh-disabled-row-hover.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });

  // Font size tier: official stepper writes through the anonymous local document.
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await openPanel("en");
  await page.evaluate(() => { document.querySelector('[role="dialog"] [class*="stepper"]').scrollIntoView({ block: "center" }); });
  await settle(200);
  const fontBefore = await page.evaluate(() => document.body.style.getPropertyValue("--dsh-content-font-size"));
  await page.evaluate(() => { document.querySelector('[role="dialog"] [class*="stepper"] button').click(); });
  await page.waitForFunction(() => document.body.style.getPropertyValue("--dsh-content-font-size") !== "", { timeout: 5000 });
  const fontAfter = await page.evaluate(() => document.body.style.getPropertyValue("--dsh-content-font-size"));
  assert.notEqual(fontAfter, fontBefore, "font stepper changes the official size variable");
  await settle();
  await page.screenshot({ path: join(output, "panel-en-fontsize.png") });
  const storedFont = await page.evaluate(() => JSON.parse(localStorage.getItem("dsh-base.anonymous-settings.v1") ?? "{}").sections?.["ui-theme"]?.fontSize);
  assert.equal(typeof storedFont, "number", "font size persisted to the anonymous local document");
  observations.push({ fontBefore, fontAfter, storedFont });
  // Theme write through the panel, in the same document as the font write.
  await page.evaluate(() => { document.querySelectorAll('[role="dialog"] button[aria-pressed]')[1].click(); });
  await page.waitForFunction(() => document.documentElement.style.colorScheme === "dark", { timeout: 5000 });

  // Panel language switch updates the URL prefix and the document language.
  await page.evaluate(() => { document.querySelector('[role="dialog"] [aria-haspopup="menu"]:not(:disabled)').click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(row => row.textContent.includes("中文")), { timeout: 10000 });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="menuitem"]')];
    const zh = rows.find(row => row.textContent.includes("中文"));
    zh.click();
  });
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN", { timeout: 10000 });
  assert.match(await page.evaluate(() => location.pathname), /^\/zh-CN(?:\/|$)/u, "language switch updates the URL prefix");

  const storedPreferences = await page.evaluate(() => JSON.parse(localStorage.getItem("dsh-base.anonymous-settings.v1") ?? "{}").sections ?? {});
  assert.equal(storedPreferences.locale?.preference, "zh", "language write reached the local document");
  assert.equal(storedPreferences["ui-theme"]?.preference, "dark", "theme write reached the local document");

  // Escape closes the panel and returns focus to the launcher trigger.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-signed-out") === "true", { timeout: 5000 });
  observations.push({ panelKeyboard: "escape closes and focus returns" });

  // Reload keeps the panel-written theme, font size and language (browser write path).
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitLauncher("zh");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN", { timeout: 10000 });
  await page.waitForFunction(() => document.documentElement.style.colorScheme === "dark", { timeout: 10000 });
  await page.waitForFunction(() => document.body.style.getPropertyValue("--dsh-content-font-size") === "15px", { timeout: 10000 });
  const afterReload = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    colorScheme: document.documentElement.style.colorScheme,
    contentFontSize: document.body.style.getPropertyValue("--dsh-content-font-size"),
  }));
  assert.deepEqual(afterReload, { lang: "zh-CN", colorScheme: "dark", contentFontSize: "15px" }, "panel preferences survive a reload");
  observations.push({ panelPersistence: afterReload });

  // P12 C–E: all five sections open with real content, the owner APIs stay
  // silent, and the settings ledger stays empty (guard).
  const P12_SECTIONS = [
    { id: "account", index: 0 },
    { id: "general", index: 1 },
    { id: "models", index: 2 },
    { id: "plugins", index: 3 },
    { id: "agent-presets", index: 4 },
  ];
  const contentHash = () => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    // The shell's content column is the panel's last child; the nav rail also
    // scrolls, so a computed-style search would hash the wrong column.
    const options = dialog.lastElementChild;
    const text = (options.innerText ?? "").trim();
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return {
      active: dialog.querySelector('nav button[aria-current="true"]')?.textContent.trim() ?? null,
      textLength: text.length,
      hash: hash.toString(16).padStart(8, "0"),
    };
  });
  const waitSectionReady = async (id) => {
    if (id === "plugins") {
      await page.waitForFunction(() => document.querySelectorAll("[data-anonymous-plugins] [data-plugin-entry]").length > 0,
        { timeout: 15000 });
    }
    if (id === "agent-presets") {
      await page.waitForFunction(() => document.querySelectorAll("[data-anonymous-presets] [data-agent-preset-id]").length === 5,
        { timeout: 15000 });
    }
  };
  const sectionMatrix = [];
  for (const locale of ["zh", "en"]) {
    await page.evaluate(() => localStorage.clear());
    await setMedia("light");
    await page.goto(urlFor(locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    await openPanel(locale);
    const requestMark = forbiddenPanelTraffic.length;
    const capture = async (scheme) => {
      const rows = [];
      for (const section of P12_SECTIONS) {
        await switchSection(section.index);
        await waitSectionReady(section.id);
        const snapshot = await contentHash();
        assert.ok(snapshot.textLength > 0, `${locale} ${scheme}: ${section.id} renders content`);
        await settle(250);
        await page.screenshot({ path: join(output, `section-${section.id}-${locale}-${scheme}.png`) });
        rows.push({ id: section.id, ...snapshot });
      }
      assert.equal(new Set(rows.map(row => row.hash)).size, rows.length,
        `${locale} ${scheme}: every section renders a distinct DOM hash`);
      return rows;
    };
    const lightRows = await capture("light");

    // C — the full official Models surface and its anonymous gates were exercised
    // above in all eight locales; these section screenshots keep the light/dark matrix.
    const models = modelObservations.find(observation => observation.locale === locale);
    assert.ok(models?.loginGate && models.privateRequests === 0);

    // D — plugins: the official inventory tab renders real rows, no sync error.
    await switchSection(3);
    await waitSectionReady("plugins");
    const plugins = await page.evaluate(() => {
      const page = document.querySelector("[data-anonymous-plugins]");
      return {
        heading: page.querySelector("h2")?.textContent?.trim() ?? null,
        entries: page.querySelectorAll("[data-plugin-entry]").length,
        presetId: page.querySelector('[data-plugin-scope="preset"]')?.getAttribute("data-preset-id") ?? null,
        syncFailure: page.querySelector("[data-client-sync-failure]") !== null,
        loadError: page.querySelector('[class*="failure"] [role="alert"]')?.textContent?.trim() ?? null,
      };
    });
    assert.equal(plugins.heading !== null, true, `${locale}: built-in plugins page has its official heading`);
    assert.ok(plugins.entries > 0, `${locale}: the read-only inventory row list is non-empty`);
    assert.equal(plugins.presetId, FIXED_AGENT_PRESET_ID, `${locale}: the selected preset group is the fixed Think composition`);
    assert.equal(plugins.syncFailure, false, `${locale}: the anonymous client-graph stub reports no sync failure`);
    assert.equal(plugins.loadError, null, `${locale}: the inventory read does not surface an error state`);

    // E — agent presets: the pinned roster matches the composer menu, every
    // selection control is unavailable (the default row) or aria-disabled.
    await switchSection(4);
    await waitSectionReady("agent-presets");
    const presets = await page.evaluate(() => ({
      cards: [...document.querySelectorAll("[data-anonymous-presets] [data-agent-preset-id]")].map(card => ({
        id: card.getAttribute("data-agent-preset-id"),
        availability: card.getAttribute("data-availability"),
        name: card.querySelector('[class*="cardName"]')?.textContent?.trim() ?? null,
        buttonDisabled: card.querySelector("button")?.disabled === true,
        ariaDisabled: card.querySelector("button")?.getAttribute("aria-disabled"),
        reason: card.querySelector('[class*="cardUnavailableReason"]')?.textContent?.trim() ?? null,
      })),
      alert: document.querySelector('[data-anonymous-presets] [role="alert"]')?.textContent?.trim() ?? null,
    }));
    assert.deepEqual(presets.cards.map(card => card.id).sort(),
      [...OFFICIAL_AGENT_PRESET_IDS, FIXED_AGENT_PRESET_ID].sort(),
      `${locale}: the roster lists the four official modes and the fixed Think composition`);
    assert.equal(presets.alert, null, `${locale}: the preset roster reads without an error alert`);
    const unavailableCards = presets.cards.filter(card => card.availability === "unavailable");
    assert.equal(unavailableCards.length, OFFICIAL_AGENT_PRESET_IDS.length,
      `${locale}: the four official modes are unavailable here`);
    const presetReason = fixedAgentPresetCopy(locale).unavailableReason;
    for (const card of unavailableCards) {
      assert.equal(card.ariaDisabled, "true", `${locale}: ${card.id} cannot be selected`);
      assert.equal(card.reason, presetReason, `${locale}: ${card.id} shows the localized unavailable reason`);
    }
    for (const card of presets.cards) {
      assert.ok(card.buttonDisabled || card.ariaDisabled === "true",
        `${locale}: ${card.id} offers no usable "use as default" action`);
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });
    const composerPresets = await presetMenu();
    assert.equal(composerPresets.items.length, presets.cards.length,
      `${locale}: the preset page lists the same roster as the composer menu`);
    for (const card of presets.cards) {
      assert.ok(composerPresets.items.some(item => item.toLowerCase().includes(card.name.toLowerCase())),
        `${locale}: composer menu carries ${card.name}`);
    }
    observations.push({ locale, composerPresets: composerPresets.items });

    // Dark matrix: the guard is read on the General page, then the official
    // appearance row flips the theme before the second screenshot pass.
    await openPanel(locale);
    await switchSection(1);
    const guard = await page.evaluate(() => {
      const general = document.querySelector("[data-anonymous-settings-sections]");
      return {
        sections: Number(general?.getAttribute("data-anonymous-settings-sections")),
        generalItems: Number(general?.getAttribute("data-anonymous-settings-general-items")),
        rows: general?.children.length ?? 0,
      };
    });
    assert.equal(guard.sections, 0, `${locale}: the anonymous page registers zero settings.section entries`);
    assert.equal(guard.generalItems, 0, `${locale}: the anonymous page registers zero settings.general.item entries`);
    assert.equal(guard.rows, 12, `${locale}: General still shows its twelve rows`);
    await page.evaluate(() => { document.querySelectorAll('[role="dialog"] button[aria-pressed]')[1].click(); });
    await page.waitForFunction(() => document.documentElement.style.colorScheme === "dark", { timeout: 5000 });
    const darkRows = await capture("dark");
    assert.equal(forbiddenPanelTraffic.length, requestMark,
      `${locale}: opening and switching every section issued no owner-API request`);
    sectionMatrix.push({ locale, light: lightRows, dark: darkRows, models, plugins, presets, guard });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });
  }
  observations.push({ p12Sections: sectionMatrix });

  // Navigation snapshots for all eight locales (the five-row ledger is stable).
  for (const locale of LOCALE_IDS) {
    await page.evaluate(() => localStorage.clear());
    await setMedia("light");
    await page.goto(urlFor(locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    await openPanel(locale);
    await settle(250);
    await page.screenshot({ path: join(output, `panel-nav-${locale}-light.png`) });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });
  }
  await setMedia("light");

  // Collapsed rail: the panel opens from the 36px More trigger too.
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlFor("zh"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitLauncher("zh");
  await page.click("[data-sidebar-toggle]");
  await page.waitForSelector('[data-signed-out="true"][data-collapsed="true"]', { timeout: 10000 });
  await waitCollapsedRail();
  await openPanel("zh", true);
  await settle();
  await page.screenshot({ path: join(output, "panel-zh-collapsed.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });

  // Sign-in navigation target.
  await page.evaluate(() => localStorage.clear());
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitLauncher("en");
  await openMenu("en");
  const launcherUrl = page.url();
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="menuitem"]:not([aria-disabled])')];
    rows[rows.length - 1].click();
  });
  await page.waitForSelector('[role="dialog"]:has([data-auth-dialog])', { visible: true });
  assert.equal(page.url(), launcherUrl, "launcher sign-in opens the shared modal in place");
  observations.push({ signIn: "shared auth modal", navigation: false });
  await page.keyboard.press("Escape"); await page.waitForSelector('[role="dialog"]:has([data-auth-dialog])', { hidden: true });

  // Every anonymous menu/panel operation must stay off the Host settings wire.
  assert.deepEqual(settingsTraffic, [], "anonymous launcher and panel never issue /api/settings/* requests");

  // Signed-in regression: official AccountMenu owns the slot, no second entry.
  const account = { username: `launcher${randomBytes(6).toString("hex")}`, name: "Launcher acceptance", email: `launcher-${randomBytes(6).toString("hex")}@example.test`, password: randomBytes(24).toString("base64url") };
  const signup = await request("/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken }, body: JSON.stringify(account),
  });
  assert.equal(signup.status, 200, `local signup: ${await signup.clone().text()}`);
  const match = signup.headers.getSetCookie().join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  assert.ok(match, "signup returned no session cookie");
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
  await page.evaluate(() => localStorage.clear());
  // QA-reproducible reading: a signed-in page must never touch the anonymous document.
  await page.evaluateOnNewDocument(() => {
    const KEY = "dsh-base.anonymous-settings.v1";
    const stats = { reads: 0, writes: 0 };
    window.__ANON_SETTINGS_STATS__ = stats;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) { if (key === KEY) stats.reads += 1; return getItem.call(this, key); };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === KEY) stats.writes += 1; return setItem.call(this, key, value); };
  });
  await page.goto(urlFor("en"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-signed-out="false"]', { timeout: 45000 });
  const anonymousDocumentStats = await page.evaluate(() => window.__ANON_SETTINGS_STATS__);
  assert.deepEqual(anonymousDocumentStats, { reads: 0, writes: 0 }, "signed-in page never reads or writes the anonymous settings document");
  const signedInSettingsTraffic = [...settingsTraffic];
  assert.ok(signedInSettingsTraffic.length > 0, "signed-in settings still ride the Host RPC (describe)");
  const signedIn = await page.evaluate(() => ({
    officialLaunchers: document.querySelectorAll('[data-signed-out="false"]').length,
    anonymousLaunchers: document.querySelectorAll('[data-signed-out="true"]').length,
    menuButtons: document.querySelectorAll('[class*="settingsArea"] [aria-haspopup="menu"]').length,
    hasOfficialContent: document.querySelector('[data-signed-out="false"]')?.innerHTML?.length > 0,
  }));
  assert.equal(signedIn.anonymousLaunchers, 0, "signed-in owners never see the anonymous launcher");
  assert.equal(signedIn.officialLaunchers, 1, "official AccountMenu owns the slot");
  assert.equal(signedIn.menuButtons, 1, "exactly one account entry");
  assert.equal(signedIn.hasOfficialContent, true, "official account trigger renders");
  await page.click('[data-signed-out="false"]');
  await page.waitForSelector('[role="menu"]', { timeout: 10000 });
  const officialMenu = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(row => row.textContent.trim()));
  assert.ok(officialMenu.some(text => /sign out|退出登录/iu.test(text)), "official signed-in menu still owns sign-out");
  await page.screenshot({ path: join(output, "signed-in-en.png") });
  observations.push({ signedIn, anonymousDocumentStats });

  // R17 regression: the shared fork panel keeps its official signed-in rendering.
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find(row => /^(settings|设置)/iu.test(row.textContent.trim()));
    item.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const officialPanel = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      width: Math.round(dialog.getBoundingClientRect().width),
      sections: [...dialog.querySelectorAll("nav button")].map(element => ({
        label: element.textContent.trim(),
        disabled: element.getAttribute("aria-disabled"),
      })),
      anonymousRows: dialog.querySelectorAll("[data-anonymous-row]").length,
    };
  });
  assert.equal(officialPanel.width, 800, "signed-in official settings keeps the 800px shell");
  assert.equal(officialPanel.sections.length, 5, "signed-in official settings keeps five sections");
  assert.equal(officialPanel.sections.filter(row => row.disabled !== null).length, 0, "no official section is disabled by the anonymous extension");
  assert.equal(officialPanel.anonymousRows, 0, "official settings never renders anonymous rows");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, { timeout: 5000 });
  observations.push({ officialSettings: officialPanel });

  assert.deepEqual(errors, [], "no browser errors, including anonymous authentication errors, are ignored");
  const screenshots = readdirSync(output).filter(file => file.endsWith(".png")).length;
  // Launcher, General and Account each cover every locale in both themes;
  // navigation covers each locale once, and all sections cover en/zh × themes.
  // Nine focused captures: two collapsed launchers, two bottom/hover pairs,
  // font size, collapsed settings, and signed-in identity.
  const expectedScreenshots = LOCALE_IDS.length * (3 * 2 + 1) + P12_SECTIONS.length * 2 * 2 + 9;
  assert.equal(screenshots, expectedScreenshots, "planned locale/theme/section and focused screenshots are complete");
  writeFileSync(join(output, "report.json"), JSON.stringify({ ok: true, base, locales: LOCALE_IDS, settingsTraffic: { anonymous: [], signedIn: signedInSettingsTraffic }, observations, errors, screenshots }, null, 2));
  console.log(JSON.stringify({ ok: true, output, locales: LOCALE_IDS.length, screenshots, signIn: observations.find(row => row.signIn)?.signIn }));
} catch (error) {
  writeFileSync(join(output, "failure.json"), JSON.stringify({ ok: false, error: String(error?.stack ?? error), errors, observations }, null, 2));
  try { await page?.screenshot({ path: join(output, "failure.png") }); } catch {}
  throw error;
} finally {
  try { await closeAcceptanceBrowser(browser); } finally { if (server.exitCode === null) server.kill("SIGTERM"); }
}
