# Worker 账户认证

此插件使用 Better Auth 1.7.18 和现有 `AUTH_DB` D1 数据库提供产品账户、密码与会话。官方账户栈是 DeepSeek OAuth 与平台账单，不能直接提供本地产品认证；官方 Account UI 继续由客户端兼容层挂载，账单等不可用能力保持可见禁用。

认证 HTTP 请求使用 Better Auth 原生 `rateLimit.storage: "database"`，复用 `apps/web/migrations/0002_username_password.sql` 已创建的 `rateLimit` 表。内置条件增量在数据库中原子消耗计数，多个 Worker isolate 和进程重启共享同一 IP / 路径预算；没有内存回退或自定义计数器。本次没有新增迁移，也不变更数据库标识、账户 ID 或签名 secret。缺表或 D1 故障会拒绝认证，不能因此放行请求或签发 cookie。数据库模式与 HTTP / 内部 API 的区别见 [Better Auth 限流文档](https://better-auth.com/docs/concepts/rate-limit)。

仅信任 Cloudflare 边缘覆盖的 `cf-connecting-ip`，不信任客户端自行提供的 `X-Forwarded-For`。Better Auth 会规范化 IPv4 / IPv6，并按 IPv6 `/64` 网络共享预算。用户名、邮箱登录和开放注册各为每分钟 20 次；普通路径每分钟 600 次，`get-session` 每分钟 1200 次。超限返回 429 和 `X-Retry-After`。这是跨 isolate 的认证端点限流，不是按账户限制所有来源 IP 的攻击，也不是产品 API 或模型消费配额；内部 `auth.api.getSession` 不经过此 HTTP 限流。

注册默认关闭；仅显式开启或受管理注册令牌保护的请求能够注册。公开策略端点只返回是否开放注册。缓存实例随 D1 binding、认证 origin 或 secret 的变化重新建立，不改写这些配置。

运行 `node packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/tests/rate-limit.test.mjs`。测试在真实本地 workerd 与 D1 中启用两个 isolate，验证并发只放行共享预算、重启持久化、过期并发重置和清理、IPv6 归一化、真实注册 / 登录 / cookie 会话，以及数据库故障拒绝。使用随机测试 secret 与临时持久目录，不访问线上数据库或模型。`tests/policy.test.ts` 另验证默认关闭、受控注册、停用旧测试账户和缓存配置更新。
