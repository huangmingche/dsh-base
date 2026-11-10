# @dsh-base/site-seo

The single source of truth for site-level SEO: types, defaults, a three-layer merge and field-level validation. Zero runtime dependencies (no npm imports), directly testable with `node --experimental-strip-types`, so a Worker cold start only carries this pure resolver.

## Three-layer priority

1. Deployment env `SITE_SEO_JSON` (one JSON variable, injected by `apps/web/cloudflare.config.ts` from the `seo` section of `deployment.local.json`);
2. The shipped `DEFAULT_SITE_SEO` (eight-locale copy, icon set, `og.png`, manifest defaults);
3. `HARD_FALLBACK_COPY` (the minimal copy that still renders when every dictionary is unusable).

## Fail-open

`resolveSiteSeo(env)` never throws and never turns into a 500:

- invalid JSON, an oversized document (> 256 KB), a non-object, or a mistyped field **falls back field by field** to the default;
- every fallback is reported in `problems` (`SITE_SEO_JSON: ...`), which the Worker plugin logs once per distinct set with `console.warn`;
- URL fields reject credentials, query strings and fragments and normalize the trailing slash; `robots.extraLines` rejects `User-agent:` and newline injection; `pages[*].lastmod` only accepts a configured ISO date and **never reads the clock**.

## Shape

`SiteSeoConfig`: `site` (name, optional url, Twitter, GitHub, contact email), `locales` (title/description/keywords/ogImageAlt for all eight locales), `icons` (eight paths), `image` (the Open Graph quartet), `manifest` (short name, theme color, background color, display), optional `robots`, and optional `pages` for page-level overrides.

## Renderers (`src/render.ts`)

- `renderHead`: description/keywords/canonical, alternates for the available translations plus `x-default` when English is available, `og:url`, `og:locale` and alternates, the Open Graph image quartet, the Twitter card, two default icon links (only the transparent black/white SVG color-scheme pair; custom SVGs and explicit ICO/PNG overrides retain their configuration) plus apple-touch, manifest and theme-color — all through the same `escapeHtml`.
- `renderJsonLd`: two `application/ld+json` graphs (`WebSite` and `Organization`); `inLanguage` follows the locale and `sameAs` carries the social profiles; JSON escaping prevents `</script>` breakouts.
- `renderManifest`: the `/manifest.webmanifest` JSON (name/short_name/description/start_url/scope/display/theme_color/background_color/lang/icons).
- `resolvePageCopy` / `resolvePageImage`: page → locale → English → fallback; page images resolve against the site origin.

## Deployment override example

```json
{
  "seo": {
    "site": { "name": "Example", "url": "https://example.com", "twitter": "@example" },
    "locales": { "en": { "title": "Example", "description": "Example site", "keywords": ["example"] } },
    "robots": { "disallow": ["/private"], "extraLines": ["Crawl-delay: 1"] },
    "pages": { "/": { "lastmod": "2025-01-31", "changefreq": "monthly", "priority": "0.8" } }
  }
}
```

Unset fields keep their defaults; changing this configuration needs a deployment but no code change.

## Tests

`pnpm check:seo` (`tests/site-seo.test.ts` covers configuration resolution, `tests/render.test.ts` covers the exact head/JSON-LD/manifest output and escaping).
