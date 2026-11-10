/** Unit tests: the SEO config resolver is pure, fail-open and dependency-free. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SITE_SEO, HARD_FALLBACK_COPY, MAX_SITE_SEO_JSON_LENGTH, OG_LOCALES, SITE_SEO_ENV_KEY,
  absoluteAssetUrl, resolvePageCopy, resolveSiteOrigin, resolveSiteSeo,
} from "../src/index.ts";
import { LOCALE_IDS } from "../../dsh-base-locale-path/src/index.ts";

const json = (value: unknown) => JSON.stringify(value);

test("shipped defaults are complete without any override", () => {
  const { config, problems } = resolveSiteSeo({});
  assert.deepEqual(problems, []);
  assert.equal(config.site.name, "DeepSeek Harness Base");
  assert.deepEqual(Object.keys(config.locales).sort(), [...LOCALE_IDS].sort());
  assert.deepEqual(Object.keys(OG_LOCALES).sort(), [...LOCALE_IDS].sort());
  for (const locale of LOCALE_IDS) {
    assert.ok(config.locales[locale].title.length > 0);
    assert.ok(config.locales[locale].description.length > 0);
    assert.ok(config.locales[locale].keywords.length > 0);
  }
  assert.equal(config.image.url, "/og.png");
  assert.equal(config.image.width, 1200);
  assert.equal(config.image.height, 630);
  assert.equal(Object.keys(config.icons).length, 8);
  assert.equal(config.manifest.display, "standalone");
  assert.equal(config.robots, undefined);
  assert.equal(config.pages, undefined);
});

test("an empty JSON object and absent env both resolve to the defaults", () => {
  assert.deepEqual(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: "{}" }).config, resolveSiteSeo(undefined).config);
  assert.deepEqual(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: "   " }).config, resolveSiteSeo(undefined).config);
});

test("a valid JSON override merges over the defaults", () => {
  const { config, problems } = resolveSiteSeo({
    [SITE_SEO_ENV_KEY]: json({
      site: { name: "Acme", url: "https://acme.example/", twitter: "@acme", contactEmail: "hi@acme.example" },
      locales: { zh: { title: "Acme 中文", description: "描述", keywords: ["a", "b"], ogImageAlt: "中文图" } },
      icons: { png32: "/brand/32.png" },
      image: { url: "https://cdn.example/og.png", width: 1200, height: 630, type: "image/png", alt: "Acme 卡片" },
      manifest: { shortName: "Acme", themeColor: "#000000", backgroundColor: "#ffffff", display: "standalone" },
    }),
  });
  assert.deepEqual(problems, []);
  assert.equal(config.site.name, "Acme");
  assert.equal(config.site.url, "https://acme.example");
  assert.equal(config.site.twitter, "@acme");
  assert.equal(config.locales.zh.title, "Acme 中文");
  assert.equal(config.locales.zh.ogImageAlt, "中文图");
  assert.equal(config.locales.en.title, DEFAULT_SITE_SEO.locales.en.title, "untouched locales keep the default copy");
  assert.equal(config.icons.png32, "/brand/32.png");
  assert.equal(config.icons.svg, "/favicon.svg");
  assert.equal(config.image.url, "https://cdn.example/og.png");
  assert.equal(config.manifest.shortName, "Acme");
});

test("invalid JSON falls back to the defaults without throwing", () => {
  const { config, problems } = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: "{not json" });
  assert.deepEqual(config, DEFAULT_SITE_SEO);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is not valid JSON/u);
});

test("an oversized override is ignored before parsing", () => {
  const { config, problems } = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: "x".repeat(MAX_SITE_SEO_JSON_LENGTH + 1) });
  assert.deepEqual(config, DEFAULT_SITE_SEO);
  assert.match(problems[0], /exceeds/u);
});

test("a non-object JSON document is refused field-completely", () => {
  const { config, problems } = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: "[1,2]" });
  assert.deepEqual(config, DEFAULT_SITE_SEO);
  assert.match(problems[0], /expected a JSON object/u);
});

test("per-field fallback keeps valid siblings", () => {
  const { config, problems } = resolveSiteSeo({
    [SITE_SEO_ENV_KEY]: json({
      site: { name: 42, url: "not a url" },
      locales: { zh: { title: 7, description: "保留的文案", keywords: "not-an-array" } },
      icons: { svg: "no-leading-slash.png", ico: "https://cdn.example/favicon.ico" },
      image: { width: -1, height: "630" },
      manifest: { display: "fullscreen" },
      pages: { "no-slash": { title: "x" }, "/app/session": { title: "Drop", lastmod: "yesterday" } },
      robots: { disallow: ["/private", "no-slash"], extraLines: ["User-agent: *", "Sitemap: https://elsewhere.example/sitemap.xml"] },
    }),
  });
  assert.equal(config.site.name, DEFAULT_SITE_SEO.site.name);
  assert.equal(config.site.url, undefined);
  assert.equal(config.locales.zh.title, DEFAULT_SITE_SEO.locales.zh.title);
  assert.equal(config.locales.zh.description, "保留的文案");
  assert.deepEqual(config.locales.zh.keywords, DEFAULT_SITE_SEO.locales.zh.keywords);
  assert.equal(config.icons.svg, DEFAULT_SITE_SEO.icons.svg);
  assert.equal(config.icons.ico, "https://cdn.example/favicon.ico");
  assert.equal(config.image.width, DEFAULT_SITE_SEO.image.width);
  assert.equal(config.image.height, DEFAULT_SITE_SEO.image.height);
  assert.equal(config.manifest.display, "standalone");
  assert.deepEqual(config.pages, { "/app/session": { title: "Drop" } });
  assert.deepEqual(config.robots, { disallow: ["/private"], extraLines: [] });
  assert.ok(problems.length >= 8);
  assert.ok(problems.some(problem => /site\.name/u.test(problem)));
  assert.ok(problems.some(problem => /pages\["no-slash"\]/u.test(problem)));
  assert.ok(problems.some(problem => /User-agent/u.test(problem)));
});

test("partial locales leave the other seven dictionaries intact", () => {
  const { config } = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ locales: { fr: { title: "Seulement le titre" } } }) });
  assert.equal(config.locales.fr.title, "Seulement le titre");
  assert.equal(config.locales.fr.description, DEFAULT_SITE_SEO.locales.fr.description);
  for (const locale of LOCALE_IDS.filter(value => value !== "fr")) {
    assert.equal(config.locales[locale].title, DEFAULT_SITE_SEO.locales[locale].title);
  }
});

test("site.url normalizes trailing slashes and rejects credentials, query or fragment", () => {
  assert.equal(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ site: { url: "https://a.example/" } }) }).config.site.url, "https://a.example");
  assert.equal(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ site: { url: "https://user:pw@a.example" } }) }).config.site.url, undefined);
  assert.equal(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ site: { url: "https://a.example/?x=1" } }) }).config.site.url, undefined);
  assert.equal(resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ site: { url: "ftp://a.example" } }) }).config.site.url, undefined);
});

test("page overrides accept hints but never read a clock", () => {
  const { config, problems } = resolveSiteSeo({
    [SITE_SEO_ENV_KEY]: json({
      pages: {
        "/": { title: "首页", description: "首页描述", keywords: ["首页"], priority: "0.9", changefreq: "daily", lastmod: "2026-11-14" },
      },
    }),
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(config.pages, {
    "/": { title: "首页", description: "首页描述", keywords: ["首页"], priority: "0.9", changefreq: "daily", lastmod: "2026-11-14" },
  });
  const withoutHints = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ pages: { "/": {} } }) });
  assert.equal(withoutHints.config.pages?.["/"]?.lastmod, undefined, "no date is invented when the config does not set one");
});

test("page copy resolves page config → registry copy → locale → English → hard fallback", () => {
  const { config } = resolveSiteSeo({
    [SITE_SEO_ENV_KEY]: json({
      pages: { "/": { title: "Config title", keywords: ["config"] } },
      locales: { en: { title: "English title", description: "English description", keywords: ["english"] } },
    }),
  });
  const fromConfig = resolvePageCopy(config, "/", "zh", { zh: { description: "registry description" } });
  assert.equal(fromConfig.title, "Config title");
  assert.equal(fromConfig.description, "registry description");
  assert.deepEqual(fromConfig.keywords, ["config"]);

  const locale = resolvePageCopy(config, "/missing", "zh");
  assert.equal(locale.title, DEFAULT_SITE_SEO.locales.zh.title);
  const english = resolvePageCopy(config, "/missing", "zh");
  assert.ok(english.description.length > 0);
  assert.equal(HARD_FALLBACK_COPY.title, "DeepSeek Harness Base");
});

test("origin and asset URLs resolve against the site origin", () => {
  const { config } = resolveSiteSeo({ [SITE_SEO_ENV_KEY]: json({ site: { url: "https://acme.example" } }) });
  assert.equal(resolveSiteOrigin(config, "http://127.0.0.1:5190"), "https://acme.example");
  assert.equal(resolveSiteOrigin(DEFAULT_SITE_SEO, "http://127.0.0.1:5190"), "http://127.0.0.1:5190");
  assert.equal(absoluteAssetUrl("/og.png", "https://acme.example/"), "https://acme.example/og.png");
  assert.equal(absoluteAssetUrl("https://cdn.example/og.png", "https://acme.example"), "https://cdn.example/og.png");
  assert.equal(absoluteAssetUrl("/og.png/", "https://acme.example"), "https://acme.example/og.png");
});
