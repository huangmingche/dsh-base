#!/usr/bin/env node
/**
 * Browser acceptance for the human-in-the-loop approval card.
 *
 * Opens the official UI, sends an approval-gated `remember_fact` prompt through
 * the composer, waits for the official approval card, answers "Allow once",
 * and verifies the resumed turn settles in both the DOM and the durable Host
 * transcript with no pending approvals left.
 */
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser, registrationHeaders, mayRegisterAcceptance, waitForHostReadiness } from "./acceptance-config.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { officialSessionPage, officialSessionProjections, waitForUserTurnSemantics, assertVisibleTurnProcesses, assertStatsMatchJournal, assertVisibleSessionStats } from "./acceptance-turn-semantics.mjs";

const { base, credentials } = remoteAcceptanceConfig();
const chromePath = chromeExecutable();
const suffix = Date.now().toString(36);
const username = credentials.username;
const password = credentials.password;
const cookieName = "__Secure-better-auth.session_token";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let lastStep = "start";
const mark = (step) => { lastStep = step; console.error(`[approval-ui] ${new Date().toISOString()} ${step}`); };
const watchdog = setTimeout(() => {
  console.error(`approval-ui watchdog: stalled at "${lastStep}"`);
  process.exit(3);
}, 720_000);
watchdog.unref?.();

function rawCookie(response) {
  return ((response.headers.getSetCookie?.() ?? []).join("; ") || response.headers.get("set-cookie")) ?? "";
}

async function authFetch(path, body) {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base, ...(path.endsWith("sign-up/email") ? registrationHeaders() : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok || response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw lastError ?? new Error(`auth failed: ${path}`);
}

mark("auth");
let response = await authFetch("/api/auth/sign-in/username", { username, password });
if (!response.ok && mayRegisterAcceptance()) response = await authFetch("/api/auth/sign-up/email", { username, name: username, email: credentials.email, password });
const token = rawCookie(response).match(new RegExp(`${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`))?.[1];
assert(token !== undefined && token !== "", "no session token");
const cookie = `${cookieName}=${token}`;

async function hostCall(method, params = {}) {
  const result = await fetch(`${base}/api/session-host`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const envelope = await result.json();
  assert(result.status === 200, `${method}: HTTP ${result.status}`);
  assert(envelope.error === undefined && Object.hasOwn(envelope, "result"), `${method}: invalid Host result`);
  return envelope;
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "dsh-approval-ui-")),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: cookieName, value: token, url: base, httpOnly: true, secure: true, sameSite: "Lax" });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

