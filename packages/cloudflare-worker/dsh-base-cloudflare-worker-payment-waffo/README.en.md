# Waffo Pancake payments

A Worker DSH plugin for authenticated Waffo Pancake checkout, hosted customer portal, scoped account orders and raw signed webhooks. It uses the official MIT `@waffo/pancake-ts` SDK, pinned to `0.28.0`, under the application's existing Workers `nodejs_compat` flag. It adds five tables (checkout, orders, receipts, analytics consent and conversion outbox) to the existing `AUTH_DB`; no extra database, queue, cron, container or always-on service is required.

The pinned DSH account controller, DeepSeek account and settings account packages expose DeepSeek Platform billing rather than merchant checkout. They cannot be mounted or forked into this capability through a Host-only seam. Their UI is preserved. See package reuse metadata.

## Configuration

Apply this package's `schema.sql` to `AUTH_DB`, then configure server bindings. Credentials must never enter a client bundle or serializable plugin configuration.

| Binding | Meaning |
| --- | --- |
| `WAFFO_ENABLED` | Explicit `true` opt-in; all other values disable payments |
| `WAFFO_ENVIRONMENT` | Required `test` or `prod`; must match the merchant key |
| `WAFFO_MERCHANT_ID` | Merchant ID, `MER_` plus 22 alphanumeric characters |
| `WAFFO_PRIVATE_KEY` | Secret merchant RSA private key |
| `WAFFO_STORE_ID` | Store ID, `STO_` plus 22 alphanumeric characters |
| `WAFFO_PLANS_JSON` | Nonempty server allowlist shown below |
| `AUTH_BASE_URL` | Canonical HTTPS origin; local HTTP loopback is allowed |
| `AUTH_DB` | Existing D1 binding with payment schema |

```json
[{"id":"pro","name":"Pro","productId":"PROD_1234567890abcdefghijkl","type":"subscription","currency":"USD"}]
```

Replace the example product ID with the actual product. `type` is `subscription` or `one_time`; `name` and `description` are optional. Configure the actual price in Waffo Pancake. An optional `price:{amount:"19.00",interval:"month",intervalCount:1}` declares the public display price in major currency units; this is deployment data, not a live provider quote. Subscription display prices require an explicit day/week/month/year interval and a count from 1–120; one-time prices must omit both. Currency precision is validated to prevent silent display rounding. Missing price stays unknown. `ENTITLEMENTS_FEATURES_JSON` supplies `{id,label?,planIds}` declarations; public included features come only from those mappings. The client cannot submit prices, product IDs, user identities, arbitrary metadata or a return origin. Readiness means configuration is present and valid; it does not verify the remote merchant, published product or D1 schema.

Configure Waffo Pancake's **Raw** webhook channel at `/api/webhooks/waffo`. Subscribe to order completion, subscription activation/payment/renewal/recovery/plan-change/cancellation/past-due, and refund success/failure events. The SDK verifies the exact raw UTF-8 payload with the explicitly selected environment's public key, a 45-minute past and 1-minute future signature window. These windows retain Waffo Pancake retries; receipt uniqueness prevents replay. No application webhook secret or custom production key override is required.

## HTTP and service contracts

All responses use `Cache-Control: no-store`; operational failures return generic errors without provider payloads or credentials.

| Endpoint | Contract |
| --- | --- |
| `GET /api/payments` | `{provider:'waffo',ready,plans,priceSource:'deployment'}`; explicit declared plans remain readable with `ready:false`, while purchases stay disabled |
| `POST /api/payments/checkout` | Authenticated, same-origin JSON `{planId,returnPath?,locale?,analyticsConsent?,analyticsCampaign?}` plus a 16–128 character alphanumeric/hyphen/underscore `Idempotency-Key`; returns `{id,url}` |
| `POST /api/payments/portal` | Authenticated, same-origin JSON `{}`; returns a real SDK authenticated `{url}` |
| `GET /api/payments/account` | Authenticated owner's latest 100 orders and `portalAvailable` |
| `POST /api/webhooks/waffo` | Public signed raw payload; returns `{received:true,result}` after durable processing |

Orders expose `{id,planId,type,status,periodEnd,refunded,entitled}`. The trusted `ctx.payments.account(env,userId)` service exposes the same projection; callers must derive the owner from authentication. `ctx.payments.ready(env)` checks configuration. The entitlements companion gates explicitly configured operations; this package does not meter usage or credits.

