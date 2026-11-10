#!/usr/bin/env node
/**
 * P7 local acceptance: the restored subagent row declares unavailable in the
 * official inventory UI (localized), the class/export is restored with empty
 * storage, and no tool is advertised.
 *
 * Built Worker + real local D1/DO + Chromium. The model is never called.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
if (process.env.DSH_ACCEPTANCE_OUT === undefined || process.env.DSH_ACCEPTANCE_OUT === "") {
  throw new Error("DSH_ACCEPTANCE_OUT is required: handoff evidence directories are immutable — pass a fresh output directory");
}
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT);
mkdirSync(artifacts, { recursive: true });
const port = process.env.DSH_LOCAL_PORT ?? "5183";
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app,
  env: {
    ...process.env,
    DSH_LOCAL_PORT: port,
    DSH_LOCAL_REGISTRATION_TOKEN: registrationToken,
    DSH_LOCAL_FORBID_OUTBOUND: "1",
    DSH_LOCAL_COMPATIBILITY_DATE: process.env.DSH_LOCAL_COMPATIBILITY_DATE ?? "2026-10-30",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser;
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await sleep(100);
  }

  const account = {
    username: `sub${randomBytes(8).toString("hex")}`,
    name: "Subagent acceptance",
    email: `sub-${randomBytes(8).toString("hex")}@example.test`,
    password: randomBytes(32).toString("base64url"),
  };
  const auth = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken },
    body: JSON.stringify(account),
  });
  assert.equal(auth.status, 200, `local signup: ${await auth.clone().text()}`);
  const cookie = (auth.headers.getSetCookie() ?? []).join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  assert.ok(cookie, "local signup returned no session cookie");
  const sessionCookie = `${cookie[1]}=${cookie[2]}`;
  const call = async (method, params = {}) => {
    const response = await request("/api/session-host", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, cookie: sessionCookie },
      body: JSON.stringify({ method, params }),
    });
    assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
    const value = await response.json();
    assert.equal(value.error, undefined, `${method}: ${JSON.stringify(value.error)}`);
    return value.result;
  };

  browser = await puppeteer.launch({ ...acceptanceLaunchOptions(), userDataDir: mkdtempSync(join(tmpdir(), "dsh-subagent-")) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error?.message ?? error).slice(0, 300)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, sameSite: "Lax" });

  const clickText = async pattern => {
    const clicked = await page.evaluate(source => {
      const regex = new RegExp(source, "i");
      const element = [...document.querySelectorAll("button, [role='menuitem'], a, li")]
        .find(candidate => regex.test((candidate.textContent ?? "").trim()) || regex.test(candidate.getAttribute("aria-label") ?? ""));
      element?.click();
      return element !== undefined;
    }, pattern);
    assert.equal(clicked, true, `missing control: ${pattern}`);
  };
  const openInventory = async locale => {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[contenteditable="true"]', { timeout: 120_000 });
    await clickText(locale === "zh" ? "账号菜单|account menu" : "account menu|账号菜单");
    await clickText(locale === "zh" ? "^设置" : "^settings\\b");
    await clickText(locale === "zh" ? "内置插件" : "built-in plugins");
    await page.waitForSelector('[data-plugin-scope="preset"]', { timeout: 30_000 });
  };
  const subagentCard = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-plugin-scope="preset"] [data-plugin-module]')]
      .find(element => element.dataset.pluginModule === "@dsh-base/cloudflare-think-subagent");
    if (row === undefined) return null;
    return { text: (row.closest("[class*=card]") ?? row.parentElement)?.innerText ?? "", ariaLabel: row.getAttribute("aria-label") ?? "" };
  });

  // English: the official card names the unavailable state and explains the empty storage.
  await openInventory("en");
  const enCard = await subagentCard();
  assert.notEqual(enCard, null, "the restored subagent row must stay visible in Session plugins");
  assert.match(enCard.text, /Subagent \(unavailable\)/u, "the card title declares unavailability");
  assert.match(enCard.text, /no history to verify/u, "the card explains the empty storage instead of claiming history");
  assert.doesNotMatch(enCard.text, /Runtime/u, "the row must not claim a live fiber phase");
  await page.screenshot({ path: join(artifacts, "subagent-inventory-en.png") });

  // Chinese: the same facts are localized, not English fallback.
  await call("settingsUpdate", { ns: "locale", patch: { preference: "zh" } });
  await openInventory("zh");
  const zhCard = await subagentCard();
  assert.notEqual(zhCard, null, "中文界面同样保留子代理条目");
  assert.match(zhCard.text, /子代理（不可用）/u, "中文卡片标题声明不可用");
  assert.match(zhCard.text, /无历史可验/u, "中文卡片写明无历史可验");
  await page.screenshot({ path: join(artifacts, "subagent-inventory-zh.png") });

  // Restored class/export: sqlite Durable Object + binding, no tombstone left.
  const config = JSON.parse(readFileSync(join(app, ".cloudflare/output/v0/workers/default/worker.config.json"), "utf8"));
  assert.deepEqual(config.exports.DshSubagent, { type: "durable-object", storage: "sqlite" }, "DshSubagent must be a real sqlite Durable Object again");
  assert.deepEqual(config.env.DshSubagent, { type: "durable-object", worker: config.name, exportName: "DshSubagent" }, "the DshSubagent namespace binding must exist");
  assert.doesNotMatch(JSON.stringify(config.exports.DshSubagent), /deleted/u, "no deleted tombstone may remain");
  const composition = readFileSync(join(app, "src/agent/generated-composition.ts"), "utf8");
  assert.match(composition, /import \{ subagentTools as plugin\d+ \} from "@dsh-base\/cloudflare-think-subagent"/u, "the unavailable-declaration plugin is composed");
  assert.doesNotMatch(composition, /delegate_task/u, "no delegation tool may be composed");

  const report = {
    ok: true,
    base,
    titleEn: "Subagent (unavailable)",
    titleZh: "子代理（不可用）",
    storageEmptyWording: "no history to verify / 无历史可验",
    durableObject: config.exports.DshSubagent,
    binding: config.env.DshSubagent,
    delegateToolComposed: false,
    consoleErrors: errors.slice(-5),
    artifacts,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(artifacts, "subagent-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(artifacts, "server.log"), serverLog);
  assert.deepEqual(errors, [], "subagent acceptance emitted browser errors");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(artifacts, "failure.json"), `${JSON.stringify({ error: String(error?.stack ?? error), serverLog: serverLog.slice(-8000) }, null, 2)}\n`);
  throw error;
} finally {
  await closeAcceptanceBrowser(browser);
  const killServerTree = signal => {
    try { process.kill(-server.pid, signal); } catch { try { server.kill(signal); } catch { /* already gone */ } }
  };
  killServerTree("SIGTERM");
  await sleep(1500);
  if (server.exitCode === null) killServerTree("SIGKILL");
}
