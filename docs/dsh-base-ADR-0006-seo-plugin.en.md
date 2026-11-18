# ADR-0006: SEO config package + complete head / sitemap / manifest + default site assets

- Status: Accepted (design finalized; implementation pending assignment)
- Date: 2026-11-14
- Decision by: CEO (direction approved); architecture: Architect
- Related: the SEO plugin task that follows P8
- Constraints: Workers-native (no Node APIs), no unnecessary runtime dependencies, everything is a plugin, bilingual documentation

## 1. Context

Findings from the live deployment and the code:

| Item | Current state | Evidence |
| --- | --- | --- |
| Basic head | title / description / canonical / 8 hreflang alternates / x-default / four OG tags are injected | `packages/cloudflare-worker/dsh-base-cloudflare-worker-seo/src/index.ts:79-95` |
| Site copy | **Hard-coded in the plugin** (8-locale `copy`), including `SITE_NAME = "dsh-base"`; the `SITE_BRAND_NAME` env value is not used for SEO | same file `:23,31-63`; `apps/web/cloudflare.config.ts:54-56` |
| Sitemap | Only `/` × 8 locales; `localizedPaths: ["/"]` | same file `:110-119`; `packages/boot/dsh-base-public-pages/src/index.ts:26-28` |
| robots | Present, with the sitemap reference and login/API/agent exclusions | same file `:121-124` |
| Locale 301 | Present: case variants and `/en/*` normalize to the bare address | same file `:152-162` |
| Missing tags | keywords, og:url, og:locale, og:image, Twitter cards, JSON-LD, icon/manifest links | as above |
| Assets | `/favicon.svg`, `/favicon.ico`, `/manifest.webmanifest`, `/og.png` all fall through to the SPA shell as HTML | `apps/web/cloudflare.config.ts:20` (`notFoundHandling: "single-page-application"`) |
| Asset routing | `isDocumentNavigation` excludes only `/favicon.svg`, `/favicon-dark.svg`, `/manifest.webmanifest`; `.ico`/`og.png` slip past via the "last segment has a dot" rule but still hit ASSETS → SPA | same file `:126-130` |
| Config foundation | No D1 site-config table, no admin role; site facts live in env | `deployment.local.json`, `cloudflare.config.ts` |
| Existing tests | `check:seo` already runs three suites: public-pages, sitemap, document-meta | `package.json` `check:seo` |

## 2. Decision

1. Add a boot config package `@dsh-base/site-seo`: types + defaults + pure validation/resolution (zero runtime dependencies, testable with `node --experimental-strip-types`, following the `sitemap.ts` precedent).
2. Extend `cloudflare-worker-seo`: complete head, dynamic `/manifest.webmanifest`, config-driven sitemap/robots, per-page metadata fallbacks.
3. Commit a default asset set to `apps/web/public/` and fix the SPA fallback in `cloudflare-worker-assets` (a missing asset returns 404, never HTML).
4. **No app code changes**: one new boot package, two worker plugins changed, static assets added; the `deployment.local.json` / `cloudflare.config.ts` edits are deployment configuration, not application logic.

**Out of scope**: a D1 site-config table and admin UI, dynamic OG image generation (no Workers-native image library, and it would pull in heavy dependencies), additional pages (only `/` exists today), per-page social-card overrides, per-page schema.org types (Article/Product).

## 3. The single source of truth for configuration

### 3.1 Why not reuse the existing env fields

8 locales × title/description/keywords, plus icon sets, social accounts, manifest and per-page sitemap overrides, would explode into dozens of env variables: unmanageable, unvalidatable, and impossible to extend per page. A D1 table is out of scope here.

### 3.2 Three layers of precedence

```
deployment env `SITE_SEO_JSON` (one JSON variable)
  > the boot package's `DEFAULT_SITE_SEO` (ships with the code)
  > a minimal hard-coded fallback (renders even with an empty JSON)
```

- `apps/web/deployment.local.json` gains an optional `seo` section; `cloudflare.config.ts` serializes it into the `SITE_SEO_JSON` binding.
- A **single JSON variable** rather than a swarm of env vars: the shape can evolve with the package without adding bindings, and a deployment override is one value.
- Env is injected at deploy time, so changing configuration needs a redeploy — but **no code change**.

### 3.3 Shape

