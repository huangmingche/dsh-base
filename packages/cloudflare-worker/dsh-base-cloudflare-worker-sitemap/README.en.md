# @dsh-base/cloudflare-worker-sitemap

Serves `/sitemap.xml` as `application/xml; charset=utf-8` and publishes its path through `siteSitemap` for the robots plugin.

Indexing defaults to off. Only a production deployment with indexing explicitly enabled and a valid HTTPS site origin lists URLs. Staging serves an empty sitemap. The Worker reads published, indexable pages from `publicPages.list(env)` and lists only their available translations. Locale URLs carry reciprocal hreflang links, with `x-default` when English is available. `seo.pages[path]` supplies metadata for registered pages, including `changefreq`, `priority` and a fallback `lastmod` when the page provides none. Private routes and login stay out.

## Configuration and authority

Reads the existing shared document through `siteSettings.read(env)`: saved values win; the common deployment resolver supplies defaults before the first save. No extra database, account setting, scheduled task or persistent service is introduced. Server-side site administrators still save through `/api/site-settings` with revision CAS; this plugin adds no write API. Only its exact resource requests read configuration, never static assets or AI requests.

`@dsh-base/public-pages` registers the route for anonymous GET/HEAD, including `Accept: text/html`. HTTP priority 20 runs before asset fallback. Successful responses use `no-store`; HEAD has no body and other methods return 405. Storage failures return an explicit 503, also bodyless for HEAD, without reviving stale defaults.

## Reuse decision

The pinned official locale and ui-plugin-manager packages supply browser language and settings contracts, but no Workers HTTP implementation of this resource. Mounting or forking them cannot supply that behavior, so this is an independent custom Worker plugin. It copies no official code and changes no official UI.

## Verification

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-sitemap/tests/render.test.ts
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-sitemap/tests/resource.test.ts
```
