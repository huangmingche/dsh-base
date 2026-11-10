# Paid feature authorization

A server DSH plugin composed over local authentication and `ctx.payments`. The official pinned account packages expose DeepSeek Platform identity/wallets, not SaaS feature grants; this capability therefore uses a custom plugin and the existing payment projection. It adds no infrastructure or schema.

Configure `ENTITLEMENTS_FEATURES_JSON` in server bindings:

```json
[{"id":"exports","label":"Exports","planIds":["pro","lifetime"]}]
```

Feature and plan IDs contain 1–80 letters, digits, underscores or hyphens. Lists must be nonempty, unique and at most 100 entries. Missing or malformed configuration, disabled payment configuration and database failures deny access. Only the configured user's persisted, scoped Waffo Pancake orders can grant access: the order must be eligible, not superseded, and either a paid one-time purchase or a subscription with a known future period end. Authorization queries all matching orders; it does not depend on the account screen's 100-order display limit.

Trusted server plugins call `await ctx.entitlements.authorize(env, authenticatedUserId, 'exports')` before protected work. The result is `{allowed,reason}` where `reason` is `allowed`, `no_entitlement`, `unavailable` or `unknown_feature`. Always derive the user ID from the authenticated session; never accept it from a browser request. The optional `label` is presentation only.

Deployment `saas.entitlementOperations` becomes `ENTITLEMENTS_OPERATIONS_JSON`; its default `{}` preserves existing free behavior. For example, `{"platform_ai":"pro-ai"}` maps platform inference to a declared `pro-ai` feature. Unknown feature mappings and malformed policy deny execution. Trusted callers use `ctx.entitlements.authorizeOperation(env,userId,operation)` or exported `assertOperationAllowed`; the latter throws 402 for missing access and 503 for unavailable state. The Host checks before configuring a platform model, and Think rechecks before every actual generate/stream request, including a reused model after refund. BYOK keeps its existing policy. Optional `saas.platformAiMaxOutputTokens` accepts 1–131072 as a per-request cap; 0 preserves the existing limit. This is not a cumulative usage quota. Other business operations must explicitly call the trusted gate; arbitrary routes are not automatically protected, and no credit metering is supplied.

`GET /api/entitlements` requires login and returns `{features:[{id,label?,planIds}]}`. `GET /api/entitlements?feature=exports` returns `{feature,allowed,reason}` for that authenticated owner. Unknown features return 404; unavailable data returns 503; a known feature without access returns 200 with `allowed:false`. Unauthenticated requests return 401. No mutation or anonymous grant endpoint exists.

Payment state is the latest locally reconciled provider state. Lost webhook deliveries can delay revocation until replay, although known subscription expiry is checked on each authorization. Feature handlers needing stronger freshness must define their own provider reconciliation policy.

Validation: `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-entitlements/tests/*.test.ts`. The Waffo Pancake runtime suite also verifies real D1 ownership, expiry and historical lifetime grants beyond the display limit. No real provider requests are made.
