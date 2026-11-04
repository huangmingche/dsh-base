import { chromeExecutable, closeAcceptanceBrowser } from "../../../../apps/web/scripts/acceptance-config.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../.."), app = resolve(root, "apps/web");
const require = createRequire(resolve(app, "package.json"));
const vite = await import(require.resolve("vite")), puppeteer = require("puppeteer-core").default;
const Excel = require("exceljs");
const configFile = resolve(import.meta.dirname, "vite.config.mjs");
let browser, server;
const cases = [];
const evidence = resolve(root, ".artifacts/browser-compat-evidence");
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
  const result = await page.evaluate((pdfBytes, xlsxBytes) => window.checkPreview(pdfBytes, xlsxBytes), pdf(), [...new Uint8Array(await workbook.xlsx.writeBuffer())]);
  assert.equal(result.pages, 1); assert.deepEqual(result.pixel, [255, 0, 0, 255]);
  assert.ok(result.fontBytes > 1000); assert.ok(result.stylesheetBytes > 10000);
  assert.equal(result.csv.sheets[0].celldata.find(cell => cell.r === 1 && cell.c === 0).v.v, "Dsh-base");
  assert.equal(result.xlsx.sheets[0].celldata.find(cell => cell.r === 0 && cell.c === 1).v.v, 42);
  assert.equal(result.invalid, true); assert.deepEqual(result.failures, []); assert.deepEqual(errors, []);
  const notice = await readFile(resolve(root, ".artifacts/browser-compat/third-party/document-preview.txt"), "utf8");
  for (const text of ["PDF.js", "FortuneSheet", "exceljs", "fflate", "xlsx"]) assert.ok(notice.includes(text));
  cases.push({ surface: "document-preview", realPdfWorker: true, redCanvas: true, bundledFont: true, stylesheetBytes: result.stylesheetBytes, csv: true, xlsx: true, invalidWorkbookRejected: true });
  await page.close();
  for (const locale of ["en", "zh"]) for (const policy of ["closed", "enabled", "failed"]) {
    const p = await browser.newPage(), calls = [], failures = [];
    p.on("pageerror", e => failures.push(e.message));
    await p.setRequestInterception(true);
    p.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth-policy") return void request.respond({ status: policy === "failed" ? 503 : 200, contentType: "application/json", body: JSON.stringify({ signUpEnabled: policy === "enabled" }) });
      if (path.startsWith("/api/auth/")) { calls.push(path); return void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "fixture", username: "test", email: "test@example.com" } }) }); }
      void request.continue();
    });
    await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await p.goto(`${origin}/?surface=login&locale=${locale}`);
    await p.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent.includes("…"));
    const disabled = await p.$eval(".dsh-login-switch", button => button.disabled);
    assert.equal(disabled, policy !== "enabled");
    if (policy !== "enabled") {
      assert.match(await p.$eval('[role="status"]', el => el.textContent), locale === "zh" ? /注册/ : /registration|Registration/);
      await p.click(".dsh-login-switch");
      assert.equal(await p.$('input[name="email"]'), null);
    }
    const palettes = [];
    for (const scheme of ["light", "dark", "light"]) {
      await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await p.waitForFunction(expected => document.documentElement.style.colorScheme === expected, {}, scheme);
      const palette = await p.evaluate(() => {
        const surface = document.querySelector("#dsh-base-login"), title = document.querySelector(".dsh-login-title");
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--dsw-alias-bg-base)";
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
        probe.remove(); return result;
      });
      assert.deepEqual(palette.background, palette.expectedBackground, "login background must use the real official palette token");
      assert.deepEqual(palette.foreground, palette.expectedForeground, "title must follow the official foreground token");
      assert.equal(palette.background[3], 255, "login surface must have an opaque official background");
      assert.ok(contrast(palette.foreground, palette.background) >= 7, "primary title must be readable on its actual background");
      assert.equal(palette.darkAttribute, scheme === "dark");
      assert.equal(palette.source, "system"); assert.equal(palette.fontSize, "14px");
      palettes.push({ scheme, primaryContrast: contrast(palette.foreground, palette.background), ...palette });
      await p.screenshot({ path: resolve(evidence, `login-${locale}-${policy}-${scheme}.png`) });
    }
    await p.type('input[name="username"]', "test"); await p.type('input[name="password"]', "test-password");
    await p.click('.dsh-login-submit'); await p.waitForFunction(() => location.pathname === "/signed-in-fixture");
    assert.deepEqual(calls, ["/api/auth/sign-in/username"]); assert.deepEqual(failures, []);
    cases.push({ surface: "login", locale, policy, registerVisible: true, registerDisabled: disabled, realSignInRequest: true, actualPluginApply: true, palettes });
    await p.close();
  }
  await writeFile(resolve(root, ".artifacts/browser-compat-report.json"), JSON.stringify({ ok: true, cases }, null, 2));
  console.log(`browser source compatibility: ${cases.length} cases passed (real PDF/Excel workers and localized registration policy)`);
} finally { await closeAcceptanceBrowser(browser); await server?.close(); }
