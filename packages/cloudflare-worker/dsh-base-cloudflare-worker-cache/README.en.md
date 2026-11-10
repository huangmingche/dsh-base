# Public KV cache

Enable `CACHE_ENABLED=true` and bind Workers KV as `CACHE`. This is a trusted server service for public data only; it adds no schema. The official Session projection checkpoint cache has different consistency and ownership semantics, recorded in reuse metadata.

`ctx.publicCache.get(env,key)`, `put(env,key,value,ttlSeconds)` and `delete(env,key)` accept only `public:` namespaced keys. Stored keys receive a deployment namespace. Values are JSON up to 256 KiB; TTL is 60–86400 seconds. Workers KV is eventually consistent: deletion is not an immediate global invalidation guarantee. Never cache sessions, credentials, payments, entitlements or private account data here.

`GET /api/saas/cache/status` returns public `{enabled,ready}`. `GET /api/saas/cache` and same-origin `DELETE /api/saas/cache?key=public:example` require an authenticated `SITE_ADMIN_USER_IDS` administrator. HTTP does not expose cache contents or arbitrary writes. Missing bindings fail closed; provider errors are generic. No warming cron or extra runtime is started.

The root SaaS workerd suite covers administrator scope, key boundaries, TTL/value bounds and real local KV.
