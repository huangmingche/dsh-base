#!/usr/bin/env node
/**
 * Sidebar More acceptance against the pinned official dictionaries and real UI.
 * Keeps the historical command name, but supersedes the removed product-row P6
 * acceptance: only official Browse/Create remain; branding reads public site
 * configuration once at boot, independently of the retired sidebar entries.
 *
 * Default: built local Worker, isolated local account and real D1/DO/Chromium.
 * DSH_MORE_MENU_REMOTE=true: explicit remoteAcceptanceConfig dedicated account;
 * no registration, Creator invocation, model request or plugin selection write.
 * The dedicated account's locale preference is temporarily selected through the
 * real Host settings API and restored, preserving an originally unset overlay.
 * Set DSH_EXPECTED_DEPLOYMENT_VERSION to verify the deployed Host before browsing.
 */
import { assertSidebarBrand } from './assert-sidebar-brand.mjs';
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser, remoteAcceptanceConfig } from "./acceptance-config.mjs";
import { LOCALE_IDS, localizePath, hreflangFor } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";
import { assertOfficialSidebarMore } from "./sidebar-more-contract.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
if (!process.env.DSH_ACCEPTANCE_OUT) throw new Error("DSH_ACCEPTANCE_OUT is required; use a fresh evidence directory");
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT);
mkdirSync(artifacts, { recursive: true });
const remote = process.env.DSH_MORE_MENU_REMOTE === "true";
const remoteConfig = remote ? remoteAcceptanceConfig() : undefined;
const port = process.env.DSH_LOCAL_PORT ?? "5182";
const base = remoteConfig?.base ?? `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
let browser, page, server, restoreLocale;
let serverLog = "";
const controller = new AbortController();
const watchdog = setTimeout(() => controller.abort(new Error("sidebar More acceptance exceeded 600 seconds")), 600000);
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const report = { ok: false, base, remote, observations: [], siteConfigRequests: [], pluginMutations: [], browserErrors: [], creatorInvoked: false, modelRequestSubmitted: false };

try {
  if (!remote) {
    server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
      cwd: app,
      env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? "2026-10-30" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
      if (serverLog.includes("Local Worker ready:")) break;
      if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
      await sleep(100);
    }
  }
  const auth = remote
    ? await request("/api/auth/sign-in/username", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ username: remoteConfig.credentials.username, password: remoteConfig.credentials.password }) })
    : await request("/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken },
      body: JSON.stringify({ username: `more${randomBytes(8).toString("hex")}`, name: "Sidebar More acceptance", email: `more-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(32).toString("base64url") }),
    });
  assert.equal(auth.status, 200, `isolated acceptance authentication: HTTP ${auth.status}`);
  const cookie = (auth.headers.getSetCookie() ?? []).join("; ").match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/u);
  assert.ok(cookie, "acceptance authentication returned no session cookie");
  const headers = { cookie: `${cookie[1]}=${cookie[2]}`, origin: base, "content-type": "application/json" };
  const hostCall = async (method, params = {}, cleanup = false) => {
    const init = { method: "POST", headers, body: JSON.stringify({ method, params }) };
    const response = cleanup
      ? await fetch(base + "/api/session-host", { ...init, signal: AbortSignal.timeout(20000) })
      : await request("/api/session-host", init);
    assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
    const reply = await response.json();
    assert.equal(reply.error, undefined, `${method}: Host rejected operation`);
    return reply.result;
  };
  if (remote && process.env.DSH_EXPECTED_DEPLOYMENT_VERSION) {
    const started = Date.now();
    while (true) {
      const response = await request("/api/session-host", { method: "POST", headers, body: JSON.stringify({ method: "runtimeInfo", params: {} }) });
      assert.equal(response.status, 200);
      const reply = await response.json();
      assert.equal(reply.error, undefined);
      assert.equal(typeof reply.result?.versionId, "string");
      if (reply.result.versionId === process.env.DSH_EXPECTED_DEPLOYMENT_VERSION) { report.versionId = reply.result.versionId; break; }
      assert.ok(Date.now() - started < 360000, "deployed Host version must become ready");
      console.log("[sidebar-more] waiting for the new deployed Host version");
      await sleep(15000);
    }
  }
  const originalLocale = (await hostCall("settingsDescribe")).values?.locale ?? {};
  const explicitPreference = Object.hasOwn(originalLocale, "preference");
  restoreLocale = async () => {
    await hostCall("settingsMutate", { ns: "locale", ops: [explicitPreference
      ? { op: "set", path: ["preference"], value: originalLocale.preference }
      : { op: "unset", path: ["preference"] }] }, true);
    const restored = (await hostCall("settingsDescribe", {}, true)).values?.locale ?? {};
    assert.equal(Object.hasOwn(restored, "preference"), explicitPreference, "restore keeps an unset locale preference unset");
    assert.deepEqual(restored.preference, originalLocale.preference, "restore preserves the original explicit preference value");
  };
  const getControl = async () => {
    const response = await request("/api/plugin-manager", { headers });
    assert.equal(response.status, 200);
    return response.json();
  };
  const controlBefore = await getControl();
  const publicSiteResponse = await request('/api/site-config');
  assert.equal(publicSiteResponse.status, 200);
  const publicSite = await publicSiteResponse.json();
  assert.ok(typeof publicSite.brand?.name === 'string' && publicSite.brand.name.trim() !== '');
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  page = await browser.newPage();
  page.on("pageerror", error => report.browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") report.browserErrors.push(message.text()); });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/site-config") report.siteConfigRequests.push(path);
    if (path === "/api/plugin-manager" && request.method() !== "GET") report.pluginMutations.push(request.method());
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, secure: remote, sameSite: "Lax" });
  for (const locale of LOCALE_IDS) {
    // A bare English path intentionally preserves the saved account preference.
    // Select the actual preference before boot; never rely on the SSR lang alone.
    await hostCall("settingsUpdate", { ns: "locale", patch: { preference: locale } });
    const siteReadsBeforeBoot = report.siteConfigRequests.length;
    await page.goto(base + localizePath("/", locale), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === "active"), { timeout: 45000 });
    await page.waitForFunction(language => document.documentElement.lang === language, { timeout: 30000 }, hreflangFor(locale));
    await assertSidebarBrand(page);
    assert.equal(report.siteConfigRequests.length - siteReadsBeforeBoot, 1, 'the public site service reads once for each fresh application boot');
    report.observations.push(await assertOfficialSidebarMore(page, locale, { screenshot: join(artifacts, `sidebar-more-${locale}.png`) }));
    assert.equal(report.siteConfigRequests.length - siteReadsBeforeBoot, 1, 'opening More and browsing plugins does not reread public configuration');
    console.log(`[sidebar-more] ${locale}: original Browse/Create only; real Browse navigation passed`);
  }
  assert.deepEqual(await getControl(), controlBefore, "menu inspection never changes persisted plugin controls");
  report.pluginControlsUnchanged = true;
  assert.equal(report.siteConfigRequests.length, LOCALE_IDS.length, 'one public site-config request per application boot, without menu polling');
  assert.deepEqual(report.pluginMutations, []);
  assert.deepEqual(report.browserErrors, []);
  report.upstream = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")).commit;
  report.generatedAt = new Date().toISOString();
  report.ok = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  if (page) {
    report.failurePage = await page.evaluate(() => ({ url: location.href, language: document.documentElement.lang, menu: [...document.querySelectorAll('[role="menuitem"]')].map(row => row.textContent.trim()) })).catch(() => undefined);
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  let cleanupFailure;
  try { await closeAcceptanceBrowser(browser); }
  catch (error) { cleanupFailure = error; }
  if (restoreLocale) {
    try { await restoreLocale(); report.localePreferenceRestored = true; }
    catch (error) { report.localePreferenceRestored = false; cleanupFailure ??= error; }
  }
  if (cleanupFailure) { report.ok = false; report.cleanupFailure = String(cleanupFailure); }
  writeFileSync(join(artifacts, "sidebar-more-report.json"), JSON.stringify(report, null, 2) + "\n");
  if (server) writeFileSync(join(artifacts, "server.log"), serverLog);
  if (server) {
    const killServerTree = signal => {
      try { process.kill(-server.pid, signal); } catch { try { server.kill(signal); } catch { /* already gone */ } }
    };
    killServerTree("SIGTERM");
    await sleep(1500);
    if (server.exitCode === null) killServerTree("SIGKILL");
  }
  if (cleanupFailure) throw cleanupFailure;
}
console.log(JSON.stringify(report));
