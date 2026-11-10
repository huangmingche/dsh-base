#!/usr/bin/env node
/**
 * Public-site acceptance for the restored SEO + site-config seam (P3, deployed).
 *
 * Crawler contract: every sitemap URL must return the localized document for
 * a wildcard Accept header, `text/html`, a browser UA, a Googlebot UA and `sec-fetch-mode: navigate`.
 * The login shell is reachable but noindex; private product navigations still
 * redirect anonymous clients to /login and are never listed in the sitemap.
 *
 * Usage: DSH_BASE_URL=https://<origin> node apps/web/scripts/acceptance-site-config.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LOCALE_IDS, canonicalizeLocalePath, hreflangFor, localizePath, splitLocalePath } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";

const raw = process.env.DSH_BASE_URL ?? process.env.SESSION_HOST_URL;
if (raw === undefined || raw === "") throw new Error("Set DSH_BASE_URL to the deployment HTTPS origin");
const url = new URL(raw);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/u, "") !== "") {
  throw new Error("Public-site acceptance requires an explicit HTTPS origin");
}
const base = url.origin;
if (process.env.DSH_ACCEPTANCE_OUT === undefined || process.env.DSH_ACCEPTANCE_OUT === "") {
  throw new Error("DSH_ACCEPTANCE_OUT is required: handoff evidence directories are immutable — pass a fresh output directory");
}
const output = resolve(process.env.DSH_ACCEPTANCE_OUT);
const fetchWithRetry = async (path, init = {}) => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try { return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(25_000) }); }
    catch (error) { if (attempt === 4) throw error; await new Promise(resolve => setTimeout(resolve, 1_500)); }
  }
};
const evidence = [];
const note = (name, value) => { evidence.push({ name, sha256: createHash("sha256").update(value).digest("hex"), head: value.slice(0, 400) }); };

// P4b publishes every official locale: Chinese /zh-CN, six bare ids, English
// unprefixed. Prefixes and BCP-47 tags come from the shared module, so this
// script cannot drift from the Worker.
const SERVED_LOCALES = LOCALE_IDS;
const PUBLIC_DOCUMENTS = SERVED_LOCALES.map(locale => ({
  path: localizePath("/", locale),
  lang: hreflangFor(locale),
  canonical: localizePath("/", locale),
}));
const HEADER_MATRIX = [
  { name: "wildcard", headers: { accept: "*/*" } },
  { name: "html", headers: { accept: "text/html" } },
  { name: "browser-ua", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36" } },
  { name: "googlebot-ua", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } },
  { name: "navigate", headers: { accept: "text/html", "sec-fetch-mode": "navigate" } },
];

// 1. Public site-config whitelist: known public fields only, never secrets.
const configResponse = await fetchWithRetry("/api/site-config", { headers: { accept: "application/json" } });
assert.equal(configResponse.status, 200, `/api/site-config HTTP ${configResponse.status}`);
const config = await configResponse.json();
assert.deepEqual(Object.keys(config).filter(key => !["environmentLabel", "brand", "links"].includes(key)), [], "site-config must expose whitelisted public fields only");
assert.ok(typeof config.brand?.name === "string" && config.brand.name.trim() !== "", "site-config brand.name is required");
if (process.env.DSH_EXPECT_ENVIRONMENT_LABEL) assert.equal(config.environmentLabel, process.env.DSH_EXPECT_ENVIRONMENT_LABEL);
note("site-config", JSON.stringify(config));

