#!/usr/bin/env node
/** Read-only icon acceptance against an explicit local or deployed Worker. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from "./acceptance-config.mjs";
import { verifySelectedFavicons } from "./favicon-selection.mjs";
import { SITE_ASSET_VERSIONS } from "../../../packages/boot/dsh-base-site-seo/src/assets.generated.ts";
import { BASE_LOCALE, localizePath } from "../../../packages/boot/dsh-base-locale-path/src/index.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
assert.ok(process.env.DSH_BASE_URL, "Set DSH_BASE_URL explicitly; no remote deployment is selected by default");
const target = new URL(process.env.DSH_BASE_URL);
assert.ok(target.protocol === "https:" || target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Use HTTPS or a local HTTP Worker");
assert.ok(target.pathname === "/" && target.search === "" && target.hash === "" && target.username === "" && target.password === "", "DSH_BASE_URL must be an origin without credentials or a path");
const base = target.origin;
const artifacts = resolve(process.env.DSH_ACCEPTANCE_OUT ?? join(root, ".artifacts/acceptance/site-icons", new Date().toISOString().replaceAll(":", "-")));
mkdirSync(artifacts, { recursive: true });
const provenance = JSON.parse(readFileSync(join(root, "scripts/assets/site-assets.provenance.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const assetUrl = path => `${base}${path}?v=${SITE_ASSET_VERSIONS[path]}`;
const expectedTypes = new Map([
  ["/favicon.svg", "image/svg+xml"], ["/favicon-dark.svg", "image/svg+xml"], ["/favicon.ico", "image/x-icon"],
  ...["favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "og.png"].map(name => [`/${name}`, "image/png"]),
]);
const report = { ok: false, base, source: provenance.source, geometry: provenance.geometry, documents: [], assets: [], manifests: [], browser: [], transparency: [], nativeFaviconRequests: [], selectedFavicons: [], errors: [] };
const get = (url, init = {}) => fetch(new URL(url, base), { ...init, signal: AbortSignal.timeout(30_000) });
const selectedPages = [], runId = randomUUID();
let browser, page, profile;

async function asset(path, versioned = true) {
  const url = versioned ? assetUrl(path) : `${base}${path}`;
  const response = await get(url);
  assert.equal(response.status, 200, `${url}: status`);
  const type = response.headers.get("content-type")?.split(";")[0];
  assert.equal(type, expectedTypes.get(path), `${path}: content type`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = readFileSync(join(app, "public", path.slice(1)));
  assert.deepEqual(bytes, local, `${url}: deployment bytes must match the shipped asset`);
  const sha256 = hash(bytes);
  assert.equal(sha256, provenance.assets[path].sha256, `${path}: generated provenance`);
  assert.equal(sha256.slice(0, 12), SITE_ASSET_VERSIONS[path], `${path}: URL version`);
  report.assets.push({ path, url, type, bytes: bytes.length, sha256, cacheControl: response.headers.get("cache-control") });
  return bytes;
}

async function inspectHead(path) {
  const response = await get(path, { headers: { accept: "text/html" } });
  assert.equal(response.status, 200, `${path}: public document status`);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/u, `${path}: HTML`);
  const html = await response.text();
  const head = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return {
      links: [...doc.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map(link => ({ rel: link.getAttribute("rel"), href: link.getAttribute("href"), type: link.getAttribute("type"), sizes: link.getAttribute("sizes"), media: link.getAttribute("media") })),
      social: [...doc.head.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')].map(meta => meta.getAttribute("content")),
      robots: doc.head.querySelector('meta[name="robots"]')?.getAttribute("content"),
    };
  }, html);
  const icons = head.links.filter(link => link.rel === "icon" || link.rel === "apple-touch-icon");
  assert.deepEqual(icons.map(link => new URL(link.href, base).pathname), ["/favicon-dark.svg", "/favicon.svg", "/apple-touch-icon.png"], `${path}: official theme SVG pair without competing fallback links`);
  for (const icon of icons) assert.equal(icon.href, assetUrl(new URL(icon.href).pathname), `${path}: versioned icon URL`);
  const declaredSizes = new Map(icons.map(icon => [new URL(icon.href).pathname, icon.sizes]));
  for (const [icon, sizes] of [["/favicon.svg", null], ["/favicon-dark.svg", null], ["/apple-touch-icon.png", "180x180"]]) assert.equal(declaredSizes.get(icon), sizes, `${path}: ${icon} declared size`);
  for (const icon of icons) {
    const name = new URL(icon.href).pathname;
    assert.equal(icon.media, name === "/favicon.svg" ? "(prefers-color-scheme: light)" : name === "/favicon-dark.svg" ? "(prefers-color-scheme: dark)" : null, `${path}: document owns favicon theme selection`);
  }
  for (const image of head.social) assert.equal(image, assetUrl("/og.png"), `${path}: versioned social image`);
  assert.equal(head.links.filter(link => link.rel === "manifest").length, 1, `${path}: manifest link`);
  if (new URL(response.url).pathname.endsWith("/login")) assert.match(head.robots ?? "", /noindex/u);
  report.documents.push({ requested: path, final: response.url, ...head });
  writeFileSync(join(artifacts, `head-${path === "/" ? "root" : path.slice(1).replaceAll("/", "-")}.html`), /<head[^>]*>[\s\S]*?<\/head>/iu.exec(html)?.[0] ?? html);
}

try {
  assert.deepEqual(Object.keys(SITE_ASSET_VERSIONS).sort(), [...expectedTypes.keys()].sort(), "all ten shipped assets have generated versions");
  assert.match(provenance.geometry.pathSha256, /^[a-f0-9]{64}$/u, "official geometry digest");
  // Always create our own disposable profile; never inspect the user's Chrome.
  profile = mkdtempSync(join(tmpdir(), "dsh-site-icons-"));
  browser = await puppeteer.launch({ ...acceptanceLaunchOptions(), userDataDir: profile });
  report.chromeVersion = await browser.version();
  page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });

  for (const path of [
    ...[BASE_LOCALE, "zh"].map(locale => localizePath("/", locale)),
    ...[BASE_LOCALE, "zh"].map(locale => localizePath("/login", locale)),
    "/app/session/icon-acceptance",
  ]) await inspectHead(path);
  const privateResult = report.documents.at(-1);
  assert.equal(new URL(privateResult.final).pathname, "/login", "anonymous private navigation stays behind login");

  const svgs = new Map();
  for (const path of expectedTypes.keys()) {
    const bytes = await asset(path);
    if (path.endsWith(".svg")) svgs.set(path, bytes.toString("utf8"));
  }
  // Browsers may request these implicit legacy URLs without consulting the head.
  await asset("/favicon.svg", false);
  await asset("/favicon-dark.svg", false);
  await asset("/favicon.ico", false);
  for (const [path, svg] of svgs) {
    const shape = await page.evaluate(svg => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return { error: doc.querySelector("parsererror")?.textContent, paths: [...doc.querySelectorAll("path")].map(path => ({ d: path.getAttribute("d"), fill: path.getAttribute("fill") })), backplates: doc.querySelectorAll("rect, circle, style, [style]").length };
    }, svg);
    assert.equal(shape.error, undefined, `${path}: valid SVG`);
    assert.equal(shape.paths.length, 1, `${path}: one official mark`);
    assert.equal(shape.backplates, 0, `${path}: no background or embedded styles`);
    assert.doesNotMatch(svg, /background|prefers-color-scheme/u, `${path}: theme selection belongs to document media`);
    assert.equal(hash(shape.paths[0].d), provenance.geometry.pathSha256, `${path}: exact official whale path`);
    assert.equal(shape.paths[0].fill, path === "/favicon.svg" ? "#000000" : "#ffffff", `${path}: official fixed theme color`);
  }

  for (const locale of [BASE_LOCALE, "zh"]) {
    const path = localizePath("/manifest.webmanifest", locale);
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.split(";")[0], "application/manifest+json");
    const manifest = await response.json();
    assert.deepEqual(manifest.icons.map(icon => icon.src), ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/favicon.svg"].map(assetUrl));
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512", "512x512", "any"]);
    assert.equal(manifest.icons[2].purpose, "maskable");
    report.manifests.push({ path, lang: manifest.lang, icons: manifest.icons });
  }

  let login;
  for (const scheme of ["light", "dark"]) {
    // Independent pages keep a subsequent theme change from rewriting the
    // preceding page's persisted favicon mapping.
    login = await browser.newPage();
    let captureFavicon = true;
    login.on("pageerror", error => report.errors.push(error.message));
    login.on("response", response => {
      const url = new URL(response.url());
      if (captureFavicon && ["/favicon.svg", "/favicon-dark.svg", "/favicon.ico", "/favicon-16x16.png", "/favicon-32x32.png"].includes(url.pathname)) report.nativeFaviconRequests.push({ scheme, url: response.url(), status: response.status(), contentType: response.headers()["content-type"] });
    });
    await login.setViewport({ width: 1000, height: 800 });
    const expectedSvg = assetUrl(scheme === "dark" ? "/favicon-dark.svg" : "/favicon.svg");
    const nativeResponse = login.waitForResponse(response => response.url() === expectedSvg && [200, 304].includes(response.status()), { timeout: 15_000 }).then(() => true, () => false);
    await login.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    const pageUrl = new URL("/login", base); pageUrl.searchParams.set("favicon-check", `${runId}-${scheme}`);
    await login.goto(pageUrl.href, { waitUntil: "networkidle2", timeout: 45_000 });
    await login.bringToFront();
    assert.equal(login.url(), pageUrl.href, "public favicon evidence keeps its independent page URL");
    selectedPages.push({ url: pageUrl.href, scheme, expectedIconUrl: expectedSvg });
    await login.waitForSelector('dialog[data-auth-dialog][open]', { timeout: 30_000 });
    // The approved auth-modal design has no brand mark. Verify the deployed
    // favicon's geometry directly; rendered sidebar parity has its own check.
    const faviconSvg = await (await get(expectedSvg)).text();
    const faviconPath = await login.evaluate(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')?.getAttribute('d'), faviconSvg);
    assert.equal(hash(faviconPath), provenance.geometry.pathSha256, "deployed favicon retains the exact pinned official whale shape");
    const hydratedLinks = await login.$$eval('head link[rel="icon"]', links => links.map(link => ({ href: link.href, media: link.media, type: link.type, matches: matchMedia(link.media).matches })));
    assert.deepEqual(hydratedLinks.map(link => link.href), ["/favicon-dark.svg", "/favicon.svg"].map(assetUrl), "hydration preserves the official theme SVG pair without competing fallbacks");
    const matchingSvg = hydratedLinks.filter(link => link.type === "image/svg+xml" && link.matches).map(link => link.href);
    assert.deepEqual(matchingSvg, [expectedSvg], `${scheme}: exactly one SVG matches the browser theme`);
    await login.screenshot({ path: join(artifacts, `login-${scheme}.png`), captureBeyondViewport: false });
    await nativeResponse;
    captureFavicon = false;
    const nativeExpectedObserved = report.nativeFaviconRequests.some(request => request.scheme === scheme && request.url === expectedSvg && [200, 304].includes(request.status));
    report.browser.push({ case: `login-document-favicon-${scheme}`, pathSha256: hash(faviconPath), hydratedLinks, matchingSvg, nativeExpectedObserved });
    assert.ok(nativeExpectedObserved, `${scheme}: Chrome requests the expected SVG natively`);
  }

  // The login page supplies the same origin for readable canvases. Deliberate
  // image loads below are never counted as native browser favicon requests.
  const alphaAssets = [
    { path: "/favicon.svg", size: 32, ink: [0, 0, 0] },
    { path: "/favicon-dark.svg", size: 32, ink: [255, 255, 255] },
    { path: "/favicon-16x16.png", size: 16, ink: [0, 0, 0] },
    { path: "/favicon-32x32.png", size: 32, ink: [0, 0, 0] },
    { path: "/favicon.ico", size: 48, ink: [0, 0, 0] },
  ];
  report.transparency = await login.evaluate(async entries => Promise.all(entries.map(async entry => {
    const image = new Image(); image.src = entry.url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = entry.size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, entry.size, entry.size);
    const { data } = context.getImageData(0, 0, entry.size, entry.size);
    let transparent = 0, opaque = 0, partial = 0, wrongInk = 0;
    for (let at = 0; at < data.length; at += 4) {
      const alpha = data[at + 3];
      if (alpha === 0) transparent++;
      else if (alpha === 255) opaque++;
      else partial++;
      if (alpha >= 250 && entry.ink.some((channel, index) => Math.abs(data[at + index] - channel) > 2)) wrongInk++;
    }
    const alphaAt = (x, y) => data[(y * entry.size + x) * 4 + 3];
    return { path: entry.path, size: entry.size, transparent, opaque, partial, wrongInk, edgeAlpha: [alphaAt(Math.floor(entry.size / 2), 0), alphaAt(0, Math.floor(entry.size / 2)), alphaAt(entry.size - 1, Math.floor(entry.size / 2)), alphaAt(Math.floor(entry.size / 2), entry.size - 1)] };
  })), alphaAssets.map(entry => ({ ...entry, url: assetUrl(entry.path) })));
  for (const decoded of report.transparency) {
    const total = decoded.size ** 2;
    assert.ok(decoded.transparent > total * 0.30, `${decoded.path}: transparent background beyond rounded corners`);
    assert.ok(decoded.opaque > total * 0.10, `${decoded.path}: visible whale foreground`);
    assert.ok(decoded.partial > 0, `${decoded.path}: antialiased silhouette`);
    assert.equal(decoded.wrongInk, 0, `${decoded.path}: no backplate color`);
    assert.deepEqual(decoded.edgeAlpha, [0, 0, 0, 0], `${decoded.path}: non-corner background is transparent`);
  }

  const pictures = [
    ...[16, 32, 64].map(size => ({ name: `Theme SVG · ${size}px`, path: "/favicon.svg", size, themed: true })),
    { name: "PNG · 16px", path: "/favicon-16x16.png", size: 16 },
    { name: "PNG · 32px", path: "/favicon-32x32.png", size: 32 },
    { name: "Apple touch · 180px", path: "/apple-touch-icon.png", size: 96 },
    { name: "App · 192px", path: "/icon-192.png", size: 96 },
    { name: "App · 512px", path: "/icon-512.png", size: 96 },
    { name: "Maskable · 512px", path: "/icon-maskable-512.png", size: 96 },
  ];
  // This is an evidence sheet of served files, not an independent redraw of the mark.
  // Establish the target origin first: an about:blank sheet may be denied
  // loopback image access by Chrome's local-network boundary.
  await page.goto(`${base}/login`, { waitUntil: "networkidle2", timeout: 45_000 });
  await page.bringToFront();
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0;padding:32px;font:14px system-ui;color:#191919;background:#fff;color-scheme:light dark}
    h1{font-size:20px;font-weight:500;margin:0 0 24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    figure{margin:0;border:1px solid #ccc;border-radius:8px;padding:16px;min-height:115px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:12px}figcaption{font-size:12px}img{object-fit:contain}.social{grid-column:1/-1}.social img{width:480px;height:252px}
    @media(prefers-color-scheme:dark){body{color:#f1f1f1;background:#141414}figure{border-color:#444}}
    </style></head><body><h1>Shipped official whale — browser rendering</h1><main>${pictures.map(picture => {
      const image = `<img src="${assetUrl(picture.path)}" width="${picture.size}" height="${picture.size}" alt="${picture.name}">`;
      const artwork = picture.themed ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${assetUrl("/favicon-dark.svg")}"><source media="(prefers-color-scheme: light)" srcset="${assetUrl("/favicon.svg")}">${image}</picture>` : image;
      return `<figure>${artwork}<figcaption>${picture.name}</figcaption></figure>`;
    }).join("")}<figure class="social"><img src="${assetUrl("/og.png")}" alt="Shipped social card"><figcaption>og.png · 1200 × 630</figcaption></figure></main></body></html>`);
  for (const scheme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    const expectedSvg = assetUrl(scheme === "dark" ? "/favicon-dark.svg" : "/favicon.svg");
    await page.waitForFunction(expected => [...document.querySelectorAll("picture img")].every(image => image.currentSrc === expected && image.complete), { timeout: 15_000 }, expectedSvg);
    const rendered = await page.evaluate(async () => Promise.all([...document.images].map(async image => {
      await image.decode();
      return { src: image.currentSrc, fallbackSrc: image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: image.width, height: image.height };
    })));
    assert.equal(rendered.length, pictures.length + 1);
    assert.deepEqual(rendered.slice(0, 3).map(image => image.src), [expectedSvg, expectedSvg, expectedSvg], `${scheme}: actual picture sources at 16/32/64px`);
    for (const image of rendered) {
      const path = new URL(image.src).pathname;
      const expected = provenance.assets[path];
      if (path.endsWith(".svg")) {
        // A vector with only viewBox has browser-default intrinsic dimensions.
        assert.ok(image.naturalWidth > 0 && image.naturalHeight > 0, `${scheme}: SVG decoded`);
        assert.equal(image.naturalWidth / image.naturalHeight, expected.width / expected.height, `${scheme}: SVG aspect ratio`);
      } else {
        assert.equal(image.naturalWidth, expected.width, `${scheme}: decoded width`);
        assert.equal(image.naturalHeight, expected.height, `${scheme}: decoded height`);
      }
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "the complete evidence sheet fits its screenshot");
    await page.screenshot({ path: join(artifacts, `icons-${scheme}.png`), captureBeyondViewport: false });
    report.browser.push({ case: `contact-sheet-${scheme}`, images: rendered });
  }
  report.nativeFaviconObserved = report.nativeFaviconRequests.length > 0;
  report.privateDocumentAuthenticated = false;
  assert.deepEqual(report.errors, [], "public login loads without browser runtime errors");
  report.ok = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  report.lastPage = await page?.evaluate(() => ({ url: location.href, dark: matchMedia("(prefers-color-scheme: dark)").matches, images: [...document.images].map(image => ({ src: image.src, currentSrc: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth })), sources: [...document.querySelectorAll("picture source")].map(source => ({ media: source.media, matches: matchMedia(source.media).matches, srcset: source.srcset })) })).catch(() => undefined);
  throw error;
} finally {
  try {
    await closeAcceptanceBrowser(browser);
    if (report.ok) report.selectedFavicons = verifySelectedFavicons({ profile, pages: selectedPages, output: artifacts });
  } catch (error) {
    report.ok = false;
    report.failure = String(error?.stack ?? error);
    throw error;
  } finally {
    // Export only the verified favicon PNGs and measurements, never cookies or
    // the browser databases. The profile belongs exclusively to this run.
    if (profile) rmSync(profile, { recursive: true, force: true });
    writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
console.log(JSON.stringify({ ok: report.ok, base, artifacts, documents: report.documents.length, assets: report.assets.length, browserCases: report.browser.length, nativeFaviconObserved: report.nativeFaviconObserved, selectedFaviconThemes: report.selectedFavicons.length }));
