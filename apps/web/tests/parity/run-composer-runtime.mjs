#!/usr/bin/env node
/** Official editor runtime regression; no Host or model request exists. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
const app = resolve(import.meta.dirname, "../.."), require = createRequire(resolve(app, "package.json"));
const vite = await import(require.resolve("vite")), puppeteer = require("puppeteer-core").default;
const configFile = resolve(app, "vite.parity.config.ts"), output = resolve(app, "dist/parity-evidence");
const text = "trace-editor: Please call fetch_url exactly once for https://developers.cloudflare.com/ and then reply with only the page title.";
let server, browser; const results = [];
try {
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  for (const locale of ["en", "zh"]) for (const mode of ["type", "paste"]) {
    const page = await browser.newPage(), errors = [];
    await page.setViewport({ width: 1440, height: 900 });
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?surface=composer-runtime&locale=${locale}`, { waitUntil: "networkidle0" });
    const editor = await page.waitForSelector('[contenteditable="true"][role="textbox"]');
    await editor.click();
    if (mode === "type") await page.keyboard.type(text); else { const cdp = await page.createCDPSession(); await cdp.send("Input.insertText", { text }); }
    await page.waitForFunction(value => window.__COMPOSER_RUNTIME__.input.state.getSnapshot().draft === value, {}, text);
    const afterTyping = errors.length;
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__COMPOSER_RUNTIME__.submitted.length === 1);
    const actual = await page.evaluate(() => ({ submitted: window.__COMPOSER_RUNTIME__.submitted, publications: window.__COMPOSER_RUNTIME__.publications(), draft: window.__COMPOSER_RUNTIME__.input.state.getSnapshot().draft, reactVersion: window.__COMPOSER_RUNTIME__.reactVersion }));
    results.push({ locale, mode, afterTyping, errors, ...actual });
    assert.deepEqual(actual.submitted, [text]); assert.equal(actual.draft, "");
    assert.deepEqual(errors, [], "official desktop composer typing/submission must not cause React update loops");
    await page.close();
  }
  console.log("official composer runtime: 4 real Lexical input and submission cases passed");
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "composer-runtime-report.json"), JSON.stringify({ results }, null, 2));
  await closeAcceptanceBrowser(browser); await server?.close();
}
