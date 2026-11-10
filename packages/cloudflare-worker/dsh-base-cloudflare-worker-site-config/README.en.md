# @dsh-base/cloudflare-worker-site-config

Manages one site configuration shared by the entire deployment and exposes its public name and links. Site settings are stored separately from account preferences and session configuration. Ordinary accounts cannot change the site.

## Routes and permissions

- `GET /api/site-settings`: authenticated read of `{ revision, values, source, canEdit }`; `values` contains `seo` and `links`. Ordinary accounts may inspect it.
- `PUT /api/site-settings`: only an authenticated user ID listed in the server's `SITE_ADMIN_USER_IDS` JSON array may save. Missing, empty, malformed or mixed-type lists deny all writes. Usernames, client roles and submitted permission fields never grant authority.
- Writes accept `{ expectedRevision, values }`, require a same-origin Origin and JSON, and bound the actual body byte count. Unknown fields, invalid settings and invalid revisions are rejected. A revision conflict returns `409` without overwriting another administrator's save.
- `GET/HEAD /api/site-config`: preserves the public shape `{ environmentLabel?, brand: { name }, links?, documentTitles }`. The brand comes from the same document's `seo.site.name`. User IDs, administrator lists, authority flags, revisions and bindings never appear in this public payload.

## Storage and publication

Reuse the existing `AUTH_DB` and apply this package's `schema.sql` to create the single-row `dsh_site_settings` table. No additional service is needed. Before the first save, revision is `0`, source is `deployment`, and values resolve from `SITE_SEO_JSON`, legacy brand/link bindings and shipped defaults. A saved, validated full document takes precedence, source becomes `saved`, and revision increases monotonically. One SQLite statement performs compare-and-swap; concurrent writes across isolates accept only one version.

`ctx.siteSettings.read(env)` supplies the same document to the SEO plugin. Each request that needs site settings uses a D1 `first-primary` session with no cross-isolate TTL cache. Site responses use `no-store`, so the next read after saving sees the new document. A missing binding or migration, database failure or invalid saved document returns `503`; it never reports a false successful save or silently restores old deployment values. Static assets and AI requests do not query this table.

Icons reference existing asset paths or URLs; this API does not upload files. The active `client:site-config` service reads public values, the brand plugin displays the shared site name in the official name slot, and the official title component consumes the eight-language `documentTitles` projection. Retired custom More menu entries remain disabled.

## Reuse and validation

The official plugin manager's `plugins.bundle.config` / `plugins.row.config` slots provide the client entry points, and official forms supply the interaction contract. The official `config-editor` persists local profiles; it does not provide deployment-wide site metadata, administrator authority or Workers-native storage. This package supplies those services without changing the scope of account settings.

`node packages/cloudflare-worker/dsh-base-cloudflare-worker-site-config/tests/settings-runtime.test.mjs` exercises two real workerd isolates and persistent D1: authorization, input validation, concurrent first saves, CAS, cross-account consistency, restart persistence, public SEO output, failures and no site queries for static assets/AI requests. Its auth face is fixture-provided; production uses `ctx.auth.session`.

## Conversion configuration and published paths

Public site configuration retains validated conversion modes and public campaign labels, never Worker secrets. Saving Google conversion mode requires readiness, while administrator authorization and revision CAS remain unchanged. Tests use the real publicPages service and explicit production indexing configuration, retaining anonymous denial, ordinary-user read-only access and cross-origin rejection.
