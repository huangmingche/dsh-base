# @dsh-base/cloudflare-worker-seo

HTML document SEO Worker plugin: complete localized heads for public documents and restricted metadata for noindex documents. Separate sitemap, robots, manifest and llms plugins own their resource routes. Reads through `siteSettings`: a saved full document takes precedence; before the first save, `@dsh-base/site-config/settings` resolves deployment `SITE_SEO_JSON`, legacy brand bindings and shipped defaults. A database read failure returns an explicit `503` rather than reverting to older values.

## Head (every page)

- `title` / `meta description` / `meta keywords`: page `pages[path]` → `PublicPage.copy[locale]` → `locales[locale]` → `locales.en` → hard fallback;
- A canonical URL and reciprocal hreflang links for the page’s available translations. English supplies `x-default` when available. The shared locale-path package maps `zh` to `zh-CN`.
- Open Graph: `type` / `site_name` / `title` / `description` / `url` / `locale` (the current language) / `locale:alternate` for the other available translations / `image` with `width` / `height` / `type` / `alt`;
- Twitter card: `card=summary_large_image` / `title` / `description` / `image`, plus `twitter:site` only when `site.twitter` is configured;
- JSON-LD: `WebSite` (name/url/inLanguage) and `Organization` (name/url/sameAs/email), JSON-escaped so it cannot close the script element;
- icons: `favicon.svg` + `favicon-dark.svg` (the only default favicon declarations; explicit custom ICO/PNG overrides remain) / `apple-touch-icon` / `manifest` (locale-prefixed) / `theme-color`;
- Login and private pages include only the branding metadata and `noindex, nofollow`. Published public pages retain their localized metadata when deployment policy disables indexing. The Worker adds `noindex, nofollow` to those pages on Staging.

## Resource boundaries

This plugin only handles HTML GET/HEAD. It emits a locale-prefixed manifest link when the optional `siteManifest` producer is present; independent icons and theme color remain when that producer is absent. Sitemap, robots, manifest and llms endpoints are owned by their separate Worker plugins. All read the same site document without an additional cache or database.

HTML uses `text/html`, `no-store`, and the matching content language. HEAD is bodyless, including storage-error 503 responses. Static assets, AI requests and metadata resource requests do not cause configuration reads through this plugin.

## Assets

The ten default assets in `apps/web/public/` include black/white SVGs, ICO (16/32/48), 16/32 PNG, Apple touch (180), 192/512, maskable 512 and the social image. `node scripts/assets/generate-site-assets.mjs` generates them from the pinned official `@deepseek-ai/dsh-client-ui-primitives` stable exports `FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX`, retaining the sidebar whale proportions. Website icons have transparent backgrounds: the exact bundled `/favicon.svg` setting uses the official `link media` pattern to select black/white SVGs for the browser light/dark scheme; custom SVGs remain a single resource without a default whale override. Default heads omit ICO/PNG candidates so they cannot replace the themed tab icon. Those files remain transparent black and directly accessible; custom paths retain their configuration. Apple touch, installation icons and the social image retain separate dark tiles. Maskable geometry stays inside the safe circle. Generation is development-only with no new Worker/browser runtime dependency; `pnpm check:site-assets` verifies provenance and outputs.

Default head, manifest and OG asset URLs use generated content hashes in a `v` parameter while saved configuration retains its original paths. Custom addresses, query strings and fragments are untouched; global settings can point `seo.icons` / `seo.image.url` at owned resources. Missing assets still return a real 404.

## Acceptance

```sh
pnpm check:seo                       # configuration + head/JSON-LD/manifest + sitemap/robots + assets unit tests
pnpm acceptance:seo-local            # local Worker: eight head snapshots, asset status/content-type, manifest, sitemap, robots, JSON-LD, 404 guard, 301/noindex
node apps/web/scripts/acceptance-locale-routes-local.mjs   # 301/noindex/sitemap regression (needs DSH_ACCEPTANCE_OUT)
```

## Reuse decision

No official DSH Host service renders public HTML heads for a Workers deployment, and `@deepseek-ai/dsh-client-locale` is a browser runtime that cannot produce crawlable documents. This is therefore a custom worker plugin serving only the public document boundary; official UI is untouched.
