#!/usr/bin/env node
/** Online rendered brand checks in both locales; only the isolated account's locale is changed and restored. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { officialSessionPage, officialSessionProjections, assertStatsMatchJournal, assertVisibleSessionStats } from "./acceptance-turn-semantics.mjs";

const { base, credentials } = remoteAcceptanceConfig();
const output = resolve(import.meta.dirname, "../../../.artifacts/acceptance/online-sidebar");
mkdirSync(output, { recursive: true });
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(30000) });
const login = await request("/api/auth/sign-in/username", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) });
assert.equal(login.status, 200, "isolated acceptance sign-in must succeed");
const match = login.headers.getSetCookie().join("; ").match(/(__Secure-better-auth\.session_token)=([^;]+)/u);
assert.ok(match, "authentication returned no session cookie");
const call = async (method, params = {}) => {
  const response = await request("/api/session-host", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${match[1]}=${match[2]}` }, body: JSON.stringify({ method, params }) });
  const body = await response.json();
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);assert.equal(body.error, undefined);assert.ok(Object.hasOwn(body, "result"));return body.result;
};
const originalPreference = (await call("settingsDescribe")).values?.locale?.preference;
const sessions = (await call("list")).sessions;
const requestedSessionId = process.env.DSH_ACCEPTANCE_SESSION_ID;
const ordinary = sessions.find(session => session.blank === false && session.archived !== true
  && (requestedSessionId === undefined || session.sessionId === requestedSessionId));
assert.ok(ordinary, "run official-ui acceptance first to provide a completed isolated Session");
const sessionId = ordinary.sessionId;
const officialOptions = { base, cookie: `${match[1]}=${match[2]}`, sessionId };
const sessionStats = assertStatsMatchJournal(await officialSessionProjections(officialOptions), await officialSessionPage(officialOptions));
const transcript = await call("page", { address: { kind: "session", sessionId }, limit: 100 });
const assistantText = transcript.records.filter(record => record.role === "assistant").flatMap(record => record.parts ?? []).filter(part => part.type === "text" && part.text.trim() !== "").at(-1)?.text;
assert.ok(assistantText, "brand capture requires a completed assistant reply to verify history readiness");
let browser;
const observations = [], errors = [];
try {
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, args: ["--no-sandbox", "--disable-http2"] });
  const page = await browser.newPage();await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: match[1], value: match[2], url: base, httpOnly: true, secure: true, sameSite: "Lax" });
  page.on("pageerror", error => errors.push(error.message));page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  for (const locale of ["en", "zh"]) {
    await page.goto(`${base}${locale === "zh" ? "/zh-CN" : ""}/agent/${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector('[contenteditable="true"][role="textbox"]', { timeout: 45000 });
    await page.waitForFunction(id => [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].some(row => row.dataset.rowKey === `session:${id}`), { timeout: 30000 }, sessionId);
    await page.waitForSelector(`button[aria-label="${locale === "zh" ? "新建会话" : "New session"}"]`, { timeout: 30000 });
    await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 30000 }, assistantText.slice(0, 50));
    await assertVisibleSessionStats(page, sessionStats, locale);
    await page.evaluate(() => document.fonts.ready);
    const brand = await page.$eval('[class*="brandIdentity"]', element => ({ text: element.textContent.trim(), copyVersion: element.querySelector('[data-copy-version]') !== null, logo: Boolean(element.closest("button")?.querySelector("svg")) }));
    // Only the official name slot is occupied; the official mark fallback keeps
    // the version copy affordance while the visible name has no version line.
    assert.deepEqual(brand, { text: "dsh-base", copyVersion: true, logo: true });
    const active = await page.evaluate(() => {
      const rows = window.__DSH_BASE_PLUGINS__;return ["@dsh-base/client-brand", "@deepseek-ai/dsh-client-ui-sidebar"].map(name => ({ name, enabled: rows.find(row => row.moduleName === name)?.enabled, phase: rows.find(row => row.moduleName === name)?.fiberPhase }));
    });
    for (const row of active) { assert.equal(row.enabled, true);assert.equal(row.phase, "active"); }
    const completedTurns = await page.$$eval('button[data-turn-process]', buttons => buttons
      .filter(button => button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0)
      .map(button => button.getAttribute('data-turn-process')));
    await page.screenshot({ path: join(output, `sidebar-${locale}.png`) });
    observations.push({ locale, ...brand, active, completedTurns, sessionStats });
  }
  assert.deepEqual(errors, [], "online shell must not emit browser errors during bilingual brand capture");
} finally {
  try { await closeAcceptanceBrowser(browser); }
  finally { await call("settingsMutate", { ns: "locale", ops: [originalPreference === undefined ? { op: "unset", path: ["preference"] } : { op: "set", path: ["preference"], value: originalPreference }] }); }
}
writeFileSync(join(output, "report.json"), JSON.stringify({ ok: true, base, deploymentVersion: process.env.DSH_ACCEPTANCE_VERSION, sessionId, observations, errors }, null, 2));
console.log(JSON.stringify({ ok: true, deploymentVersion: process.env.DSH_ACCEPTANCE_VERSION, sessionId, locales: observations.map(row => row.locale), exactName: "dsh-base", versionLine: false, output }));
