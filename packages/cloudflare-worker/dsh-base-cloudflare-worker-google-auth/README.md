# Google 产品账户登录

此 Worker 插件通过 `ctx.auth.registerExtension()` 配置 Better Auth 1.7.18 的 Google provider。默认关闭；仅 `AUTH_GOOGLE_ENABLED=true`、有效的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 与 `AUTH_BASE_URL` 同时存在时，公开认证策略才返回 `googleEnabled: true`。密钥只保存在 Worker binding。Google Console 必须登记 `${AUTH_BASE_URL}/api/auth/callback/google`。

客户端通过 `/api/auth/sign-in/social` 发起授权码流程，由原版 Better Auth 处理 state、PKCE、固定 Google token endpoint、回调与 D1 会话。配置关闭自动跨账号合并；关闭公开注册时新 Google 用户也不能注册。拒绝客户端直接提交 ID token。Google 登录入口未配置时保持可见禁用，Apple 与手机号仍不可用。参见 [Better Auth Google 文档](https://better-auth.com/docs/authentication/google)。

复用审计读取固定版本 DSH 的 `deepseek-account` 与 `api-account-controller`；它们实现 DeepSeek Platform 账户协议，不能挂载或仅改 Host seam 后提供本地 Google 产品账户。此包是独立编写的配置适配器，未复制商业模板或 DSH 源码；商业模板仅供流程参考。

`tests/config.test.ts` 覆盖默认关闭、配置更新及扩展冲突。认证包 `tests/email-google-runtime.test.mjs` 使用真实 workerd、Better Auth、临时 D1 与本地 outboundService 验证 state、PKCE、token 交换、302 拒绝、回调与会话。测试不访问 Google；真实凭据、Google Console 与生产回调仍须部署方验收。
