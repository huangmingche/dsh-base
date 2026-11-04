#!/usr/bin/env node
/**
 * Browser acceptance for the durable schedule backend + official ui-schedule.
 *
 * Creates one real Host task through the official wire endpoint, boots the app,
 * opens the official Scheduled tasks surface and waits for the task title, then
 * opens Settings → Models and waits for the DeepSeek provider row. The task is
 * deleted again so reruns stay isolated.
 */
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";

const { base, credentials } = remoteAcceptanceConfig();
const chromePath = chromeExecutable();
const username = credentials.username;
const password = credentials.password;
const suffix = Date.now().toString(36);
const title = `Browser schedule ${suffix}`;
const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.artifacts/acceptance");
mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "dsh-schedule-ui-"));

const setCookieHeader = (response) => ((response.headers.getSetCookie?.() ?? []).join("; ")) || (response.headers.get("set-cookie") ?? "");
const timeoutFetch = async (url, init) => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { if (attempt === 6) throw error; await new Promise((resolve) => setTimeout(resolve, 2_000)); }
  }
};
const signIn = await timeoutFetch(`${base}/api/auth/sign-in/username`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ username, password }),
});
assert.equal(signIn.ok, true, `sign-in HTTP ${signIn.status}`);
const token = setCookieHeader(signIn).match(/__Secure-better-auth[^=]*=([^;]+)/u)?.[1];
assert.ok(token !== undefined, "sign-in returned no session cookie");
const authHeaders = { "content-type": "application/json", origin: base, cookie: `__Secure-better-auth.session_token=${token}` };
const wire = async (method, args) => {
  const rpcId = `${method}-${suffix}`;
  const response = await timeoutFetch(`${base}/api/${method}`, {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${method} HTTP ${response.status}`);
  assert.equal(body.result?.ok, true, `${method}: ${JSON.stringify(body).slice(0, 500)}`);
  return body.result.value;
};

const created = await wire("schedule/create", { request: {
  title,
  prompt: "Browser acceptance task.",
  timing: { kind: "after", after_seconds: 600 },
  target: { kind: "new" },
} });
assert.equal(typeof created.id, "string");

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  protocolTimeout: 180_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: "__Secure-better-auth.session_token", value: token, url: base, httpOnly: true, secure: true, sameSite: "Lax" });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error?.message ?? error).slice(0, 200)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 200)); });

try {
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector('[contenteditable="true"]', { visible: true, timeout: 90_000 });

const clickByText = async pattern => {
  const source = pattern.source ?? String(pattern);
  await page.waitForFunction(source => {
    const matcher = new RegExp(source, "iu");
    return [...document.querySelectorAll('button, [role="button"], a, [role="tab"], [role="menuitem"]')].some(element =>
      [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].some(label => matcher.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled"));
  }, { timeout: 15_000 }, source);
  return page.evaluate(source => {
    const matcher = new RegExp(source, "iu");
    const candidates = [...document.querySelectorAll('button, [role="button"], a, [role="tab"], [role="menuitem"]')].filter(element =>
      [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].some(label => matcher.test(label?.trim() ?? "")) && element.getBoundingClientRect().width > 0 && !element.matches(":disabled"));
    candidates[0]?.click(); return candidates.length;
  }, source);
};

const scheduleClicks = await clickByText(/automation tasks|scheduled tasks|自动化任务|计划任务/i);
if (scheduleClicks === 0) {
  const debug = await page.evaluate(() => ({
    labels: [...document.querySelectorAll("[aria-label], [title]")].slice(0, 100).map((element) => `${element.tagName}:${element.getAttribute("aria-label") ?? element.getAttribute("title") ?? ""}`),
    text: document.body.innerText.slice(0, 1500),
  })).catch(() => ({}));
  console.error("sidebar debug", JSON.stringify(debug, null, 1));
}
assert.ok(scheduleClicks > 0, `no Scheduled tasks entry in the sidebar; errors: ${errors.slice(-8).join(" | ")}`);
let scheduleVisible = false;
for (let attempt = 0; attempt < 30 && !scheduleVisible; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  scheduleVisible = await page.evaluate((needle) => document.body.innerText.includes(needle), title).catch(() => false);
}
if (!scheduleVisible) {
  const debug = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
  console.error("schedule surface debug", JSON.stringify({ text: debug, errors: errors.slice(-8) }, null, 1));
}
assert.equal(scheduleVisible, true, `task "${title}" never appeared in the schedule surface`);

// Settings lives behind the account menu; opening it explicitly first makes the
// click independent of sidebar width or localization.
assert.ok(await clickByText(/account menu|账户菜单|账号菜单/i), "account menu launcher missing");
assert.ok(await clickByText(/^settings\\b|^设置/i), "Settings menu item missing");
await page.waitForSelector('[role="dialog"] nav button', { visible: true, timeout: 15_000 });
assert.ok(await clickByText(/^models$|^模型$/i), "Models settings section missing");
let modelsVisible = false;
for (let attempt = 0; attempt < 25 && !modelsVisible; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  modelsVisible = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => /DeepSeek/.test(dialog.textContent ?? "")));
}
if (!modelsVisible) {
  const debug = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
  console.error("models debug", JSON.stringify(debug, null, 1));
}
assert.equal(modelsVisible, true, "Models page did not render the DeepSeek provider row");

await page.screenshot({ path: join(artifacts, `schedule-ui-${suffix}.png`) });
assert.deepEqual(errors, [], "browser errors occurred during Schedule/Models acceptance");
console.log(JSON.stringify({ ok: true, base, scheduleId: created.id, scheduleVisible, modelsVisible, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, `schedule-ui-${suffix}-failed.png`) }).catch(() => {});
  const diagnostic = { error: error instanceof Error ? error.message : String(error), errors, text: await page.evaluate(() => document.body.innerText.slice(0, 6000)).catch(() => "") };
  writeFileSync(join(artifacts, `schedule-ui-${suffix}-failed.json`), JSON.stringify(diagnostic, null, 2).replaceAll(username, "[acceptance account]"), { mode: 0o600 });
  throw error;
} finally {
  try { await wire("schedule/edit", { request: { id: created.id, action: "delete" } }); }
  finally { try { await closeAcceptanceBrowser(browser); } finally { rmSync(profile, { recursive: true, force: true }); } }
}
