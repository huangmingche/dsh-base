import { siteAssetUrl } from "../../../boot/dsh-base-site-seo/src/render.ts";
/** Worker SEO seam: localized HTML document heads over the real handler. */
import assert from "node:assert/strict";
import { apply } from "../src/index.ts";
import { LOCALE_IDS } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { resolveSiteSeo } from "../../../boot/dsh-base-site-seo/src/index.ts";

const handlers: Array<(request: Request, env: unknown) => Promise<Response | undefined>> = [];
let manifestAvailable = true;
let settingsAvailable = true;
let reads = 0;
const ctx = {
  get(name: string) { return name === "siteManifest" && manifestAvailable ? { path: "/manifest.webmanifest" } : undefined; },
  siteSettings: { async read(env: { SITE_SEO_JSON?: unknown }) { reads++; if (!settingsAvailable) throw new Error("unavailable"); return { values: { seo: resolveSiteSeo(env).config } }; } },
  effect(callback: () => unknown) { return callback(); },
  http: { use(handler: (request: Request, env: unknown) => Promise<Response | undefined>) { handlers.push(handler); return () => {}; } },
};
apply(ctx as never);
assert.equal(handlers.length, 1);
const handler = handlers[0]!;
const shell = "<!doctype html><html lang=\"en\"><head><title>dsh-base</title></head><body><div id=\"root\"></div></body></html>";
const assets = { async fetch() { return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } }); } };
const baseEnv = { ASSETS: assets };
const get = (path: string, env: unknown = baseEnv, accept = "text/html") =>
  handler(new Request(`https://app.example.test${path}`, { headers: { accept } }), env);
const config = resolveSiteSeo({}).config;

// Eight published locales, one document each, canonical under its own prefix.
const locales = [
  { locale: "en", prefix: "", lang: "en" },
  { locale: "zh", prefix: "/zh-CN", lang: "zh-CN" },
  { locale: "ja", prefix: "/ja", lang: "ja" },
  { locale: "es", prefix: "/es", lang: "es" },
  { locale: "fr", prefix: "/fr", lang: "fr" },
  { locale: "de", prefix: "/de", lang: "de" },
  { locale: "pt", prefix: "/pt", lang: "pt" },
  { locale: "ru", prefix: "/ru", lang: "ru" },
] as const;
const OG_LOCALE = { en: "en_US", zh: "zh_CN", ja: "ja_JP", es: "es_ES", fr: "fr_FR", de: "de_DE", pt: "pt_PT", ru: "ru_RU" } as const;

for (const { locale, prefix, lang } of locales) {
  const path = `${prefix}/`;
  const response = await get(path);
  assert.equal(response?.status, 200, path);
  assert.equal(response!.headers.get("content-language"), lang, `${path}: content-language`);
  const html = await response!.text();
  const copy = config.locales[locale];
  assert.match(html, new RegExp(`<html lang="${lang}">`, "u"), `${path}: lang`);
  assert.ok(html.includes(`<title>${copy.title}</title>`), `${path}: localized title`);
  assert.ok(html.includes(`<meta name="description" content="${copy.description}" />`), `${path}: description`);
  assert.ok(html.includes(`<meta name="keywords" content="${copy.keywords.join(", ")}" />`), `${path}: keywords`);
  assert.ok(html.includes(`rel="canonical" href="https://app.example.test${prefix || "/"}"`), `${path}: canonical`);
  assert.ok(html.includes(`<meta property="og:url" content="https://app.example.test${prefix || "/"}" />`), `${path}: og:url`);
  assert.ok(html.includes(`<meta property="og:locale" content="${OG_LOCALE[locale]}" />`), `${path}: og:locale`);
  assert.ok(html.includes('hreflang="x-default" href="https://app.example.test/"'), `${path}: x-default`);
  assert.ok(html.includes(`<meta property="og:image" content="${siteAssetUrl("/og.png", "https://app.example.test")}" />`), `${path}: og:image`);
  assert.ok(html.includes('<meta property="og:image:width" content="1200" />'), `${path}: og:image:width`);
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'), `${path}: twitter card`);
  assert.ok(html.includes('<link rel="manifest"'), `${path}: manifest link`);
  assert.ok(html.includes('<meta name="theme-color" content="#ffffff" />'), `${path}: theme-color`);
  assert.ok(html.includes('<link rel="icon" type="image/svg+xml"'), `${path}: svg icon`);
  assert.ok(html.includes('<link rel="apple-touch-icon"'), `${path}: apple touch icon`);
  // JSON-LD: two parseable graphs with the required fields.
  const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map(match => JSON.parse(match[1] as string) as Record<string, unknown>);
  assert.equal(graphs.length, 2, `${path}: two JSON-LD graphs`);
  const [website, organization] = graphs as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(website["@context"], "https://schema.org", `${path}: JSON-LD context`);
  assert.equal(website["@type"], "WebSite", `${path}: WebSite type`);
  assert.equal(website.name, config.site.name, `${path}: site name`);
  assert.equal(website.url, `https://app.example.test${prefix || "/"}`, `${path}: site url`);
  assert.equal(website.inLanguage, lang, `${path}: inLanguage`);
  assert.equal(organization["@type"], "Organization", `${path}: Organization type`);
  assert.equal(organization.url, "https://app.example.test/", `${path}: organization url`);
}
const rootHtml = await (await get("/"))!.text();
assert.ok(rootHtml.includes(`<title>${config.locales.en.title}</title>`), "English keeps the default title");
assert.equal((rootHtml.match(/rel="alternate" hreflang=/gu) ?? []).length, 9, "8 locales + x-default");
assert.equal((rootHtml.match(/hreflang="zh-CN" href="https:\/\/app\.example\.test\/zh-CN"/gu) ?? []).length, 1, "Chinese alternate uses the canonical /zh-CN path");
assert.equal((rootHtml.match(/property="og:locale:alternate"/gu) ?? []).length, 7, "seven alternate og locales");
assert.ok(!rootHtml.includes('href="https://app.example.test/zh"'), "the retired bare /zh path is never emitted");

