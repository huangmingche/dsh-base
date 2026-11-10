# @dsh-base/cloudflare-worker-robots

Serves `/robots.txt` as `text/plain; charset=utf-8`. The default rules disallow crawling of `/api/`, `/agents/`, `/app/session/` and `/app/workspace/` and their localized variants. Crawlers can visit `/login` to read its `noindex` directive. Site settings can add rules through `seo.robots.disallow` and `extraLines`.

Robots includes a `Sitemap:` directive only when the deployment has enabled production indexing and the `siteSitemap` service is present. Staging omits this directive. Server-side authorization protects private data.

## Configuration and authority

Reads the existing shared document through `siteSettings.read(env)`: saved values win; the common deployment resolver supplies defaults before the first save. No extra database, account setting, scheduled task or persistent service is introduced. Server-side site administrators still save through `/api/site-settings` with revision CAS; this plugin adds no write API. Only its exact resource requests read configuration, never static assets or AI requests.

`@dsh-base/public-pages` registers the route for anonymous GET/HEAD, including `Accept: text/html`. HTTP priority 20 runs before asset fallback. Successful responses use `no-store`; HEAD has no body and other methods return 405. Storage failures return an explicit 503, also bodyless for HEAD, without reviving stale defaults.

## Reuse decision

The pinned official locale and ui-plugin-manager packages supply browser language and settings contracts, but no Workers HTTP implementation of this resource. Mounting or forking them cannot supply that behavior, so this is an independent custom Worker plugin. It copies no official code and changes no official UI.

## Verification

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-robots/tests/render.test.ts
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-robots/tests/resource.test.ts
```
