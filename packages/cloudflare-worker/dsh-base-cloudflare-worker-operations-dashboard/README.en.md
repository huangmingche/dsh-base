# Operations counts

A read-only Worker DSH plugin for real SaaS operations counts. The pinned official session statistics and telemetry packages describe conversation/model execution and cannot provide merchant/account/email operations through a Host-only seam. Reuse metadata records this decision. There are no sample metrics, charts, extra tables or outbound telemetry.

`GET /api/operations-dashboard` first verifies the local auth session and the existing `SITE_ADMIN_USER_IDS` server policy. Anonymous callers receive 401; non-administrators and malformed administrator lists receive 403. Only after authorization are counts read from D1 primary sessions and the payment service. Responses are never cached.

```ts
{
  users: {available:true, total:number} | {available:false},
  payments: {available:true, orders:number, activeSubscriptions:number, refundedOrders:number} | {available:false},
  email: {available:true, sending:number, accepted:number, rejected:number, unknown:number} | {available:false}
}
```

`users.total` counts real Better Auth `user` rows. Payment counts come from the configured merchant/store/environment's Waffo Pancake projection; `activeSubscriptions` counts current eligible, unexpired, unsuperseded subscriptions. `refundedOrders` reflects the current affected period for subscriptions and the purchase for one-time orders. A disabled/unavailable payment service or missing payment schema is explicitly unavailable.

Email counts group the existing `dsh_email_deliveries.state` rows. `accepted` means provider acceptance, not inbox delivery; `sending` can include an interrupted attempt, and `unknown` requires investigation. Historical counts can remain visible when email sending is disabled. Missing tables or individual query failures produce `{available:false}` for that module, never a fabricated zero. A successful empty table produces real zero counts. Sections are independent snapshots, not a cross-service financial transaction.

No personal emails, user IDs, tokens, message bodies, payment amounts or mixed-currency revenue are returned. This is not a settlement, tax, cash-flow or deliverability report. D1 aggregate reads incur usage; no periodic background queries are scheduled.

Run `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-operations-dashboard/tests/*.test.ts` for administrator, unavailable-schema, actual-zero and response-shape checks. The Waffo Pancake runtime suite covers the underlying real D1 payment aggregation.
