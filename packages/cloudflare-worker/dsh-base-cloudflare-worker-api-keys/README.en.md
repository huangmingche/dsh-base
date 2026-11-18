# User API keys

This Worker plugin composes `@better-auth/api-key@1.7.18`, retaining its random generation, hashed storage, ownership, expiration and database rate limiting. It requires `API_KEYS_ENABLED=true`. `schema.sql` uses existing `AUTH_DB` without always-on infrastructure.

| Route | Contract |
| --- | --- |
| `GET /api/api-keys/status` | `{enabled,authenticated,scopes:["profile:read"]}` |
| `GET /api/api-keys` | Current cookie user's `{keys,total,limit,offset}`; `limit=1..100` defaults to 100, `offset=0..100000` defaults to 0; no complete key/hash in lists |
| `POST /api/api-keys` | Same-origin cookie user, `{name,expiresInDays?}`; name 1–64 characters; expiry 1–365 days, default 30; 201 `{key:summary,secret}` returns the complete secret once |
| `DELETE /api/api-keys/{id}` | Same-origin cookie user revokes their own key; `{ok:true}` |
| `GET /api/api-keys/whoami` | `Authorization: Bearer dsh_...`; returns only `{id,email}` after verification |

Permission is fixed to `profile:read`. Keys never become browser sessions or authorize chat, storage, billing or administration. Banned accounts, revoked/expired keys and missing scope are denied; internal Worker `ctx.apiKeys.verify(env,key)` applies the same checks. Each key allows 60 verifications per minute; creation allows 5 per IP per minute. Pagination is not a total-key quota.

Bodies are stream-limited to 2048 bytes. Clients cannot choose permissions, metadata, user ID, prefix, unlimited expiration or rate-limit settings. All public `/api/auth/api-key/*` paths are denied. Internal endpoints include only create, list, delete and server-side verification, without update. Responses use `no-store`; complete keys cannot be recovered from the server.

The reuse audit read the pinned DSH `deepseek-account` plugin and its `account` Remote, which manage DeepSeek Platform accounts/inference credentials and contain no product API-key issuer to mount or fork. This independently authored adapter uses the [Better Auth API key plugin](https://better-auth.com/docs/plugins/api-key), copying no commercial template or DSH source.

`node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-api-keys/tests/runtime.test.mjs` uses actual workerd, Better Auth and temporary D1 for generation/hashing/one-time reveal, pagination, cross-user denial, scope, concurrent rate limits, expiry/revocation, bans and native endpoint bypass. Tests have no external network.
