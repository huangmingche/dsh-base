# Cloudflare Worker email plugin

`@dsh-base/cloudflare-worker-email` provides the Cordis `email` service for verification and password-reset messages sent by the authentication plugin. It is disabled by default. It registers no public send endpoint and sends nothing during startup, status reads or configuration checks.

## Reuse and scope

The source and exports of `@deepseek-ai/dsh-deepseek-account` were inspected directly at pinned release `dsh-v0.2.2-rc.5` (`9c2670d3bce5275e0d1610272958121af87787bb`). The package provides DeepSeek OAuth and account operations, with no product transactional mail transport or email templates to mount or fork. The custom-plugin decision is recorded in `dshBase.reuse`. [TanStarter's documented email scope](https://docs.tanstarter.dev/email/) informed the provider selection; this implementation was independently written against public provider APIs without copying purchased template source, components or styling.

Only internal `verify-email` and `reset-password` intents are supported. There is no raw HTML, custom subject, bulk-send, contact-form, marketing or newsletter interface. Consumers must authorize the recipient against the account action and enforce rate limits. The plugin uses Workers `fetch`, Web Crypto and the existing `AUTH_DB` D1 database, with no React, SMTP, container, additional database or always-on process.

## Deployment

Apply this package's `schema.sql` to `AUTH_DB` first. Configuration comes exclusively from Worker bindings; secrets must never enter client data or serializable plugin configuration.

| Binding | Purpose |
| --- | --- |
| `EMAIL_ENABLED` | Must be exactly the string `true`; disabled by default |
| `EMAIL_PROVIDER` | `cloudflare` or `resend`; no automatic fallback |
| `EMAIL_FROM` | Verified sender address, optionally `Name <address@example.com>` |
| `AUTH_BASE_URL` | Auth site origin; HTTPS required except localhost development |
| `AUTH_DB` | Existing D1 binding with the schema applied |
| `EMAIL_CLOUDFLARE_ACCOUNT_ID` | Required Cloudflare account ID for that provider |
| `EMAIL_CLOUDFLARE_API_TOKEN` | Worker secret with Email Sending Edit permission |
| `RESEND_API_KEY` | Worker secret required for Resend |

Onboard and verify a sender domain with [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/); this plugin uses its [REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). [Resend](https://resend.com/docs/api-reference/emails/send-email) is the alternative. Both transports use fixed HTTPS APIs, refuse redirects and have a 10-second request timeout. Operators must verify provider access, domain setup and actual delivery; `ready` checks configuration only and makes no probe request.

## Internal service

```ts
ctx.email.status(env); // { enabled, ready, provider }, without secrets
ctx.email.ready(env);
await ctx.email.sendTransactional(env, {
  kind: "verify-email", // or reset-password
  to: user.email,
  actionUrl: url, // URL supplied by the Better Auth hook
  idempotencyKey: token,
  locale: "en", // zh/en/ja/es/fr/de/pt/ru; regional tags also accepted
});
```

Call this service from Better Auth's `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword` hooks with their `user.email`, `url` and `token`. Consumers decide whether to require verification and must preserve indistinguishable password-reset responses for existing and missing accounts. Never forward client-selected recipients or arbitrary URLs directly. Accepted action paths are same-origin `/api/auth/verify-email?token=…` and `/api/auth/reset-password/{token}`; `callbackURL` must also be same-origin. Templates provide escaped static HTML and plain text in all eight supported languages, without remote images or tracking pixels.

## Deduplication and failure behavior

D1 atomically reserves the SHA-256 digest of `kind + idempotencyKey` before sending, allowing only one concurrent isolate to contact the provider. Rows contain key and payload hashes, provider, state and timestamps, never addresses, tokens, bodies or provider errors. Accepted repeats return `duplicate`; a changed payload with the same key fails as a conflict. Resend additionally receives a hashed [idempotency key](https://resend.com/docs/dashboard/emails/idempotency-keys/).

Explicit rejection becomes `rejected`; timeouts, network errors and ambiguous responses become `unknown`. Neither state, nor an incomplete `sending` claim, automatically retries. Inspect provider records and let the user start a new account action. This prioritizes avoiding duplicates and does not promise exactly-once or inbox delivery. Cloudflare's `delivered` or `queued` array must contain the intended recipient; recipient addresses are never mistaken for message IDs. Missing schema and database errors fail closed, and errors contain no raw provider content.

Claims do not expire automatically because removing them permits replay. Operators should prune only after confirming the associated auth tokens cannot be used or replayed. There is no retry worker, queue, delivery webhook or provider failover. Enabling email incurs provider usage and D1 read/write costs.

## Validation

```sh
node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-email/tests/email.test.ts
node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-email/tests/runtime.test.mjs
```

Tests cover disabled defaults, binding/address/link validation, escaping in eight languages, both provider response contracts, concurrent claims across two real workerd isolates sharing D1, restart persistence, conflicts, failures without retries and missing schema. Provider transports are fixtures: no real email was sent and production delivery remains unverified.
