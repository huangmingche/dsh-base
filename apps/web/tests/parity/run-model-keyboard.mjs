#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Search-keyboard regression against the actual model-selection fork in Chromium. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(resolve(app, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const vite = await import(requireFromApp.resolve("vite"));
const configFile = resolve(app, "vite.parity.config.ts");
const output = resolve(app, "dist/parity-evidence");
let server;
let browser;
const cases = [];
try {
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  for (const locale of ["en", "zh"]) for (const key of ["Enter", "Tab"]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${origin}/?surface=model-keyboard&locale=${locale}`, { waitUntil: "networkidle0" });
    await page.click("#root button");
    await page.waitForSelector('[role="menu"]');
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(button => /Model|模型/.test(button.textContent)).click());
    await page.waitForSelector('input');
    await page.type("input", "Blocked");
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitemradio"]')].some(button => button.disabled && button.textContent.includes("Blocked model")));
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => window.__PARITY__.calls.filter(call => call.endpoint === "model/select").length), 0, `${locale} ${key}: unavailable model must never submit`);
    assert.ok(await page.$("input"), `${locale} ${key}: unavailable selection must keep its explanation visible`);
    await page.click(`button[aria-label="${locale === "zh" ? "清除搜索" : "Clear search"}"]`);
    await page.type("input", "Enabled");
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitemradio"]')].some(button => !button.disabled && button.textContent.includes("Enabled model")));
    await page.keyboard.press(key);
    try {
      await page.waitForFunction(() => window.__PARITY__.calls.some(call => call.endpoint === "model/select"), { timeout: 3000 });
    } catch (error) {
      console.error(locale, key, await page.evaluate(() => ({ text: document.body.innerText, active: document.activeElement?.outerHTML, inputs: [...document.querySelectorAll('input')].map(input => input.value), calls: window.__PARITY__.calls })));
      throw error;
    }
    const selected = await page.evaluate(() => window.__PARITY__.calls.filter(call => call.endpoint === "model/select"));
    assert.deepEqual(selected.map(call => call.args), [{ provider: "fixture", model: "enabled" }]);
    assert.deepEqual(errors, []);
    cases.push({ locale, key, blockedSubmissions: 0, enabledSubmissions: 1 });
    await page.close();
  }
  const sharedPage = await browser.newPage();
  await sharedPage.goto(`${origin}/?surface=model-keyboard`, { waitUntil: "networkidle0" });
  const shared = await sharedPage.evaluate(() => window.__PARITY__.checkModelDirectoryAvailability());
  assert.equal(shared.blocked, "session/model-unavailable");
  assert.equal(shared.unknown, "session/model-unavailable");
  assert.equal(shared.effort, "gateway/endpoint-unavailable");
  assert.deepEqual(shared.commandSelection, { provider: "fixture", model: "enabled" }, "/model must not invent default effort");
  assert.equal(shared.stale, "session/model-unavailable");
  assert.match(shared.blockedReason, /不可用/);
  assert.equal(shared.callsBeforeEnabled, 0);
  assert.equal(shared.enabled, true);
  assert.equal(shared.calls.length, 1);
  assert.equal(shared.calls[0].model, "enabled");
  assert.equal(shared.blockedRoutable, false);
  assert.equal(shared.enabledRoutable, true);
  assert.equal(shared.staleRoutable, false);
  assert.equal(shared.acknowledgementDoesNotForgeProjection, true, "local acknowledgement must not shadow the Host projection");
  assert.equal(shared.laterRemoteSelectionWins, true, "a later cross-tab selection must replace the previous local choice");
  cases.push({ kind: "shared-directory", unavailableMissingAndStaleRejected: true, unsupportedEffortRejected: true, commandOmitsUnsupportedEffort: true, enabledSubmissions: 1 });
  await sharedPage.close();
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "model-keyboard-report.json"), JSON.stringify({ ok: true, scope: "actual fork search Enter/Tab in en/zh and shared composer/command ModelDirectory; unavailable, missing and stale models cannot submit; enabled model can", cases }, null, 2));
  console.log(`model keyboard regression: ${cases.length} Chromium cases passed`);
} finally {
  await closeAcceptanceBrowser(browser);
  await server?.close();
}
