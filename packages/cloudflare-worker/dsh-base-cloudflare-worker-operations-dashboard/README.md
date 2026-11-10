# 运营统计

本只读 Worker DSH 插件提供真实 SaaS 运营计数。固定版本官方 session stats 和 telemetry 描述会话/模型执行，无法仅通过 Host 适配提供商户、账号、邮件运营统计，复用决策已记录在包元数据中。不提供示例指标、示例图表、额外表或外发遥测。

`GET /api/operations-dashboard` 首先验证本地登录会话和现有服务端 `SITE_ADMIN_USER_IDS` 策略。匿名返回 401，非管理员及损坏的管理员列表返回 403。授权后才从 D1 主库会话及支付服务读取，响应禁止缓存。

```ts
{
  users: {available:true, total:number} | {available:false},
  payments: {available:true, orders:number, activeSubscriptions:number, refundedOrders:number} | {available:false},
  email: {available:true, sending:number, accepted:number, rejected:number, unknown:number} | {available:false}
}
```

`users.total` 统计真实 Better Auth `user` 表。支付计数来自当前商户/店铺/环境的 Waffo Pancake 状态投影；`activeSubscriptions` 为当前有效、未过期、未被替代的订阅数。`refundedOrders` 对订阅反映当前受影响周期，对单次购买反映该购买。支付服务关闭、不可用或缺少支付表时明确标记 unavailable。

邮件按现有 `dsh_email_deliveries.state` 分组。`accepted` 仅表示供应商接受，不能等同收件箱送达；`sending` 可能包含中断尝试，`unknown` 需调查。停止发送邮件后历史计数仍可查看。缺表或单项查询失败时仅该模块返回 `{available:false}`，不伪装为零；成功查询空表才返回真实零。各模块是独立快照，不是跨服务财务事务。

不返回私人邮箱、用户 ID、token、邮件正文、支付金额或混合币种营收。本接口不是结算、税务、现金流或送达率报表。聚合查询产生 D1 使用量，不自动安排后台轮询。

运行 `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-operations-dashboard/tests/*.test.ts` 验证管理员、缺表、真实零值和响应契约。底层真实 D1 支付聚合也由 Waffo Pancake runtime 测试覆盖。
