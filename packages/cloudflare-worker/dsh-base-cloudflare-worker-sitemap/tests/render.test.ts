/** Public sitemap renderer contract. */
import assert from "node:assert/strict";
import { escapeXml, pageUrl, renderSitemap } from "../src/render.ts";

const base = {
  origin: "https://example.com/",
  baseLocale: "en",
  locales: ["en", "zh"],
  pathPrefix: { en: "", zh: "/zh-CN" },
  hreflang: { en: "en", zh: "zh-CN" },
  localizedPaths: ["/"],
};

// Localized page: one <loc> per locale, reciprocal alternates, x-default only
// when the base locale participates.
const xml = renderSitemap({ ...base, pages: [{ path: "/", changefreq: "weekly", priority: "1.0" }] });
assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/u);
assert.match(xml, /<loc>https:\/\/example\.com\/<\/loc>/u);
assert.match(xml, /<loc>https:\/\/example\.com\/zh-CN<\/loc>/u);
assert.equal((xml.match(/<url>/gu) ?? []).length, 2);
assert.equal((xml.match(/hreflang="en"/gu) ?? []).length, 2);
assert.equal((xml.match(/hreflang="zh-CN"/gu) ?? []).length, 2);
assert.equal((xml.match(/hreflang="x-default"/gu) ?? []).length, 2);
assert.match(xml, /<changefreq>weekly<\/changefreq>/u);
assert.match(xml, /<priority>1\.0<\/priority>/u);

// Absent translations are omitted together with their alternates; an explicit
// empty availability skips the page entirely.
const partial = renderSitemap({ ...base, localizedPaths: ["/", "/guides/"], pages: [
  { path: "/guides/english-only", availableLocales: ["en"] },
  { path: "/guides/chinese-only", availableLocales: ["zh"] },
  { path: "/guides/missing", availableLocales: [] },
] });
assert.match(partial, /https:\/\/example\.com\/guides\/english-only/u);
assert.doesNotMatch(partial, /hreflang="zh-CN" href="https:\/\/example\.com\/guides\/english-only"/u);
assert.match(partial, /https:\/\/example\.com\/zh-CN\/guides\/chinese-only/u);
assert.doesNotMatch(partial, /guides\/missing/u);
assert.doesNotMatch(partial, /hreflang="x-default" href="https:\/\/example\.com\/zh-CN\/guides\/chinese-only"/u);

// Non-localized paths are emitted once with no alternates.
const plain = renderSitemap({ ...base, pages: [{ path: "/internal", lastmod: "2026-01-02" }] });
assert.equal((plain.match(/<url>/gu) ?? []).length, 1);
assert.match(plain, /<lastmod>2026-01-02<\/lastmod>/u);
assert.doesNotMatch(plain, /alternate/u);

// XML escaping for every reserved character.
assert.equal(escapeXml(`<&>"'`), "&lt;&amp;&gt;&quot;&apos;");
assert.match(renderSitemap({ ...base, pages: [{ path: "/", lastmod: `a&b<c"d` }] }), /<lastmod>a&amp;b&lt;c&quot;d<\/lastmod>/u);

// URL helper: origin slash normalization + localized joins.
assert.equal(pageUrl("https://example.com/", "/", "en", "en", { en: "", zh: "/zh-CN" }), "https://example.com/");
assert.equal(pageUrl("https://example.com", "/internal", "zh", "en", { en: "", zh: "/zh-CN" }), "https://example.com/zh-CN/internal");

console.log("sitemap renderer: localized alternates, hints and escaping passed");
