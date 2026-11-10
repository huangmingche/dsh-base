#!/usr/bin/env node
/**
 * P4b local acceptance: eight localized documents, canonical spelling and crawlability.
 *
 * Built Worker + local D1/DO, no browser. Proves every document answers the five
 * crawler request shapes with the right lang/title/canonical/alternate set,
 * canonical case variants and `/en/*` 301, the retired `/zh` stays inert, the
 * sitemap lists eight crawlable documents, the login shell is noindex and a
 * private deep link keeps its first-screen lang for a signed-in owner.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_LOCALE, LOCALE_IDS, canonicalizeLocalePath, hreflangFor, localizePath, splitLocalePath,
} from "../../../packages/boot/dsh-base-locale-path/src/index.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
if (process.env.DSH_ACCEPTANCE_OUT === undefined || process.env.DSH_ACCEPTANCE_OUT === "") {
  throw new Error("DSH_ACCEPTANCE_OUT is required: handoff evidence directories are immutable — pass a fresh output directory");
}
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT);
mkdirSync(artifacts, { recursive: true });
const port = process.env.DSH_LOCAL_PORT ?? "5185";
const base = `http://127.0.0.1:${port}`;
const registrationToken = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app,
  env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: "2026-10-30" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const get = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
const HTML_SHAPES = [
  { name: "wildcard", headers: { accept: "*/*" } },
  { name: "html", headers: { accept: "text/html" } },
  { name: "browser-ua", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36" } },
  { name: "googlebot-ua", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } },
  { name: "navigate", headers: { accept: "text/html", "sec-fetch-mode": "navigate" } },
];

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await sleep(100);
  }

  const evidence = [];
  const documents = LOCALE_IDS.map(locale => ({
    locale,
    path: localizePath("/", locale),
    lang: hreflangFor(locale),
    canonical: localizePath("/", locale),
  }));

  // 1. Every document × every crawler shape: 200, no login redirect, localized head.
  for (const document of documents) {
    for (const shape of HTML_SHAPES) {
      const path = document.locale === BASE_LOCALE ? "/" : document.path;
      const response = await get(path, { headers: shape.headers, redirect: "manual" });
      const label = `${document.locale}/${shape.name}`;
      assert.equal(response.status, 200, `${label}: HTTP ${response.status}`);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/u, `${label}: content-type`);
      assert.doesNotMatch(response.headers.get("location") ?? "", /\/login/u, `${label}: must not redirect to login`);
      const html = await response.text();
      assert.match(html, new RegExp(`<html lang="${document.lang}">`, "u"), `${label}: lang`);
      assert.match(html, /<title>[^<]+<\/title>/u, `${label}: title`);
      assert.ok(!/<title>[^<]*<\/title>/u.test(html) || !/<title>\s*<\/title>/u.test(html), `${label}: non-empty title`);
      assert.ok(html.includes(`rel="canonical" href="${base}${document.canonical}"`), `${label}: canonical`);
      for (const alternate of documents) {
        const href = `${base}${alternate.canonical}`;
        assert.ok(html.includes(`hreflang="${alternate.lang}" href="${href}"`), `${label}: hreflang ${alternate.lang}`);
      }
      assert.ok(html.includes('hreflang="x-default"'), `${label}: x-default`);
      assert.ok(!/noindex/u.test(html), `${label}: public document stays indexable`);
      if (shape.name === "html") evidence.push({ path, lang: document.lang, title: /<title>([^<]+)<\/title>/u.exec(html)?.[1], canonical: `${base}${document.canonical}` });
    }
  }

  // 2. Canonical spelling: case variants and `/en/*` are 301s, query preserved.
  const redirects = [
    ["/EN?x=1", "/?x=1"], // locale-path:allow case-canonicalization matrix
    ["/En/app/session/a", "/app/session/a"], // locale-path:allow case-canonicalization matrix
    ["/ZH-CN", "/zh-CN"], // locale-path:allow case-canonicalization matrix
    ["/zh-cn", "/zh-CN"], // locale-path:allow case-canonicalization matrix
    ["/Zh-Cn/app/session/a", "/zh-CN/app/session/a"], // locale-path:allow case-canonicalization matrix
    ["/JA/app/session/a", "/ja/app/session/a"], // locale-path:allow case-canonicalization matrix
    ["/eS", "/es"], // locale-path:allow case-canonicalization matrix
  ];
  for (const [input, expected] of redirects) {
    const response = await get(input, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 301, `${input}: 301`);
    assert.equal(response.headers.get("location"), `${base}${expected}`, `${input}: canonical location`);
  }
  for (const [input, expected] of [["/en", "/"], ["/en/app/session/a", "/app/session/a"]]) { // locale-path:allow case-canonicalization matrix
    const response = await get(input, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 301, `${input}: 301`);
    assert.equal(response.headers.get("location"), `${base}${expected}`);
  }

  // 3. The retired `/zh` path carries no language meaning. An anonymous visitor
  //    is gated like any unknown app route; a signed-in visitor gets the raw SPA
  //    shell with no localized canonical/alternates.
  for (const retired of ["/zh", "/zh/app/session/acceptance-probe"]) { // locale-path:allow retired path must stay inert
    const anonymous = await get(retired, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(anonymous.status, 302, `${retired}: anonymous navigation is gated`);
    assert.match(anonymous.headers.get("location") ?? "", /\/login\?next=/u, `${retired}: gated to login`);
  }

  // 4. Sitemap: eight documents, each crawlable as text/html, each localized.
  const sitemap = await (await get("/sitemap.xml")).text();
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => new URL(match[1]));
  assert.equal(locations.length, LOCALE_IDS.length, "sitemap lists one document per locale");
  for (const location of locations) {
    assert.equal(location.origin, base, "sitemap entry stays on the deployment origin");
    const barePath = splitLocalePath(location.pathname).path;
    assert.ok(!barePath.startsWith("/app/") && barePath !== "/login", "sitemap lists public documents only");
    const document = await get(`${location.pathname}${location.search}`, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(document.status, 200, `sitemap entry ${location.pathname} opens as text/html`);
    assert.match(await document.text(), /<html lang="[^"]+">/u, `sitemap entry ${location.pathname} is localized`);
  }
  assert.equal((sitemap.match(/hreflang="zh-CN"/gu) ?? []).length, LOCALE_IDS.length, "every sitemap entry carries the zh-CN alternate");
  const robots = await (await get("/robots.txt")).text();
  for (const locale of ["zh", "ja"]) {
    assert.ok(robots.includes(`Disallow: ${localizePath("/api/", locale)}`), `robots disallow ${locale}`);
  }
  assert.ok(!robots.includes("/zh/api/"), "robots must not use the retired path"); // locale-path:allow retired path must stay inert

  // 5. Login is reachable but noindex; private documents keep a localized first
  //    screen for a signed-in owner and redirect anonymous visitors to login.
  for (const path of ["/login", localizePath("/login", "zh"), localizePath("/login", "ja")]) {
    const response = await get(path, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 200, `${path}: login 200`);
    const html = await response.text();
    assert.ok(/noindex/u.test(html) || /noindex/u.test(response.headers.get("x-robots-tag") ?? ""), `${path}: noindex`);
    assert.ok(!html.includes('rel="canonical"'), `${path}: no canonical`);
  }
  for (const path of ["/app/session/acceptance-probe", localizePath("/app/session/acceptance-probe", "zh")]) {
    const anonymous = await get(path, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(anonymous.status, 302, `${path}: anonymous private navigation redirects`);
    assert.match(anonymous.headers.get("location") ?? "", /\/login\?next=/u, `${path}: redirect target is login`);
  }
  const account = { username: `locale${randomBytes(6).toString("hex")}`, name: "Locale routes", email: `locale-${randomBytes(6).toString("hex")}@example.test`, password: randomBytes(24).toString("base64url") };
  const signup = await get("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: base, "x-dsh-registration-token": registrationToken }, body: JSON.stringify(account) });
  assert.equal(signup.status, 200, "local signup");
  const cookie = (signup.headers.getSetCookie() ?? []).join("; ").match(/(better-auth\.session_token)=([^;]+)/u);
  const signed = await get(localizePath("/app/session/acceptance-probe", "zh"), { headers: { accept: "text/html", cookie: `${cookie[1]}=${cookie[2]}` }, redirect: "manual" });
  assert.equal(signed.status, 200, "signed-in private deep link serves the shell");
  const privateHtml = await signed.text();
  assert.match(privateHtml, /<html lang="zh-CN">/u, "private deep link first screen is Chinese");
  assert.ok(/noindex/u.test(privateHtml) || /noindex/u.test(signed.headers.get("x-robots-tag") ?? ""), "private deep link is noindex");
  assert.ok(!privateHtml.includes('rel="canonical"'), "private deep link has no canonical");
  const retiredSigned = await get("/zh/app/session/acceptance-probe", { headers: { accept: "text/html", cookie: `${cookie[1]}=${cookie[2]}` }, redirect: "manual" }); // locale-path:allow retired path must stay inert
  assert.equal(retiredSigned.status, 200, "the retired /zh path still serves the SPA shell to a signed-in visitor");
  const retiredHtml = await retiredSigned.text();
  assert.ok(!retiredHtml.includes('rel="canonical"'), "the retired /zh path gets no canonical");
  assert.ok(!/hreflang=/u.test(retiredHtml), "the retired /zh path gets no alternates");
  assert.doesNotMatch(retiredHtml, /<html lang="zh-CN">/u, "the retired /zh path is not localized as Chinese");

  const report = {
    ok: true,
    base,
    documents: evidence,
    redirects: redirects.map(([input, expected]) => `${input} -> ${expected}`),
    sitemapEntries: locations.length,
    retiredZhInert: true,
    loginNoindex: true,
    privateFirstScreenLang: "zh-CN",
    canonicalCaseHelper: canonicalizeLocalePath("/ZH-CN") === "/zh-CN", // locale-path:allow case-canonicalization probe
    consoleErrors: [],
    artifacts,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(artifacts, "locale-routes-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(artifacts, "server.log"), serverLog);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(artifacts, "failure.json"), `${JSON.stringify({ error: String(error?.stack ?? error), serverLog: serverLog.slice(-8000) }, null, 2)}\n`);
  throw error;
} finally {
  const kill = signal => { try { process.kill(-server.pid, signal); } catch { try { server.kill(signal); } catch { /* gone */ } } };
  kill("SIGTERM");
  await sleep(1500);
  if (server.exitCode === null) kill("SIGKILL");
}
