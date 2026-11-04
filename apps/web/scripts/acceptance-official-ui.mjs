#!/usr/bin/env node
/**
 * Acceptance for the official DSH chat UI mounted on the Workers-native Host.
 *
 * Verifies the official-first surface end to end against a deployed Worker:
 * - official `session/*` unary RPC (the Phase C bridge) and the custom
 *   `/api/session-host` fallback both serve the same durable Host;
 * - the DeepSeek model catalog and real persisted effort choices and provider response provenance;
 * - the official chat UI streams through the agent-live WebSocket while the
 *   official Connection keeps the `/api/remote.mux` carrier open;
 * - RunningStatus starts and completes, the reply survives a page reload, and
 *   the browser reports no console/page/request failures.
 *
 * WebSocket observation uses the CDP `Network` domain: puppeteer-core's
 * page-level `websocket` event does not fire for these connections in the
 * pinned Chrome build.
 *
 * Usage:
 *   DSH_BASE_URL=https://... node scripts/acceptance-official-ui.mjs
 * Optional: CHROME_PATH, DSH_ACCEPTANCE_USERNAME, DSH_ACCEPTANCE_EMAIL,
 * DSH_ACCEPTANCE_PASSWORD.
 */
import { remoteAcceptanceConfig, chromeExecutable, closeAcceptanceBrowser, registrationHeaders, mayRegisterAcceptance, waitForHostReadiness } from "./acceptance-config.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { officialSessionPage, waitForUserTurnSemantics, assertVisibleTurnProcesses, assertModelExecutionEvidence, findAssistantTextForPrompt } from "./acceptance-turn-semantics.mjs";

/** Fetch with bounded timeout and retries; Cloudflare's edge can drop a single cold request. */
async function fetchWithRetry(input, init = {}, { timeoutMs = 20_000, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: init.signal ?? controller.signal });
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  console.error(`fetchWithRetry failed: ${String(input)} (${String(lastError)})`);
  throw lastError;
}

const { base, credentials } = remoteAcceptanceConfig();
const chromePath = chromeExecutable();
const suffix = Date.now().toString(36);
const prompt = `官方验收 ${suffix}：请用一句话说明你运行在什么运行时上。`;
const sessionTitle = `Official acceptance ${suffix}`;
const cookieName = "__Secure-better-auth.session_token";
const host = `${base}/api/session-host`;

/** A failure with the command output needed to diagnose it. */
class AcceptanceError extends Error {}

function sessionCookieOf(response) {
  const raw = ((response.headers.getSetCookie?.() ?? []).join("; ")) || (response.headers.get("set-cookie") ?? "");
  const match = raw.match(new RegExp(`${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^=]*=([^;]+)`, "u"));
  return match?.[1];
}

/** Sign in, falling back to registering the acceptance account. */
async function authenticate() {
  const signIn = () => fetchWithRetry(`${base}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  const signUp = () => fetchWithRetry(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, ...registrationHeaders() },
    body: JSON.stringify({
      username: credentials.username,
      name: credentials.username,
      email: credentials.email,
      password: credentials.password,
    }),
  });
  let response = await signIn();
  if (!response.ok && mayRegisterAcceptance()) response = await signUp();
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    // Better Auth rate limits repeat automated sign-ins; one bounded retry.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    response = await signIn();
  }
  if (!response.ok) throw new AcceptanceError(`account authentication failed: ${response.status} ${await response.text()}`);
  const token = sessionCookieOf(response);
  if (token === undefined) throw new AcceptanceError("authentication returned no session cookie");
  return token;
}

/** POST one official `client-request` envelope and return its result envelope. */
async function rpc(method, args, cookie) {
  const rpcId = `acceptance-${suffix}-${method.replaceAll("/", "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetchWithRetry(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
  });
  const body = await response.json().catch(() => undefined);
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.equal(body?.type, "server-response", `${method}: not an official server-response`);
  assert.equal(body?.rpcId, rpcId, `${method}: rpcId mismatch`);
  return body.result;
}

/** Call the custom `/api/session-host` fallback transport. */
async function hostCall(method, params, cookie) {
  const response = await fetchWithRetry(host, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ method, params }),
  });
  const body = await response.json().catch(() => undefined);
  if (body?.error !== undefined) {
    throw new AcceptanceError(`${method}: ${body.error.code} ${body.error.message ?? ""}`);
  }
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  return body.result;
}

