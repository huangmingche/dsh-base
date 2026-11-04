#!/usr/bin/env node
/**
 * Browser acceptance for the official composer triggers: `+`, `/`, and `@`.
 *
 * Creates one isolated blank Session and reference file, opens its exact official
 * sidebar row, then verifies:
 *   - `/` opens the command/skill menu (Permission + web-fetch rows),
 *   - `@` opens the session/file reference menu with candidates,
 *   - the `+` button opens the composer action menu.
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
const sessionId = `accept-composer-${suffix}`;
const referenceName = `reference-${suffix}.txt`;
const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.artifacts/acceptance");
mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "dsh-chat-ui-"));

const timeoutFetch = async (url, init) => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }); }
    catch (error) { if (attempt === 6) throw error; await new Promise((resolve) => setTimeout(resolve, 2_000)); }
  }
};
const signIn = await timeoutFetch(`${base}/api/auth/sign-in/username`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ username, password }),
});
assert.equal(signIn.ok, true, `sign-in HTTP ${signIn.status}`);
const token = (((signIn.headers.getSetCookie?.() ?? []).join("; ")) || (signIn.headers.get("set-cookie") ?? ""))
  .match(/__Secure-better-auth[^=]*=([^;]+)/u)?.[1];
assert.ok(token !== undefined, "no session cookie");
const headers = { "content-type": "application/json", origin: base, cookie: `__Secure-better-auth.session_token=${token}` };
const host = async (method, params = {}) => {
  const response = await timeoutFetch(`${base}/api/session-host`, { method: "POST", headers, body: JSON.stringify({ method, params }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${method} HTTP ${response.status}`);
  assert.equal(body.error, undefined, `${method}: ${body.error?.code ?? "failed"}`);
  assert.ok(Object.hasOwn(body, "result"), `${method}: missing result`);
  return body.result;
};
await host("create", { sessionId, title: `Composer acceptance ${suffix}` });
await host("workspaceFileWrite", { sessionId, path: referenceName, dataBase64: Buffer.from("Reference picker acceptance; no model execution.").toString("base64") });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  protocolTimeout: 240_000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: "__Secure-better-auth.session_token", value: token, url: base, httpOnly: true, secure: true, sameSite: "Lax" });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error?.message ?? error).slice(0, 200)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 200)); });

try {
await page.goto(`${base}/agent/${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector('[contenteditable="true"]', { visible: true, timeout: 90_000 });
// Direct navigation makes this new blank Session current (official workspace
// hides non-current blank Sessions). Its exact row identity excludes workspace treeitems and
// unrelated titles are never mistaken for an opened Session.
const sessionSelector = `[data-row-key="session:${sessionId}"]`;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const visible = await page.evaluate(selector => (document.querySelector(selector)?.getBoundingClientRect().height ?? 0) > 0, sessionSelector);
  if (visible) break;
  await page.evaluate(() => {
    for (const group of document.querySelectorAll('[data-row-key^="workspace:"][aria-expanded="false"]')) group.click();
  });
  await new Promise(resolve => setTimeout(resolve, 500));
}
await page.waitForSelector(sessionSelector, { visible: true, timeout: 10_000 });
await page.click(sessionSelector);
await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-selected") === "true", { timeout: 15_000 }, sessionSelector);

const composerSelector = '[contenteditable="true"]';
const composer = () => page.click(composerSelector);
const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? "Meta" : "Control");
const clearComposer = async () => {
  await page.keyboard.press("Escape");
  await composer();
  await page.keyboard.down(modifier);
  await page.keyboard.press("a");
  await page.keyboard.up(modifier);
  await page.keyboard.press("Backspace");
  await page.waitForFunction(selector => (document.querySelector(selector)?.textContent ?? "").trim() === "", { timeout: 5_000 }, composerSelector);
};
const menuRows = () => page.$$eval('[role="listbox"] [role="option"]', rows => rows.filter(row => row.getBoundingClientRect().height > 0).map(row => row.textContent?.trim() ?? ""));
const waitForMenu = async patterns => {
  await page.waitForFunction(patterns => {
    const rows = [...document.querySelectorAll('[role="listbox"] [role="option"]')].filter(row => row.getBoundingClientRect().height > 0).map(row => row.textContent?.trim() ?? "");
    return patterns.every(pattern => rows.some(text => new RegExp(pattern, "iu").test(text)));
  }, { timeout: 25_000 }, patterns);
  return menuRows();
};

await clearComposer();
await composer();
await page.keyboard.type("/");
const slashRows = await waitForMenu(["permission|权限", "web-fetch"]);
const slashVisible = slashRows.some(text => /permission|权限/iu.test(text)) && slashRows.some(text => /web-fetch/iu.test(text));
assert.equal(slashVisible, true, "official slash listbox must show the Permission command and web-fetch skill");
assert.equal(slashRows.some(text => /^delegate\b/iu.test(text)), false, "our skill catalog must not offer unavailable delegation");

await clearComposer();
await composer();
await page.keyboard.type(`@${referenceName}`);
const referenceRows = await waitForMenu([referenceName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")]);
const referenceVisible = referenceRows.some(text => text.includes(referenceName));
assert.equal(referenceVisible, true, "reference listbox did not show the real seeded file; sidebar rows do not count");

await clearComposer();
const plusSelector = 'button[aria-label="Add files or run commands"]';
await page.waitForFunction(selector => {
  const button = document.querySelector(selector);
  return button instanceof HTMLButtonElement && !button.disabled;
}, { timeout: 15_000 }, plusSelector);
// Exercise the real mousedown/click sequence: the official button preserves
// Lexical focus on mousedown before toggling the command launcher on click.
await page.click(plusSelector);
const plusClicked = true;
const plusRows = await waitForMenu(["file|文件", "permission|权限"]);
const plusVisible = plusRows.length >= 2;
assert.equal(plusVisible, true, "composer plus menu rendered no real actions");
await page.screenshot({ path: join(artifacts, `chat-interactions-${suffix}.png`) });
await clearComposer();
assert.deepEqual(errors, [], "browser errors occurred during composer acceptance");
console.log(JSON.stringify({ ok: true, base, sessionId, slashVisible, referenceVisible, plusClicked, plusVisible, slashRows, referenceRows, plusRows, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, `chat-interactions-${suffix}-failed.png`) }).catch(() => {});
  const diagnostic = { error: error instanceof Error ? error.message : String(error), errors, text: await page.evaluate(() => document.body.innerText.slice(0, 6000)).catch(() => "") };
  writeFileSync(join(artifacts, `chat-interactions-${suffix}-failed.json`), JSON.stringify(diagnostic, null, 2).replaceAll(username, "[acceptance account]"), { mode: 0o600 });
  throw error;
} finally {
  try { await host("workspaceSetFlags", { sessionId, archived: true }); }
  finally { try { await closeAcceptanceBrowser(browser); } finally { rmSync(profile, { recursive: true, force: true }); } }
}
