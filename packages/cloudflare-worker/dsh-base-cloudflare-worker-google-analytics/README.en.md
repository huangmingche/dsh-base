# @dsh-base/cloudflare-worker-google-analytics

An independent Workers DSH plugin for public page views, trusted business conversions, first-party daily aggregates and administrator reporting. It reads the unified siteSettings document and is off by default. No new database, queue, schedule, always-on service or browser tracking SDK is introduced.

## Configuration and boundaries

- `analytics.google.enabled` / `measurementId` independently control public page_view. `GOOGLE_ANALYTICS_API_SECRET` exists only as a Worker secret. Public requests also require `SITE_ANALYTICS_LIMITER`; IP addresses are used only by Cloudflare's native limiter and never sent to Google.
- `analytics.conversions.mode`: `off` (default), `aggregate` (local daily counts), or `google` (local counts plus explicitly consented Google events). Google mode requires a valid Measurement ID and deployment readiness; configuration failure must not silently replace the destination.
- `analytics.conversions.campaigns`: at most 64 unique public labels, each up to 64 lowercase letters, digits, underscores or hyphens. Unconsented or unapproved campaign values are discarded.
- Existing administrator authorization and revision CAS apply. Without Google consent, enabled conversion modes aggregate locally. Activation always remains local. Complete user-level attribution is not claimed.

Same-origin POST `/api/site-analytics/google` accepts only `{path}` JSON, bounded to 512 actual UTF-8 bytes. Production injects publicPages.resolve and counts only published paths with an available locale, including public noindex documents. Titles and canonical URLs come from site settings, never browser titles, cookies, Authorization, referrers, User-Agent, private paths or queries. Extra fields, non-canonical addresses and private documents are rejected; missing configuration sends nothing.

## Trusted conversions and deduplication

`recordConversion(env,event)` is for trusted plugins only; no public conversion ingestion API exists. Better Auth records registration after successful account creation. Host records activation only after a durably completed AI turn, once per account; creation, queueing, failures and cancellations do not qualify. Payments record checkout only after provider creation and purchase only after a verified webhook confirms payment and commits trusted state. Purchase requires provider-confirmed value/currency and a public itemId, never a display price. Checkout may omit amounts.

Additive `dsh_analytics_conversions` / `dsh_analytics_daily` tables use the existing D1 binding. Business deduplication keys are hashed with the event type; raw account/order identifiers are not stored and no cross-event visitor profile is created. One D1 batch commits a unique receipt and daily aggregate atomically. Concurrent retries count once; conflicting amounts fail closed. Receipts are retained to prevent old webhook replays, so storage grows with trusted business events; public page views create no D1 event rows. A DO remembers successful activation in memory to avoid repeated writes on later turns; durable deduplication still applies after restart.

Google receives a fresh random client_id per event and a random receipt as purchase transaction_id, never a user, session, workspace or order identifier. Advertising data and personalization are denied. Delivery uses only `https://www.google-analytics.com/mp/collect`, disallows redirects, times out after three seconds and attempts at most once. Ambiguous failures never retry; local aggregates remain committed. HTTP 2xx means transport acceptance, not confirmed Google ingestion. Analytics failure must not change account, AI or payment results.

GET `/api/site-analytics/conversions` requires a real session whose user ID is in SITE_ADMIN_USER_IDS. It returns only aggregates for the last 30 UTC dates, rejects cross-origin requests and extra query parameters, and uses private/no-store caching. Anonymous and ordinary accounts cannot read it. The existing global Analytics editor displays the summary and a refresh action.

## Official reuse and validation

Pinned official product-analytics targets Desktop Host telemetry and has no site/merchant/admin contract to mount or fork without changing behavior. This is a custom plugin with no copied official source; client settings reuse official primitives.

`node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-google-analytics/tests/*.test.ts` exercises real handlers, SQLite atomic deduplication, concurrent replay, payment amount requirements, privacy, authorization and failure handling. Browser and Host contract tests separately verify consent and trusted completion. Tests intercept all outbound traffic; no real GA property receives events and actual reporting is not claimed verified.

References: [Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4), [official event contracts](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events).