Checkout analytics consent defaults to false and is persisted separately from the order. A retry may revoke consent but cannot upgrade the same intent's earlier denial. `begin_checkout` follows a successful hosted-session response and omits value because that SDK response has no authoritative amount. `purchase` takes its major-unit `chargedAmount`, `currency` and `paymentId` only from a verified `order.completed` / `subscription.payment_succeeded` event. The queried order, store, environment and unique successful payment must match; subscription payments must belong to the current period, and refunded payments are excluded. Missing or mismatched information produces no purchase conversion; an explicit zero amount is valid. Price snapshots are not actual revenue. Its outbox is committed with the signed webhook receipt; deduplication uses the actual payment ID, including separate renewals. A verified repeat delivery can finish a pending conversion after an analytics outage. Trials never invent revenue. Analytics failures do not undo committed access; consent/campaign is inherited from the local checkout, never supplied by the webhook. No provider URLs or private account details are sent to analytics.

Checkout uses stable local user IDs for Waffo Pancake buyer identity. A per-user idempotency claim is persisted before the provider call and the same reference is reused on retries. Conflicting request bodies return 409. Keys older than 23 hours fail closed before Waffo Pancake's 24-hour idempotency cache expires; start a new purchase intentionally with a new key. Checkout URLs expire after one hour; retrying the same key after expiry does not create a new purchase. Token-bearing checkout/portal URLs are returned only to that authenticated caller and never stored in D1. Only HTTPS `pancake.waffo.ai` URLs are accepted.

## State and failure behavior

Known webhooks fetch the current order through signed, query-only Waffo Pancake GraphQL. A checkout reference, stored owner, allowed product/currency/type, store and environment must agree before storing state. Browser return URLs never grant access. Events for unrelated sales cannot create local grants. Portal plan changes require the new order's origin and the old order's authoritative replacement backlink; terminal supersession cannot be undone by a later delivery.

D1 reads start on the primary. An order revision is read before the provider query; an atomic compare-and-swap and receipt transaction prevents concurrent stale writes. Conflicts, GraphQL errors, transport failures and D1 failures return non-2xx without falsely recording completion. A provider retry refetches current state. Receipts persist across isolates and restarts and cannot be pruned until their replay and business retention requirements are resolved.

A one-time entitlement requires a completed order and an unrefunded successful payment. Subscription entitlement requires active/trialing/canceling status, a known future period end, and a successful current-period payment (or explicit trialing status). Canceled, expired, closed, unknown or past-due states do not grant access. Refunds revoke their affected billing period; an older refunded period does not invalidate a later paid renewal. Any provider `refunded` state in the current period revokes eligibility conservatively; this template does not calculate partial-refund balances. Pending refund reconciliation does not grant access from that payment. Refunded subscriptions retain portal access so users can manage an otherwise active subscription.

This is a local projection of the latest successfully processed provider event, not a continuous provider poll. If every delivery is lost, local state can remain stale until a verified delivery is replayed; known period expiry still applies on every read. There is no automatic reconciliation scheduler, refund initiation API, billing-provider migration or product quota system. Each processed event normally costs a provider query and D1 reads/writes; a plan replacement can need a second provider query.

## Verification and provenance

Run `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-payment-waffo/tests/*.test.ts` and `node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-payment-waffo/tests/runtime.test.mjs` from the repository root. Tests use ephemeral RSA keys, provider fixtures and local workerd/D1; no real charges or merchant requests occur. Production activation still requires merchant sandbox verification, including the current GraphQL schema, portal, checkout and real delivery signatures.

The purchased TanStarter checkout, webhook and reconciliation tests were reviewed as behavior references, including its accepted implementation decisions. This package's source and tests were written independently; no TanStarter source or UI was copied. Do not interpret the package's MIT label as relicensing that commercial template. Reference paths: `src/payment/provider/waffo.ts`, `src/payment/waffo-query.ts`, `tests/unit/payment/waffo-reconciliation.test.ts` and `docs/others/implementation-decisions.md` in the purchased template.

Primary implementation references: [Waffo Pancake SDK](https://github.com/waffo-com/waffo-pancake-sdk-ts), [Waffo Pancake webhook guide](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/webhook-guide.md), [Waffo Pancake GraphQL guide](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/graphql-guide.md), [Workers Node crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

Pricing and post-login checkout flow also reference purchased-template commit `b101976ed1aa6d4fd39ca5a1e7f0b95a7c4777d7`: `src/components/pricing/pricing-card.tsx`, `src/components/pricing/create-checkout-button.tsx` and `src/config/payment.ts`. This is a behavior reference with no source copied; the original commercial license remains with the template. See `dshBase.reference` for provenance.
