/** Public-surface predicate contract shared by SEO and auth. */
import assert from "node:assert/strict";
import { PUBLIC_PAGES, isNoIndexDocument, isPrivateDocument, isPublicDocument, isPublicResource, resolvePublicResource } from "../src/index.ts";

assert.deepEqual(PUBLIC_PAGES.map(page => page.path), ["/"]);
assert.equal(isPublicDocument("/"), true);
assert.equal(isPublicDocument("/zh-CN"), false, "callers pass the locale-stripped path");
assert.equal(isPublicDocument("/login"), false, "login is reachable but not public content");
assert.equal(isPrivateDocument("/app/session/1"), true);
assert.equal(isPrivateDocument("/app/workspace/w"), true);
assert.equal(isPrivateDocument("/app/sessions"), false, "segment boundary");
assert.equal(isNoIndexDocument("/login"), true);
assert.equal(isNoIndexDocument("/app/session/1"), true);
assert.equal(isNoIndexDocument("/"), false);
console.log("public pages: one shared public/private/noindex predicate for SEO and auth");

for (const path of ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/zh-CN/manifest.webmanifest", "/llms.txt", "/ja/llms.txt"]) assert.equal(isPublicResource(path), true, path);
for (const path of ["/sitemap.xml/private", "/robots.txt/", "/llms.txt/private", "/llms-full.txt", "/zh/llms.txt", "/private/llms.txt", "/ja/sitemap.xml", "/ja/robots.txt", "/api/site-settings"]) assert.equal(isPublicResource(path), false, path);
assert.deepEqual(resolvePublicResource("/ZH-CN/llms.txt"), { name: "llms", locale: "zh", canonicalPath: "/zh-CN/llms.txt" });
assert.deepEqual(resolvePublicResource("/en/manifest.webmanifest"), { name: "manifest", locale: "en", canonicalPath: "/manifest.webmanifest" });
console.log("public resources: exact paths, localized declarations and no prefix widening passed");
