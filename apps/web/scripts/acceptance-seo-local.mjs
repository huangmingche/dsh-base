#!/usr/bin/env node
/**
 * P10 SEO acceptance: the built Worker's site-level public surface.
 *
 * Boots the local Worker on an isolated port and records, as raw evidence:
 * one head snapshot per locale, the ten default assets with status/content-type,
 * the web app manifest, sitemap, robots, JSON-LD parsing, the missing-asset 404
 * guard and the noindex/301 matrix. No browser and no rebuild.
 */
import assert from "node:assert/strict";
import { assertBaseRegistry, assertNoRetiredLinks, retiredDocuments } from "./acceptance-public-routes.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_LOCALE, LOCALE_IDS, hreflangFor, localizePath,
} from "../../../packages/boot/dsh-base-locale-path/src/index.ts";
import { siteAssetUrl } from "../../../packages/boot/dsh-base-site-seo/src/render.ts";
import { resolveSiteSeo } from "../../../packages/boot/dsh-base-site-seo/src/index.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(app, "../..");
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT ?? join(repoRoot, ".artifacts/seo/acceptance"));
mkdirSync(join(artifacts, "heads"), { recursive: true });
const port = process.env.DSH_LOCAL_PORT ?? "5192";
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(app, "scripts/serve-local.mjs")], {
  cwd: app,
  env: { ...process.env, DSH_LOCAL_PORT: port, DSH_LOCAL_FORBID_OUTBOUND: "1", DSH_LOCAL_COMPATIBILITY_DATE: "2026-10-30" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { serverLog = (serverLog + data.toString()).slice(-12000); });
const sleep = ms => new Promise(wait => setTimeout(wait, ms));
const get = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
const config = resolveSiteSeo({}).config;
const report = { base, heads: [], assets: [], manifest: null, sitemap: null, robots: null, jsonLd: [], guards: [], errors: [] };

try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`local Worker exited: ${serverLog}`);
    if (serverLog.includes("Local Worker ready:")) break;
    if (attempt === 100) throw new Error(`local Worker startup timed out: ${serverLog}`);
    await sleep(100);
  }

  // 1. One complete head snapshot per locale, with every required tag.
  for (const locale of LOCALE_IDS) {
    const path = `${localizePath("/", locale)}`;
    const url = `${base}${path === "/" ? "/" : path}`;
    const response = await get(path === "/" ? "/" : `${path}/`);
    const html = await response.text();
    assert.equal(response.status, 200, `${locale}: document status`);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", `${locale}: preview isolation`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/u, `${locale}: content-type`);
    assert.equal(response.headers.get("content-language"), hreflangFor(locale), `${locale}: content-language`);
    assertNoRetiredLinks([...html.matchAll(/<(?:a|link)\b[^>]*?\shref="([^"]+)"/giu)].map(match => match[1]), base);
    const head = /<head>([\s\S]*?)<\/head>/iu.exec(html)?.[0] ?? "";
    assert.ok(head.length > 0, `${locale}: head present`);
    writeFileSync(join(artifacts, "heads", `${locale}.head.html`), head);
    const copy = config.locales[locale];
    const prefix = localizePath("/", locale);
    const canonical = `${base}${prefix === "/" ? "/" : prefix}`;
    assert.ok(head.includes(`<title>${copy.title}</title>`), `${locale}: title`);
    assert.ok(head.includes(`<meta name="description" content="${copy.description}" />`), `${locale}: description`);
    assert.ok(head.includes(`<meta name="keywords" content="${copy.keywords.join(", ")}" />`), `${locale}: keywords`);
    assert.ok(head.includes(`rel="canonical" href="${canonical}"`), `${locale}: canonical`);
    assert.equal((head.match(/rel="alternate" hreflang=/gu) ?? []).length, 9, `${locale}: 8 locales + x-default`);
    assert.ok(head.includes(`<meta property="og:url" content="${canonical}" />`), `${locale}: og:url`);
    assert.ok(head.includes(`<meta property="og:image" content="${siteAssetUrl("/og.png", base)}" />`), `${locale}: og:image`);
    assert.ok(head.includes('<meta property="og:image:width" content="1200" />'), `${locale}: og:image:width`);
    assert.ok(head.includes('<meta property="og:image:height" content="630" />'), `${locale}: og:image:height`);
    assert.ok(head.includes('<meta property="og:image:type" content="image/png" />'), `${locale}: og:image:type`);
    assert.ok(head.includes('<meta name="twitter:card" content="summary_large_image" />'), `${locale}: twitter card`);
    assert.equal((head.match(/<link rel="icon"/gu) ?? []).length, 2, `${locale}: official SVG-only theme pair`);
    assert.ok(head.includes('<link rel="apple-touch-icon"'), `${locale}: apple-touch-icon`);
    assert.ok(head.includes(`<link rel="manifest" href="${base}${localizePath("/manifest.webmanifest", locale)}" />`), `${locale}: manifest link`);
    assert.ok(head.includes('<meta name="theme-color" content="#ffffff" />'), `${locale}: theme-color`);
    const graphs = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)]
      .map(match => JSON.parse(match[1]));
    assert.equal(graphs.length, 2, `${locale}: two JSON-LD graphs`);
    for (const graph of graphs) {
      assert.equal(graph["@context"], "https://schema.org", `${locale}: JSON-LD context`);
      assert.ok(typeof graph["@type"] === "string" && graph["@type"].length > 0, `${locale}: JSON-LD type`);
      assert.ok(typeof graph.name === "string" && graph.name.length > 0, `${locale}: JSON-LD name`);
      assert.ok(typeof graph.url === "string" && graph.url.startsWith(base), `${locale}: JSON-LD url`);
    }
    const website = graphs.find(graph => graph["@type"] === "WebSite");
    assert.equal(website.inLanguage, hreflangFor(locale), `${locale}: JSON-LD inLanguage`);
    report.heads.push({ locale, path: `${prefix === "/" ? "/" : prefix}`, url: url, title: copy.title, tags: head.split("\n").length });
    report.jsonLd.push({ locale, types: graphs.map(graph => graph["@type"]), inLanguage: website.inLanguage });
  }

  // 2. The ten default assets: 200 with the expected content type.
  const expectedAssets = [
    ["/favicon.svg", "image/svg+xml"],
    ["/favicon-dark.svg", "image/svg+xml"],
    ["/favicon.ico", "image/x-icon"],
    ["/favicon-16x16.png", "image/png"],
    ["/favicon-32x32.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    ["/icon-192.png", "image/png"],
    ["/icon-512.png", "image/png"],
    ["/icon-maskable-512.png", "image/png"],
    ["/og.png", "image/png"],
  ];
  for (const [path, type] of expectedAssets) {
    const response = await get(path);
    const body = await response.arrayBuffer();
    assert.equal(response.status, 200, `${path}: 200`);
    assert.equal(response.headers.get("content-type"), type, `${path}: content-type`);
    assert.ok(body.byteLength > 0, `${path}: non-empty body`);
    report.assets.push({ path, status: response.status, contentType: response.headers.get("content-type"), bytes: body.byteLength });
  }
  // Missing assets and the SPA fallback never return HTML.
  for (const path of ["/nope.png", "/favicon-404.ico", "/missing.webmanifest", "/og-2.png"]) {
    const response = await get(path);
    const type = response.headers.get("content-type") ?? "";
    assert.equal(response.status, 404, `${path}: 404`);
    assert.ok(!type.includes("text/html"), `${path}: never the SPA shell (${type})`);
    report.guards.push({ path, status: response.status, contentType: type });
  }

  // 3. Manifest: parseable, localized, declared content type.
  for (const locale of [BASE_LOCALE, "zh"]) {
    const path = localizePath("/manifest.webmanifest", locale);
    const response = await get(path, { headers: { accept: "*/*" } });
    assert.equal(response.status, 200, `${path}: 200`);
    assert.equal(response.headers.get("content-type"), "application/manifest+json", `${path}: content-type`);
    const manifest = JSON.parse(await response.text());
    assert.equal(manifest.lang, hreflangFor(locale), `${path}: lang`);
    assert.equal(typeof manifest.name, "string", `${path}: name`);
    assert.equal(manifest.start_url, `${base}${localizePath("/", locale) === "/" ? "/" : `${localizePath("/", locale)}/`}`, `${path}: start_url`);
    assert.equal(manifest.icons.length, 4, `${path}: four icons`);
    report.manifest = report.manifest ?? { path, contentType: response.headers.get("content-type"), manifest };
  }

  // 4. Sitemap and robots.
  {
    const response = await get("/sitemap.xml");
    const body = await response.text();
    assert.equal(response.status, 200, "sitemap: 200");
    assert.match(response.headers.get("content-type") ?? "", /application\/xml/u, "sitemap: content-type");
    const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => match[1]);
    assert.equal(locations.length, 0, "local/preview deployments never advertise indexable pages");
    assert.ok(!body.includes("/login"), "sitemap: login excluded");
    assert.ok(!body.includes("<lastmod>"), "sitemap: no clock-derived lastmod");
    report.sitemap = { status: response.status, contentType: response.headers.get("content-type"), locations, bytes: body.length };
    writeFileSync(join(artifacts, "sitemap.xml"), body);
  }
  {
    const response = await get("/robots.txt");
    const body = await response.text();
    assert.equal(response.status, 200, "robots: 200");
    assert.doesNotMatch(body, /Sitemap:/u, "preview robots does not advertise a sitemap");
    assert.doesNotMatch(body, /Disallow: \/(?:zh-CN\/)?login/u, "login remains crawlable for noindex");
    assert.match(body, /Disallow: \/api\//u, "robots: default disallow block");
    report.robots = { status: response.status, contentType: response.headers.get("content-type"), body };
    writeFileSync(join(artifacts, "robots.txt"), body);
  }

  const registryResponse = await get('/api/public-pages');
  assert.equal(registryResponse.status, 200);
  const { pages } = await registryResponse.json();
  assertBaseRegistry(pages);

  for (const locale of ['en', 'zh']) {
    for (const route of [...retiredDocuments, '/not-a-published-page']) {
      const path = localizePath(route, locale);
      const response = await get(path, {redirect: 'manual'});
      assert.equal(response.status, 404, `${path}: unregistered document`);
      assert.doesNotMatch(await response.text(), /rel="canonical"|id="root"/u);
      report.guards.push({path, status: response.status});
    }
  }
  for (const path of ['/third-party-notices.txt', '/third-party/document-preview.txt']) {
    for (const method of ['GET', 'HEAD']) {
      for (const accept of ['text/html', 'text/plain']) {
        const response = await get(path, {method, headers: {accept}, redirect: 'manual'});
        assert.equal(response.status, 404, `${method} ${path} (${accept})`);
        assert.match(response.headers.get('content-type') ?? '', /^text\/plain/iu);
        assert.equal(await response.text(), method === 'HEAD' ? '' : 'Not found');
      }
    }
  }
  assert.equal((await get('/assets/public-content/third-party-notices.txt')).status, 404);

  // 5. No-regression matrix: canonical 301s and noindex documents. Every
  // prefix comes from the shared module; the upper-case inputs are the
  // deliberate case-variant probes, not hand-written paths.
  const zhPrefix = localizePath("/", "zh");
  const jaPrefix = localizePath("/", "ja");
  const redirects = [
    [zhPrefix.toUpperCase(), zhPrefix],
    [jaPrefix.toUpperCase(), jaPrefix],
    [`/${BASE_LOCALE}`, `/`],
    [`/${BASE_LOCALE}/app/session/a`, `/app/session/a`],
  ];
  for (const [input, expected] of redirects) {
    const response = await get(input, { redirect: "manual" });
    assert.equal(response.status, 301, `${input}: 301`);
    assert.equal(response.headers.get("location"), `${base}${expected}`, `${input}: location`);
  }
  for (const path of ["/login", `${zhPrefix}/login`]) {
    const response = await get(path, { redirect: 'manual' });
    assert.equal(response.status, 200, `${path}: actual login document`);
    const html = await response.text();
    assert.ok(/noindex/u.test(response.headers.get("x-robots-tag") ?? "") || /noindex/u.test(html), `${path}: noindex`);
    assert.ok(!html.includes('rel="canonical"'), `${path}: no canonical`);
    assert.ok(!html.includes("application/ld+json"), `${path}: no JSON-LD`);
  }
  for (const path of ['/app/session/private-canary', `${zhPrefix}/app/workspace/private-canary`]) {
    const response = await get(path, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(response.status, 302, `${path}: anonymous private navigation remains protected`);
    assert.match(response.headers.get('location') ?? '', /\/login\?next=/u);
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/u);
  }
  report.llms = [];
  for (const locale of LOCALE_IDS) {
    const path = localizePath('/llms.txt', locale);
    const response = await get(path, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(response.status, 200, `${path}: a public resource even for HTML Accept`);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/u);
    const body = await response.text();
    assert.match(body, /^# /u);
    const listed = [...body.matchAll(/\]\(<([^>]+)>\)/gu)].map(match => match[1]);
    assert.deepEqual(listed, [`${base}${localizePath('/', locale)}`], `${path}: only the published home is listed`);
    assert.doesNotMatch(body, /\/app\/session\/|\/app\/workspace\/|\/api\/|private-canary/u);
    const head = await fetch(`${base}${path}`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    report.llms.push({ path, status: response.status, bytes: body.length });
  }
  console.log(`seo acceptance: ${report.heads.length} heads, ${report.assets.length} assets, manifest, sitemap, robots, JSON-LD, 404 guard and 301/noindex verified`);
  writeFileSync(join(artifacts, "report.json"), JSON.stringify({ ok: true, ...report, serverLog }, null, 2));
  console.log(JSON.stringify({ ok: true, output: artifacts, heads: report.heads.length, assets: report.assets.length, guards: report.guards.length }));
} catch (error) {
  writeFileSync(join(artifacts, "failure.json"), JSON.stringify({ ok: false, error: String(error?.stack ?? error), serverLog, report }, null, 2));
  throw error;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
}
