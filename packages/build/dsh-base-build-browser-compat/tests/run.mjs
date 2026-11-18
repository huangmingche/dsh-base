import { chromeExecutable, closeAcceptanceBrowser } from "../../../../apps/web/scripts/acceptance-config.mjs";
import { checkOfficialWorkbooks, checkReadOnlyWorkbook } from "./excel-workbooks.mjs";
import { checkWorkspaceWorkbook } from "./workspace-workbook.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../.."), app = resolve(root, "apps/web");
const require = createRequire(resolve(app, "package.json"));
const vite = await import(require.resolve("vite")), puppeteer = require("puppeteer-core").default;
const Excel = require("exceljs");
const configFile = resolve(import.meta.dirname, "vite.config.mjs");
let browser, server;
const cases = [];
const evidence = resolve(root, ".artifacts/browser-compat-evidence");
const modal = '[role="dialog"]:has([data-auth-dialog])';
async function clickText(page, text) {
  const handle = await page.evaluateHandle(({ selector, text }) => [...document.querySelectorAll(`${selector} button`)].find(element => element.textContent.trim() === text), { selector: modal, text });
  const button = handle.asElement(); assert.ok(button, `missing login action: ${text}`);
  try { await button.click(); } finally { await handle.dispose(); }
}
async function waitForLogin(page, locale) {
  await page.waitForSelector(`${modal} [data-auth-step="identifier"]`, { visible: true });
  const unavailable = locale === "zh" ? "本站暂未启用邮箱验证和密码找回。" : "Email verification and password recovery are unavailable on this site.";
  // Every policy fixture disables email. These titles change from checkingPolicy
  // only after readAuthPolicy resolves and LoginSurface renders the final policy.
  await page.waitForFunction(({ selector, unavailable }) => {
    const buttons = [...document.querySelectorAll(`${selector} [data-auth-email]`)];
    return buttons.length === 2 && buttons.every(button => button.disabled && button.title === unavailable);
  }, {}, { selector: modal, unavailable });
  assert.equal(await page.$(`${modal} [role="status"]`), null, "identifier entry has no repeated mail availability paragraph");
}
const luminance = ([red, green, blue]) => [red, green, blue].map(value => {
  const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
function pdf() {
  const stream = "1 0 0 rg 0 0 100 100 re f\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let body = "%PDF-1.4\n", offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(body)];
}
try {
  await mkdir(evidence, { recursive: true });
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.checkPreview === "function");
  const workbook = new Excel.Workbook(), sheet = workbook.addWorksheet("Example"); sheet.addRow(["Dsh-base", 42]);
  workbook.addWorksheet("Second").addRow(["Selected second sheet"]);
  const workbookBytes = [...new Uint8Array(await workbook.xlsx.writeBuffer())];
  const result = await page.evaluate((pdfBytes, xlsxBytes) => window.checkPreview(pdfBytes, xlsxBytes), pdf(), workbookBytes);
  const officialWorkbookFixtures = await checkOfficialWorkbooks(page, root);
  await checkReadOnlyWorkbook(page, workbookBytes);
  await checkWorkspaceWorkbook(page);
  assert.equal(result.pages, 1); assert.deepEqual(result.pixel, [255, 0, 0, 255]);
  assert.ok(result.fontBytes > 1000); assert.ok(result.stylesheetBytes > 10000);
  assert.equal(result.csv.sheets[0].celldata.find(cell => cell.r === 1 && cell.c === 0).v.v, "Dsh-base");
  assert.equal(result.xlsx.sheets[0].celldata.find(cell => cell.r === 0 && cell.c === 1).v.v, 42);
  assert.equal(result.invalid, true); assert.deepEqual(result.failures, []); assert.deepEqual(errors, []);
  const outputAssets = resolve(root, ".artifacts/browser-compat/assets");
  const licenseSections = [];
  for (const file of await readdir(outputAssets)) {
    if (!file.endsWith(".js")) continue;
    const code = await readFile(resolve(outputAssets, file), "utf8");
    licenseSections.push(...code.split("// Third-party software licenses\n").slice(1));
  }
  const notice = licenseSections.join("\n");
  const spreadsheetNotice = licenseSections.find(section => section.includes("FortuneSheet"));
  assert.ok(spreadsheetNotice, "the embedded Excel worker carries its own notices");
  for (const name of ["anynum", "is-unsafe", "xml-naming", "strnum", "@nodable/entities"]) {
    assert.ok(spreadsheetNotice.includes(name), `missing Excel worker dependency: ${name}`);
  }
  for (const holder of ["2021 Natural Intelligence", "2026 Natural Intelligence", "2026 Nodable"]) {
    assert.equal(spreadsheetNotice.split(`// Copyright (c) ${holder}\n`).length - 1, 1, `expected one bundled notice for ${holder}`);
  }
  for (const text of ["PDF.js", "FortuneSheet", "exceljs", "fflate", "xlsx", "Copyright (c) 2026 DeepSeek", "SIL OPEN FONT LICENSE"]) assert.ok(notice.includes(text));
  assert.doesNotMatch(notice, /DeepSeek Harness Base attribution|dsh-source\.lock\.json/);
  for (const path of ["third-party-notices.txt", "third-party/document-preview.txt"]) {
    await assert.rejects(readFile(resolve(root, ".artifacts/browser-compat", path)), { code: "ENOENT" });
  }
  cases.push({ surface: "document-preview", realPdfWorker: true, redCanvas: true, bundledFont: true, stylesheetBytes: result.stylesheetBytes, csv: true, xlsx: true, officialWorkbookFixtures, readOnlySheetSwitch: true, invalidWorkbookRejected: true });
  await page.close();
  for (const locale of ["en", "zh"]) for (const policy of ["closed", "enabled", "failed"]) {
    const p = await browser.newPage(), calls = [], failures = [];
    p.on("pageerror", e => failures.push(e.message));
    await p.setRequestInterception(true);
    p.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth-policy") return void request.respond({ status: policy === "failed" ? 503 : 200, contentType: "application/json", body: JSON.stringify({ signUpEnabled: policy === "enabled", email: { enabled: false, ready: false, provider: null }, passwordResetEnabled: false, emailVerificationEnabled: false, emailVerificationRequired: false, googleEnabled: false }) });
      if (path.startsWith("/api/auth/")) { calls.push(path); return void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "fixture", username: "test", email: "test@example.com" } }) }); }
      void request.continue();
    });
    await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await p.goto(`${origin}/?surface=login&locale=${locale}`);
    await waitForLogin(p, locale);
    assert.equal(await p.$$eval(`${modal} .dsh-auth-providers button`, buttons => buttons.length === 3 && buttons.every(button => button.disabled)), true, "unavailable social controls stay visible and disabled");
    assert.equal(await p.$$eval(`${modal} [data-auth-email]`, buttons => buttons.length === 2 && buttons.every(button => button.disabled)), true, "unconfigured email controls stay visible and disabled");
    await clickText(p, locale === "zh" ? "创建账户" : "Create an account");
    await p.waitForSelector(`${modal} [data-auth-step="register"]`, { visible: true });
    const disabled = await p.$eval(`${modal} button[type="submit"]`, button => button.disabled);
    assert.equal(disabled, policy !== "enabled");
    await p.type(`${modal} input[name="username"]`, "newuser");
    await p.type(`${modal} input[name="email"]`, "new@example.test");
    await p.type(`${modal} input[name="password"]`, "test-password");
    await p.click(`${modal} button[type="submit"]`);
    if (policy !== "enabled") {
      assert.match(await p.$eval(modal, el => el.textContent), locale === "zh" ? /注册/ : /registration|Registration/);
      assert.deepEqual(calls, [], "closed or failed policy never submits registration");
      assert.ok(await p.$(`${modal} [data-auth-step="register"]`));
      await clickText(p, locale === "zh" ? "已有账户，去登录" : "I already have an account");
    } else {
      await p.waitForFunction(() => location.pathname === "/signed-in-fixture");
      assert.deepEqual(calls, ["/api/auth/sign-up/email"], "enabled registration sends the real signup request");
      await p.goto(`${origin}/?surface=login&locale=${locale}`);
    }
    await waitForLogin(p, locale);
    assert.equal(await p.$(`${modal} input[name="email"]`), null);
    assert.equal(await p.$(`${modal} input[name="password"]`), null, "identifier step never exposes a password input");
    const palettes = [];
    for (const scheme of ["light", "dark", "light"]) {
      await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await p.waitForFunction(expected => document.documentElement.style.colorScheme === expected, {}, scheme);
      const palette = await p.evaluate(() => {
        const surface = document.querySelector('[role="dialog"]:has([data-auth-dialog])'), title = surface.querySelector("h2");
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--dsw-alias-bg-layer-2)";
        probe.style.color = "var(--dsw-alias-label-primary)";
        document.body.append(probe);
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext("2d");
        const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
        const result = {
          background: rgba(getComputedStyle(surface).backgroundColor),
          foreground: rgba(getComputedStyle(title).color),
          expectedBackground: rgba(getComputedStyle(probe).backgroundColor),
          expectedForeground: rgba(getComputedStyle(probe).color),
          darkAttribute: document.body.hasAttribute("data-ds-dark-theme"),
          source: document.documentElement.getAttribute("data-ds-theme-source"),
          fontSize: document.body.style.getPropertyValue("--dsh-content-font-size"),
        };
        probe.style.backgroundColor = "var(--dsw-alias-bg-base)";
        result.documentBackground = rgba(getComputedStyle(document.body).backgroundColor);
        result.expectedDocumentBackground = rgba(getComputedStyle(probe).backgroundColor);
        probe.remove(); return result;
      });
      assert.deepEqual(palette.background, palette.expectedBackground, "login Modal background must use the real official layer token");
      assert.deepEqual(palette.documentBackground, palette.expectedDocumentBackground, "public document background must use the official base token");
      assert.deepEqual(palette.foreground, palette.expectedForeground, "title must follow the official foreground token");
      assert.equal(palette.background[3], 255, "login surface must have an opaque official background");
      assert.ok(contrast(palette.foreground, palette.background) >= 7, "primary title must be readable on its actual background");
      assert.equal(palette.darkAttribute, scheme === "dark");
      assert.equal(palette.source, "system"); assert.equal(palette.fontSize, "14px");
      palettes.push({ scheme, primaryContrast: contrast(palette.foreground, palette.background), ...palette });
      await p.screenshot({ path: resolve(evidence, `login-${locale}-${policy}-${scheme}.png`) });
    }
    const beforeSignIn = [...calls];
    await p.type(`${modal} input[name="username"]`, "test"); await p.click(`${modal} button[type="submit"]`);
    await p.waitForSelector(`${modal} [data-auth-step="password"]`, { visible: true });
    assert.deepEqual(calls, beforeSignIn, "identifier step does not send credentials");
    await p.type(`${modal} input[name="password"]`, "test-password");
    await p.click(`${modal} button[type="submit"]`); await p.waitForFunction(() => location.pathname === "/signed-in-fixture");
    assert.deepEqual(calls, [...beforeSignIn, "/api/auth/sign-in/username"]); assert.deepEqual(failures, []);
    cases.push({ surface: "login", locale, policy, registerVisible: true, registerSubmitDisabled: disabled, realRegistrationRequest: policy === "enabled", realSignInRequest: true, twoStepSignIn: true, unavailableControlsDisabled: true, actualPluginApply: true, palettes });
    await p.close();
  }
  await writeFile(resolve(root, ".artifacts/browser-compat-report.json"), JSON.stringify({ ok: true, cases }, null, 2));
  console.log(`browser source compatibility: ${cases.length} cases passed (real PDF/Excel workers and localized registration policy)`);
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
