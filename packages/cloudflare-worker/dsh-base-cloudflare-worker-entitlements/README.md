# 付费功能授权

本服务端 DSH 插件组合本地认证与 `ctx.payments`。固定版本官方账号包提供 DeepSeek Platform 身份/钱包，不具备 SaaS 功能授权契约，因此使用自有插件及已有支付状态投影，不增加基础设施或数据库表。

在服务端绑定配置 `ENTITLEMENTS_FEATURES_JSON`：

```json
[{"id":"exports","label":"Exports","planIds":["pro","lifetime"]}]
```

功能和套餐 ID 由 1–80 位字母、数字、下划线或连字符组成；列表非空、不重复、最多 100 项。缺失/损坏配置、支付未启用或数据库失败均拒绝授权。仅当前用户的持久化、范围隔离 Waffo Pancake 订单可以授予权限：订单必须可用、未被替代，并为已支付单次购买或明确尚未到期的订阅。授权查询全部匹配订单，不受账号页面最近 100 条展示限制。

可信服务端插件在受保护操作前调用 `await ctx.entitlements.authorize(env, authenticatedUserId, 'exports')`。返回 `{allowed,reason}`，其中 reason 为 `allowed`、`no_entitlement`、`unavailable`、`unknown_feature`。用户 ID 必须来自认证会话，不能相信浏览器传入的 ID。可选 `label` 仅用于展示，不参与授权。

部署 `saas.entitlementOperations` 写入 `ENTITLEMENTS_OPERATIONS_JSON`，默认 `{}` 保持现有免费行为。例如 `{"platform_ai":"pro-ai"}` 把平台推理映射到已声明的 `pro-ai` 功能；未知功能和损坏映射拒绝执行。可信调用方可用 `ctx.entitlements.authorizeOperation(env,userId,operation)` 或导出的 `assertOperationAllowed`；后者在无权益时抛出 402，不可用时抛出 503。Host 配置平台模型前及 Think 每次真正的 generate/stream 出站前都会重查该映射和本人的付款/到期状态，退款后复用的模型也不能继续出站。BYOK 保持原有策略。`saas.platformAiMaxOutputTokens` 可设置 1–131072 的单次上限，0 保留现有限制；它不是累计用量配额。其他业务操作必须自行在可信执行前接入，不自动封锁任意路由，也不提供积分计量。

`GET /api/entitlements` 要求登录，返回 `{features:[{id,label?,planIds}]}`。`GET /api/entitlements?feature=exports` 返回本人 `{feature,allowed,reason}`。未知功能为 404，数据不可用为 503，已知功能但无权限为 200 且 `allowed:false`；未登录为 401。无修改接口或匿名授权入口。

支付状态取最近本地对账结果，webhook 全部丢失时撤权可能延后至重放事件；已知订阅到期在每次授权时检查。需要更强实时性的业务须另行定义供应商对账策略。

验证命令：`node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-entitlements/tests/*.test.ts`。Waffo Pancake runtime 测试同时覆盖真实 D1 所有权、到期和超出展示上限的历史单次权益，不发起真实供应商请求。