```ts
interface SiteSeoConfig {
  site: {
    name: string; url?: string;            // url defaults to the request origin
    twitter?: string; github?: string; contactEmail?: string;
  };
  locales: Record<LocaleId, {              // en/zh/ja/es/fr/de/ru/pt
    title: string; description: string; keywords: string[]; ogImageAlt?: string;
  }>;
  icons: {                                 // paths inside public/ or absolute URLs
    svg: string; ico: string; png16: string; png32: string;
    appleTouch: string; icon192: string; icon512: string; maskable512: string;
  };
  image: { url: string; width: number; height: number; type: string; alt?: string };
  manifest: { shortName?: string; themeColor: string; backgroundColor: string; display: 'standalone' };
  robots?: { disallow?: string[]; extraLines?: string[] };
  pages?: Record<string, {               // per-page overrides; only fields that change
    title?: string; description?: string; keywords?: string[];
    priority?: string; changefreq?: string; lastmod?: string; image?: string;
  }>;
}
```

### 3.4 Validation and fallbacks

- `resolveSiteSeo(env)` is a pure function: parse → validate → merge defaults → return `{ config, problems }`.
- **Fail-open**: invalid JSON or fields never produce a 500 or a throw; each field falls back to its default and `console.warn` records the `problems` for acceptance scripts to read.
- Field-level fallback chain: `pages[path]` → `locales[requested locale]` → `locales.en` → built-in fallback.
- No zod in the worker package: hand-written field validation (zero dependencies, controlled bundle size) with unit tests for invalid input. **Rationale**: this code ships in every cold start, and the repo already has a "pure functions, node-tested" precedent (the `sitemap.ts` header).

### 3.5 URL normalization

- `site.url` defaults to the request origin (correct for staging and prod, never mixing canonicals); an explicit value wins.
- Assets and the OG image resolve to absolute `origin + path`; trailing slashes normalize.
- No domain redirects (Worker routing semantics stay unchanged).

## 4. Plugin extensions (`cloudflare-worker-seo`)

### 4.1 Complete head

| Tag | Source | Notes |
| --- | --- | --- |
| `<title>` | `page.title ?? locales[locale].title` | keeps the existing `replace` injection |
| `meta description` | the same fallback chain | |
| `meta keywords` | `page.keywords ?? locales[locale].keywords.join(", ")` | one per locale |
| `link canonical` | `localizePath(path, locale)` | existing logic unchanged |
| 8 × `link alternate hreflang` + `x-default` | existing | **no regression** |
| `og:type/site_name/title/description` | existing | values now come from config |
| `og:url` | canonical | new |
| `og:locale` / `og:locale:alternate` | locale map | new; `en→en_US, zh→zh_CN, ja→ja_JP, es→es_ES, fr→fr_FR, de→de_DE, pt→pt_PT, ru→ru_RU` |
| `og:image` + `og:image:width/height/type/alt` | `image` | new |
| `twitter:card/title/description/image/site` | `image`, `site.twitter` | new; `twitter:site` only when configured |
| JSON-LD `WebSite` + `Organization` | `site` + locale | new; `inLanguage` follows the locale, `sameAs` from social links |
| `link icon` ×4 + `apple-touch-icon` + `manifest` + `theme-color` | `icons` / `manifest` | new |
| robots noindex | `isNoIndexDocument` | existing; noindex pages get **no** canonical/OG/JSON-LD (semantics preserved) |

Injection stays a string `replace` with the shared `escapeHtml`; every new tag goes through the same escaper.

### 4.2 Dynamic manifest

`GET /manifest.webmanifest` is served by the seo plugin: `name/short_name/description/start_url/scope/display/theme_color/background_color/icons[]`, all from config; `content-type: application/manifest+json`; caching matches `/` (`no-store`, conservative). Icon URLs point at the §5.4 asset set.

### 4.3 Sitemap

- Page set = `PUBLIC_PAGES` ∪ `config.pages` (same path merges, config wins).
- `localizedPaths` = paths that declare locale variants (still only `/`); undeclared paths are not duplicated eight times.
- `lastmod/changefreq/priority` come only from config and **never read the clock** (cacheable, reproducible, assertable).
- XML escaping reuses `sitemap.ts`'s `escapeXml`.

### 4.4 robots

