#!/usr/bin/env node
/**
 * P4b local acceptance: the language switch moves the URL prefix and a reload
 * keeps both the language and the Session.
 *
 * Built Worker + local D1/DO + Chromium. No model call.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { localizePath } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
if (process.env.DSH_ACCEPTANCE_OUT === undefined || process.env.DSH_ACCEPTANCE_OUT === "") {
  throw new Error("DSH_ACCEPTANCE_OUT is required: handoff evidence directories are immutable — pass a fresh output directory");
}
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT);
mkdirSync(artifacts, { recursive: true });
const port = process.env.DSH_LOCAL_PORT ?? "5186";
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app,
  env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: "2026-10-30" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser;
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
const ZH = localizePath("/", "zh");
const JA = localizePath("/", "ja");

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await sleep(100);
  }
  const account = { username: `locurl${randomBytes(6).toString("hex")}`, name: "Locale URL", email: `locurl-${randomBytes(6).toString("hex")}@example.test`, password: randomBytes(32).toString("base64url") };
  const auth = await request("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken }, body: JSON.stringify(account) });
  assert.equal(auth.status, 200, "local signup");
  const cookie = (auth.headers.getSetCookie() ?? []).join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  const sessionCookie = `${cookie[1]}=${cookie[2]}`;
  const call = async (method, params = {}) => {
    const response = await request("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: sessionCookie }, body: JSON.stringify({ method, params }) });
    assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
    const value = await response.json();
    assert.equal(value.error, undefined, `${method}: ${JSON.stringify(value.error)}`);
    return value.result;
  };
  const created = await call("create", { title: `Locale URL ${Date.now().toString(36)}` });
  const sessionId = created.sessionId;

  browser = await puppeteer.launch({ ...acceptanceLaunchOptions(), userDataDir: mkdtempSync(join(tmpdir(), "dsh-locale-url-")) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error?.message ?? error).slice(0, 300)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, sameSite: "Lax" });
  const boot = () => page.waitForSelector('[contenteditable="true"]', { timeout: 120_000 });
  const pathNow = () => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
  const langNow = () => page.evaluate(() => document.documentElement.lang);

  // Observe the address for a real dwell window: the H4-1 defect rewrote the
  // path a few seconds after boot, after the immediate assertion had passed.
  const observeAddress = async (expected, ms, label) => {
    const seen = new Set();
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      seen.add(await pathNow());
      await sleep(250);
    }
    assert.deepEqual([...seen], [expected], `${label}: address changed during ${ms}ms observation (saw ${[...seen].join(" -> ")})`);
    return [...seen];
  };

  // 1. A canonical Chinese deep link selects Chinese; query and hash survive the dwell window.
  const zhDeepLink = `${ZH}/app/session/${sessionId}?keep=1#probe`;
  await page.goto(`${base}${zhDeepLink}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await sleep(1_000);
  assert.equal(await pathNow(), zhDeepLink, "the canonical prefix and the deep link stay in the address");
  assert.equal(await langNow(), "zh-CN", "the first screen is Chinese");
  await observeAddress(zhDeepLink, 30_000, "zh deep link");
  const zhTitle = await page.title();

  // 2. Switching to Japanese rewrites only the prefix; path, query and hash survive a dwell window.
  const jaDeepLink = `${JA}/app/session/${sessionId}?keep=1#probe`;
  await call("settingsUpdate", { ns: "locale", patch: { preference: "ja" } });
  await page.waitForFunction(path => `${location.pathname}${location.search}${location.hash}` === path, { timeout: 30_000 }, jaDeepLink);
  assert.equal(await pathNow(), jaDeepLink, "switching to Japanese keeps the path, query and hash");
  await observeAddress(jaDeepLink, 30_000, "ja deep link");

  // 3. Switching to English removes the prefix; the Session and query survive.
  await page.goto(`${base}${JA}/app/session/${sessionId}?keep=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await sleep(500);
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  await page.waitForFunction(path => `${location.pathname}${location.search}${location.hash}` === path, { timeout: 30_000 }, `/app/session/${sessionId}?keep=1`);
  assert.equal(await pathNow(), `/app/session/${sessionId}?keep=1`, "English drops the prefix and keeps the query");
  assert.equal(await langNow(), "en", "the bare English first screen");
  await observeAddress(`/app/session/${sessionId}?keep=1`, 10_000, "english deep link");

  // 3b. English also keeps the hash fragment when it drops the prefix.
  await page.goto(`${base}${ZH}/app/session/${sessionId}?keep=1#probe`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await sleep(500);
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  await page.waitForFunction(path => `${location.pathname}${location.search}${location.hash}` === path, { timeout: 30_000 }, `/app/session/${sessionId}?keep=1#probe`);
  assert.equal(await pathNow(), `/app/session/${sessionId}?keep=1#probe`, "the hash survives a language switch");
  await observeAddress(`/app/session/${sessionId}?keep=1#probe`, 10_000, "english hash deep link");

  // 4. A reload of the Chinese deep link keeps the language, the Session, the query and the hash.
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  await page.goto(`${base}${zhDeepLink}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await sleep(1_000);
  assert.equal(await pathNow(), zhDeepLink, "reload keeps the canonical Chinese deep link");
  assert.equal(await langNow(), "zh-CN", "reload keeps the Chinese first screen");
  assert.equal(await page.title(), zhTitle, "the server title stays localized on reload");
  await observeAddress(zhDeepLink, 10_000, "reload deep link");

  await page.screenshot({ path: join(artifacts, "locale-url-zh.png") });
  const report = {
    ok: true,
    base,
    sessionId,
    bootPrefix: ZH,
    switchPrefix: JA,
    englishBare: true,
    queryPreserved: "?keep=1",
    hashPreserved: "#probe",
    dwellSeconds: 30,
    observedStable: { "zh deep link": 30, "ja deep link": 30, "english deep link": 10, "english hash deep link": 10, "reload deep link": 10 },
    reloadKeptLanguage: true,
    firstScreenLang: await langNow(),
    consoleErrors: errors.slice(-5),
    artifacts,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(artifacts, "locale-url-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(artifacts, "server.log"), serverLog);
  assert.deepEqual(errors, [], "locale URL acceptance emitted browser errors");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(artifacts, "failure.json"), `${JSON.stringify({ error: String(error?.stack ?? error), serverLog: serverLog.slice(-8000) }, null, 2)}\n`);
  throw error;
} finally {
  await closeAcceptanceBrowser(browser);
  const kill = signal => { try { process.kill(-server.pid, signal); } catch { try { server.kill(signal); } catch { /* gone */ } } };
  kill("SIGTERM");
  await sleep(1500);
  if (server.exitCode === null) kill("SIGKILL");
}