/** Page through every durable Host session. */
async function allHostSessions(cookie) {
  const sessions = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await hostCall("list", cursor === undefined ? {} : { cursor }, cookie);
    sessions.push(...result.sessions);
    cursor = result.cursor;
    if (cursor === undefined) break;
  }
  return sessions;
}

/** Find the Host turn created by this run and return its durable history. */
async function findPromptedTurn(cookie, needle = suffix, sessionId) {
  const sessions=sessionId===undefined ? await allHostSessions(cookie) : [{sessionId}];
  for (const session of sessions) {
    const history = await hostCall("history", {sessionId:session.sessionId}, cookie);
    const reply=findAssistantTextForPrompt(history.records??[],needle);
    if(reply!==undefined)return {sessionId:session.sessionId,...reply};
  }
  return undefined;
}

/** Collect one page-text snapshot used for status assertions. */
async function readPage(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      text,
      running: /Running/.test(text),
      completed: /Completed/.test(text),
    };
  });
}

const cookieHeader = (token) => `${cookieName}=${token}`;

// ---------------------------------------------------------------------------
// Phase C bridge: the official unary `session/*` endpoints on the live Worker.
// ---------------------------------------------------------------------------
const token = await authenticate();
const cookie = cookieHeader(token);

const created = await rpc("session/create", { request: { title: sessionTitle } }, cookie);
assert.equal(created.ok, true, `session/create: ${JSON.stringify(created)}`);
const rpcSessionId = created.value.sessionId;
assert.equal(typeof rpcSessionId, "string");
await waitForHostReadiness(async (method, params) => {
  const response = await fetchWithRetry(host, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ method, params }) });
  return { status: response.status, body: await response.json() };
}, rpcSessionId);

const listed = await rpc("session/list", { _request: {} }, cookie);
assert.equal(listed.ok, true);
assert.ok(listed.value.items.some((item) => item.sessionId === rpcSessionId), "session/list is missing the created session");

const state = await rpc("session/state", { request: { sessionId: rpcSessionId } }, cookie);
assert.equal(state.ok, true);
assert.equal(typeof state.value.running, "boolean");

const projections = await rpc("session/projections", { request: { sessionId: rpcSessionId } }, cookie);
assert.equal(projections.ok, true);
assert.equal(projections.value.kind, "sequenced");

const renamed = await rpc("session/rename", { request: { sessionId: rpcSessionId, title: `${sessionTitle} renamed` } }, cookie);
assert.equal(renamed.ok, true);

const catalog = await rpc("session/modelCatalog", {}, cookie);
assert.equal(catalog.ok, true);
const models = catalog.value.groups.flatMap((group) => group.models);
for (const modelId of ["deepseek-flash", "deepseek-v4-pro"]) {
  // R1 exposes two independent providers; catalog ids are group-prefixed.
  const model = models.find((candidate) => candidate.id === modelId
    || (candidate.id.endsWith(`/${modelId}`) && candidate.unavailable !== true))
    ?? models.find((candidate) => candidate.id.endsWith(`/${modelId}`));
  assert.ok(model, `session/modelCatalog: ${modelId} missing`);
  assert.deepEqual(
    model.reasoning.efforts.map((effort) => effort.id),
    ["off", "low", "high", "max"],
    `session/modelCatalog: ${modelId} efforts`,
  );
  assert.notEqual(model.reasoning.unavailable, true, `session/modelCatalog: ${modelId} effort is implemented`);
  assert.equal(model.reasoning.defaultEffort, "high", "official provider default effort is high");
}
const proModel = models.find((candidate) => candidate.unavailable !== true && candidate.id.endsWith("/deepseek-v4-pro"))
  ?? models.find((candidate) => candidate.id.endsWith("/deepseek-v4-pro"))
  ?? models.find((candidate) => candidate.id === "deepseek-v4-pro");
assert.ok(proModel, "session/modelCatalog: no executable deepseek-v4-pro");
const selected = await rpc("session/selectModel", {
  request: { sessionId: rpcSessionId, model: proModel.id, reasoningEffort: "low" },
}, cookie);
assert.equal(selected.ok, true);
assert.equal((await hostCall("state", { sessionId: rpcSessionId }, cookie)).model, proModel.id);

