#!/usr/bin/env node
/** Characterize whether the sidebar Plugins click is lost before the official panel handler is ready. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromeExecutable } from "./acceptance-config.mjs";
import puppeteer from "puppeteer-core";

const app = resolve(import.meta.dirname, "..");
const out = resolve(app, "../../.artifacts/harness-handoff/probe-click-loss");
mkdirSync(out, { recursive: true });
const port = await new Promise(resolvePort => { const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => resolvePort(typeof address === "object" && address !== null ? address.port : 0)) }) });
const base = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], { cwd: app, env: { ...process.env, DSH_LOCAL_PORT: String(port), DSH_LOCAL_REGISTRATION_TOKEN: token, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: "2026-10-30" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { log = (log + String(data)).slice(-12000) });
const call = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
let browser;
try {
  for (let i = 0; ; i += 1) { if (server.exitCode !== null) throw new Error(log); if (log.includes("Local Worker ready:")) break; if (i > 100) throw new Error("startup timeout"); await new Promise(r => setTimeout(r, 100)) }
  const account = { username: `loss${randomBytes(8).toString("hex")}`, name: "Click Loss", email: `loss-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(32).toString("base64url") };
  const signup = await call("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": token }, body: JSON.stringify(account) });
  const match = signup.headers.getSetCookie().join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  const cookie = `${match[1]}=${match[2]}`;
  const sessionResponse = await call("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ method: "create", params: { title: "Click loss" } }) });
  const session = (await sessionResponse.json()).result;
  browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  for (const method of ["element.click", "page.click", "dispatchEvent"]) {
    for (const delay of [200, 500, 1000, 2000]) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, sameSite: "Lax" });
        await page.goto(`${base}/agent/${session.sessionId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('[contenteditable], textarea, [role="textbox"]', { timeout: 60000 });
        await page.waitForFunction(() => [...document.querySelectorAll("button, a")].some(element => (element.textContent ?? "").trim() === "Plugins" && element.getBoundingClientRect().width > 0), { timeout: 30000 });
        await new Promise(r => setTimeout(r, delay));
        const before = await page.evaluate(() => {
          const button = [...document.querySelectorAll("button, a")].find(element => (element.textContent ?? "").trim() === "Plugins" && element.getBoundingClientRect().width > 0)
          window.__loss = { mutations: 0, clicks: 0, replaced: false }
          if (button !== undefined) {
            const observer = new MutationObserver(() => { window.__loss.mutations += 1; if (!button.isConnected) window.__loss.replaced = true })
            observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
            window.__loss.observer = observer
            document.addEventListener("click", event => { if (event.target?.closest?.("button, a")?.textContent?.trim() === "Plugins") window.__loss.clicks += 1 }, true)
          }
          return { connected: button?.isConnected ?? false }
        });
        if (method === "element.click") await page.evaluate(() => [...document.querySelectorAll("button, a")].find(element => (element.textContent ?? "").trim() === "Plugins" && element.getBoundingClientRect().width > 0)?.click());
        else if (method === "dispatchEvent") await page.evaluate(() => { const button = [...document.querySelectorAll("button, a")].find(element => (element.textContent ?? "").trim() === "Plugins" && element.getBoundingClientRect().width > 0); button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })) });
        else { const handles = await page.$$("button, a"); for (const handle of handles) { const label = await handle.evaluate(element => (element.textContent ?? "").trim()); if (label === "Plugins") { await handle.click(); break } } }
        let opened = false;
        try { await page.waitForFunction(() => document.querySelector("[data-plugin-panel]") !== null, { timeout: 3000 }); opened = true } catch {}
        const after = await page.evaluate(() => ({ mutations: window.__loss?.mutations ?? 0, clicks: window.__loss?.clicks ?? 0, replaced: window.__loss?.replaced ?? false, buttonConnected: [...document.querySelectorAll("button, a")].some(element => (element.textContent ?? "").trim() === "Plugins" && element.isConnected) }));
        results.push({ method, delay, attempt, opened, beforeConnected: before.connected, after, href: page.url() });
        await page.close();
      }
    }
  }
  writeFileSync(join(out, "click-loss.json"), JSON.stringify({ ok: true, results }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, opened: results.filter(row => row.opened).length }));
} finally {
  await browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 800).unref();
}