The default output is unchanged; `robots.disallow` appends `Disallow:` lines and `robots.extraLines` appends verbatim (validated: lines starting with `User-agent:` are rejected so a block cannot be overridden). The `/sitemap.xml` reference stays.

### 4.5 Ordering and compatibility

- Whether the seo plugin or the assets plugin handles `/manifest.webmanifest` first decides if it reaches the SPA; the implementation must verify this (a spike in deliverable 1), with the assets plugin returning 404 for the manifest as the fallback.
- The locale 301 and hreflang logic are **not touched at all**; only metadata values change.

## 5. Assets

### 5.1 Default set (committed to `apps/web/public/`)

`favicon.svg`, `favicon.ico` (16+32 embedded), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og.png` (1200×630).

### 5.2 Origin and licensing

The default set is generated once from the repository's brand SVG (a dev-only script; not part of CI, no runtime dependency). These are our own assets, so no third-party license registration is needed. The reference template lends structure only, never images (§10).

### 5.3 Replacing them

Overwrite the files with the same names, or point `config.icons` / `config.image.url` at other paths inside `public/`.

### 5.4 Never 404 as HTML (the core fix)

Add a "static asset surface" rule to `cloudflare-worker-assets`:

- When a request matches the asset extension allowlist (`.svg .ico .png .webp .avif .jpg .jpeg .gif .txt .xml .webmanifest .woff .woff2`) or an explicit path (`/og.png`), and `ASSETS.fetch` returns **404** or **`content-type: text/html`** (the SPA-fallback signature), return a **plain-text/empty 404** instead.
- Precedence: `isDocumentNavigation` (no dot, not API/agent/assets) still wins for documents; a request with an extension must never return HTML.
- Even if the seo plugin misses an asset path, the HTML shell can no longer leak.

### 5.5 content-type

Correct by extension (`image/svg+xml`, `image/x-icon`, `image/png`, `application/manifest+json`, …); if ASSETS answers `text/html`, §5.4 returns 404 (honest rather than a forged type).

## 6. Per-page metadata

Extend `PublicPage` (`packages/boot/dsh-base-public-pages/src/index.ts`):

```ts
interface PublicPage {
  path: string;
  changefreq?: string;
  priority?: string;
  lastmod?: string;                                   // new
  copy?: Partial<Record<LocaleId, {                   // new
    title?: string; description?: string; keywords?: string[];
  }>>;
  image?: string;                                     // new
}
```

- Every field is optional: the auth side reads only `path`, so nothing regresses.
- Merge order: `page.copy[locale]` → `site.locales[locale]` → `site.locales.en` → built-in fallback.
- `/login` still does **not** join `PUBLIC_PAGES` (stays noindex); private-document detection is unchanged.

## 7. Acceptance

### 7.1 Unit tests (extending `check:seo`)

- Config: defaults, valid env, invalid-JSON fallback, field-level fallback, URL normalization, reported problems.
- Head: per-locale snapshots asserting title/description/keywords/canonical/9 alternates/og:url/og:locale/og:image/twitter/JSON-LD counts and escaping (including `&"<>` inputs).
- Sitemap: per-page lastmod/changefreq/priority, xhtml alternates, XML escaping, still 8 entries when only `/` exists.
- Manifest: fields match the icons one-for-one; `content-type: application/manifest+json`.
- robots: default unchanged; `disallow`/`extraLines` appended; `User-agent:` injection rejected.
- Assets: nine URLs return 200 with correct content-types; an unknown asset `/nope.png` returns 404 and not HTML; `.ico` no longer returns HTML.

### 7.2 Integration acceptance

- Eight-locale head snapshots (miniflare or staging): the full `<head>` per locale.
- Asset curl records: status + content-type, one line each.
- JSON-LD: `JSON.parse` succeeds and required fields exist (`@context`/`@type`/`name`/`url`/`inLanguage`).
- No regression: the 301 matrix (case variants, `/en` prefix), `/login` noindex, private pages noindex, `x-robots-tag` (reuse `apps/web/scripts/acceptance-locale-routes-local.mjs`).

### 7.3 Gates

`check:seo`, `check:reuse`, `check:boundaries`, `check:packs`, `pnpm check`, `build` all green.

### 7.4 Evidence

Eight head snapshots, asset curl output, JSON-LD validation output, and the raw sitemap/manifest/robots documents; screenshots are not needed.

## 8. Cost and rounds