// The custom transport must keep serving the same durable Host.
const fallbackSessions = await allHostSessions(cookie);
assert.ok(
  fallbackSessions.some((session) => session.sessionId === rpcSessionId),
  "custom /api/session-host fallback cannot see the official-RPC session",
);

// ---------------------------------------------------------------------------
// Browser: login, official chat surface, streaming and history.
// ---------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "dsh-official-accept-")),
  // This host's Chrome HTTP/2 stack stalls against the Workers edge after a
  // burst of tabs; HTTP/1.1 is the reliable carrier for acceptance runs.
  // Set DSH_ACCEPTANCE_HTTP2=1 to exercise HTTP/2 explicitly.
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    ...(process.env.DSH_ACCEPTANCE_HTTP2 === "1" ? [] : ["--disable-http2"]),
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({ name: cookieName, value: token, url: base, httpOnly: true, secure: true, sameSite: "Lax" });

const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Runtime.enable");
const socketTimeline = [];
const consoleErrorDetails = [];
cdp.on("Runtime.consoleAPICalled", ({ type, timestamp, args, stackTrace }) => {
  if (type === "error") consoleErrorDetails.push({ timestamp, args: args.map(arg => ({ type: arg.type, subtype: arg.subtype, description: arg.description, value: arg.value })), stackTrace });
});
/** @type {Map<string, { url: string, received: number, sent: number, closed: boolean }>} */
const sockets = new Map();
/** @type {string[]} */
const textDeltas = [];
cdp.on("Network.webSocketCreated", ({ requestId, url }) => {
  sockets.set(requestId, { url, received: 0, sent: 0, closed: false });
});
const muxFrames = { sent: [], received: [] };
cdp.on("Network.webSocketFrameReceived", ({ requestId, timestamp, response }) => {
  const socket = sockets.get(requestId);
  if (socket === undefined) return;
  socket.received += 1;
  const payload = String(response?.payloadData ?? "");
  const url = new URL(socket.url);
  socketTimeline.push({ direction: "received", requestId, timestamp, path: url.pathname, sessionId: url.searchParams.get("sessionId"), payload });
  if (/text-delta/.test(payload)) textDeltas.push(payload);
  if (socket.url.includes("/api/remote.mux")) muxFrames.received.push(payload);
});
cdp.on("Network.webSocketFrameSent", ({ requestId, timestamp, response }) => {
  const socket = sockets.get(requestId);
  if (socket === undefined) return;
  socket.sent += 1;
  const url = new URL(socket.url);
  socketTimeline.push({ direction: "sent", requestId, timestamp, path: url.pathname, sessionId: url.searchParams.get("sessionId"), payload: String(response?.payloadData ?? "") });
  if (socket.url.includes("/api/remote.mux")) muxFrames.sent.push(String(response?.payloadData ?? ""));
});
cdp.on("Network.webSocketClosed", ({ requestId, timestamp }) => {
  const socket = sockets.get(requestId);
  if (socket !== undefined) {
    socket.closed = true;
    socketTimeline.push({direction:"closed",requestId,timestamp,wallTime:Date.now(),path:new URL(socket.url).pathname});
  }
});
cdp.on("Network.webSocketFrameError", ({requestId,timestamp,errorMessage})=>{
  const socket=sockets.get(requestId);
  socketTimeline.push({direction:"error",requestId,timestamp,wallTime:Date.now(),path:socket===undefined?undefined:new URL(socket.url).pathname,errorMessage});
});

/** @type {Array<{ path: string, status: number }>} */
const officialResponses = [];
const sessionRequests = [];
let beforeComposer;
cdp.on("Network.requestWillBeSent", ({ request }) => {
  const path = new URL(request.url).pathname;
  if (["/api/session/prompt", "/api/session/create", "/api/session/selectModel"].includes(path)) {
    sessionRequests.push({ path, payload: request.postData === undefined ? undefined : JSON.parse(request.postData) });
  }
});
cdp.on("Network.responseReceived", ({ response }) => {
  let path;
  try {
    path = new URL(response.url).pathname;
  } catch {
    return;
  }
  if (path.startsWith("/api/session/")) officialResponses.push({ path, status: response.status });
});

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("requestfailed", (request) => {
  if (!request.url().endsWith("/favicon.ico")) failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
});

