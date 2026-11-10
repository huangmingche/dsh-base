#!/usr/bin/env node
/** Isolated local Worker acceptance for the guest login and authenticated account launcher. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { prefixFor, LOCALE_IDS } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
const urlFor = locale => `${base}${prefixFor(locale)}/`;

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/settings/")) settingsTraffic.push(request.url()); });
  for (const locale of LOCALE_IDS) {
    await page.goto(urlFor(locale), { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-auth-dialog]', { visible: true });
    assert.equal(await page.$('[data-signed-out], [data-anonymous-settings-sections]'), null);
    await page.screenshot({ path: join(output, `login-${locale}.png`) });
  }
  assert.deepEqual(settingsTraffic, [], 'guest login never reads account settings');
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
  const expectedScreenshots = LOCALE_IDS.length + 1;
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
