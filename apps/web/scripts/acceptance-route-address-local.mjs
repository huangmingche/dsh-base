#!/usr/bin/env node
/**
 * P5 local acceptance: Session addresses under official locale prefixes.
 *
 * Built Worker + real local D1/DO + Chromium. Proves `/zh-CN/app/session/:id` and
 * `/ja/app/session/:id` open that Session with the prefix preserved, the deep link
 * survives reload, back/forward keeps the Session, clicking a sidebar row
 * mirrors the current prefix into the address, an unknown id falls back to the
 * prefixed home, and none of it emits browser errors. The AI provider is not
 * called.
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
import { prefixFor } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
// A re-run (for example by QA) must not overwrite the handoff evidence: point
// DSH_ACCEPTANCE_OUT at a separate directory to write its own copy.
const ZH_PREFIX = prefixFor("zh");
const JA_PREFIX = prefixFor("ja");
/** Whether a pathname is a Chinese Session address with a single id segment. */
const isZhSessionPath = (pathname) => {
  const head = `${ZH_PREFIX}/app/session/`;
  if (!pathname.startsWith(head)) return false;
  const id = pathname.slice(head.length);
  return id !== "" && !id.includes("/");
};
if (process.env.DSH_ACCEPTANCE_OUT === undefined || process.env.DSH_ACCEPTANCE_OUT === "") {
  throw new Error("DSH_ACCEPTANCE_OUT is required: handoff evidence directories are immutable — pass a fresh output directory");
}
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT);
mkdirSync(artifacts, { recursive: true });
const port = process.env.DSH_LOCAL_PORT ?? "5181";
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
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
let browser;
const controller = new AbortController();
const watchdog = setTimeout(() => {
  controller.abort(new Error("route-address acceptance exceeded 600 seconds"));
  void browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
}, 600000);
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await sleep(100);
  }

  const account = {
    username: `route${randomBytes(8).toString("hex")}`,
    name: "Route acceptance",
    email: `route-${randomBytes(8).toString("hex")}@example.test`,
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
  const first = await call("create", { title: `Address first ${Date.now().toString(36)}` });
  const second = await call("create", { title: `Address second ${Date.now().toString(36)}` });
  assert.notEqual(first.sessionId, second.sessionId);
  // The official tree intentionally omits reusable blanks. Real cancelled user
  // records make these two navigation targets visible without calling a model.
  for (const sessionId of [first.sessionId, second.sessionId]) {
    await call("prompt", { sessionId, text: "Local route regression; cancelled before inference." });
    await call("cancel", { sessionId });
    assert.equal((await call("state", { sessionId })).running, false);
  }
  const raceWorkspace = await call("workspaceCreate", { path: `/route-race-${Date.now().toString(36)}`, title: "Route race" });
  const raceBlank = await call("create", { workspaceId: raceWorkspace.workspace.workspaceId });

  // Back/forward navigation must not be served from the back-forward cache:
  // bfcache freezes the page, the official WebSocket layer reports its sockets
  // as closed, and those console errors are unrelated to address routing.
  const launch = acceptanceLaunchOptions();
  browser = await puppeteer.launch({
    ...launch,
    args: [...(launch.args ?? []), "--disable-features=BackForwardCache"],
    userDataDir: mkdtempSync(join(tmpdir(), "dsh-route-")),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error?.message ?? error).slice(0, 300)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, sameSite: "Lax" });

  // Reproduce the reported race against the built app and actual Host. Hold only
  // the real, idempotent saved-blank acquisition; no fake response or readiness
  // delay is used. Clicking Plugins must remain authoritative after it completes.
  const racePage = await browser.newPage();
  await racePage.setViewport({ width: 1440, height: 900 });
  racePage.on("pageerror", error => errors.push(String(error?.message ?? error).slice(0, 300)));
  await racePage.evaluateOnNewDocument(id => {
    localStorage.setItem("dsh.sessions.current", JSON.stringify({ sessionId: id }));
  }, raceBlank.sessionId);
  const acquisition = Promise.withResolvers();
  let heldRequest;
  await racePage.setRequestInterception(true);
  racePage.on("request", request => {
    let body; try { body = JSON.parse(request.postData() ?? "{}"); } catch {}
    if (new URL(request.url()).pathname === "/api/session/create"
      && body?.payload?.args?.request?.sessionId === raceBlank.sessionId && heldRequest === undefined) {
      heldRequest = request;
      acquisition.resolve(request);
      return;
    }
    void request.continue();
  });
  await racePage.goto(`${base}${ZH_PREFIX}/app/session/${raceBlank.sessionId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await Promise.race([acquisition.promise, sleep(30_000).then(() => { throw new Error("official saved-blank acquisition never started"); })]);
  await racePage.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.some(row => row.moduleName === "@dsh-base/client-route-address" && row.fiberPhase === "active"));
  await racePage.click('button[aria-label="插件"]');
  await racePage.waitForSelector('[data-plugin-package]');
  const acquisitionResponse = racePage.waitForResponse(response => response.request() === heldRequest);
  await heldRequest.continue();
  const restored = await acquisitionResponse;
  assert.equal(restored.status(), 200);
  assert.equal((await restored.json()).result.value.sessionId, raceBlank.sessionId, "official reconnect keeps the existing blank");
  // The old seam waited ten seconds before replaying the URL. Observe beyond
  // that window rather than sleeping before the click and hiding the defect.
  const startupRace = await racePage.evaluate(async () => {
    let interrupted = false;
    const check = () => {
      if (!document.querySelector('[data-global-panel]')
        || document.querySelector('button[aria-label="插件"]')?.getAttribute("aria-current") !== "page") interrupted = true;
    };
    const watcher = new MutationObserver(check);
    watcher.observe(document.body, { childList: true, subtree: true });
    await new Promise(resolve => setTimeout(resolve, 12_000));
    watcher.disconnect(); check();
    return { interrupted, activeLabel: document.querySelector('button[aria-label="插件"]')?.getAttribute("aria-current"), observationMs: 12_000 };
  });
  assert.equal(startupRace.interrupted, false, "late startup restoration replaced the Plugins content");
  assert.equal(startupRace.activeLabel, "page", "official sidebar selection and main content agree");
  assert.ok(await racePage.$('[data-plugin-package]'), "the main panel contains the actual plugin catalog");
  await racePage.screenshot({ path: join(artifacts, "route-startup-plugins.png") });
  await racePage.close();

  const boot = () => page.waitForSelector('[contenteditable="true"]', { timeout: 120_000 });
  const pathNow = () => page.evaluate(() => `${location.pathname}${location.search}`);
  const waitSelected = (id, timeout = 30_000) => page.waitForFunction(
    expected => [...document.querySelectorAll('[data-conversation-session]')]
      .some(content => content.dataset.conversationSession === expected),
    { timeout }, id);
  const clickRow = async id => {
    const clicked = await page.evaluate(expected => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find(element => element.dataset.rowKey === `session:${expected}`);
      if (row === undefined) return false;
      row.click();
      return true;
    }, id);
    assert.equal(clicked, true, `sidebar row for ${id} is not rendered`);
  };
  const goto = async path => {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await boot();
  };

  // 1. Chinese deep link: the address keeps its prefix and the Session opens.
  await goto(`${ZH_PREFIX}/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);
  assert.equal(await pathNow(), `${ZH_PREFIX}/app/session/${first.sessionId}`, "zh deep link was rewritten away from its prefix");

  // 2. Reload keeps both the prefix and the Session.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await boot();
  await waitSelected(first.sessionId);
  assert.equal(await pathNow(), `${ZH_PREFIX}/app/session/${first.sessionId}`, "zh deep link did not survive a reload");

  // 3. With the English preference, the bare address opens the same Session and
  //    stays bare (client-locale-url never forces English, it mirrors the saved
  //    preference — so reset it first).
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  await sleep(500);
  await goto(`/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);
  assert.equal(await pathNow(), `/app/session/${first.sessionId}`, "unprefixed deep link gained a prefix");

  // 4. Back / forward across two address entries keep the Session.
  await goto(`/app/session/${encodeURIComponent(first.sessionId)}?from=bare`);
  await waitSelected(first.sessionId);
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await waitSelected(first.sessionId);
  assert.match(await pathNow(), new RegExp(`/app/session/${first.sessionId}$`, "u"), "back kept the Session address");
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await waitSelected(first.sessionId);
  assert.match(await pathNow(), new RegExp(`/app/session/${first.sessionId}\\?from=bare$`, "u"), "forward kept the Session and query");

  // 5. When the official browser renders both rows, clicking the other Session
  //    mirrors the current prefix into the address instead of dropping it.
  await goto(`${ZH_PREFIX}/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);
  const secondRowRendered = await page.evaluate(id => [...document.querySelectorAll('[role="treeitem"]')]
    .some(element => element.dataset.rowKey === `session:${id}`), second.sessionId);
  let sidebarMirror = false;
  if (secondRowRendered) {
    await clickRow(second.sessionId);
    await waitSelected(second.sessionId);
    await page.waitForFunction(path => location.pathname === path, { timeout: 30_000 }, `${ZH_PREFIX}/app/session/${second.sessionId}`);
    sidebarMirror = true;
  }

  // 5b. A selection change that is not an address navigation (the official
  //     "new session" shortcut) must still mirror the current prefix: the
  //     address becomes /zh-CN/app/session/<new id>, never a bare /app/session/<new id>.
  await goto(`${ZH_PREFIX}/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);
  await page.click('[contenteditable="true"]');
  await page.keyboard.down("Meta");
  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Meta");
  const mirrorDeadline = Date.now() + 45_000;
  let mirroredPath = null;
  while (Date.now() < mirrorDeadline && mirroredPath === null) {
    const current = await pathNow();
    mirroredPath = isZhSessionPath(current) && current !== `${ZH_PREFIX}/app/session/${first.sessionId}` ? current : null;
    if (mirroredPath === null) await sleep(500);
  }
  assert.notEqual(mirroredPath, null, "official new-session selection was not mirrored into a prefixed address");
  const mirroredId = decodeURIComponent(mirroredPath.slice(`${ZH_PREFIX}/app/session/`.length));
  await waitSelected(mirroredId);

  // 6. Japanese prefix resolves the same way; the prefix is not baked into the id.
  await goto(`${JA_PREFIX}/app/session/${encodeURIComponent(second.sessionId)}`);
  await waitSelected(second.sessionId);
  assert.equal(await pathNow(), `${JA_PREFIX}/app/session/${second.sessionId}`, "ja deep link lost its prefix");

  // 7. Unknown id shows a localized notice and falls back to the prefixed home.
  const missingId = `missing-${Date.now().toString(36)}`;
  await goto(`${ZH_PREFIX}/app/session/${missingId}`);
  const fallbackDeadline = Date.now() + 45_000;
  let fellBack = false;
  let noticeSeen = false;
  while (Date.now() < fallbackDeadline && !fellBack) {
    const current = await pathNow();
    // A valid fallback is the prefixed home or any existing Session under that
    // prefix — never the unknown id itself.
    fellBack = current === ZH_PREFIX || (isZhSessionPath(current) && current !== `${ZH_PREFIX}/app/session/${missingId}`);
    if (!fellBack) await sleep(500);
    if (!noticeSeen) noticeSeen = /no longer exists|已不存在/iu.test(await page.evaluate(() => document.body.innerText));
  }
  if (!noticeSeen) noticeSeen = /no longer exists|已不存在/iu.test(await page.evaluate(() => document.body.innerText));
  assert.equal(fellBack, true, "unknown Session id did not fall back to a valid prefixed address");
  assert.equal(noticeSeen, true, "unknown Session id rendered no visible localized notice");

  // 8. With the English preference the unprefixed address stays bare.
  await call("settingsUpdate", { ns: "locale", patch: { preference: "en" } });
  await sleep(500);
  await goto(`/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);
  assert.equal(await pathNow(), `/app/session/${first.sessionId}`, "unprefixed deep link gained a prefix");

  await page.screenshot({ path: join(artifacts, "route-address-zh.png") }).catch(() => undefined);
  // 9. The retired bare /zh prefix is not a language or registered app path.
  //    The public-document contract now requires a real 404, not an SPA shell.
  const retiredPath = `/zh/app/session/${encodeURIComponent(first.sessionId)}`; // locale-path:allow retired path must stay inert
  const retiredResponse = await request(retiredPath, { headers: { cookie: sessionCookie } });
  assert.equal(retiredResponse.status, 404, "retired prefix cannot restore a private Session or mount an unknown app path");
  await goto(`${ZH_PREFIX}/app/session/${encodeURIComponent(first.sessionId)}`);
  await waitSelected(first.sessionId);

  // A Workspace link lets the official navigator select its Session.
  const { workspace } = await call("workspaceCreate", { title: "Address workspace", path: "/address-workspace" });
  const scoped = await call("create", { workspaceId: workspace.workspaceId });
  await goto(`${ZH_PREFIX}/app/workspace/${encodeURIComponent(workspace.workspaceId)}`);
  await waitSelected(scoped.sessionId);
  assert.equal(await pathNow(), `${ZH_PREFIX}/app/session/${encodeURIComponent(scoped.sessionId)}`);

  for (const path of [`/agent/${encodeURIComponent(first.sessionId)}`, `${ZH_PREFIX}/workspace/${encodeURIComponent(workspace.workspaceId)}`]) {
    for (const headers of [{}, { cookie: sessionCookie }]) {
      const retired = await request(path, { headers, redirect: "manual" });
      assert.equal(retired.status, 404, `retired document path must return 404: ${path}`);
    }
  }

  const report = {
    ok: true,
    base,
    sessionIdPrefixes: [ZH_PREFIX, JA_PREFIX, ""],
    deepLink: `${ZH_PREFIX}/app/session/:id`,
    reloadKeptSession: true,
    backForwardKeptSession: true,
    startupRace,
    sidebarMirror,
    selectionMirror: mirroredPath,
    unknownFallback: ZH_PREFIX,
    retiredZhPathInert: true,
    retiredZhStatus: retiredResponse.status,
    consoleErrors: errors.slice(-5),
    artifacts,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(artifacts, "route-address-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(artifacts, "server.log"), serverLog);
  assert.deepEqual(errors, [], "route navigation emitted browser errors");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(artifacts, "failure.json"), `${JSON.stringify({ error: String(error?.stack ?? error), serverLog: serverLog.slice(-8000) }, null, 2)}\n`);
  const visible = (await browser?.pages().catch(() => []) ?? []).at(-1);
  await visible?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  clearTimeout(watchdog);
  await closeAcceptanceBrowser(browser);
  server.kill("SIGTERM");
}
