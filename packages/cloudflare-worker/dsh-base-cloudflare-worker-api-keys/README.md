# 用户 API key

此 Worker 插件组合 `@better-auth/api-key@1.7.18`，复用其随机生成、哈希存储、所有权、到期与数据库限流。`API_KEYS_ENABLED=true` 才启用，schema 位于 `schema.sql`，复用 `AUTH_DB`，无需常驻服务。

| 路由 | 契约 |
| --- | --- |
| `GET /api/api-keys/status` | `{enabled,authenticated,scopes:["profile:read"]}` |
| `GET /api/api-keys` | 当前 cookie 用户的 `{keys,total,limit,offset}`；`limit=1..100` 默认 100、`offset=0..100000` 默认 0；列表没有完整 key/hash |
| `POST /api/api-keys` | 同源 cookie 用户，`{name,expiresInDays?}`；名称 1–64 字符，到期 1–365 天默认 30；201 返回 `{key:summary,secret}`，完整 secret 仅此一次 |
| `DELETE /api/api-keys/{id}` | 同源 cookie 用户撤销自己的 key，返回 `{ok:true}` |
| `GET /api/api-keys/whoami` | `Authorization: Bearer dsh_...`；验证后只返回 `{id,email}` |

固定权限为 `profile:read`。key 不变成浏览器会话，不能访问聊天、存储、账单或管理功能。封禁账户、撤销/到期 key、缺少 scope 均拒绝；Worker 内部 `ctx.apiKeys.verify(env,key)` 使用相同校验。按 key 每分钟最多 60 次验证；创建端点每 IP 每分钟最多 5 次。列表分页不是总 key 数配额。

请求体按流限制 2048 字节；客户端不能指定权限、元数据、用户 ID、prefix、无限到期或限流参数。公开 `/api/auth/api-key/*` 全部拒绝；内部只挂载创建、列表、删除与服务端验证，不开放更新。所有响应 `no-store`，完整 key 不能从服务端恢复。

复用审计读取固定版本 DSH 的 `deepseek-account` 的 `account` Remote，该插件管理 DeepSeek 平台账户与推理凭据，没有可挂载/分叉的产品 API key 发行功能。本包独立适配 [Better Auth API key 插件](https://better-auth.com/docs/plugins/api-key)，未复制商业模板或 DSH 源码。

`node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-api-keys/tests/runtime.test.mjs` 使用真实 workerd、Better Auth、临时 D1，验证生成/哈希/一次展示、分页、跨用户拒绝、scope、并发限流、到期/撤销、封禁和原生端点绕过。测试没有外部网络。