// 2. Crawler matrix: every request shape must receive the localized document.
for (const document of PUBLIC_DOCUMENTS) {
  for (const requestShape of HEADER_MATRIX) {
    const response = await fetchWithRetry(document.path, { headers: requestShape.headers, redirect: "manual" });
    const label = `${document.path} [${requestShape.name}]`;
    assert.equal(response.status, 200, `${label}: HTTP ${response.status} (expected the public document, not a redirect)`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/u, `${label}: content-type`);
    assert.doesNotMatch(response.headers.get("location") ?? "", /\/login/u, `${label}: must not redirect to login`);
    const html = await response.text();
    assert.ok(new RegExp(`<html[^>]*lang="${document.lang}"`, "u").test(html), `${label}: <html lang="${document.lang}">`);
    assert.ok(/<title>[^<]+<\/title>/u.test(html), `${label}: localized <title>`);
    assert.match(html, /<meta name="description" content="[^"]+"/u, `${label}: description`);
    assert.ok(html.includes(`rel="canonical" href="${base}${document.canonical}"`), `${label}: canonical ${document.canonical}`);
    for (const locale of SERVED_LOCALES) {
      const href = `${base}${localizePath("/", locale)}`;
      assert.ok(html.includes(`hreflang="${hreflangFor(locale)}" href="${href}"`), `${label}: hreflang ${hreflangFor(locale)} → ${href}`);
    }
    assert.ok(html.includes('hreflang="x-default"'), `${label}: hreflang x-default`);
    assert.ok(!/noindex/u.test(html), `${label}: public page must be indexable`);
    note(`document${document.path}`, html);
  }
}

// 3. The login shell is reachable but never indexable.
for (const path of ["/login", localizePath("/login", "zh")]) {
  const response = await fetchWithRetry(path, { headers: { accept: "text/html" }, redirect: "manual" });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  const html = await response.text();
  assert.ok(/noindex/u.test(html) || /noindex/u.test(response.headers.get("x-robots-tag") ?? ""), `${path}: login shell must be noindex`);
  assert.ok(!html.includes('rel="canonical"'), `${path}: login shell has no canonical`);
}

// 4. Private product navigations keep the login redirect and are never indexed.
const privateResponse = await fetchWithRetry("/app/session/acceptance-probe", { headers: { accept: "text/html" }, redirect: "manual" });
assert.equal(privateResponse.status, 302, "anonymous private navigation redirects to login");
assert.match(privateResponse.headers.get("location") ?? "", /^https:\/\/[^/]+\/login\?next=/u, "redirect target is the login page with the original next path");

// 5. Sitemap/robots are real payloads; every sitemap URL must be crawlable as HTML.
const sitemapResponse = await fetchWithRetry("/sitemap.xml");
assert.equal(sitemapResponse.status, 200, `sitemap HTTP ${sitemapResponse.status}`);
assert.match(sitemapResponse.headers.get("content-type") ?? "", /application\/xml/u, "sitemap content-type");
const sitemap = await sitemapResponse.text();
assert.match(sitemap, /<urlset/u, "sitemap must be XML");
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => new URL(match[1]));
assert.ok(locations.length >= PUBLIC_DOCUMENTS.length, "sitemap lists the public documents");
for (const location of locations) {
  assert.equal(location.origin, base, `sitemap entry outside the deployment origin: ${location.href}`);
  const barePath = splitLocalePath(location.pathname).path;
  assert.ok(!barePath.startsWith("/app/") && barePath !== "/login", `sitemap must not list private addresses: ${location.href}`);
  const document = await fetchWithRetry(location.pathname + location.search, { headers: { accept: "text/html" }, redirect: "manual" });
  assert.equal(document.status, 200, `sitemap entry must open as a public document: ${location.href} (HTTP ${document.status})`);
  assert.match(document.headers.get("content-type") ?? "", /text\/html/u, `sitemap entry must be HTML: ${location.href}`);
  assert.ok(!/noindex/u.test(await document.text()), `sitemap entry must be indexable: ${location.href}`);
}
note("sitemap.xml", sitemap);
const robotsResponse = await fetchWithRetry("/robots.txt");
assert.equal(robotsResponse.status, 200, `robots HTTP ${robotsResponse.status}`);
assert.match(robotsResponse.headers.get("content-type") ?? "", /text\/plain/u, "robots content-type");
const robots = await robotsResponse.text();
assert.ok(robots.includes("Sitemap:"), "robots must point at the sitemap");
note("robots.txt", robots);

await mkdir(output, { recursive: true });
await writeFile(resolve(output, "site-config-evidence.json"), JSON.stringify({ base, ok: true, evidence }, null, 2));
console.log(`public site acceptance: site-config, ${PUBLIC_DOCUMENTS.length * HEADER_MATRIX.length} crawler requests (${SERVED_LOCALES.join(", ")}), login noindex, private redirect, ${locations.length} sitemap entries, robots passed`);
