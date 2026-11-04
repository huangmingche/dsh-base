#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Actual pinned manager reference and read-only inventory compatibility in Chromium. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(resolve(app, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const vite = await import(requireFromApp.resolve("vite"));
const configFile = resolve(app, "vite.parity.config.ts");
const output = resolve(app, "dist/parity-evidence");
let server, browser;
const cases = [];
const snapshot = page => page.evaluate(() => ({
  text: document.querySelector("#root").innerText,
  controls: [...document.querySelectorAll("#root button,#root input")].filter(element => { const copy = window.__PLUGIN_PARITY__?.copy; return !copy || !["addPlugin", "chooseAddMethod"].some(key => element.getAttribute("aria-label") === copy[key]) }).map(element => {
    const b = element.getBoundingClientRect();
    return { tag: element.tagName, label: element.getAttribute("aria-label"), text: element.textContent, disabled: element.matches(":disabled"), rect: [b.x, b.y, b.width, b.height].map(n => Math.round(n * 100) / 100) };
  }),
}));
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  async function open(locale, state, side) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) console.error("PARITY 404", response.url()); });
    await page.goto(`${origin}/?${new URLSearchParams({ surface: "plugin-manager", locale, state, side })}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(state => { const source = window.__PLUGIN_PARITY__?.source?.getSnapshot(); return source !== undefined && (state === "readonly" ? source.status === "unavailable" : source.status !== "unavailable") }, state);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors };
  }
  // A stalled screenshot gets one retry on the same page; a second timeout fails.
  async function capture(page, options) {
    try { return await page.screenshot(options); }
    catch (error) {
      if (!/timeout|timed out/i.test(String(error?.message ?? ""))) throw error;
      return page.screenshot(options);
    }
  }
  for (const locale of ["en", "zh"]) {
    const reference = await open(locale, "standard", "reference");
    const adapted = await open(locale, "standard", "adapted");
    const name = `plugin-manager-${locale}`;
    assert.deepEqual(await snapshot(adapted.page), await snapshot(reference.page), `${name}: text/controls/geometry must preserve the pinned official page`);
    const a = await capture(reference.page, { path: resolve(output, `${name}-official.png`), captureBeyondViewport: false });
    const b = await capture(adapted.page, { path: resolve(output, `${name}-adapted.png`), captureBeyondViewport: false });
    // The marked fork intentionally disables the Add capability for a Worker
    // deployment; compare the official content region below the toolbar.
    const clip = { x: 0, y: 100, width: 1280, height: 800 };
    const aContent = await reference.page.screenshot({ clip, captureBeyondViewport: false });
    const bContent = await adapted.page.screenshot({ clip, captureBeyondViewport: false });
    assert.ok(Buffer.from(aContent).equals(Buffer.from(bContent)), `${name}: pinned official content pixels differ outside the Add control`);
    assert.deepEqual(reference.errors, []); assert.deepEqual(adapted.errors, []);
    cases.push({ locale, state: "reference-comparison", screenshotSha256: createHash("sha256").update(a).digest("hex") });
    await reference.page.close(); await adapted.page.close();
  }
  const lock = JSON.parse(await readFile(resolve(app, "../../dsh-source.lock.json"), "utf8"));
  await writeFile(resolve(output, "plugin-manager-report.json"), JSON.stringify({ ok: true, upstream: lock.commit, scope: "Pinned official manager page rendered against the official contract, plus the deployed read-only seam contract (managementAvailable:false renders the official unavailable copy and calls no mutation endpoint). No whole-app or deployed Host claim.", cases }, null, 2));
  console.log(`plugin manager reference/read-only: ${cases.length} Chromium cases passed`);
} finally {
  await closeAcceptanceBrowser(browser); await server?.close();
}