// The deployment override flows through the HTML head.
const override = JSON.stringify({
  site: { name: "Override Corp", url: "https://override.example.test", twitter: "@override", github: "override-org" },
  locales: { en: { title: "Override title", description: "Override description", keywords: ["alpha", "beta"] } },
  robots: { disallow: ["/private", "/staging"], extraLines: ["# managed by deployment"] },
  pages: { "/pricing": { title: "Pricing", lastmod: "2025-01-31", priority: "0.8", changefreq: "monthly" } },
});
const overrideEnv = { ASSETS: assets, SITE_SEO_JSON: override };
const overrideHtml = await (await get("/", overrideEnv))!.text();
assert.ok(overrideHtml.includes("<title>Override title</title>"), "override title wins");
assert.ok(overrideHtml.includes('<meta name="description" content="Override description" />'), "override description wins");
assert.ok(overrideHtml.includes('<meta name="keywords" content="alpha, beta" />'), "override keywords win");
assert.ok(overrideHtml.includes('<meta name="twitter:site" content="@override" />'), "twitter handle renders twitter:site");
assert.ok(overrideHtml.includes(`content="${siteAssetUrl("/og.png", "https://override.example.test")}"`), "configured site.url wins over the request origin");
assert.ok(overrideHtml.includes(`"sameAs":["https://twitter.com/override","https://github.com/override-org"]`), "Organization sameAs uses the configured profiles");
// The retired bare `/zh` path is an ordinary route now: no document shell.
assert.equal(await get("/zh"), undefined, "retired /zh is not a locale document");
assert.equal(await get("/zh/"), undefined, "retired /zh/ is not a locale document");

// Case variants canonicalize with a 301 before locale parsing.
for (const [input, location] of [
  ["/ZH-CN", "https://app.example.test/zh-CN"],
  ["/Zh-cn?x=1", "https://app.example.test/zh-CN?x=1"],
  ["/Zh-cn/app/session/a", "https://app.example.test/zh-CN/app/session/a"],
  ["/JA/app/session/a", "https://app.example.test/ja/app/session/a"],
  ["/EN?x=1", "https://app.example.test/?x=1"],
] as const) {
  const variant = await handler(new Request(`https://app.example.test${input}`, { headers: { accept: "text/html" } }), baseEnv);
  assert.equal(variant?.status, 301, `${input}: 301`);
  assert.equal(variant?.headers.get("location"), location, `${input}: canonical location`);
}

// Private product surfaces are served a localized shell for authenticated
// navigations, but stay noindex and carry no canonical/hreflang/JSON-LD.
for (const [path, lang] of [
  ["/app/session/acceptance-probe", "en"],
  ["/zh-CN/app/session/acceptance-probe", "zh-CN"],
  ["/app/workspace/w", "en"],
  ["/ja/app/workspace/w", "ja"],
] as const) {
  const response = await get(path);
  assert.equal(response?.status, 200, `${path}: private shell served`);
  assert.equal(response!.headers.get("x-robots-tag"), "noindex, nofollow", `${path}: noindex header`);
  const html = await response!.text();
  assert.match(html, new RegExp(`<html lang="${lang}">`, "u"), `${path}: first-screen lang`);
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'), `${path}: robots meta`);
  assert.ok(!html.includes('rel="canonical"'), `${path}: no canonical`);
  assert.ok(!html.includes('hreflang='), `${path}: no hreflang`);
  assert.ok(!html.includes('property="og:'), `${path}: no Open Graph`);
  assert.ok(!html.includes("application/ld+json"), `${path}: no JSON-LD`);
}