let liveSessionId = "";
let turn;
let lastStep = "start";
const mark = (step) => { lastStep = step; console.error(`[acceptance] ${new Date().toISOString()} ${step}`); };
const startedAt = Date.now();
const watchdog = setTimeout(() => {
  console.error(`acceptance watchdog: stalled at "${lastStep}"`);
  process.exit(3);
}, 240_000);
watchdog.unref?.();
try {
  // The staging edge can drop one cold navigation/bundle request. Retry the
  // whole boot (including a reload) before failing the acceptance.
  const openApp = async () => {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      mark(`boot:attempt-${attempt}`);
      try {
        // Drive navigation through the page itself: chrome's lifecycle watcher
        // can wait forever for a stalled subresource on this proxy network,
        // while the document itself is already usable.
        // Model/effort controls belong to an actual Session in the official
        // shell. The home composer may be the inert, sessionless placeholder.
        await page.evaluate((url) => { location.href = url; }, `${base}/agent/${encodeURIComponent(rpcSessionId)}`).catch(() => undefined);
        await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
        const bodyText = await page.evaluate(() => document.body.innerText);
        assert.ok(!/Sign in to dsh-base/.test(bodyText), "boot landed on /login");
        await page.waitForFunction(() => /Workspace|Choose workspace/.test(document.body.innerText), { timeout: 30_000 });
        // The model catalog is asserted from the opened model menu; a slow
        // catalog must not fail the whole boot (the app can still compose).
        return;
      } catch (error) {
        lastError = error;
        const state = await page.evaluate(() => ({
          ready: document.readyState,
          body: document.body.innerText.slice(0, 120),
          plugins: (window.__DSH_BASE_PLUGINS__ ?? []).length,
        })).catch(() => undefined);
        console.error(`acceptance boot attempt ${attempt} failed: ${String(error).slice(0, 140)} state=${JSON.stringify(state)}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await page.evaluate(() => { location.reload(); }).catch(() => undefined);
      }
    }
    throw lastError;
  };
  await openApp();
  mark("booted");

  // Workspace picker and composer must be the official surface.
  const workspaceButton = await page.$('button[aria-label="Choose workspace"], button[aria-label*="choose workspace" i]');
  assert.ok(workspaceButton, "Workspace picker missing");
  const composer = await page.$('[contenteditable="true"], textarea, [role="textbox"]');
  assert.ok(composer, "official composer missing");

  // Zero-model smoke for the preset deployment acceptance: version, shell,
  // brand, and the real fork/disabled-original inventory; stop before any
  // model menu selection or prompt.
  if (process.env.DSH_ACCEPTANCE_SMOKE_ONLY === "true") {
    const expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
    assert.ok(expectedVersion, "DSH_ACCEPTANCE_SMOKE_ONLY requires DSH_EXPECTED_DEPLOYMENT_VERSION");
    // The script's earlier waitForHostReadiness already confirmed this exact
    // Worker version through the Host lifecycle gate.
    const inventory = await page.evaluate(() => window.__DSH_BASE_PLUGINS__ ?? []);
    const fork = inventory.find(entry => entry.moduleName === "@dsh-base/client-agent-preset");
    const original = inventory.find(entry => entry.moduleName === "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(fork?.origin, "custom"); assert.equal(fork?.enabled, true); assert.equal(fork?.fiberPhase, "active");
    assert.equal(fork?.replaces, "@deepseek-ai/dsh-client-ui-agent-preset");
    assert.equal(original?.origin, "upstream"); assert.equal(original?.enabled, false); assert.equal(original?.fiberPhase, null);
    const brand = await page.$eval('[class*="brandIdentity"]', element => element.textContent.trim());
    assert.equal(brand, "dsh-base");
    assert.ok(!/dsh-base\s+0\.1\.0/u.test(await page.evaluate(() => document.body.innerText)), "sidebar version must stay hidden");
    assert.ok(!officialResponses.some(entry => entry.path === "/api/session/prompt"), "smoke mode must not submit a prompt");
    assert.deepEqual(consoleErrors, []); assert.deepEqual(pageErrors, []);
    const directory = resolve(import.meta.dirname, "../../../.artifacts/acceptance/preset-deployed");
    mkdirSync(directory, { recursive: true });
    const screenshot = join(directory, `official-ui-smoke-${suffix}.png`);
    await page.screenshot({ path: screenshot });
    writeFileSync(join(directory, "official-ui-smoke.json"), JSON.stringify({
      ok: true, base, version: expectedVersion, brand, inventory: { fork, original },
      promptRequests: 0, consoleErrors, pageErrors, screenshot,
    }, null, 2) + "\n");
    await closeAcceptanceBrowser(browser);
    console.log(`official UI smoke: version ${expectedVersion}, fork active, no model call`);
    process.exit(0);
  }

  // Model menu: the official seat must offer both DeepSeek models and a visible
  // usable Effort control. The menu is a two-level surface: the root pane has
  // Model/Effort drill-in rows, and Escape pops one pane (it does not close the
  // menu). Opening only the root pane is the historical false negative.
  const modelTrigger = () => page.evaluate(() => {
    const trigger = [...document.querySelectorAll("button")]
      .find((button) => /select model/i.test(button.getAttribute("aria-label") ?? "")
        || /deepseek-v4|deepseek-v4\.1/i.test(button.textContent ?? ""));
    trigger?.click();
  });
  const menuState = () => page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    return menu === null ? null : menu.innerText;
  });
  const waitMenu = (open, timeout = 20_000) => page.waitForFunction(
    (expected) => (document.querySelector('[role="menu"]') !== null) === expected,
    { timeout },
    open,
  );
  const clickMenuItem = async (prefix) => {
    const found = await page.evaluate((needle) => {
      const menu = document.querySelector('[role="menu"]');
      const item = [...(menu?.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]') ?? [])]
        .find((candidate) => (candidate.textContent ?? "").trim().startsWith(needle));
      if (item === undefined) return null;
      item.click();
      return (item.textContent ?? "").trim().slice(0, 80);
    }, prefix);
    assert.ok(found !== null, `model menu row ${JSON.stringify(prefix)} missing`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return found;
  };
  const closeMenu = async () => {
    if ((await menuState()) === null) return;
    await modelTrigger();
    await waitMenu(false);
  };

  await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label*="Select model" i]')]
    .some(button => !button.disabled && /DeepSeek/i.test(button.textContent ?? "")), { timeout: 30000 });
  await modelTrigger();
  await waitMenu(true);
  const rootMenuText = await menuState();
  assert.match(rootMenuText, /Model/, "model menu root pane has no Model row");
  assert.match(rootMenuText, /Effort/, "model menu root pane has no Effort row");
  await clickMenuItem("Model");
  const modelListText = await menuState();
  assert.match(modelListText, /DeepSeek-V4\.1-Flash/, "DeepSeek-V4.1-Flash missing from the official model menu");
  assert.match(modelListText, /DeepSeek-V4-Pro/, "DeepSeek-V4-Pro missing from the official model menu");
  await page.keyboard.press("Escape"); // pop back to the root pane
  await new Promise((resolve) => setTimeout(resolve, 500));
  const effortAvailable = await page.$$eval('[role="menuitem"]', items => {
    const effort = items.find(item => /^Effort/.test(item.textContent?.trim() ?? ""));
    return effort?.matches(":disabled") === false;
  });
  assert.equal(effortAvailable, true, "implemented effort must be selectable in the official UI");
  await clickMenuItem("Effort");
  const effortMenuText = await menuState();
  for (const name of ["Off", "Low", "High", "Max"]) assert.match(effortMenuText, new RegExp(name));
  // Use one real keyboard selection before the existing model requests; no
  // extra provider call is needed to verify admission and later response data.
  const low = await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitemradio"]')].find(button => /^Low/.test(button.textContent.trim())));
  assert.ok(low.asElement()); await low.asElement().focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  assert.equal((await hostCall("state", { sessionId: rpcSessionId }, cookie)).reasoningEffort, "low", "UI effort acknowledgement must be durable");
  await closeMenu();
  assert.equal(await menuState(), null, "model menu did not close before composing");

  // Send the prompt through the official composer and watch the status lifecycle.
  mark("composer:send");
  beforeComposer = await page.evaluate(() => ({ path: location.pathname, selected: [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map(row => row.dataset.rowKey) }));
  await composer.click();
  await page.keyboard.type(prompt);
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const sendButton = await page.$('button[aria-label="Send message"]');
  if (sendButton !== null) await sendButton.click().catch(() => {});

  let runningSeen = false;
  let completedSeen = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshot = await readPage(page);
    if (snapshot.running) runningSeen = true;
    if (snapshot.completed) completedSeen = true;
    if (completedSeen) break;
  }
  if (!completedSeen) {
    // The staging carrier can stall the follow stream while the turn still
    // settles durably. Reload once and re-observe the completed status.
    mark("status:reload-recovery");
    await page.evaluate(() => { location.reload(); }).catch(() => {});
    await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
    const recoveryDeadline = Date.now() + 45_000;
    while (Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const snapshot = await readPage(page);
      if (snapshot.completed) {
        completedSeen = true;
        break;
      }
    }
  }
  mark("status:done");
  assert.ok(completedSeen, "RunningStatus never completed");
  if (!runningSeen) console.warn("acceptance: RunningStatus was not sampled before completion");

  // The reply is durable Host history; the DOM must render the same text.
  const turnDeadline = Date.now() + 30_000;
  while (Date.now() < turnDeadline) {
    turn = await findPromptedTurn(cookie, suffix, rpcSessionId);
    if (turn !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(turn !== undefined, "no assistant turn produced by the official composer");
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: 30_000 },
    turn.text.slice(0, 20),
  );

  // Streaming transport: official Connection carrier plus the agent-live socket.
  const liveSockets = [...sockets.values()].filter((socket) => socket.url.includes("/api/agent-live"));
  assert.ok(liveSockets.length > 0, "agent-live WebSocket was never opened");
  // The page may have follow sockets for restored Sessions; pick the one that
  // belongs to the Session this prompt actually created/used.
  liveSessionId = turn.sessionId;
  const sessionLiveSockets = liveSockets.filter((socket) => socket.url.includes(`sessionId=${encodeURIComponent(liveSessionId)}`));
  assert.ok(sessionLiveSockets.length > 0, `agent-live WebSocket missing for Session ${liveSessionId}`);
  // A reload or fast completion may have reopened the socket; the streamed
  // frames are the sum of this Session's live sockets.
  const liveFrames = sessionLiveSockets.reduce((total, socket) => total + socket.received, 0);
  assert.ok(liveFrames >= 10, `agent-live received only ${liveFrames} frame(s)`);
  assert.ok(textDeltas.length >= 10, `only ${textDeltas.length} text-delta frame(s) observed`);
  const mux = [...sockets.values()].find((socket) => socket.url.includes("/api/remote.mux"));
  assert.ok(mux !== undefined, "/api/remote.mux WebSocket was never opened");
  const settledState = await hostCall("state", { sessionId: liveSessionId }, cookie);
  assert.equal(settledState.running, false, "Host session still running after Completed");
  assert.equal(liveSessionId, rpcSessionId, "the official composer must send to the explicitly opened Session");
  assert.equal(settledState.reasoningEffort, "low", "prompt admission preserves selected effort");
  assert.equal(settledState.model, "deepseek-v4-pro", "the official first-prompt create retry reset the Session's selected model");
  assert.ok(typeof settledState.title === "string" && settledState.title.length > 0, "the completed Session lost its title");

  mark("streaming:done");

  // Official-first proof: the browser must have used the migrated RPC endpoints,
  // not silently fallen back to the custom transport.
  const officialPaths = new Set(officialResponses.filter((entry) => entry.status === 200).map((entry) => entry.path));
  for (const path of ["/api/session/list", "/api/session/modelCatalog", "/api/session/prompt"]) {
    assert.ok(officialPaths.has(path), `browser never completed ${path} through the official bridge`);
  }

  // Phase C streams: the migrated follow/control logical streams must actually
  // have opened on the Gateway mux and delivered official frames. A silent
  // fallback to the custom transport would leave these empty.
  const sentFrames = muxFrames.sent.join("\n");
  assert.match(sentFrames, /"endpoint":"session\/follow"/, "session/follow never opened on /api/remote.mux");
  assert.match(sentFrames, /"endpoint":"session\/control"/, "session/control never opened on /api/remote.mux");
  assert.match(sentFrames, /"endpoint":"workspace\/follow"/, "workspace/follow never opened on /api/remote.mux");
  const receivedFrames = muxFrames.received.join("\n");
  assert.match(receivedFrames, /"snapshot"/, "no official follow snapshot arrived from the mux");
  assert.match(receivedFrames, /"(event|turn\/start|user\/message)"/, "no official follow events arrived from the mux");
  assert.match(receivedFrames, /"baseline"/, "no official control baseline arrived from the mux");
  assert.match(receivedFrames, /"archivedSessionIds"/, "no official workspace baseline arrived from the mux");

  // The custom fallback must still serve the same Session used by the browser.
  const fallbackAfter = await allHostSessions(cookie);
  assert.ok(fallbackAfter.some((session) => session.sessionId === liveSessionId), "custom fallback lost the browser session");

  mark("history:reload");
  // History reload: the official UI must restore the conversation from the Host.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector('[contenteditable="true"], textarea, [role="textbox"]', { timeout: 60_000 });
  const expectedReply = turn.text.slice(0, 20);
  const waitForReply = async (timeout) => page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout },
    expectedReply,
  ).catch(() => {});
  await waitForReply(30_000);
  let reloadedText = await page.evaluate(() => document.body.innerText);
  // The reload may restore the home surface or a different sidebar window;
  // open this Session from the sidebar (its title carries the unique suffix).
  for (let attempt = 1; attempt <= 3 && !reloadedText.includes(expectedReply); attempt += 1) {
    const opened = await page.evaluate((needle) => {
      const candidates = [...document.querySelectorAll("button, [role=\"button\"], a")]
        .filter((element) => (element.textContent ?? "").includes(needle));
      const target = candidates.find((element) => element.getBoundingClientRect().width > 0);
      if (target === undefined) return false;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    }, suffix);
    if (opened) await waitForReply(20_000);
    reloadedText = await page.evaluate(() => document.body.innerText);
  }
  assert.ok(reloadedText.includes(expectedReply), "assistant reply did not survive a page reload");
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('DeepSeek-V4-Pro')), { timeout: 30000 });

  mark("tool:turn");
  // Tool turn: the mux journal must carry live tool call/result events and the
  // official process disclosure must render the tool detail. This is the
  // regression surface for the Workers Think tools (fetch_url et al).
  const toolNeedle = `tool-${suffix}`;
  const toolPrompt = `${toolNeedle}：请务必调用 fetch_url 工具读取 https://developers.cloudflare.com/ 页面，然后用一句话告诉我页面标题。`;
  const consoleBeforeTool = consoleErrors.length;
  const toolComposer = await page.$('[contenteditable="true"], textarea, [role="textbox"]');
  assert.ok(toolComposer, "official composer missing before the tool turn");
  await toolComposer.click();
  await page.keyboard.type(toolPrompt);
  assert.deepEqual(consoleErrors.slice(consoleBeforeTool), [], "rapid typing into the official composer must not cause a React update loop");
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const toolSend = await page.$('button[aria-label="Send message"]');
  if (toolSend !== null) await toolSend.click().catch(() => {});

  let toolTurn;
  const toolDeadline = Date.now() + 150_000;
  while (Date.now() < toolDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    toolTurn = await findPromptedTurn(cookie, toolNeedle, liveSessionId);
    if (toolTurn !== undefined) break;
  }
  assert.ok(toolTurn !== undefined, "tool turn produced no assistant reply");
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: 30_000 },
    toolTurn.text.slice(0, 20),
  );
  const toolPageText = await page.evaluate(() => document.body.innerText);
  assert.match(toolPageText, /fetch_url/, "tool detail/name missing from the official process disclosure");
  assert.match(toolPageText, /Called tools|Completed/, "tool process never settled in the official UI");
  const toolConsoleErrors = consoleErrors.slice(consoleBeforeTool);
  const unexpectedToolErrors = toolConsoleErrors;
  assert.deepEqual(unexpectedToolErrors, [], "unexpected console error during the tool turn");
  const toolMuxFrames = muxFrames.received.join("\n");
  assert.match(toolMuxFrames, /"tool\/call"/, "no tool/call journal event arrived from the mux");
  const readOfficialPage = () => officialSessionPage({ base, cookie, sessionId: liveSessionId });
  // Requested canonical model and actual provider response are distinct evidence.
  const expectedTurn = { promptNeedle: toolNeedle, toolName: "fetch_url", expectedUserTurns: 2,
    expectedModelSource: { provider: "deepseek-official" } };
  const turnSemantics = await waitForUserTurnSemantics(readOfficialPage, expectedTurn);
  const expectedExecution = { provider: "deepseek-official", requestedModel: "deepseek-v4-pro", reasoningEffort: "low" };
  const executionEvidence = assertModelExecutionEvidence(await hostCall("history", { sessionId: liveSessionId }, cookie), await readOfficialPage(), expectedExecution);
  await assertVisibleTurnProcesses(page, turnSemantics);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[contenteditable="true"][role="textbox"]', { timeout: 45000 });
  await assertVisibleTurnProcesses(page, turnSemantics);
  assert.deepEqual(await waitForUserTurnSemantics(readOfficialPage, expectedTurn), turnSemantics, "tool turn ownership must survive reload");
  assert.deepEqual(assertModelExecutionEvidence(await hostCall("history", { sessionId: liveSessionId }, cookie), await readOfficialPage(), expectedExecution), executionEvidence, "provider provenance and effort survive reload");
  assert.equal((await hostCall("state", { sessionId: liveSessionId }, cookie)).reasoningEffort, "low");
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('DeepSeek-V4-Pro')), { timeout: 30000 });

  const unexpectedConsoleErrors = consoleErrors;
  assert.deepEqual(unexpectedConsoleErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedRequests, []);

  clearTimeout(watchdog);
