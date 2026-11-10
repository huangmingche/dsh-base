# 确认式邮件订阅

启用 `NEWSLETTER_ENABLED=true`，配置 `RESEND_API_KEY`、已有邮件插件、规范 `AUTH_BASE_URL`、公开 `TURNSTILE_SITE_KEY` 和secret `TURNSTILE_SECRET_KEY`。通过仓库带字段检查的插件schema部署流程，将本包及HTTP公共表单、邮件schema应用到 `AUTH_DB`。newsletter schema为旧草稿追加 `revision`、`operation_at`。无定时器、群发器或额外数据库。

- 公开 `GET /api/saas/newsletter/status` 返回配置状态及Turnstile site key。
- 公开同源 `POST /subscribe` 接收 `{email,consent:true,turnstileToken,locale?}`。Turnstile必须匹配规范域名和 `newsletter` action。D1固定窗口限制每IP每10分钟5次、每action每天1000次、每地址每10分钟1封确认邮件。发送随机256位token，仅保存摘要，24小时过期。接受请求返回202，不暴露供应商订阅状态。
- 同源 `POST /confirm` `{token}` 先原子声明再修改Resend联系人。重复已确认点击读取真实供应商状态；仅提交邮箱不会直接建立订阅。
- 登录 `GET /api/saas/newsletter` 仅查询会话中已验证邮箱的真实Resend状态；同源 `DELETE` 取消该本人订阅。确认及账号管理不依赖邮件发送/Turnstile仍可用，普通操作仍要求功能启用。

不确定的写入保留confirming/unsubscribing锁，避免与随后相反操作竞争。管理员 `GET /api/saas/newsletter/reconcile` 返回 `{items:[{email,state,revision,operationAt,reconcilable}]}`，不含token摘要。同源 `POST` 接收 `{email,expectedRevision,reviewedProvider:true}`：必须先在供应商记录确认原请求已结束，且距离声明至少60秒；服务端读取真实Resend状态，以revision比较更新恢复confirmed/revoked，绝不再次发送订阅写入。冲突或供应商读取失败保持锁。即使停止收集新订阅，管理员恢复仍可使用。

Resend请求固定HTTPS origin，正文解析有大小上限，8秒超时并明确拒绝重定向。GET404表示未订阅，查询失败绝不伪装false。无自动重试、供应商迁移或群发计划。

`tests/reconcile-runtime.test.mjs` 覆盖真实D1并发恢复、管理员权限、供应商故障和邮件不可用时本人取消订阅。HTTP `tests/outbound-runtime.test.mjs` 用真实Workers fetch连接mock Resend/Turnstile。未改动真实联系人或发送真实邮件。协议依据：[查询联系人](https://resend.com/docs/api-reference/contacts/get-contact)、[更新联系人](https://resend.com/docs/api-reference/contacts/update-contact)。
