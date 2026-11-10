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
const request = (path: string, method = "GET", accept = "text/html") => handler(new Request(`https://app.example.test${path}`, { method, headers: { accept } }), {});

const ownedPath = "/llms.txt";
const outsidePaths = ["/", "/llms.txt/private", "/zh/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/assets/a.js", "/api/site-config", "/agents/a"];
assert.deepEqual(services.get("siteLlms"), { path: ownedPath });
for (const locale of LOCALE_IDS) {
  const path = localizePath(ownedPath, locale);
  const response = await request(path);
  assert.equal(response?.status, 200);
  assert.equal(response!.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response!.headers.get("content-language"), hreflangFor(locale));
  const text = await response!.text();
  assert.ok(text.startsWith(`# ${config.site.name}`));
  assert.ok(text.includes(config.locales[locale].description));
  assert.ok(text.includes(`(<https://app.example.test${localizePath("/", locale)}>)`));
  assert.doesNotMatch(text, /\.md|llms-full|\/login|\/app\/session\/|\/app\/workspace\/|<html/u);
  assert.equal((text.match(/^- \[/gmu) ?? []).length, 1, "only one registered page per locale");
  const head = await request(path, "HEAD"); assert.equal(head?.status, 200); assert.equal(await head!.text(), "");
  assert.equal(head!.headers.get("content-type"), "text/plain; charset=utf-8");
}
config = { ...config, site: { ...config.site, url: "https://saved.example.test" }, pages: { "/private": {}, "/pricing": {} }, llms: { introduction: "Saved introduction", guidance: "Use the listed public pages." } };
for (const accept of ["text/html", "text/plain", "*/*"]) {
  const text = await (await request(ownedPath, "GET", accept))!.text();
  assert.match(text, /> Saved introduction/u); assert.match(text, /Use the listed public pages\./u);
  assert.match(text, /https:\/\/saved\.example\.test\//u); assert.doesNotMatch(text, /\/private|\/pricing/u);
}
config = { ...config, llms: { enabled: false } };
for (const method of ["GET", "HEAD"]) { const response = await request(ownedPath, method); assert.equal(response?.status, 404); assert.equal(await response!.text(), ""); }
config = { ...config, llms: { enabled: true } };
assert.equal((await request(ownedPath))?.status, 200, "enabling is visible without cache delay");
for (const [path, target] of [["/en/llms.txt?x=1", "/llms.txt?x=1"], ["/ZH-CN/llms.txt", "/zh-CN/llms.txt"]]) {
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
console.log("llms resource: exact route, real payload, HEAD, shared saved values, read isolation and explicit failure passed");
