/** Public robots renderer contract. */
import assert from "node:assert/strict";
import { renderRobots } from "../src/render.ts";

// robots: sitemap reference, base + localized disallow rules.
const robots = renderRobots("https://example.com", "/sitemap.xml", ["en", "zh"], "en", { en: "", zh: "/zh-CN" });
assert.match(robots, /^User-agent: \*/u);
assert.match(robots, /Disallow: \/api\//u);
assert.match(robots, /Disallow: \/zh-CN\/api\//u);
assert.doesNotMatch(robots, /Disallow: \/login/u, "login must remain crawlable for its noindex directive");
assert.match(robots, /Disallow: \/app\/session\//u);
assert.match(robots, /Disallow: \/app\/workspace\//u);
assert.doesNotMatch(robots, /Disallow: \/zh-CN\/login/u);
assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/u);
console.log("worker seo: sitemap and robots renderer passed");

// robots: the default block is unchanged; deployment additions append.
const robotsBase = renderRobots("https://example.com", "/sitemap.xml", ["en", "zh"], "en", { en: "", zh: "/zh-CN" });
assert.match(robotsBase, /^User-agent: \*\nAllow: \/\n/u);
assert.match(robotsBase, /Disallow: \/api\//u);
assert.match(robotsBase, /Disallow: \/zh-CN\/api\//u);
assert.match(robotsBase, /Sitemap: https:\/\/example\.com\/sitemap\.xml\n$/u);
const robotsWithAdditions = renderRobots("https://example.com", "/sitemap.xml", ["en", "zh"], "en", { en: "", zh: "/zh-CN" }, {
  disallow: ["/private", "staging"],
  extraLines: ["# managed by deployment", "Crawl-delay: 1"],
});
assert.match(robotsWithAdditions, /Disallow: \/private/u);
assert.match(robotsWithAdditions, /Disallow: \/staging/u, "a path without a leading slash is normalized");
assert.match(robotsWithAdditions, /# managed by deployment/u);
assert.match(robotsWithAdditions, /Crawl-delay: 1/u);
assert.match(robotsWithAdditions, /Sitemap: https:\/\/example\.com\/sitemap\.xml\n$/u, "the sitemap pointer stays last");
assert.equal((robotsWithAdditions.match(/Disallow: \/private/gu) ?? []).length, 1, "a configured path already covered by the default block is not duplicated");
console.log("sitemap/robots: localized alternates, page hints, XML escaping and robots additions passed");

assert.doesNotMatch(renderRobots("https://example.com", undefined, ["en"], "en"), /Sitemap:/u, "an absent producer has no advertised sitemap");
const unsafeAdditions = {extraLines: ['Sitemap: https://foreign.test/sitemap.xml', ' sitemap : https://foreign.test/other.xml', 'User-agent: *', '# note']};
assert.doesNotMatch(renderRobots('https://canonical.test', undefined, ['en'], 'en', undefined, unsafeAdditions), /Sitemap:|foreign\.test/u, 'preview cannot regain submission hints through custom rules');
const controlled = renderRobots('https://canonical.test', '/sitemap.xml', ['en'], 'en', undefined, unsafeAdditions);
assert.equal((controlled.match(/Sitemap:/gu) ?? []).length, 1);
assert.match(controlled, /Sitemap: https:\/\/canonical.test\/sitemap.xml/u);
