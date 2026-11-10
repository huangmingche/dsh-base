import assert from "node:assert/strict";
import {
  BASE_LOCALE, LOCALE_IDS, canonicalizeLocalePath, hreflangFor, isLocaleId, isLocalePrefix, localeForPathSegment,
  localizePath, prefixFor, splitLocalePath,
} from "../src/index.ts";

assert.deepEqual([...LOCALE_IDS], ["zh", "en", "ja", "es", "fr", "de", "pt", "ru"]);
assert.equal(BASE_LOCALE, "en");
assert.equal(isLocaleId("zh"), true);
assert.equal(isLocaleId("zh-CN"), false, "locale ids are dictionary ids; the Chinese path segment keeps its historical region");
assert.equal(isLocaleId("en"), true, "en is a known id even though it is the unprefixed base");

// Chinese keeps the historical /zh-CN path prefix; the other six keep bare ids.
assert.deepEqual(prefixFor("zh"), "/zh-CN");
for (const locale of LOCALE_IDS.filter(id => id !== "zh" && id !== "en")) assert.equal(prefixFor(locale), `/${locale}`);
assert.equal(prefixFor("en"), "");
assert.equal(localeForPathSegment("zh-CN"), "zh");
assert.equal(localeForPathSegment("ja"), "ja");
assert.equal(localeForPathSegment("zh"), undefined, "the old bare Chinese id is no longer a path segment");
assert.equal(localeForPathSegment("en"), "en");
assert.equal(localeForPathSegment("xx"), undefined);

// The seven path forms from the task card. Functions take pathname only, so the
// URL-level forms (with query/hash) are exercised through `new URL` below.
const cases: Array<[string, { locale: string; path: string; prefixed: boolean; needsLocaleRedirect: boolean; canonicalPath: string }]> = [
  ["/", { locale: "en", path: "/", prefixed: false, needsLocaleRedirect: false, canonicalPath: "/" }],
  ["/zh-CN", { locale: "zh", path: "/", prefixed: true, needsLocaleRedirect: false, canonicalPath: "/zh-CN" }],
  ["/zh-CN/", { locale: "zh", path: "/", prefixed: true, needsLocaleRedirect: false, canonicalPath: "/zh-CN" }],
  ["/zh", { locale: "en", path: "/zh", prefixed: false, needsLocaleRedirect: false, canonicalPath: "/zh" }],
  ["/en/x", { locale: "en", path: "/x", prefixed: true, needsLocaleRedirect: true, canonicalPath: "/x" }],
  ["/xx", { locale: "en", path: "/xx", prefixed: false, needsLocaleRedirect: false, canonicalPath: "/xx" }],
  ["/zh-CN/app/session/abc", { locale: "zh", path: "/app/session/abc", prefixed: true, needsLocaleRedirect: false, canonicalPath: "/zh-CN/app/session/abc" }],
];
for (const [input, expected] of cases) assert.deepEqual(splitLocalePath(input), expected, `split ${input}`);

// A pathname contract, not a URL: query/hash would be silently dropped, so they throw.
for (const input of ["/zh-CN?a=1", "/zh-CN/app/session/abc#top", "/?x=1"]) {
  assert.throws(() => splitLocalePath(input), TypeError, `query/hash rejected: ${input}`);
}

// Prefix resolves only at the outermost segment.
assert.deepEqual(splitLocalePath("/app/session/zh-CN/abc"), { locale: "en", path: "/app/session/zh-CN/abc", prefixed: false, needsLocaleRedirect: false, canonicalPath: "/app/session/zh-CN/abc" });
assert.deepEqual(splitLocalePath("/zh-CN/app/workspace/w1"), { locale: "zh", path: "/app/workspace/w1", prefixed: true, needsLocaleRedirect: false, canonicalPath: "/zh-CN/app/workspace/w1" });