mark("done");
console.log(JSON.stringify({
    ok: true,
    base,
    rpcSessionId,
    liveSessionId,
    assistantText: turn.text.slice(0, 200),
    modelMenu: { models: ["DeepSeek-V4.1-Flash", "DeepSeek-V4-Pro"], effortAvailable: true, selectedEffort: "low", effortMenuText, executionEvidence },
    streaming: {
      agentLiveFrames: liveFrames,
      agentLiveSockets: sessionLiveSockets.length,
      textDeltas: textDeltas.length,
      remoteMuxOpen: true,
    },
    officialRpcSeenInBrowser: [...officialPaths].sort(),
    streamMux: {
      followOpened: /"endpoint":"session\/follow"/.test(sentFrames),
      controlOpened: /"endpoint":"session\/control"/.test(sentFrames),
      workspaceFollowOpened: /"endpoint":"workspace\/follow"/.test(sentFrames),
      followFrames: muxFrames.received.filter((frame) => /"snapshot"|"turn\/start"|"user\/message"/.test(frame)).length,
    },
    customFallback: true,
    runningStatus: { started: runningSeen, completed: completedSeen },
    historyReload: true,
    turnSemantics,
    completionProcessesAfterReload: turnSemantics.completionProcesses,
    toolTurn: {
      answered: toolTurn !== undefined,
      toolEventsFromMux: /"tool\/call"/.test(toolMuxFrames),
      unexpectedConsoleErrors: unexpectedToolErrors.length,
      assistantText: toolTurn.text.slice(0, 160),
    },
    browserErrors: {
      console: unexpectedConsoleErrors.length,
      page: pageErrors.length,
      failedRequests: failedRequests.length,
    },
    durationMs: Date.now() - startedAt,
  }, null, 2));
} finally {
  clearTimeout(watchdog);
  const directory = resolve(import.meta.dirname, "../../../.artifacts/acceptance");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `official-${suffix}-diagnostic.json`), JSON.stringify({
    rpcSessionId, liveSessionId, beforeComposer, sessionRequests, lastStep,
    sockets: [...sockets.values()].map(socket => { const url = new URL(socket.url);return { path: url.pathname, sessionId: url.searchParams.get("sessionId"), received: socket.received, sent: socket.sent, closed: socket.closed }; }),
    muxFrames, socketTimeline, consoleErrorDetails, consoleErrors, pageErrors, failedRequests,
  }, null, 2), { mode: 0o600 });
  await closeAcceptanceBrowser(browser);
}
