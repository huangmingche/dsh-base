/** Explicit remote targets/credentials; importing this module never contacts a deployment. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function remoteAcceptanceConfig(env = process.env) {
  const stored = env.DSH_ACCEPTANCE_CONFIG ? JSON.parse(readFileSync(env.DSH_ACCEPTANCE_CONFIG, "utf8")) : {};
  const raw = env.DSH_BASE_URL ?? env.SESSION_HOST_URL ?? stored.base;
  if (!raw) throw new Error("Set DSH_BASE_URL/SESSION_HOST_URL or DSH_ACCEPTANCE_CONFIG explicitly; no remote deployment is selected by default");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/u, "") !== "") throw new Error("Remote acceptance requires an explicit HTTPS origin");
  const credentials = {
    username: env.DSH_ACCEPTANCE_USERNAME ?? env.DSH_ACCEPTANCE_USER ?? stored.username,
    email: env.DSH_ACCEPTANCE_EMAIL ?? stored.email,
    password: env.DSH_ACCEPTANCE_PASSWORD ?? stored.password,
  };
  if (typeof credentials.username !== "string" || credentials.username.trim() === "" || typeof credentials.password !== "string" || credentials.password.length < 8) throw new Error("Set private DSH_ACCEPTANCE_USERNAME and DSH_ACCEPTANCE_PASSWORD, or provision an isolated acceptance account");
  if (credentials.username.toLowerCase() === "dshbaseacceptance" || credentials.email?.toLowerCase() === "dshbaseacceptance@example.com" || credentials.password === "acceptance-pass-123") throw new Error("Retired shared acceptance credentials are forbidden");
  return { base: url.origin, credentials };
}

export function registrationHeaders(env = process.env) {
  return env.AUTH_REGISTRATION_TOKEN ? { "x-dsh-registration-token": env.AUTH_REGISTRATION_TOKEN } : {};
}

export function mayRegisterAcceptance(env = process.env) { return env.DSH_ACCEPTANCE_REGISTER === "true"; }

/** Read-only barrier for a created Session before any model request. Only the
 * known old schema/version is retried; authentication/business failures propagate.
 * Cloudflare may defer active DO code updates for 300s after a deployment.
 */
export async function waitForHostReadiness(readHost, sessionId, {
  expectedVersion = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION,
  timeoutMs = 360_000, pollMs = 1000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  progress = message => console.error(`[host-readiness] ${message}`),
} = {}) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Host readiness requires a created Session");
  if (expectedVersion !== undefined && (typeof expectedVersion !== "string" || !expectedVersion.trim())) throw new Error("Invalid expected deployment version");
  const startedAt = now(); let lastProgress = -Infinity;
  const resultOf = (reply, method) => {
    if (reply?.status !== 200) throw new Error(`Host readiness ${method}: HTTP ${reply?.status}`);
    if (reply.body?.error !== undefined) throw new Error(`Host readiness ${method}: ${reply.body.error.code ?? "business failure"}`);
    if (!reply.body || !Object.hasOwn(reply.body, "result")) throw new Error(`Host readiness ${method}: missing result`);
    return reply.body.result;
  };
  while (true) {
    const history = resultOf(await readHost("history", { sessionId }, AbortSignal.timeout(20_000)), "history");
    if (!history || !Array.isArray(history.records)) throw new Error("Host readiness history: invalid records");
    if (history.turns !== undefined && !Array.isArray(history.turns)) throw new Error("Host readiness history: invalid turns");
    if (Array.isArray(history.turns) && !history.turns.every(turn => turn && typeof turn.requestId === "string" && typeof turn.userMessageId === "string" && ["queued", "running", "awaiting-approval", "completed", "cancelled", "failed", "unknown", "forked"].includes(turn.status))) throw new Error("Host readiness history: malformed turn lifecycle");
    let reason = "waiting for Host lifecycle schema";
    let ready = Array.isArray(history.turns);
    if (ready && expectedVersion !== undefined) {
      const reply = await readHost("runtimeInfo", {}, AbortSignal.timeout(20_000));
      if (reply.status === 200 && reply.body?.error?.code === "unknown_method") { ready = false; reason = "waiting for version-aware Host"; }
      else {
        const runtime = resultOf(reply, "runtimeInfo");
        if (typeof runtime?.versionId !== "string" || runtime.turnLifecycle !== 1) throw new Error("Host readiness runtimeInfo: missing deployment version or capability");
        ready = runtime.versionId === expectedVersion;
        reason = `waiting for deployment ${expectedVersion}; observed ${runtime.versionId}`;
      }
    }
    const elapsed = now() - startedAt;
    if (ready) { progress(`ready after ${elapsed}ms${expectedVersion ? `; deployment ${expectedVersion}` : "; lifecycle schema verified"}`); return { elapsedMs: elapsed, ...(expectedVersion ? { versionId: expectedVersion } : {}) }; }
    if (elapsed >= timeoutMs) throw new Error(`Host readiness timeout after ${elapsed}ms: ${reason}`);
    if (elapsed - lastProgress >= 15_000) { progress(`${reason} (${elapsed}ms)`); lastProgress = elapsed; }
    await sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}

/** Resolve an installed browser on macOS/Linux/Windows; CI may set CHROME_PATH. */
export function chromeExecutable(env = process.env) {
  const candidates = [env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", ...(env.PROGRAMFILES ? [join(env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")] : [])].filter(Boolean);
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) throw new Error("Chrome/Chromium is required; set CHROME_PATH to its executable");
  return path;
}

/** Close our browser without waiting on stdio inherited by Chrome's updater.
 * The pipes remain open throughout the browser lifetime; only an observed
 * process exit releases them. Browser errors and close failures still propagate.
 */
export async function closeAcceptanceBrowser(browser) {
  if (browser === undefined) return;
  const child = browser.process();
  const releaseExitedPipes = () => {
    child?.stdout?.destroy();
    child?.stderr?.destroy();
  };
  if (child?.exitCode !== null && child?.exitCode !== undefined
    || child?.signalCode !== null && child?.signalCode !== undefined) releaseExitedPipes();
  else child?.once('exit', releaseExitedPipes);
  try { await browser.close(); }
  finally { child?.off('exit', releaseExitedPipes); }
}

/** Headless Chrome launch options shared by every parity runner and the local UI
 * acceptance. Keep the flag set minimal: --disable-dev-shm-usage and
 * --disable-http2 measurably slow the Linux CI runner. Screenshots instead stay
 * viewport-bound (captureBeyondViewport: false), and the protocol timeout keeps
 * slow screenshot/IPC replies from aborting.
 */
export function acceptanceLaunchOptions(env = process.env) {
  return {
    executablePath: chromeExecutable(env),
    headless: true,
    protocolTimeout: 240_000,
    args: ["--no-sandbox"],
  };
}
