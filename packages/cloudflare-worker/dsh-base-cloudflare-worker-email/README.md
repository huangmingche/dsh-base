# Cloudflare Worker 邮件插件

`@dsh-base/cloudflare-worker-email` 提供 Cordis `email` 服务，供认证插件发送邮箱验证和密码重置邮件。默认关闭；不会注册公开邮件发送接口，也不会在启动、状态查询或配置检查时发送邮件。

## 复用与边界

已直接检查固定上游版本 `dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）的 `@deepseek-ai/dsh-api-account-controller` 与 `@deepseek-ai/dsh-deepseek-account` 源码和导出。它们提供 DeepSeek OAuth 和账户操作，没有产品事务邮件传输或可 fork 的邮件模板。因此按 `dshBase.reuse` 使用自有插件。参考 [TanStarter 邮件功能范围](https://docs.tanstarter.dev/email/)，实现由公开供应商 API 独立编写，没有复制已购模板源码、组件或样式。

只支持 `verify-email`、`reset-password` 两种内部事务意图；不提供原始 HTML、任意标题、群发、联系表单、营销邮件或 newsletter 接口。调用方必须先确认收件人与真实账户操作的关系，并执行访问控制与频率限制。无 React、SMTP、容器、额外数据库或后台常驻进程；使用 Workers `fetch`、Web Crypto 和现有 `AUTH_DB` D1。

## 部署

先将本包 `schema.sql` 应用到 `AUTH_DB`。配置来源仅为 Worker 绑定，不能把密钥放到客户端或插件可序列化配置中。

| 绑定 | 用途 |
| --- | --- |
| `EMAIL_ENABLED` | 必须精确为字符串 `true` 才能发送；默认关闭 |
| `EMAIL_PROVIDER` | `cloudflare` 或 `resend`；不会自动切换供应商 |
| `EMAIL_FROM` | 已验证域名的地址，可用 `名称 <address@example.com>` |
| `AUTH_BASE_URL` | 认证站点 origin，生产须 HTTPS；只允许 localhost 使用 HTTP |
| `AUTH_DB` | 现有 D1 绑定，须已应用 schema |
| `EMAIL_CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID，选择 Cloudflare 时必填 |
| `EMAIL_CLOUDFLARE_API_TOKEN` | Worker secret；需要 Email Sending Edit 权限 |
| `RESEND_API_KEY` | Worker secret；选择 Resend 时必填 |

[Cloudflare Email Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/) 需要先开通并验证发送域名；本插件使用其 [REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)。[Resend](https://resend.com/docs/api-reference/emails/send-email) 是可选供应商。两者都只请求固定 HTTPS API，禁止跟随重定向，单次请求超时为 10 秒。供应商权限、域名和实际投递需由部署者验证；`ready` 只代表绑定配置有效，不会探测服务。

## 内部服务

```ts
ctx.email.status(env); // { enabled, ready, provider }，无密钥
ctx.email.ready(env);
await ctx.email.sendTransactional(env, {
  kind: "verify-email", // 或 reset-password
  to: user.email,
  actionUrl: url, // Better Auth 回调生成的 URL
  idempotencyKey: token,
  locale: "zh", // zh/en/ja/es/fr/de/pt/ru；支持 zh-CN 等地区标签
});
```

应在 Better Auth 的 `emailVerification.sendVerificationEmail` 和 `emailAndPassword.sendResetPassword` 中传入其提供的 `user.email`、`url`、`token`。调用方决定是否强制邮箱验证；重置密码响应必须维持账户存在与否不可区分。不能把客户端提供的收件人或任意链接直接传入服务。仅允许本站 `/api/auth/verify-email?token=…` 和 `/api/auth/reset-password/{token}`；`callbackURL` 也必须同源。模板提供八种语言的静态 HTML 和纯文本，转义链接，不包含远程图片或追踪像素。

## 去重与失败行为

D1 首先原子保留 `kind + idempotencyKey` 的 SHA-256 摘要；并发实例只有一个能调用供应商。表中只保存键摘要、消息摘要、供应商、状态和时间，不保存邮箱、令牌、正文或供应商错误。已接受的同一意图返回 `duplicate`；同一键但消息改变会报冲突。Resend 还会收到摘要形式的 [幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys/)。

供应商明确拒绝记为 `rejected`；超时、网络错误、不明确响应记为 `unknown`。两者及未完成的 `sending` 都不会自动重发，必须检查供应商记录并由用户发起新的认证操作。这是优先避免重复发送的策略，不能保证恰好一次或保证送达。Cloudflare 的 `delivered`／`queued` 必须包含当前收件人；不会把地址当成邮件 ID。数据库异常和缺失 schema 均关闭发送，错误不包含供应商原始内容。

去重记录不会自动过期，避免旧请求再次发送；运维只应在确认相关认证令牌已不可使用且不会重放后清理。没有自动重试、后台队列、投递回执或供应商故障切换。启用邮件会产生供应商用量和 D1 读写费用。

## 验证

```sh
node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-email/tests/email.test.ts
node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-email/tests/runtime.test.mjs
```

测试覆盖默认关闭、绑定／链接／邮箱校验、八种语言转义、两种供应商响应、两个真实 workerd 实例共享 D1 的并发去重、重启持久化、冲突、失败不重发及 schema 缺失。供应商传输使用测试替身；未发送真实邮件，也未验证线上投递。
