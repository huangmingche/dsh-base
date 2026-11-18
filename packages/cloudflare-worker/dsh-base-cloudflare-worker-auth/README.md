# Worker 账户认证

此插件使用 Better Auth 1.7.18 和现有 `AUTH_DB` D1 数据库提供产品账户、密码与会话。官方账户栈是 DeepSeek OAuth 与平台账单，不能直接提供本地产品认证；官方 Account UI 继续由客户端兼容层挂载，账单等不可用能力保持可见禁用。

认证 HTTP 请求使用 Better Auth 原生 `rateLimit.storage: "database"`，复用 `apps/web/migrations/0002_username_password.sql` 已创建的 `rateLimit` 表。内置条件增量在数据库中原子消耗计数，多个 Worker isolate 和进程重启共享同一 IP / 路径预算；没有内存回退或自定义计数器。本次没有新增迁移，也不变更数据库标识、账户 ID 或签名 secret。缺表或 D1 故障会拒绝认证，不能因此放行请求或签发 cookie。数据库模式与 HTTP / 内部 API 的区别见 [Better Auth 限流文档](https://better-auth.com/docs/concepts/rate-limit)。

仅信任 Cloudflare 边缘覆盖的 `cf-connecting-ip`，不信任客户端自行提供的 `X-Forwarded-For`。Better Auth 会规范化 IPv4 / IPv6，并按 IPv6 `/64` 网络共享预算。用户名、邮箱登录和开放注册各为每分钟 20 次；普通路径每分钟 600 次，`get-session` 每分钟 1200 次。超限返回 429 和 `X-Retry-After`。这是跨 isolate 的认证端点限流，不是按账户限制所有来源 IP 的攻击，也不是产品 API 或模型消费配额；内部 `auth.api.getSession` 不经过此 HTTP 限流。

注册默认关闭；仅显式开启或受管理注册令牌保护的请求能够注册。公开 `/api/auth-policy` 返回注册、邮件、验邮、重置密码、Google 及已注册扩展的能力标记，不返回 secret。每个 Worker isolate 只复用已完成初始化和 D1 表结构校验的认证实例。冷启动时，并发请求各自等待自己的检查；故障请求返回 503，后续请求可在数据库恢复后重新建立实例。D1 binding、认证 origin、secret、邮件配置或扩展 revision/cache key 变化时会重新校验。

同一个 `Request` 与环境内的鉴权复用一次会话读取；新请求重新查询，撤销的会话不会被跨请求缓存保留。内部权限检查禁用会话续期写入，由真实认证 HTTP 端点处理需要返回 Cookie 的续期。数据库或认证服务读取失败返回 `503 auth_unavailable`，不会伪装成匿名 `401`；真实未登录和已撤销会话仍拒绝私有访问。Worker 通过请求关联的 `auth.unavailable` 事件记录固定的故障阶段和类别。错误详情、Cookie、SQL 和账号信息不进入该日志。

邮件插件 ready 后接入真实验证邮箱、重发与重置密码 hooks；只有显式 `AUTH_EMAIL_VERIFICATION_REQUIRED=true` 才强制验邮。必需验邮但邮件不可用时注册拒绝。验证后不自动登录；重置 token 单次使用并撤销旧会话。回调必须同源。匿名重置返回相同通用结果，供应商发送通过 Workers `waitUntil` 在响应后有界执行；失败只记固定事件码，接受请求不等于邮件投递成功。重置请求与重发各每分钟 3 次，重置提交 10 次。上游可能包含 OAuth state 的诊断日志被关闭。

`ctx.auth.registerExtension({id,cacheKey,options,policy?})` 允许 Worker 插件声明 Better Auth plugins/socialProviders，不能覆盖核心认证配置；重复扩展/provider/plugin/policy key 拒绝。`handle(request,env,extensionId?)` 保留 origin、策略与 HTTP 限流；公开原生 admin/API-key 路径均拒绝，只有对应内部 scope 能访问包装端点。`invokeExtension` 只供受信任 Worker 服务调用已注册插件方法，不暴露通用 HTTP RPC。管理员与 API-key schema 由各自插件所有。

原生 `/api/auth/update-user` 同样关闭，资料写入必须经过 account-profile 插件的姓名和头像所有权规则。新注册请求在读取时限制 16 KiB，JSON 与表单编码均拒绝客户端 `image` 字段；自定义头像来自本人 R2 文件，既存/官方 Google 头像保留，单独改姓名不会清除。可选邮件服务通过 pinned Cordis 文档化的 `ctx.get()` 按请求读取；服务实例变化会重建缓存。`tests/composition-runtime.test.mjs` 在真实 Cordis/static loader/workerd 中验证无邮件启动、邮件移除/重挂、扩展注册/卸载与资源清理。

`tests/email-google-runtime.test.mjs` 使用真实 workerd、Better Auth 与 D1 验证邮件 token/会话流程、OAuth state/PKCE、模拟 token 交换、拒绝供应商重定向与成功回调。邮件与 Google 通过本地 fixture 截获，没有真实发送或外部网络；生产供应商仍需部署方验收。

运行 `node packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/tests/rate-limit.test.mjs`。测试在真实本地 workerd 与 D1 中启用两个 isolate，验证并发只放行共享预算、重启持久化、过期并发重置和清理、IPv6 归一化、真实注册 / 登录 / cookie 会话，以及数据库故障拒绝。使用随机测试 secret 与临时持久目录，不访问线上数据库或模型。`tests/policy.test.ts` 另验证默认关闭、受控注册、停用旧测试账户和缓存配置更新。

## 公开元数据路由

鉴权使用 `@dsh-base/public-pages` 的统一公开资源登记表，允许 sitemap、robots、manifest 和 llms 的匿名 GET/HEAD 导航（包括 HTML Accept）。manifest 与 llms 支持规范语言前缀；规则只匹配完整资源路径，不放行子目录。公开资源不读取账户 session，其输出与缺席行为由独立 Worker 插件和静态资源 404 守卫决定。

## 注册统计钩子

Better Auth 成功创建账号后，向可选 `siteAnalytics` 服务提交 sign_up；去重键仅供服务端哈希，不向 Google 发送账号资料。Google 同意来自本次注册请求的明确授权，未授权只允许配置启用的第一方汇总。统计异步执行，缺少插件或统计失败不会改变注册结果。