// A case variant is not a prefix until it is canonicalized.
for (const variant of ["/ZH-CN/x", "/Zh-cn", "/zh-cn/x", "/JA/x", "/EN/x"]) {
  assert.equal(splitLocalePath(variant).prefixed, false, `case variant stays inert: ${variant}`);
}
assert.equal(canonicalizeLocalePath("/ZH-CN/x"), "/zh-CN/x");
assert.equal(canonicalizeLocalePath("/Zh-cn"), "/zh-CN");
assert.equal(canonicalizeLocalePath("/zh-cn/x"), "/zh-CN/x");
assert.equal(canonicalizeLocalePath("/JA/x"), "/ja/x");
assert.equal(canonicalizeLocalePath("/EN/x"), "/x", "a case variant of the base spelling collapses to the bare path");
assert.equal(canonicalizeLocalePath("/EN"), "/");
for (const canonical of ["/zh-CN/x", "/zh-CN", "/ja/x", "/x", "/", "/app/session/zh-CN/x", "/zh/x"]) {
  assert.equal(canonicalizeLocalePath(canonical), canonical, `already canonical or inert: ${canonical}`);
}

// Assets, API and metadata endpoints never participate in prefix parsing.
for (const path of ["/api/session-host", "/assets/index.js", "/plugins/events", "/sitemap.xml", "/robots.txt"]) {
  assert.deepEqual(splitLocalePath(path), { locale: "en", path, prefixed: false, needsLocaleRedirect: false, canonicalPath: path }, path);
}
// …and the exclusion respects segment boundaries: a longer name is not excluded.
for (const path of ["/plugins/eventsfoo", "/sitemap.xmlfoo", "/assetsfoo", "/apifoo"]) {
  assert.deepEqual(splitLocalePath(path), { locale: "en", path, prefixed: false, needsLocaleRedirect: false, canonicalPath: path }, path);
}
assert.equal(splitLocalePath("/plugins/events/retry").locale, "en");
assert.equal(splitLocalePath("/api/zh-CN/session").locale, "en");

// zh uses BCP-47 zh-CN for lang/hreflang; the rest keep their id.
assert.equal(hreflangFor("zh"), "zh-CN");
for (const locale of LOCALE_IDS.filter(id => id !== "zh")) assert.equal(hreflangFor(locale), locale, locale);

// Prefix helpers agree with each other and with localization.
for (const locale of LOCALE_IDS) {
  const prefix = prefixFor(locale);
  assert.equal(localizePath("/", locale), locale === "en" ? "/" : prefix);
  assert.equal(localizePath("/app/session/abc", locale), `${prefix}/app/session/abc`);
  if (locale === "en") {
    assert.equal(splitLocalePath(localizePath("/app/session/abc", locale)).locale, "en");
    continue;
  }
  const roundTrip = splitLocalePath(localizePath("/app/session/abc", locale));
  assert.equal(roundTrip.locale, locale, `round-trip ${locale}`);
  assert.equal(roundTrip.path, "/app/session/abc");
  assert.equal(roundTrip.canonicalPath, localizePath("/app/session/abc", locale), `canonicalPath ${locale}`);
}
assert.equal(localizePath("relative/path", "ja"), "/ja/relative/path");
assert.equal(localizePath("/app/session/abc", "zh"), "/zh-CN/app/session/abc");
assert.equal(isLocalePrefix("zh-CN"), true);
assert.equal(isLocalePrefix("zh"), false);
assert.equal(isLocalePrefix("ja"), true);
assert.equal(isLocalePrefix("en"), true, "the explicit base spelling parses before its 301");
assert.equal(isLocalePrefix(undefined), false);

// URL-level forms: pathname excludes query/hash, and the round-trip preserves
// them while canonicalizing the trailing slash.
for (const raw of ["https://app.test/zh-CN?a=1#b", "https://app.test/zh-CN/?a=1", "https://app.test/app/session/zh-CN?a=1"]) {
  const url = new URL(raw);
  const split = splitLocalePath(url.pathname);
  const expected = raw.replace(/^https:\/\/app\.test/u, "").replace(/^\/zh-CN\/(?=[?#]|$)/u, "/zh-CN");
  assert.equal(localizePath(split.path, split.locale) + url.search + url.hash, expected, raw);
}
console.log("locale path: /zh-CN canonical prefix, bare-id siblings, canonicalPath, case-canonicalizing 301, BCP-47 hreflang and round-trips passed");
