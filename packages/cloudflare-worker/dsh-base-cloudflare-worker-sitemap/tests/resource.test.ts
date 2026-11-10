/** Independent route ownership and shared configuration behavior over the real plugin handler. */
import assert from "node:assert/strict";
import { createPublicPages } from "../../dsh-base-cloudflare-worker-public-pages/src/index.ts";
import { apply } from "../src/index.ts";
import { resolveSiteSeo, type SiteSeoConfig } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { LOCALE_IDS, localizePath, hreflangFor } from "../../../boot/dsh-base-locale-path/src/index.ts";

let config: SiteSeoConfig = resolveSiteSeo({}).config;
let reads = 0;
let unavailable = false;
const services = new Map<string, unknown>();
const handlers: Array<(request: Request, env: unknown) => Promise<Response | undefined>> = [];
const ctx = {
  publicPages: createPublicPages(),
  get(name: string) { return services.get(name); },
  provide(name: string, value: unknown) { services.set(name, value); },
  siteSettings: { async read() { reads++; if (unavailable) throw new Error("database unavailable"); return { values: { seo: config } }; } },
  effect(callback: () => unknown) { return callback(); },
  http: { use(handler: (request: Request, env: unknown) => Promise<Response | undefined>, priority: number) { assert.equal(priority, 20); handlers.push(handler); return () => {}; } },
};
apply(ctx as never);
assert.equal(handlers.length, 1);
const handler = handlers[0]!;
const request = (path: string, method = "GET", accept = "text/html") => handler(new Request(`https://app.example.test${path}`, { method, headers: { accept } }), {SITE_INDEXING_ENABLED:"true", SITE_DEPLOYMENT_ENVIRONMENT:"production", AUTH_BASE_URL: "https://app.example.test"});

const ownedPath = "/sitemap.xml";
const outsidePaths = ["/", "/sitemap.xml/private", "/ja/sitemap.xml", "/robots.txt", "/llms.txt", "/manifest.webmanifest", "/assets/a.js", "/api/site-config", "/agents/a"];
assert.deepEqual(services.get("siteSitemap"), { path: ownedPath });
for (const accept of ["text/html", "application/xml", "*/*"]) {
  const response = await request(ownedPath, "GET", accept);
  assert.equal(response?.status, 200);
  assert.equal(response!.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(response!.headers.get("x-robots-tag"), "noindex");
  const xml = await response!.text();
  assert.equal((xml.match(/<url>/gu) ?? []).length, 8);
  for (const locale of LOCALE_IDS) assert.ok(xml.includes(`<loc>https://app.example.test${localizePath("/", locale)}</loc>`));
  assert.doesNotMatch(xml, /<html|\/login|\/app\/(?:session|workspace)\//u);
}
config = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ site: { url: "https://saved.example.test" }, pages: {
  "/": { lastmod: "2025-01-31", changefreq: "monthly", priority: "0.8" },
  "/pricing": { title: "Unregistered" }, "/account": {}, "/app/session/private": {}, "/zh-CN/app/session/private": {}, "//other.test": {},
} }) }).config;
const changed = await (await request(ownedPath))!.text();
assert.match(changed, /<loc>https:\/\/app\.example\.test\/<\/loc>/u);
assert.match(changed, /<lastmod>2025-01-31<\/lastmod>/u);
assert.match(changed, /<changefreq>monthly<\/changefreq>/u);
assert.match(changed, /<priority>0\.8<\/priority>/u);
assert.doesNotMatch(changed, /pricing|account|agent\/private|other\.test/u, "deployment config cannot add unregistered routes");
const head = await request(ownedPath, "HEAD");
assert.equal(head?.status, 200); assert.equal(await head!.text(), "");
assert.equal(head!.headers.get("content-type"), "application/xml; charset=utf-8");

// Config is read only by the exact owned route, never by static, AI or other resources.
const before = reads;
for (const path of outsidePaths) assert.equal(await request(path), undefined, `${path}: not owned`);
assert.equal(reads, before);
const rejected = await request(ownedPath, "POST");
assert.equal(rejected?.status, 405);
assert.equal(rejected!.headers.get("allow"), "GET, HEAD");
assert.equal(reads, before, "unsupported methods do not read settings");
unavailable = true;
for (const method of ["GET", "HEAD"]) {
  const response = await request(ownedPath, method);
  assert.equal(response?.status, 503, `${method}: no silent fallback to defaults`);
  assert.match(response!.headers.get("cache-control") ?? "", /no-store/u);
  if (method === "HEAD") assert.equal(await response!.text(), "");
  else assert.deepEqual(await response!.json(), { error: "site_settings_unavailable" });
}
console.log("sitemap resource: exact route, real payload, HEAD, shared saved values, read isolation and explicit failure passed");
