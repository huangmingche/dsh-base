# @dsh-base/cloudflare-worker-manifest

Independently generates `/manifest.webmanifest` and canonical locale-prefixed URLs as `application/manifest+json` with matching `content-language`. Provides `siteManifest.path`; SEO links the manifest only while this service exists.

Name, description, theme and installation icons come from the shared site configuration; locale determines `lang` and `start_url`. Icon URLs retain the shared renderer's bundled asset versions and administrator overrides. Explicit `/en/*` and case-variant prefixes redirect with 301 while preserving the query.

## Configuration and authority

Reads the existing shared document through `siteSettings.read(env)`: saved values win; the common deployment resolver supplies defaults before the first save. No extra database, account setting, scheduled task or persistent service is introduced. Server-side site administrators still save through `/api/site-settings` with revision CAS; this plugin adds no write API. Only its exact resource requests read configuration, never static assets or AI requests.

`@dsh-base/public-pages` registers the route for anonymous GET/HEAD, including `Accept: text/html`. HTTP priority 20 runs before asset fallback. Successful responses use `no-store`; HEAD has no body and other methods return 405. Storage failures return an explicit 503, also bodyless for HEAD, without reviving stale defaults.

## Reuse decision

The pinned official locale and ui-plugin-manager packages supply browser language and settings contracts, but no Workers HTTP implementation of this resource. Mounting or forking them cannot supply that behavior, so this is an independent custom Worker plugin. It copies no official code and changes no official UI.

## Verification

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-manifest/tests/resource.test.ts
```
