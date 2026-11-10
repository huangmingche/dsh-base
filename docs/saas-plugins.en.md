# SaaS plugins

[简体中文](saas-plugins.md) | English

The selected items 1–8, 14–18 and 28 form 14 logical bundles and 28 runtime components, one Client and one Worker plugin per bundle. Package metadata selects production members; packs only group them. Clients use official `plugins.bundle.config`, Button, Input, Modal and theme styles, preserving official settings and DeepSeek Platform billing.

| Item | Bundle | Behavior and authority |
| --- | --- | --- |
| 1 | Dsh-base Waffo Pancake payments | Hosted checkout, signed portal, order/subscription and refund-state synchronization; raw signed webhooks, D1 idempotency and ownership validation. Owners read their orders; administrators read aggregates. |
| 2 | Dsh-base Email | Cloudflare Email / Resend verification, password recovery, newsletter confirmation and contact messages. No arbitrary-recipient public send API. |
| 3 | Dsh-base Google sign-in | Official Better Auth Google OAuth, deployment callback origin and disabled automatic cross-account linking. Unconfigured providers remain unavailable. |
| 4 | Dsh-base Account profile | Name, owned R2 image avatar and password changes revoking other sessions. A name-only save preserves the existing avatar. |
| 5 | Dsh-base User management | Paginated search, ban/unban, role labels and session revocation. Only `SITE_ADMIN_USER_IDS` grants administrative authority. |
| 6 | Dsh-base API keys | Owner create/list/revoke, raw key returned once, stored hash, expiry, rate limits and `profile:read`. Keys never substitute for browser sessions. |
| 7 | Dsh-base Plan access | Worker `entitlements.authorize` checks verified Waffo Pancake orders and denies unavailable, expired or refunded access. Consuming business plugins must enforce it server-side. |
| 8 | Cloudflare Files | Existing R2, upload, pagination, owner download/delete and constrained raster preview. 10 MiB per file, 100 MiB / 200 entries per account with atomic D1 quota reservation. |
| 14 | Dsh-base Newsletter | Resend contacts, waitlist email confirmation, owner status/unsubscribe. Public submissions require consent and server-verified Turnstile. |
| 15 | Dsh-base Contact | Verified messages to the deployment-selected support address, escaped HTML, bounded bodies, persistent limits and idempotency. |
| 16 | Dsh-base Notifications | Payment-transaction outbox with on-demand Discord / Feishu delivery. Uncertain attempts require explicit administrator review to retry. No public relay. |
| 17 | Dsh-base Crisp support | Loads Crisp only after an explicit configured support click; cleans up UI state and does not automatically forward account identity. |
| 18 | Cloudflare KV cache | Bounded TTL, `public:` namespace and administrator single-key invalidation. Never use for sessions, payments, authorization or private data. |
| 28 | Dsh-base Operations | Administrator counts from real D1 users, orders, subscriptions, refunds and email states. Missing tables are unavailable, not demo charts or invented zeros. Currency amounts are not mixed. |

The `cloudflare-worker-` package prefix identifies the runtime plane. Display names identify the capability: owned SaaS features use Dsh-base, while R2 files and KV cache use Cloudflare. Waffo Pancake and Resend are not labeled as Cloudflare products.

## Configuration

New SaaS feature switches and non-secret provider settings come from `saas` in `apps/web/deployment.local.json`; `DSH_SAAS_JSON` can replace that object. See `deployment.example.json` for all keys. Unknown fields and credentials are rejected. Clients consume safe service projections rather than storing duplicate deployment configuration. Auth origin, administrator IDs and D1/R2 bindings retain their existing top-level deployment configuration.

External providers default off. Profile, user management, API keys, files and operations use existing auth, D1 and R2; administration still requires configured IDs. KV requires an explicit existing namespace and does not create always-on infrastructure.

| Capability | Non-secret settings | Worker Secrets |
| --- | --- | --- |
| Account features | `userAdminEnabled`, `apiKeysEnabled`, `filesEnabled`, on by default | None |
| Waffo Pancake | `waffoEnabled`, `waffoEnvironment` (test/prod), `waffoStoreId`, `waffoPlans` | `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` |
| Email | `emailEnabled`, `emailProvider`, `emailFrom`; Cloudflare also needs `emailCloudflareAccountId` | `EMAIL_CLOUDFLARE_API_TOKEN` or `RESEND_API_KEY` |
| Verification | `emailVerificationRequired` | Email provider; required verification is never bypassed if mail is unavailable |
| Google | `googleEnabled`, `googleClientId`; callback `AUTH_BASE_URL/api/auth/callback/google` | `GOOGLE_CLIENT_SECRET` |
| Entitlements | `entitlementFeatures: [{id,planIds}]` referencing `waffoPlans` IDs | None |
| Newsletter/contact | `newsletterEnabled`, `contactEnabled`, `contactSupportEmail`, `turnstileSiteKey` | `TURNSTILE_SECRET_KEY`; newsletter also requires `RESEND_API_KEY` |
| Notifications | `notificationsEnabled` | `DISCORD_WEBHOOK_URL`, `FEISHU_WEBHOOK_URL`; either or both |
| Crisp | `crispEnabled`, `crispWebsiteId` | None; website ID is public |
| KV | `cacheEnabled`, `cacheNamespaceId` | None |

Waffo Pancake accepts only server-declared `{id,name?,productId,type,currency}` plans. Clients cannot supply amounts, merchants or product IDs. A real merchant sandbox checkout and current GraphQL response contract still need merchant verification; signed fixtures are not a live purchase. Email acceptance is not inbox delivery.

## Schema and deployment

Plugins adding persistent tables own `schema.sql`. `pnpm --dir apps/web schema:plugins` discovers plugin schemas and applies repeatable additive tables/indexes. Better Auth administrator and newsletter recovery-version columns are inspected before adding; existing columns are preserved. Deployment applies this before publishing the Worker, and local `serve-local.mjs` uses the same inventory.

Existing D1/R2 are shared, with KV bound only when enabled. No Containers, VMs, polling queues or always-on compute are added. Notifications run during webhook processing or an administrator retry; verified payment access does not depend on notification delivery. Apply the outbox schema before enabling notifications; a missing table fails the atomic webhook transaction for retry. Credentials never enter clients, plugin settings, logs or public inventories.

For uncertain confirmation or unsubscribe outcomes, the newsletter panel lets an administrator reconcile after verifying the original request ended and waiting at least 60 seconds. It reads actual Resend state and unlocks through a version check instead of blindly repeating a contact write.

## Verification boundaries

`check:saas` covers real local workerd, D1/R2/KV, owner boundaries, concurrency, signatures/idempotency, confirmation and provider failures. External vendor traffic is replaced with controlled fixtures. `acceptance:saas` compares official components and exercises the new panels. Repository gates continue checking provenance, exports, composition, packs, runtime planes and strict types.

Official DSH has no matching implementation for these SaaS domains, so each addition is an owned plugin in an official slot, with its reuse decision recorded. The purchased template informed scope; this implementation does not mislabel its UI or commercial source as an official DSH fork. Generated third-party notices cover the installed vendor SDKs and libraries.
