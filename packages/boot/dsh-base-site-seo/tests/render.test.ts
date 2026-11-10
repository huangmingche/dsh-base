/** Head / JSON-LD / manifest renderer contract for the site SEO package. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALE_IDS } from "../../dsh-base-locale-path/src/index.ts";
import { OG_LOCALES, resolvePageCopy, resolveSiteSeo } from "../src/index.ts";
import {
  MANIFEST_CONTENT_TYPE, documentUrl, escapeHtml, escapeJsonForScript, renderBrandHead, renderHead, renderJsonLd, renderManifest, resolvePageImage, siteAssetUrl,
} from "../src/render.ts";

const origin = "https://app.example.test";
const config = resolveSiteSeo({}).config;

test("removing the manifest plugin removes its head link without removing brand icons", () => {
  const brand = renderBrandHead({ config, locale: 'zh', origin, manifestPath: false });
  assert.doesNotMatch(brand, /rel="manifest"/u);
  assert.match(brand, /rel="icon"/u);
  const head = renderHead({ config, path: '/', locale: 'zh', origin, copy: resolvePageCopy(config, '/', 'zh'), manifestPath: false });
  assert.doesNotMatch(head, /rel="manifest"/u);
  assert.match(head, /rel="canonical"/u);
});

test("the og locale map is the eight-item table from the ADR", () => {
  assert.deepEqual(OG_LOCALES, {
    en: "en_US", zh: "zh_CN", ja: "ja_JP", es: "es_ES", fr: "fr_FR", de: "de_DE", pt: "pt_PT", ru: "ru_RU",
  });
});

test("the head carries every tag for a localized public page", () => {
  const copy = resolvePageCopy(config, "/", "zh");
  const head = renderHead({ config, path: "/", locale: "zh", origin, copy });
  assert.ok(head.includes(`<meta name="description" content="${copy.description}" />`));
  assert.ok(head.includes(`<meta name="keywords" content="${copy.keywords.join(", ")}" />`));
  assert.ok(head.includes(`<link rel="canonical" href="${origin}/zh-CN" />`));
  assert.equal((head.match(/rel="alternate" hreflang=/gu) ?? []).length, 9, "eight locales plus x-default");
  assert.ok(head.includes(`hreflang="x-default" href="${origin}/"`), "x-default points at the base locale");
  assert.ok(head.includes(`<meta property="og:url" content="${origin}/zh-CN" />`));
  assert.ok(head.includes('<meta property="og:locale" content="zh_CN" />'));
  assert.equal((head.match(/property="og:locale:alternate"/gu) ?? []).length, 7, "one alternate per other locale");
  assert.ok(head.includes('<meta property="og:locale:alternate" content="ru_RU" />'));
  assert.ok(!head.includes('property="og:locale:alternate" content="zh_CN"'), "the current locale is not its own alternate");
  assert.ok(head.includes(`<meta property="og:image" content="${siteAssetUrl('/og.png', origin)}" />`));
  assert.ok(head.includes('<meta property="og:image:width" content="1200" />'));
  assert.ok(head.includes('<meta property="og:image:height" content="630" />'));
  assert.ok(head.includes('<meta property="og:image:type" content="image/png" />'));
  assert.ok(head.includes('<meta property="og:image:alt"'));
  assert.ok(head.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(head.includes('<meta name="twitter:title"'));
  assert.ok(head.includes(`<meta name="twitter:image" content="${siteAssetUrl('/og.png', origin)}" />`));
  assert.ok(!head.includes("twitter:site"), "twitter:site is absent while no handle is configured");
  assert.equal((head.match(/<link rel="icon"/gu) ?? []).length, 2, "only the official light/dark SVG candidates");
  assert.ok(head.includes('<link rel="apple-touch-icon" sizes="180x180"'));
  assert.ok(head.includes(`<link rel="manifest" href="${origin}/zh-CN/manifest.webmanifest" />`), "the manifest link is localized");
  assert.ok(head.includes('<meta name="theme-color" content="#ffffff" />'));
  for (const locale of LOCALE_IDS) {
    const href = documentUrl(config, "/", locale, origin);
    assert.ok(head.includes(`hreflang="${locale === "zh" ? "zh-CN" : locale}" href="${href}"`), locale);
  }
});

test("head values are escaped, including the page-level copy", () => {
  const resolved = resolveSiteSeo({
    SITE_SEO_JSON: JSON.stringify({ site: { name: 'A & B <Corp> "quote"' }, locales: { en: { description: '<script>alert("x")</script>', title: "t&t" } } }),
  }).config;
  const copy = resolvePageCopy(resolved, "/", "en");
  const head = renderHead({ config: resolved, path: "/", locale: "en", origin, copy });
  assert.ok(head.includes("A &amp; B &lt;Corp&gt; &quot;quote&quot;"));
  assert.ok(head.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(!head.includes('<script>alert'));
  assert.equal(escapeHtml('&"<>'), "&amp;&quot;&lt;&gt;");
});

test("the JSON-LD graph carries the site and the organization", () => {
  const resolved = resolveSiteSeo({
    SITE_SEO_JSON: JSON.stringify({
      site: { name: "Example Corp", twitter: "@example", github: "example-org", contactEmail: "hello@example.test" },
    }),
  }).config;
  const canonical = `${origin}/zh-CN`;
  const block = renderJsonLd({ config: resolved, locale: "zh", origin, canonical });
  const scripts = [...block.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map(match => JSON.parse(match[1] as string));
  assert.equal(scripts.length, 2);
  const [website, organization] = scripts as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(website["@context"], "https://schema.org");
  assert.equal(website["@type"], "WebSite");
  assert.equal(website.name, "Example Corp");
  assert.equal(website.url, canonical);
  assert.equal(website.inLanguage, "zh-CN");
  assert.equal(organization["@type"], "Organization");
  assert.equal(organization.url, `${origin}/`);
  assert.deepEqual(organization.sameAs, ["https://twitter.com/example", "https://github.com/example-org"]);
  assert.equal(organization.email, "hello@example.test");
});

test("JSON-LD cannot close its script element", () => {
  const text = escapeJsonForScript({ name: "</script><script>alert(1)</script>" });
  assert.ok(!text.includes("</script>"));
  assert.ok(text.includes("\\u003c/script\\u003e"));
  const parsed = JSON.parse(text) as { name: string };
  assert.equal(parsed.name, "</script><script>alert(1)</script>");
});

test("the manifest is fully configured and localized", () => {
  const zhBody = renderManifest({ config, locale: "zh", origin });
  const zh = JSON.parse(zhBody) as Record<string, unknown>;
  assert.equal(zh.name, config.site.name);
  assert.equal(zh.short_name, config.manifest.shortName);
  assert.equal(zh.description, config.locales.zh.description);
  assert.equal(zh.start_url, `${origin}/zh-CN/`);
  assert.equal(zh.scope, `${origin}/`);
  assert.equal(zh.display, "standalone");
  assert.equal(zh.theme_color, config.manifest.themeColor);
  assert.equal(zh.background_color, config.manifest.backgroundColor);
  assert.equal(zh.lang, "zh-CN");
  const icons = zh.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  assert.equal(icons.length, 4);
  assert.deepEqual(icons.map(icon => icon.sizes), ["192x192", "512x512", "512x512", "any"]);
  assert.equal(icons[2]?.purpose, "maskable");
  assert.ok(icons.every(icon => icon.src.startsWith(origin)));
  const en = JSON.parse(renderManifest({ config, locale: "en", origin })) as Record<string, unknown>;
  assert.equal(en.start_url, `${origin}/`);
  assert.equal(MANIFEST_CONTENT_TYPE, "application/manifest+json");
});

test("page image overrides resolve to absolute URLs", () => {
  const overridden = resolvePageImage(config, origin, "/custom/og.png");
  assert.deepEqual(overridden, { url: `${origin}/custom/og.png`, alt: config.image.alt ?? config.site.name });
  const fallback = resolvePageImage(config, origin);
  assert.equal(fallback.url, siteAssetUrl('/og.png', origin));
  assert.equal(fallback.width, 1200);
  assert.equal(fallback.height, 630);
});

test("brand resources can be reused by noindex pages without search metadata", () => {
  for (const locale of LOCALE_IDS) {
    const brand = renderBrandHead({ config, locale, origin });
    const publicHead = renderHead({ config, path: "/", locale, origin, copy: resolvePageCopy(config, "/", locale) });
    assert.ok(publicHead.includes(brand), `${locale}: public and private branding share one rendering path`);
    assert.equal((brand.match(/rel="manifest"/gu) ?? []).length, 1);
    for (const forbidden of ['rel="canonical"', 'hreflang=', 'property="og:', 'name="twitter:', 'application/ld+json', 'name="description"']) assert.ok(!brand.includes(forbidden), `${locale}: branding excludes ${forbidden}`);
  }
});

test("shipped icons use content versions in public/private heads and the manifest", () => {
  const original = JSON.stringify(config);
  for (const locale of LOCALE_IDS) {
    const head = renderBrandHead({ config, locale, origin });
    for (const path of [config.icons.svg, '/favicon-dark.svg', config.icons.appleTouch]) {
      const url = new URL(siteAssetUrl(path, origin));
      assert.equal(url.pathname, path);
      assert.match(url.searchParams.get('v') ?? '', /^[a-f0-9]{12}$/u, path);
      assert.ok(head.includes(`href="${url.href}"`), path);
      assert.ok(!head.includes(`href="${origin}${path}"`), 'old cached URLs are not advertised');
    }
    assert.ok(head.includes('type="image/svg+xml"'));
    const manifest = JSON.parse(renderManifest({ config, locale, origin }));
    for (const icon of manifest.icons) {
      const url = new URL(icon.src);
      assert.match(url.searchParams.get('v') ?? '', /^[a-f0-9]{12}$/u);
    }
  }
  assert.equal(JSON.stringify(config), original, 'saved/deployment configuration paths remain unchanged');
});

test("custom icon paths, origins, queries and fragments remain administrator-controlled", () => {
  for (const path of ['/custom/icon.svg', '/favicon.svg?brand=custom&v=manual', '/favicon.svg#custom', 'https://cdn.example/favicon.svg', 'https://cdn.example/icon.png?signature=kept']) {
    assert.equal(siteAssetUrl(path, origin), new URL(path, origin).href);
    const custom = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ icons: { svg: path } }) }).config;
    const head = renderBrandHead({ config: custom, locale: 'en', origin });
    assert.equal((head.match(/<link rel="icon"/gu) ?? []).length, 4);
    assert.equal((head.match(/type="image\/svg\+xml"/gu) ?? []).length, 1);
    assert.ok(!head.includes('media='), 'custom SVG stays available in either browser theme');
    assert.ok(!head.includes('/favicon-dark.svg'), 'never mix the bundled dark whale into custom branding');
  }
  const custom = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ icons: { svg: '/custom/icon.svg?a=1&b=2', icon192: 'https://cdn.example/icon.png?v=mine' } }) }).config;
  assert.ok(renderBrandHead({ config: custom, locale: 'en', origin }).includes(`${origin}/custom/icon.svg?a=1&amp;b=2`));
  assert.equal(JSON.parse(renderManifest({ config: custom, locale: 'en', origin })).icons[0].src, 'https://cdn.example/icon.png?v=mine');
});

test("bundled favicon advertises only the official theme pair without competing raster candidates", () => {
  for (const locale of LOCALE_IDS) {
    const head = renderBrandHead({ config, locale, origin });
    const icons = head.match(/<link rel="icon"[^>]+>/gu) ?? [];
    assert.equal(icons.length, 2);
    assert.ok(icons[0]?.includes(`href="${siteAssetUrl('/favicon-dark.svg', origin)}" media="(prefers-color-scheme: dark)"`));
    assert.ok(icons[1]?.includes(`href="${siteAssetUrl('/favicon.svg', origin)}" media="(prefers-color-scheme: light)"`));
    assert.ok(icons.every(icon => icon.includes('type="image/svg+xml"') && !icon.includes('sizes=')), 'match the official SVG-only declarations');
    assert.equal((head.match(/prefers-color-scheme/gu) ?? []).length, 2);
  }
});

test("explicit administrator raster overrides remain advertised beside the bundled SVG pair", () => {
  for (const key of ['ico', 'png16', 'png32'] as const) {
    const path = `/brand/custom.${key === 'ico' ? 'ico' : 'png'}?v=admin&signature=kept`;
    const custom = resolveSiteSeo({ SITE_SEO_JSON: JSON.stringify({ icons: { [key]: path } }) }).config;
    const head = renderBrandHead({ config: custom, locale: 'en', origin });
    assert.equal((head.match(/<link rel="icon"/gu) ?? []).length, 3);
    assert.ok(head.includes(`href="${origin}${path.replaceAll('&', '&amp;')}"`));
    assert.equal((head.match(/prefers-color-scheme/gu) ?? []).length, 2);
  }
});