// `/en/*` is the explicit base-locale form: 301 to the bare path, query kept.
const enRoot = await handler(new Request("https://app.example.test/en?x=1", { headers: { accept: "text/html" } }), baseEnv);
assert.equal(enRoot?.status, 301);
assert.equal(enRoot?.headers.get("location"), "https://app.example.test/?x=1");
const enDoc = await handler(new Request("https://app.example.test/en/app/session/a", { headers: { accept: "text/html" } }), baseEnv);
assert.equal(enDoc?.status, 301);
assert.equal(enDoc?.headers.get("location"), "https://app.example.test/app/session/a");

// The login document is reachable but must never be indexed.
for (const path of ["/login", "/zh-CN/login", "/ja/login"]) {
  const login = await get(path);
  assert.equal(login?.status, 200, `${path}: login shell served`);
  assert.equal(login!.headers.get("x-robots-tag"), "noindex, nofollow", `${path}: x-robots-tag`);
  const html = await login!.text();
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'), `${path}: robots meta`);
  assert.ok(!html.includes('rel="canonical"'), `${path}: no canonical`);
  assert.ok(!html.includes('hreflang='), `${path}: no hreflang`);
}
assert.equal((await get("/login", baseEnv, "application/json")), undefined, "non-HTML clients bypass the document shell");

// Private and login documents keep shared brand resources while withholding search metadata.
const privateBrandEnv = { ASSETS: assets, SITE_SEO_JSON: JSON.stringify({
  icons: { svg: "/managed.svg?a=1&b=2", appleTouch: "/managed-touch.png" },
  manifest: { themeColor: "#123456" },
}) };
for (const [path, manifestPath] of [["/login", "/manifest.webmanifest"], ["/zh-CN/login", "/zh-CN/manifest.webmanifest"], ["/app/session/private", "/manifest.webmanifest"], ["/ja/app/workspace/private", "/ja/manifest.webmanifest"]]) {
  const response = await get(path!, privateBrandEnv);
  assert.equal(response?.status, 200, `${path}: managed brand shell`);
  const html = await response!.text();
  assert.ok(html.includes('rel="icon" type="image/svg+xml" sizes="any" href="https://app.example.test/managed.svg?a=1&amp;b=2"'), `${path}: configured SVG icon is escaped`);
  assert.ok(html.includes('rel="apple-touch-icon" sizes="180x180" href="https://app.example.test/managed-touch.png"'), `${path}: configured touch icon`);
  assert.ok(html.includes(`rel="manifest" href="https://app.example.test${manifestPath}"`), `${path}: localized manifest`);
  assert.ok(html.includes('<meta name="theme-color" content="#123456" />'), `${path}: configured theme color`);
  assert.ok(html.includes('content="noindex, nofollow"'), `${path}: still noindex`);
  for (const forbidden of ['rel="canonical"', 'hreflang=', 'property="og:', 'name="twitter:', 'application/ld+json']) assert.ok(!html.includes(forbidden), `${path}: private metadata excludes ${forbidden}`);
}


// Resource ownership moved to independently composed plugins: SEO neither serves nor reads for them.
const readsBeforeResources = reads;
for (const path of ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/zh-CN/manifest.webmanifest", "/llms.txt", "/ja/llms.txt", "/assets/x.js", "/api/site-config", "/agents/a"]) {
  assert.equal(await get(path), undefined, `${path}: not an HTML document owned by SEO`);
}
assert.equal(reads, readsBeforeResources, "resource and API requests do not read site settings through SEO");
manifestAvailable = false;
for (const path of ["/", "/login", "/ja/app/session/private"]) {
  const html = await (await get(path))!.text();
  assert.ok(!html.includes('rel="manifest"'), `${path}: absent manifest plugin leaves no broken link`);
  assert.ok(html.includes('rel="icon"'), `${path}: independent brand icons remain`);
}
manifestAvailable = true;
settingsAvailable = false;
for (const method of ["GET", "HEAD"]) {
  const response = await handler(new Request("https://app.example.test/", { method, headers: { accept: "text/html" } }), baseEnv);
  assert.equal(response?.status, 503, `${method}: persisted settings failure is explicit`);
  if (method === "HEAD") assert.equal(await response!.text(), "");
}
settingsAvailable = true;

// A broken override never turns into a 500: the head falls back and renders.
const broken = { ASSETS: assets, SITE_SEO_JSON: "{not json" };
const brokenResponse = await get("/", broken);
assert.equal(brokenResponse?.status, 200, "a malformed override stays fail-open");
assert.ok((await brokenResponse!.text()).includes(`<title>${config.locales.en.title}</title>`), "the default title renders");

console.log("seo document meta: localized HTML, optional manifest, separate resource ownership, failure/HEAD, private noindex and 301 matrix passed");
