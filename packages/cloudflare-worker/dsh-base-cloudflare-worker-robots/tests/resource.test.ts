/** Independent route ownership and shared configuration behavior over the real plugin handler. */
import assert from "node:assert/strict";
import { apply } from "../src/index.ts";
import { resolveSiteSeo, type SiteSeoConfig } from "../../../boot/dsh-base-site-seo/src/index.ts";
import { LOCALE_IDS, localizePath, hreflangFor } from "../../../boot/dsh-base-locale-path/src/index.ts";

let config: SiteSeoConfig = resolveSiteSeo({}).config;
let reads = 0;
let unavailable = false;
const services = new Map<string, unknown>();
const handlers: Array<(request: Request, env: unknown) => Promise<Response | undefined>> = [];
const ctx = {
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

const ownedPath = "/robots.txt";
const outsidePaths = ["/", "/robots.txt/private", "/ja/robots.txt", "/sitemap.xml", "/llms.txt", "/manifest.webmanifest", "/assets/a.js", "/api/site-config", "/agents/a"];
const initial = await request(ownedPath);
assert.equal(initial?.status, 200); assert.equal(initial!.headers.get("content-type"), "text/plain; charset=utf-8");
assert.doesNotMatch(await initial!.text(), /Sitemap:/u, "independent robots works without sitemap");
services.set("siteSitemap", { path: "/sitemap.xml" });
config = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ site: { url: "https://saved.example.test" }, robots: { disallow: ["/private"], extraLines: ["# Saved policy"] } }) }).config;
for (const accept of ["text/html", "text/plain", "*/*"]) {
  const response = await request(ownedPath, "GET", accept);
  assert.equal(response?.status, 200);
  const text = await response!.text();
  assert.match(text, /Disallow: \/private/u);
  assert.match(text, /# Saved policy/u);
  assert.match(text, /Sitemap: https:\/\/app\.example\.test\/sitemap\.xml/u);
  for (const locale of LOCALE_IDS) {
    for (const prefix of ["/app/session/", "/app/workspace/"]) {
      assert.ok(text.includes(`Disallow: ${localizePath(prefix, locale)}`));
    }
  }
  assert.doesNotMatch(text, /<html/u);
}
services.delete("siteSitemap");
assert.doesNotMatch(await (await request(ownedPath))!.text(), /Sitemap:/u, "removing producer removes reference on next request");
const head = await request(ownedPath, "HEAD");
assert.equal(head?.status, 200); assert.equal(await head!.text(), "");
assert.equal(head!.headers.get("content-type"), "text/plain; charset=utf-8");

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
console.log("robots resource: exact route, real payload, HEAD, shared saved values, read isolation and explicit failure passed");
