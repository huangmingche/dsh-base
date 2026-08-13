/** Minimal runtime contract for the rc.5 Workers surface: pages, assets, cookie auth. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const worker = (await import("../dist/worker.js")).default;
const passwordHash = createHash("sha256").update("correct horse battery").digest("hex");
const configured = { AUTH_USERNAME: "owner", AUTH_PASSWORD_SHA256: passwordHash, AUTH_SECRET: "acceptance-secret-0123456789" };
const request = (path, init) => new Request(`https://surface.test${path}`, init);

test("home page answers without a session", async () => {
  const response = await worker.fetch(request("/"), configured);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /DeepSeek Harness Base/u);
  assert.match(body, /href="\/login"/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("login page is visible and enabled when auth is configured", async () => {
  const response = await worker.fetch(request("/login"), configured);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Sign in/u);
  assert.doesNotMatch(body, /not configured/u);
  assert.doesNotMatch(body, /disabled/u);
});

test("login is visible but disabled when the deployment has no auth settings", async () => {
  const response = await worker.fetch(request("/login"), {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Authentication is not configured for this deployment/u);
  assert.match(body, /<button type="submit" disabled>/u);
  const signIn = await worker.fetch(request("/api/auth/sign-in", { method: "POST", body: "username=owner&password=x" }), {});
  assert.equal(signIn.status, 503);
  assert.deepEqual(await signIn.json(), { error: "auth_not_configured" });
});

test("wrong credentials redirect to the login error state", async () => {
  const response = await worker.fetch(request("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "owner", password: "wrong" }),
  }), configured);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?error=invalid");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("correct credentials issue a session that the home page reflects", async () => {
  const signIn = await worker.fetch(request("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "owner", password: "correct horse battery" }),
  }), configured);
  assert.equal(signIn.status, 303);
  assert.equal(signIn.headers.get("location"), "/");
  const cookie = signIn.headers.get("set-cookie");
  assert.match(cookie, /^dsh_session=.+; Path=\/; HttpOnly; SameSite=Lax/u);
  const value = cookie.split(";")[0];
  const home = await worker.fetch(request("/", { headers: { cookie: value } }), configured);
  assert.match(await home.text(), /Signed in as <strong>owner<\/strong>/u);
  const session = await worker.fetch(request("/api/auth/session", { headers: { cookie: value } }), configured);
  assert.deepEqual(await session.json(), { authenticated: true, username: "owner" });
});

test("tampered session values do not authenticate", async () => {
  const session = await worker.fetch(request("/api/auth/session", { headers: { cookie: "dsh_session=b3duZXIuOTk5OTk5OTk5OTk5OS5iYWQ" } }), configured);
  assert.deepEqual(await session.json(), { authenticated: false });
});

test("sign-out clears the session cookie", async () => {
  const response = await worker.fetch(request("/api/auth/sign-out", { method: "POST" }), configured);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.match(response.headers.get("set-cookie"), /^dsh_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/u);
});

test("static assets are served from the build", async () => {
  const css = await worker.fetch(request("/assets/app.css"), configured);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/u);
  assert.match(await css.text(), /font-family/u);
  const js = await worker.fetch(request("/assets/client.js"), configured);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /text\/javascript/u);
  assert.match(await js.text(), /auth\/session/u);
});

test("health reports the pinned upstream and unknown paths stay 404", async () => {
  const health = await worker.fetch(request("/api/health"), configured);
  assert.deepEqual(await health.json(), { ok: true, upstream: "dsh-0.1.0-rc.5" });
  const missing = await worker.fetch(request("/missing"), configured);
  assert.equal(missing.status, 404);
});
