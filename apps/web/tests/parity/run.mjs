#!/usr/bin/env node
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
/** Surface-scoped reference comparison; no deployed Host or model calls. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const requireFromApp = createRequire(resolve(appRoot, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const output = process.env.DSH_PARITY_OUTPUT ?? resolve(appRoot, "dist/parity-evidence");
await mkdir(output, { recursive: true });
let server;
let origin = process.env.DSH_PARITY_BASE_URL;
if (origin === undefined) {
  const vite = await import(requireFromApp.resolve("vite"));
  const configFile = resolve(appRoot, "vite.parity.config.ts");
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
}
const browser = await puppeteer.launch(acceptanceLaunchOptions());
const report = {
  upstream: JSON.parse(await readFile(resolve(repoRoot, "dsh-source.lock.json"), "utf8")).commit,
  scope: "Pinned official Schedule page states and interactions; visible disabled official Permission, Terminal, Session-log and all feedback controls; en/zh. This does not assert whole-application UI parity.",
  cases: [],
};
async function openCase(surface, state, locale, side) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.emulateTimezone("Asia/Shanghai");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.evaluateOnNewDocument(() => {
    const NativeDate = Date;
    const fixed = NativeDate.parse("2026-11-10T00:00:00.000Z");
    globalThis.Date = class extends NativeDate {
      constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
      static now() { return fixed; }
    };
  });
  await page.goto(`${origin}/?${new URLSearchParams({ surface, state: state === "manual" ? "empty" : state, locale, side })}`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__PARITY__ !== undefined && document.querySelector("section") !== null);
  await page.evaluate(() => document.fonts.ready);
  if (surface === "schedule") {
    await page.waitForFunction(expected => window.__PARITY__.source.getSnapshot().status === expected, {}, state === "loading" ? "loading" : state === "error" ? "error" : "ready");
    const installed = await page.evaluate(() => window.__PARITY__.registrations);
    for (const name of ["main", "sidebar.panellist", "conversation.chat.turnTail", "sidebar.session.row.hover"]) assert.ok(installed.some(entry => entry.name === name), `official contribution missing: ${name}`);
    if (state === "manual") {
      await page.evaluate(() => document.querySelector(`button[aria-label="${window.__PARITY__.copy['host.createMethod']}"]`).click());
      await page.waitForSelector('[role="menu"]');
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent.trim() === window.__PARITY__.copy['host.manualCreate']).click());
      await page.waitForSelector("textarea");
    }
  }
  await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  return { page, errors };
}
async function snapshot(page) {
  return page.evaluate(() => ({
    text: document.querySelector(new URLSearchParams(location.search).get("surface") === "feedback" ? "body" : "#root").innerText,
    controls: [...document.querySelectorAll(new URLSearchParams(location.search).get("surface") === "feedback" ? "button,input,textarea" : "#root button,#root input,#root textarea,[role='menuitem']")].map(element => {
      const bounds = element.getBoundingClientRect();
      return { tag: element.tagName, text: element.textContent.trim(), label: element.getAttribute("aria-label"), placeholder: element.getAttribute("placeholder"), disabled: element.matches(":disabled"), rect: [bounds.x, bounds.y, bounds.width, bounds.height].map(value => Math.round(value * 100) / 100) };
    }),
  }));
}
async function compare(surface, state, locale) {
  if (process.env.DSH_PARITY_FILTER !== undefined && !`${surface}-${state}-${locale}`.includes(process.env.DSH_PARITY_FILTER)) return;
  const reference = await openCase(surface, state, locale, "reference");
  const adapted = await openCase(surface, state, locale, "adapted");
  try {
    const name = `${surface}-${state}-${locale}`;
    const a = await snapshot(reference.page);
    const b = await snapshot(adapted.page);
    assert.deepEqual(b, a, `${name}: rendered text, controls or layout differ from official reference`);
    await reference.page.evaluate(() => document.activeElement?.blur());
    await adapted.page.evaluate(() => document.activeElement?.blur());
    const before = await reference.page.screenshot({ path: resolve(output, `${name}-official.png`), captureBeyondViewport: false });
    const after = await adapted.page.screenshot({ path: resolve(output, `${name}-adapted.png`), captureBeyondViewport: false });
    assert.ok(Buffer.from(before).equals(Buffer.from(after)), `${name}: screenshot pixels differ from official reference`);
    if (surface === "terminal" || surface === "session-log") {
      assert.ok(b.controls.length >= 1 && b.controls.every(control => control.disabled), `${surface}: every unavailable action stays visibly disabled`);
      assert.match(b.text, surface === "terminal" ? /PTY/ : locale === "zh" ? /上传服务/ : /upload service/);
      await adapted.page.click("button");
      assert.equal(await adapted.page.evaluate(() => window.__PARITY__.calls.filter(call => call.endpoint === "terminal/open").length), 0);
    }
    if (surface === "feedback") {
      if (state === "actions") {
        assert.equal(b.controls.length, 2);
        assert.ok(b.controls.every(control => control.disabled));
        assert.ok(b.controls.every(control => /日志反馈|log feedback/.test(control.label)));
        for (const button of await adapted.page.$$("button")) await button.click();
      } else {
        const button = await adapted.page.evaluateHandle(() => [...document.querySelectorAll("button")].find(button => /日志反馈|log feedback/.test(button.textContent)));
        assert.ok(button.asElement(), "official feedback submit remains visible");
        assert.equal(await button.asElement().evaluate(element => element.disabled), true);
        assert.equal(await adapted.page.$eval("textarea", element => element.readOnly), true);
        await button.asElement().click(); await button.dispose();
      }
      assert.equal(await adapted.page.evaluate(() => window.__PARITY__.calls.filter(call => /feedback|Feedback/.test(call.endpoint)).length), 0, "unavailable feedback controls must not submit or persist");
    }
    if (surface === "permission") {
      assert.ok(b.controls.length >= 2 && b.controls.every(control => !control.disabled), "actual permission and default controls are enabled");
      for (const { page } of [reference, adapted]) {
        await page.bringToFront(); await page.click("button");
        const option = await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(element => /Read.only|只读|仅可查看/i.test(element.textContent ?? "")));
        assert.ok(option.asElement(), "official read-only choice exists");
        await option.asElement().focus(); await page.keyboard.press("Enter");
        await page.waitForFunction(() => window.__PARITY__.calls.some(call => call.endpoint === "commands/execute" && call.args.line === "/permission read-only"));
      }
    }
    if (surface === "schedule" && state === "manual") {
      for (const { page } of [reference, adapted]) {
        await page.bringToFront();
        await page.evaluate(() => { window.__PARITY__.setCreateFailure(true); });
        const fields = await page.$$("input[type='text'],input:not([type]),textarea");
        assert.ok(fields.length >= 2, "manual task fields missing");
        await fields[0].type("Parity task");
        await page.type("textarea", "Read and summarize the project.");
        await page.evaluate(() => [...document.querySelectorAll("button")].find(element => element.textContent.trim() === window.__PARITY__.copy['host.create']).click());
        await page.waitForFunction(() => document.body.innerText.includes(window.__PARITY__.copy['host.invalidRule']), { timeout: 10000, polling: 50 }).catch(async error => {
          console.error(JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, calls: window.__PARITY__.calls, fields: [...document.querySelectorAll("input,textarea")].map(element => ({ value: element.value, type: element.type })) }))));
          throw error;
        });
        assert.equal(await page.$eval("textarea", element => element.value), "Read and summarize the project.");
        await page.evaluate(() => { window.__PARITY__.setCreateFailure(false); });
        await page.evaluate(() => [...document.querySelectorAll("button")].find(element => element.textContent.trim() === window.__PARITY__.copy['host.create']).click());
        await page.waitForFunction(() => window.__PARITY__.calls.filter(call => call.endpoint === "schedule/create").length === 2);
        await page.waitForFunction(() => window.__PARITY__.source.getSnapshot().records.some(record => record.id === "created-task"));
      }
      const requests = async page => page.evaluate(() => window.__PARITY__.calls.filter(call => call.endpoint === "schedule/create").map(call => call.args));
      assert.deepEqual(await requests(adapted.page), await requests(reference.page));
    }
    assert.deepEqual(reference.errors, [], `${name}: official reference browser errors`);
    assert.deepEqual(adapted.errors, [], `${name}: adapted browser errors`);
    report.cases.push({ name, screenshotEqual: true, controls: b.controls.length, sha256: createHash("sha256").update(before).digest("hex"), ...(state === "manual" ? { createRefusalPreservesDraft: true, retryRequestEqual: true } : {}) });
    console.log(`parity: ${name} passed`);
  } finally { await reference.page.close(); await adapted.page.close(); }
}
try {
  for (const locale of ["en", "zh"]) {
    for (const state of ["empty", "loading", "error", "list", "manual"]) await compare("schedule", state, locale);
    await compare("permission", "supported", locale);
    await compare("terminal", "unavailable", locale);
    await compare("session-log", "unavailable", locale);
    await compare("feedback", "unavailable", locale);
    await compare("feedback", "message", locale);
    await compare("feedback", "actions", locale);
  }
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, cases: report.cases.length, output }));
} finally {
  await closeAcceptanceBrowser(browser);
  await server?.close();
}