const startedAt = Date.now();
try {
  const created = await hostCall("create", { title: `Approval UI ${suffix}` });
  assert(typeof created.result?.sessionId === "string", "approval UI: Host did not create its isolated Session");
  mark("host-readiness");
  await waitForHostReadiness(async (method, params) => {
    const response = await fetch(`${base}/api/session-host`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(20_000) });
    return { status: response.status, body: await response.json() };
  }, created.result.sessionId);
  const sessionUrl = `${base}/agent/${encodeURIComponent(created.result.sessionId)}`;
  let booted = false;
  for (let attempt = 1; attempt <= 5 && !booted; attempt += 1) {
    mark(`boot:attempt-${attempt}`);
    try {
      await page.evaluate((url) => { location.href = url; }, sessionUrl).catch(() => {});
      // The official coding/chat views have different localized placeholder
      // text. Inspect the actual writable composer contract instead of old copy.
      await page.waitForSelector('[contenteditable="true"][role="textbox"]', { timeout: 45_000 });
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label*="Select model" i]')]
        .some(button => !button.disabled && /DeepSeek/i.test(button.textContent ?? "")), { timeout: 30_000 });
      booted = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await page.evaluate(() => { location.reload(); }).catch(() => {});
    }
  }
  if (!booted) {
    const state = await page.evaluate(() => ({
      url: location.href,
      body: document.body.innerText.slice(0, 300),
      plugins: (window.__DSH_BASE_PLUGINS__ ?? []).length,
    })).catch(() => undefined);
    throw new Error(`approval UI: app never booted state=${JSON.stringify(state)} pageErrors=${JSON.stringify(pageErrors.slice(0, 5))} consoleErrors=${JSON.stringify(consoleErrors.slice(0, 5))}`);
  }

  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  const composer = await page.$('[contenteditable="true"], textarea, [role="textbox"]');
  assert(composer !== null, "approval UI: composer missing");
  await composer.click();
  const prompt = `请务必调用 remember_fact 工具记住：我的名字是 ApprovalUI${suffix}。保存完成后只回复 OK。`;
  mark("composer:send");
  await page.keyboard.type(prompt);
  await page.keyboard.press("Enter");

  mark("card:wait");
  let cardSeen = false;
  let allowClicked = false;
  const cardDeadline = Date.now() + 120_000;
  while (Date.now() < cardDeadline && !cardSeen) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim())).catch(() => []);
    if (buttons.some((text) => /Allow once|允许一次/.test(text))) {
      cardSeen = true;
      const completedBeforeApproval = await page.$$eval('button[data-turn-process]', buttons => buttons.filter(button => button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0).length);
      assert(completedBeforeApproval === 0, "approval UI: an awaiting-approval turn must not already display Completed");
      const awaitingPage = await officialSessionPage({ base, cookie, sessionId: created.result.sessionId });
      assert(awaitingPage.records.filter(record => record.event?.type === "turn/start").length === 1, "approval UI: the awaiting user request owns one turn");
      assert(awaitingPage.records.every(record => record.event?.type !== "turn/end"), "approval UI: pending approval must not close the official turn");
      allowClicked = await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((candidate) => /Allow once|允许一次/.test((candidate.textContent ?? "").trim()));
        button?.click();
        return button !== undefined;
      }).catch(() => false);
    }
  }
  assert(cardSeen, "approval UI: official approval card never appeared");
  assert(allowClicked, "approval UI: could not click Allow once");
  mark("card:allowed");

  mark("settle:wait");
  let settled = false;
  let records = [];
  const settleDeadline = Date.now() + 120_000;
  while (Date.now() < settleDeadline && !settled) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    records = (await hostCall("page", { address: { kind: "session", sessionId: created.result.sessionId }, limit: 20 })).result.records ?? [];
    // The prompt also contains "OK": only an actual durable assistant answer
    // proves approval resumed the turn, never the page's echoed user prompt.
    settled = records.some(record => record.role === "assistant" && (record.parts ?? []).some(part => part.type === "text" && /OK/.test(String(part.text))));
  }
  assert(settled, "approval UI: approved turn never settled with OK");

  mark("host:verify");
  const sessions = (await hostCall("list")).result?.sessions ?? [];
  const session = sessions.find((row) => String(row.title).includes(suffix));
  assert(session !== undefined, "approval UI: session not found in Host list");
  const assistantParts = records.filter((record) => record.role === "assistant").flatMap((record) => record.parts ?? []);
  assert(!assistantParts.some((part) => part.state === "approval-requested"), "approval UI: tool call stayed approval-requested");
  assert(assistantParts.some((part) => part.type === "text" && /OK/.test(String(part.text))), "approval UI: transcript has no OK reply");
  const pending = (await hostCall("pendingApprovals", { sessionId: session.sessionId })).result;
  assert((pending.approvals ?? []).length === 0 && (pending.toolApprovals ?? []).length === 0, "approval UI: approvals still pending");
  const readOfficialPage = () => officialSessionPage({ base, cookie, sessionId: session.sessionId });
  const expectedTurn = { promptNeedle: suffix, toolName: "remember_fact", expectedUserTurns: 1 };
  const turnSemantics = await waitForUserTurnSemantics(readOfficialPage, expectedTurn);
  await assertVisibleTurnProcesses(page, turnSemantics);
  const readStats = () => officialSessionProjections({ base, cookie, sessionId: session.sessionId });
  const sessionStats = assertStatsMatchJournal(await readStats(), await readOfficialPage());
  assert(sessionStats.turns === 1 && sessionStats.steps >= 2, "approval continuation must count as additional steps of one turn");
  await assertVisibleSessionStats(page, sessionStats);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[contenteditable="true"][role="textbox"]', { timeout: 45000 });
  await assertVisibleTurnProcesses(page, turnSemantics);
  const reloadedSemantics = await waitForUserTurnSemantics(readOfficialPage, expectedTurn);
  assert(JSON.stringify(reloadedSemantics) === JSON.stringify(turnSemantics), "approval UI: reload changed turn/step/tool ownership");
  assertStatsMatchJournal(await readStats(), await readOfficialPage());
  await assertVisibleSessionStats(page, sessionStats);
  assert(consoleErrors.length === 0, `approval UI: console errors: ${JSON.stringify(consoleErrors)}`);
  assert(pageErrors.length === 0, `approval UI: page errors: ${JSON.stringify(pageErrors)}`);

  mark("done");
  clearTimeout(watchdog);
  console.log(JSON.stringify({
    ok: true,
    base,
    sessionId: session.sessionId,
    cardSeen,
    allowClicked,
    settled,
    turnSemantics,
    sessionStats,
    singleCompletionAfterReload: true,
    consoleErrors,
    pageErrors,
    durationMs: Date.now() - startedAt,
  }, null, 1));
} finally {
  clearTimeout(watchdog);
  await closeAcceptanceBrowser(browser);
}