| Deliverable | Content | Rounds |
| --- | --- | --- |
| 1 | Boot config package (types/defaults/validation/tests) + deployment wiring + handler-order spike | 0.5 |
| 2 | Complete head + dynamic manifest + config-driven sitemap/robots + unit tests | 0.75 |
| 3 | Default asset set + assets-plugin 404 fix + asset tests | 0.5 |
| 4 | Integration evidence + bilingual docs (README zh/en, docs updates) | 0.25 |
| **Total** | | **2 rounds** + QA 0.5 round |

No runtime dependencies added; no Node APIs used (all asset reads go through the `ASSETS` binding).

## 9. Risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| R1 SPA-fallback fix collateral damage | an extension allowlist could treat `/app/session/a.b` as an asset | document detection runs first (`isDocumentNavigation`); the allowlist lists only known static extensions; add regression cases |
| R2 Missing default assets | config pointing at a nonexistent file → 404 | asset-existence tests + a nine-file checklist; a `build` pre-check |
| R3 Head injection escaping | string replacement can be broken by content | one `escapeHtml` everywhere + special-character tests |
| R4 Config size / parse failure | 8 locales of copy make the JSON large | fail-open defaults + reported `problems` + a size cap |
| R5 Manifest routing order | which plugin handles it first | spike in deliverable 1; assets plugin returns 404 for the manifest as a backstop |
| R6 Wrong og:locale mapping | social cards mislabel the language | unit test the mapping table (eight assertions) |
| R7 Reference template licensing | the commercial template's license scope | borrow structure only, never code or images; record in `THIRD_PARTY_NOTICES.md` and §10 |
| R8 Multi-domain canonicals | staging snapshots carrying the prod host | default to the request origin; an explicit config URL wins |

## 10. References and licensing

Reference: `projects/templates/mkfast-app` (a commercial template purchased by the CEO; reusable under the MkImage Personal/Team/Organization License).

| Reference | Use | How we adapt it |
| --- | --- | --- |
| `src/lib/seo.ts` | metadata construction order (title/description/keywords/OG/twitter/canonical/alternates + structured data) | structure only, rewritten as Workers-native string injection |
| `src/lib/sitemap.ts` | lastmod/changefreq/priority + xhtml alternates | our `sitemap.ts` already mirrors it; only per-page fields are added |
| `src/routes/manifest[.]json.ts` | dynamic manifest fields and the icon list | fields borrowed, re-homed at `/manifest.webmanifest` |
| `src/routes/robots[.]txt.ts`, `sitemap[.]xml.ts` | route organization | route shape borrowed |
| `src/routes/__root.tsx` | icon link set (favicon 32/16/ico, apple-touch-icon, manifest) | set borrowed, not copied |
| `src/config/website.ts` | metadata / `images.ogImage` config shape | shape borrowed, rewritten around our three-layer precedence |

No framework code is copied (TanStack Start differs from Workers-native); only the verified structures are adapted. Provenance and license are recorded in `THIRD_PARTY_NOTICES.md` and this ADR.

## 11. Implementation checklist (for Coder)

1. Add `packages/boot/dsh-base-site-seo/`: `src/index.ts` (types + defaults + `resolveSiteSeo`), `src/render.ts` (head fragments, JSON-LD, manifest, sitemap/robots input adaptation), `tests/*.test.ts`; `package.json` with no runtime dependencies and an `exports` map exposing only `.`.
2. Add an optional `seo` section to `apps/web/deployment.example.json` / `deployment.local.json`; inject `SITE_SEO_JSON` in `apps/web/cloudflare.config.ts`.
3. Extend `cloudflare-worker-seo`: the head table (§4.1), `/manifest.webmanifest` (§4.2), config-driven sitemap/robots (§4.3/4.4).
4. Extend `PublicPage` (§6) with zero regression on the auth side.
5. Commit the nine default assets to `apps/web/public/`.
6. Change `cloudflare-worker-assets`: asset-surface 404 (§5.4) and content-type correction (§5.5).
7. Extend `check:seo` tests + integration evidence; update the `check:seo` script in `package.json` with the new test files.
8. Update the bilingual README / `docs/` (this ADR fixes the structure; the implementation adds "how to replace assets" and "how to override configuration").
9. All green: `check:seo`, `check:reuse`, `check:boundaries`, `check:packs`, `pnpm check`, `build`.
