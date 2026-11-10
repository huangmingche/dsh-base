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
const request = (path: string, method = "GET", accept = "text/html") => handler(new Request(`https://app.example.test${path}`, { method, headers: { accept } }), {});

const ownedPath = "/manifest.webmanifest";
const outsidePaths = ["/", "/manifest.webmanifest/private", "/zh/manifest.webmanifest", "/sitemap.xml", "/robots.txt", "/llms.txt", "/assets/a.js", "/api/site-config", "/agents/a"];
assert.deepEqual(services.get("siteManifest"), { path: ownedPath });
config = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ site: { name: "Saved Site" }, icons: { svg: "/saved.svg" }, manifest: { themeColor: "#123456" } }) }).config;
for (const locale of LOCALE_IDS) {
  const path = localizePath(ownedPath, locale);
  for (const accept of ["text/html", "application/json", "*/*"]) {
    const response = await request(path, "GET", accept);
    assert.equal(response?.status, 200);
    assert.equal(response!.headers.get("content-type"), "application/manifest+json");
    assert.equal(response!.headers.get("content-language"), hreflangFor(locale));
    const value = await response!.json() as { name: string; lang: string; theme_color: string; icons: { src: string }[]; start_url: string };
    assert.equal(value.name, "Saved Site"); assert.equal(value.lang, hreflangFor(locale));
    assert.equal(value.theme_color, "#123456"); assert.equal(value.icons.length, 4);
    assert.ok(value.icons.some(icon => icon.src === "https://app.example.test/saved.svg"));
    assert.ok(value.start_url.startsWith(`https://app.example.test${localizePath("/", locale)}`));
  }
  const head = await request(path, "HEAD");
  assert.equal(head?.status, 200); assert.equal(await head!.text(), "");
  assert.equal(head!.headers.get("content-type"), "application/manifest+json");
}
for (const [path, target] of [["/en/manifest.webmanifest?x=1", "/manifest.webmanifest?x=1"], ["/ZH-CN/manifest.webmanifest", "/zh-CN/manifest.webmanifest"]]) {
  const before = reads;
  const response = await request(path!); assert.equal(response?.status, 301);
  assert.equal(response!.headers.get("location"), `https://app.example.test${target}`); assert.equal(reads, before);
}

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
console.log("manifest resource: exact route, real payload, HEAD, shared saved values, read isolation and explicit failure passed");
