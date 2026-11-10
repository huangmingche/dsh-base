# 运营通知

本 Worker DSH 插件将支付状态变化发送到配置的 Discord、飞书机器人 webhook。固定版本官方 `dsh-webhook`、`dsh-webhook-github` 接收入站触发并启动 Workspace agent 会话，无法只通过 Host 适配提供出站通知。本插件组合已有认证、管理员策略和 D1，无公开转发接口、队列、定时器或常驻运行时。

启用前先将 `schema.sql` 应用到现有 `AUTH_DB`。设置 `NOTIFICATIONS_ENABLED=true`，并提供至少一个 secret `DISCORD_WEBHOOK_URL` 或 `FEISHU_WEBHOOK_URL`。仅接受准确 HTTPS `discord.com/api/webhooks/{id}/{token}`、`open.feishu.cn/open-apis/bot/v2/hook/{token}`，拒绝账号信息、query、fragment、其他端口、任意域名及重定向。URL 是凭据，不进入公开状态、客户端或 outbox。配置缺失/错误时不可用，ready 不探测供应商或 schema。机器人必须有目标频道/群组权限；飞书关键词策略可允许固定短语 `Payment update`，本版暂不支持启用签名校验的飞书机器人配置。

Waffo Pancake 将按目标隔离的 outbox 语句与订单更新、验证事件回执放入**同一 D1 事务**：没有对应回执不会插入通知。仅套餐、状态、周期、退款或替代关系的实质变化产生通知。同一事件重投和多 isolate 并发共享持久化声明。启用通知后缺少 outbox 表会使金融状态事务失败并由供应商重试，因此必须先迁移；未启用时支付不依赖该表，也不会补发启用前的历史通知。

提交后在当前请求中尝试 pending 投递，最多两个渠道并行。每次超时 10 秒，不跟随重定向。Discord 使用 `wait=true`，要求返回消息 ID 并禁用 mentions；飞书检查业务结果码，兼容旧 `StatusCode`。明确 HTTP/业务拒绝记为 `rejected`，超时、网络错误、408/5xx、过大或损坏响应记为 `uncertain`；崩溃可能留下 `sending`。供应商接受记为 `accepted`，不等同用户恰好收到一次。

accepted 不自动重发，重复支付投递只处理仍 pending 的记录。rejected/uncertain/sending 没有自动重试。金融事务提交后的通知失败不撤销已确认支付；管理员可调查后显式重试，不确定状态重试可能造成重复消息。目标指纹阻止更换 webhook secret 后将旧任务投递到其他目标。outbox 应按重放/审计需要保留；同时删除回执和通知记录可能允许再次发送。

## API 与服务

- `GET /api/saas/notifications/status`：公开 `{enabled,ready,channels:{discord,feishu}}`，无 URL/凭据。
- `GET /api/saas/notifications`：须登录且在 `SITE_ADMIN_USER_IDS`，返回最近 100 条 `{id,channel,kind,orderId,state,attempts,createdAt,updatedAt}`，包装为 `{deliveries}`；不返回正文、私人邮箱、目标 URL/摘要或 token。
- `POST /api/saas/notifications/retry`：管理员、规范同源 JSON `{id,expectedAttempts,reviewedUncertain?}`。成功只表示该尝试已处理，需刷新列表查看供应商结果。accepted 和过期 attempts 一律 409。sending/uncertain 必须显式 `reviewedUncertain:true`，sending 还需距声明至少 15 秒。目标缺失或改变时不可重试。

可信插件只能在对应 Waffo Pancake 回执事务中使用 `ctx.notifications.paymentStatements(env, notice)`，随后调用 `flush(env,eventKey)`；它是类型化支付更新服务，不是任意消息转发器。消息包含事件类型、订单 ID、已配置套餐 ID、当前状态和退款标记，不含客户姓名、邮箱、金额或币种合计。状态/历史接口禁止缓存，错误不泄露供应商正文。

## 验证与来源

运行 `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-notifications/tests/*.test.ts` 以及 Waffo Pancake `tests/runtime.test.mjs`。测试使用供应商 mock 和本地 workerd/D1，覆盖回执/outbox 原子性、并发声明、不确定投递审核、旧版本重试、accepted 防重及缺表回滚。未发送真实 Discord/飞书消息或 Waffo Pancake 请求。

已阅读购买模板 TanStarter 的通知 provider 作为行为参考，未复制源码；本独立实现不改变商业模板许可。主要协议依据：[Discord webhook](https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx)、[飞书自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)。
