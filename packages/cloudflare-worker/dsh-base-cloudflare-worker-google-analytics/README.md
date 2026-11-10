# @dsh-base/cloudflare-worker-google-analytics

独立 Workers DSH 插件：公开页面浏览、可信业务转化、第一方日汇总及管理员查询。统一读取 `siteSettings`，默认关闭，不创建新数据库、队列、定时任务、常驻服务或浏览器跟踪脚本。

## 配置和统计边界

- `analytics.google.enabled` / `measurementId` 独立控制公开 `page_view`；Google 密钥只由 Worker secret `GOOGLE_ANALYTICS_API_SECRET` 提供。公开接口还要求 `SITE_ANALYTICS_LIMITER`，IP 仅用于 Cloudflare 限流键，不发送 Google。
- `analytics.conversions.mode` 为 `off`（默认）、`aggregate`（第一方日计数）或 `google`（第一方计数，并向 Google 发送明确同意的事件）。Google 模式要求有效 Measurement ID 和部署就绪；不得因配置失败静默替换目标。
- `analytics.conversions.campaigns` 为最多 64 个唯一公开活动标签；只接受字母小写、数字、下划线和连字符，最多 64 字符。未同意或不在白名单的活动不归因。
- 保留现有管理员授权及 revision CAS。Google 未收到同意时只做本地聚合；激活始终仅本地计数，不宣称完整用户级归因。

`POST /api/site-analytics/google` 仅接受同源、严格 `{path}` JSON、最多 512 实际 UTF-8 字节。生产注入 `publicPages.resolve`，仅已发布且该语言可用的公开路径可以统计，包括公开 noindex 页面。公开标题和规范地址来自站点配置，不读取浏览器标题、cookie、Authorization、referrer、User-Agent、私人路径或查询参数。未知字段、非规范地址、私有页面均拒绝；没有配置不发送 Google。

## 可信转化与幂等

`recordConversion(env, event)` 只供可信插件调用，没有公共转化上报 API。注册由 Better Auth 成功创建账号后触发；激活由 Host 持久化完成 AI 回合后触发，每账号首次完成仅计一次，创建、排队、失败及取消不计入。结账由支付服务成功创建 checkout 后触发；purchase 仅由验签、确认付款并写入可信状态后的 webhook 触发，金额来自支付服务实收信息，不能用展示价格替代。开始结账可没有金额，purchase 必须提供实收 `value`、`currency` 和公开 `itemId`。

使用现有 D1 的附加表 `dsh_analytics_conversions` / `dsh_analytics_daily`。业务去重键按事件类型计算 SHA-256；不存原始账号/订单标识，不建立跨事件访客画像。单个 D1 batch 原子提交唯一回执和日汇总；并发/重放仅计一次，金额冲突拒绝。回执长期保留用于防止旧 webhook 重放，存储量随可信业务事件增长；不按页面浏览建立 D1 事件行。DO 对已记激活保留内存完成标记，避免每个后续回合重复写 D1，重启后仍由持久去重兜底。

Google 每事件使用新的随机数字点分 `client_id`，purchase 使用随机回执作为 `transaction_id`，不发送用户、会话、工作区或订单标识。广告用户数据与个性化均拒绝。固定目标 `https://www.google-analytics.com/mp/collect`，不跟随重定向、3 秒超时、至多尝试一次；超时或不明结果不自动重发，本地计数仍保留。HTTP 2xx 仅代表传输接受，不证明进入 Google 报表。所有统计失败均不得影响账号、AI 或支付结果。

`GET /api/site-analytics/conversions` 需要真实登录且属于 `SITE_ADMIN_USER_IDS`，只返回最近 30 个 UTC 日期的聚合计数/收入，禁止跨源和额外查询参数，响应 private/no-store。普通账号和匿名请求不能读取。现有全局 Google Analytics 编辑器展示该汇总及刷新操作。

## 官方复用与验证

固定版本官方 `product-analytics` 面向 Desktop Host 遥测，没有上述站点/商户/管理员契约，无法在保持行为的同时挂载或派生；故实现独立 custom 插件，不复制官方源码。客户端设置沿用官方组件。

`node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-google-analytics/tests/*.test.ts` 验证真实处理器、SQLite 原子去重、并发重放、支付金额要求、载荷隐私、授权和失败关闭。客户端浏览器测试及 Host contract 分别验证同意和可信完成时点。测试全部拦截网络，不向 Google 属性发送事件，不宣称真实报表已验收。

参考：[Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4)、[官方事件契约](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events)。
