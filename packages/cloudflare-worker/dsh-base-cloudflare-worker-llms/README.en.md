# @dsh-base/cloudflare-worker-llms

Independently generates `/llms.txt` and canonical locale-prefixed URLs as `text/plain; charset=utf-8` with matching `content-language`. Markdown contains the site name, introduction and real links to registered public pages. It does not crawl the site, call AI, export private conversations or invent full-text `.md` URLs.

`seo.llms.enabled` defaults to enabled; disabling returns a real 404. `introduction` can replace the default localized description and `guidance` can add site instructions. The Worker reads links from the active `publicPages` registry, including pages registered by product plugins. It lists published, indexable pages that have the requested translation. No search-engine or model adoption is promised. Explicit `/en/*` and case-variant prefixes redirect with 301 while preserving the query.

## Configuration and authority

Reads the existing shared document through `siteSettings.read(env)`: saved values win; the common deployment resolver supplies defaults before the first save. No extra database, account setting, scheduled task or persistent service is introduced. Server-side site administrators still save through `/api/site-settings` with revision CAS; this plugin adds no write API. Only its exact resource requests read configuration, never static assets or AI requests.

`@dsh-base/public-pages` registers the route for anonymous GET/HEAD, including `Accept: text/html`. HTTP priority 20 runs before asset fallback. Successful responses use `no-store`; HEAD has no body and other methods return 405. Storage failures return an explicit 503, also bodyless for HEAD, without reviving stale defaults.

## Reuse decision

The pinned official locale and ui-plugin-manager packages supply browser language and settings contracts, but no Workers HTTP implementation of this resource. Mounting or forking them cannot supply that behavior, so this is an independent custom Worker plugin. It copies no official code and changes no official UI.

## Verification

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-llms/tests/resource.test.ts
```
