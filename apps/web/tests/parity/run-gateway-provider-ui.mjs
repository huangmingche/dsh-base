#!/usr/bin/env node
/** Compare the actual Gateway provider card with pinned official Models row/editor styles. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { closeAcceptanceBrowser } from "../../scripts/acceptance-config.mjs";
const app = resolve(import.meta.dirname, "../..");
const requireFromApp = createRequire(resolve(app, "package.json"));
const puppeteer = requireFromApp("puppeteer-core").default;
const vite = await import(requireFromApp.resolve("vite"));
const output = resolve(process.env.DSH_PARITY_OUTPUT ?? resolve(app, "dist/parity-evidence/gateway-provider-ui"));
const configFile = resolve(app, "vite.parity.config.ts");
let browser, server, result, failure;
const previewSockets = new Set();
const cleanupErrors = [];
/** Bound cleanup without leaving a timeout handle or replacing an assertion failure. */
async function within(action, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
/** Kill only the Chrome process this runner launched if graceful cleanup fails. */
async function stopOwnedBrowser(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  try { await within(() => exited, 2000, 'owned Chrome termination'); }
  catch { child.kill('SIGKILL'); await within(() => exited, 2000, 'owned Chrome forced termination'); }
  child.stdout?.destroy(); child.stderr?.destroy();
}
const geometry = async page => page.evaluate(() => {
  const row = document.querySelector('[data-testid="official-reference"] li');
  const gateway = document.querySelector('[data-parity-row="gateway"]');
  const rowHead = row?.querySelector('[class*="rowHead"]');
  const gatewayHead = gateway?.querySelector('[class*="rowHead"]');
  const rowButton = row?.querySelector('button');
  const gatewayButton = gateway?.querySelector('button');
  const name = row?.querySelector('[class*="rowName"]');
  const gatewayName = gateway?.querySelector('[class*="rowName"]');
  const picked = element => {
    if (element === null || element === undefined) return null;
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(" "),
      borderWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      gap: style.gap,
      color: style.color,
      background: style.backgroundColor,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
    };
  };
  return {
    row: picked(row), gateway: picked(gateway),
    rowHead: picked(rowHead), gatewayHead: picked(gatewayHead),
    button: picked(rowButton), gatewayButton: picked(gatewayButton),
    name: picked(name), gatewayName: picked(gatewayName),
  };
});
const stable = (a, b) => {
  for (const key of ["height", "padding", "borderWidth", "borderRadius", "gap", "fontSize", "lineHeight", "fontWeight", "color", "background"]) {
    if (a?.[key] === undefined) continue;
    assert.equal(b?.[key], a[key], `computed ${key}: reference ${a?.[key]} vs Gateway ${b?.[key]}`);
  }
};
try {
  await mkdir(output, { recursive: true });
  await vite.build({ configFile, logLevel: "error" });
  server = await vite.preview({ configFile, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  server.httpServer.on('connection', socket => {
    previewSockets.add(socket); socket.once('close', () => previewSockets.delete(socket));
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
  const shots = [], cases = [];
  const open = async ({ locale = "en", theme = "light", state = "available", width = 1440 }) => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()) });
    await page.setViewport({ width, height: 900 });
    await page.goto(`${origin}/?${new URLSearchParams({ surface: "gateway-provider-ui", gatewayLocale: locale, state })}`, { waitUntil: "networkidle0" });
    try { await page.waitForSelector('[data-parity-row="gateway"]', { timeout: 30000 }) } catch (error) { console.error('GATEWAY FIXTURE DEBUG', JSON.stringify({ body: (await page.evaluate(() => document.body.innerText)).slice(0, 2000), errors })); throw error }
    if (theme === "dark") await page.evaluate(() => { document.body.dataset.dsDarkTheme = "" });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors };
  };
  for (const locale of ["en", "zh"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [1440, 720]) {
        const { page, errors } = await open({ locale, theme, width });
        const styles = await geometry(page);
        stable(styles.row, styles.gateway);
        stable(styles.rowHead, styles.gatewayHead);
        stable(styles.button, styles.gatewayButton);
        stable(styles.name, styles.gatewayName);
        assert.ok(styles.row.height <= 56, `compact row height ${styles.row.height}`);
        assert.ok(styles.gateway.height <= 56, `Gateway compact row height ${styles.gateway.height}`);
        assert.equal(styles.gateway.height, styles.row.height, `${locale}/${theme}/${width}: row height parity`);
        const shot = resolve(output, `gateway-row-${locale}-${theme}-${width}.png`);
        await page.screenshot({ path: shot }); shots.push(shot);
        cases.push({ locale, theme, width, rowHeight: styles.gateway.height, buttonHeight: styles.gatewayButton.height });
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  }
  // Expanded details: exact official editor surface, secondary provider id, read-only, keyboard/ARIA.
  for (const locale of ["en", "zh"]) {
    const { page, errors } = await open({ locale });
    const button = await page.$('[data-parity-row="gateway"] button');
    assert.ok(button, `${locale}: Details button`);
    await button.focus();
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-parity-row="gateway"] button')), true, `${locale}: Details focusable`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-parity-row="gateway"] button')?.getAttribute('aria-expanded') === 'true');
    const state = await page.evaluate(() => {
      const row = document.querySelector('[data-parity-row="gateway"]');
      const head = row?.querySelector('[class*="rowHead"]');
      const panel = row?.querySelector('[role="region"]');
      const editor = panel?.querySelector('[class*="editor"]');
      const officialEditor = document.querySelector('[data-testid="official-editor-reference"] [class*="editor"]');
      const style = element => element === null || element === undefined ? null : (() => { const s = getComputedStyle(element); return { padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(" "), background: s.backgroundColor, borderRadius: s.borderRadius, gap: s.gap } })();
      return {
        expanded: row?.querySelector('button')?.getAttribute('aria-expanded'),
        controls: row?.querySelector('button')?.getAttribute('aria-controls'),
        panelPresent: panel !== null,
        panelHidden: panel?.hasAttribute('hidden'),
        headText: head?.textContent ?? '',
        detailText: panel?.textContent ?? '',
        editor: style(editor), officialEditor: style(officialEditor),
        editable: [...(row?.querySelectorAll('input, textarea, select, [contenteditable="true"]') ?? [])].length,
        providerId: panel?.querySelector('[class*="editorRoute"]')?.textContent ?? '',
        statusRole: panel?.querySelector('[role="status"]') !== null,
        externalGap: (() => {
          const head = row?.querySelector('[class*="rowHead"]');
          const editor = panel?.querySelector('[class*="editor"]');
          return head && editor ? Math.round(editor.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null;
        })(),
      };
    });
    assert.equal(await page.$$eval('[data-parity-row="gateway"] [class*="credentialDot"]', nodes => nodes.length), 1, `${locale}: configured credential dot in available state`);
    assert.equal(await page.$eval('[data-parity-row="gateway"] [class*="credentialDot"]', node => node.getAttribute("role")), "img", `${locale}: credential dot is an image`);
    assert.equal(await page.$eval('[data-parity-row="gateway"] [class*="credentialDot"]', node => node.getAttribute("title")?.length > 0), true, `${locale}: credential dot has honest title`);
    assert.equal(await page.$$eval('[data-parity-row="gateway"] [class*="rowTag"]', nodes => nodes.length), 0, `${locale}: no custom status pill`);
    assert.equal(state.expanded, "true", `${locale}: expanded`);
    assert.equal(state.panelPresent, true); assert.equal(state.panelHidden, false);
    assert.ok(state.controls && state.controls.length > 0, `${locale}: aria-controls`);
    assert.equal(state.headText.includes("cloudflare-ai-gateway"), false, `${locale}: provider id not in collapsed title`);
    assert.equal(state.providerId, "cloudflare-ai-gateway", `${locale}: provider id is secondary detail`);
    assert.equal(state.editable, 0, `${locale}: no fake editable form`);
    assert.equal(state.statusRole, true, `${locale}: status announced`);
    assert.equal(state.externalGap, 12, `${locale}: rowCard header/editor external gap is 12px`);
    for (const key of ["padding", "background", "borderRadius", "gap"]) assert.equal(state.editor?.[key], state.officialEditor?.[key], `${locale}: editor ${key} parity`);
    assert.match(state.detailText, /Status|状态/u); assert.match(state.detailText, /Authentication|认证/u); assert.match(state.detailText, /Models|模型/u);
    assert.match(state.detailText, /DeepSeek-V4\.1-Flash/u); assert.match(state.detailText, /DeepSeek-V4-Pro/u);
    await page.screenshot({ path: resolve(output, `gateway-expanded-${locale}.png`) }); shots.push(resolve(output, `gateway-expanded-${locale}.png`));
    // Keyboard can close the same disclosure.
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-parity-row="gateway"] button')?.getAttribute('aria-expanded') === 'false');
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Truthful states: loading, error + retry, unavailable, and eight locale dictionaries.
  for (const stateName of ["loading", "error", "unavailable"]) {
    const { page, errors } = await open({ state: stateName });
    assert.equal(await page.$eval('[data-gateway-provider]', element => element.getAttribute('data-gateway-provider')), stateName);
    assert.equal(await page.$$eval('[data-parity-row="gateway"] [class*="credentialDot"]', nodes => nodes.length), 0, `${stateName}: no fake credential dot`);
    if (stateName === "error") {
      await page.evaluate(() => document.querySelector('[data-parity-row="gateway"] button[aria-expanded]')?.click());
      const errorShot = resolve(output, 'gateway-state-error.png');
      await page.screenshot({ path: errorShot }); shots.push(errorShot);
      const retry = await page.$('[data-parity-row="gateway"] [role="region"] button');
      assert.ok(retry, "error exposes Retry in details");
      await retry.click();
      await page.waitForFunction(() => document.querySelector('[data-parity-row="gateway"] [data-gateway-provider]')?.getAttribute('data-gateway-provider') === 'available');
      const recoveredShot = resolve(output, 'gateway-state-error-recovered.png');
      await page.screenshot({ path: recoveredShot }); shots.push(recoveredShot);
    } else {
      const shot = resolve(output, `gateway-state-${stateName}.png`);
      await page.screenshot({ path: shot }); shots.push(shot);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const locale of ["en", "zh", "ja", "es", "fr", "de", "ru", "pt"]) {
    const { page, errors } = await open({ locale });
    const text = await page.$eval('[data-parity-row="gateway"]', element => element.innerText);
    assert.equal(/tagAvailable|tagUnavailable|tagChecking|tagError|credentialConfigured|statusLabel|authenticationLabel|modelsLabel/u.test(text), false, `${locale}: all dictionary keys localized`);
    assert.match(text, /Cloudflare AI Gateway/u);
    assert.deepEqual(errors, []);
    await page.close();
  }
  result = { ok: true, scope: "pinned official Models row/editor styles vs actual Gateway provider card", cases, shots };
} catch (error) {
  failure = error;
} finally {
  const child = browser?.process();
  try { await within(() => closeAcceptanceBrowser(browser), 15000, 'browser shutdown'); }
  catch (error) {
    cleanupErrors.push(error);
    try { await stopOwnedBrowser(child); } catch (terminationError) { cleanupErrors.push(terminationError); }
  }
  if (server !== undefined) {
    try {
      server.httpServer.closeIdleConnections?.();
      await within(() => server.close(), 5000, 'preview shutdown');
    } catch (error) {
      cleanupErrors.push(error);
      // The HTTP server owns only this fixture's sockets, including upgraded ones.
      server.httpServer.closeAllConnections?.();
      for (const socket of previewSockets) socket.destroy();
      server.httpServer.unref();
    }
  }
  const cleanup = {
    browserExited: child === undefined || child.exitCode !== null || child.signalCode !== null,
    previewListening: server?.httpServer.listening ?? false,
    openPreviewSockets: [...previewSockets].filter(socket => !socket.destroyed).length,
  };
  if (!cleanup.browserExited || cleanup.previewListening || cleanup.openPreviewSockets !== 0) {
    cleanupErrors.push(new Error(`Fixture resources did not close: ${JSON.stringify(cleanup)}`));
  }
  result = {
    ...result, ok: failure === undefined && cleanupErrors.length === 0,
    ...(failure === undefined ? {} : { error: String(failure?.stack ?? failure) }),
    cleanup: { ...cleanup, errors: cleanupErrors.map(error => String(error?.stack ?? error)) },
  };
  await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2)).catch(error => { cleanupErrors.push(error); });
}
// Cleanup failures remain visible while the original test failure stays primary.
if (cleanupErrors.length > 0) console.error('Gateway fixture cleanup:', ...cleanupErrors);
if (failure !== undefined) throw failure;
if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Gateway fixture cleanup failed');
console.log(JSON.stringify({ ok: true, cases: result.cases, screenshots: result.shots, cleanup: result.cleanup }));
