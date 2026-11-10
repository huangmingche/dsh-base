# Waffo Pancake 支付

本 Worker DSH 插件提供登录用户的 Waffo Pancake 收银台、真实托管客户门户、本人订单查询及原始签名 webhook。固定使用 MIT 官方 SDK `@waffo/pancake-ts@0.28.0`，在应用现有 Workers `nodejs_compat` 下运行。为现有 `AUTH_DB` 增加五张表（checkout、订单、回执、分析同意与转化 outbox），不引入额外数据库、队列、定时任务、容器或常驻服务。

已检查固定版本 DSH 的 account controller、DeepSeek account 和 settings account 包：它们提供 DeepSeek Platform 账单，不具备商户收银台契约，无法仅通过 Host 适配获得本能力。官方账号 UI 保持原状，复用决策记录在包元数据中。

## 配置

先将本包 `schema.sql` 应用到 `AUTH_DB`。以下值仅从服务端绑定读取；凭据不得进入客户端或可序列化插件配置。

| 绑定 | 含义 |
| --- | --- |
| `WAFFO_ENABLED` | 必须明确设为 `true`，其他值均关闭支付 |
| `WAFFO_ENVIRONMENT` | 必填 `test` 或 `prod`，须与商户密钥环境一致 |
| `WAFFO_MERCHANT_ID` | `MER_` 加 22 位字母数字商户 ID |
| `WAFFO_PRIVATE_KEY` | 商户 RSA 私钥 secret |
| `WAFFO_STORE_ID` | `STO_` 加 22 位字母数字店铺 ID |
| `WAFFO_PLANS_JSON` | 非空服务端套餐白名单，示例见下 |
| `AUTH_BASE_URL` | 规范 HTTPS origin；本地回环可用 HTTP |
| `AUTH_DB` | 已应用支付 schema 的现有 D1 |

```json
[{"id":"pro","name":"Pro","productId":"PROD_1234567890abcdefghijkl","type":"subscription","currency":"USD"}]
```

示例产品 ID 必须替换为真实值。`type` 为 `subscription` 或 `one_time`，`name` 与 `description` 可选。实际价格在 Waffo Pancake 配置；可选 `price:{amount:"19.00",interval:"month",intervalCount:1}` 声明主货币单位展示价格。这是部署声明，并非供应商实时报价。订阅展示价必须明确 day/week/month/year 周期及 1–120 的周期数量，单次价格不得包含周期。解析器校验币种小数精度，避免显示时静默舍入；缺少价格保持未知。`ENTITLEMENTS_FEATURES_JSON` 的 `{id,label?,planIds}` 映射是公开权益说明的唯一来源。客户端不可指定价格、产品 ID、用户身份、任意 metadata 或返回站点。`ready` 仅表示本地配置有效，不代表已验证商户、发布产品或 D1 schema。

在 Waffo Pancake 为 `/api/webhooks/waffo` 配置 **Raw** webhook，订阅订单完成、订阅激活/支付/续费/恢复/变更/取消/逾期及退款成功/失败事件。SDK 使用明确环境的公钥验证原始 UTF-8 正文，允许过去 45 分钟、未来 1 分钟的签名时间偏差，以兼容 Waffo Pancake 重试；持久化回执负责防重放。无需另设 webhook secret，本版不提供生产公钥覆盖配置。

## HTTP 与服务契约

响应均为 `Cache-Control: no-store`，运行错误不泄露供应商正文或凭据。

| 接口 | 契约 |
| --- | --- |
| `GET /api/payments` | `{provider:'waffo',ready,plans,priceSource:'deployment'}`；关闭时仍展示明确声明的套餐，但购买禁用 |
| `POST /api/payments/checkout` | 登录、同源 JSON `{planId,returnPath?,locale?,analyticsConsent?,analyticsCampaign?}`，附 16–128 位字母数字/下划线/连字符 `Idempotency-Key`；返回 `{id,url}` |
| `POST /api/payments/portal` | 登录、同源 JSON `{}`；返回 SDK 真实登录门户 `{url}` |
| `GET /api/payments/account` | 本人最近 100 条订单及 `portalAvailable` |
| `POST /api/webhooks/waffo` | 公开签名原始正文，完成持久化后返回 `{received:true,result}` |

订单为 `{id,planId,type,status,periodEnd,refunded,entitled}`。可信插件可调用 `ctx.payments.account(env,userId)`，调用方必须从认证上下文获得用户 ID；`ctx.payments.ready(env)` 检查配置。权益伴随插件检查明确配置的受保护操作；本包不计量用量或积分。

结账分析同意默认 false，独立于订单保存。同一购买意图重试可撤回同意，不能把原先拒绝升级为同意。`begin_checkout` 只在成功获得托管会话后记录，不伪造 SDK 未提供的金额。`purchase` 仅采用已验签 `order.completed` / `subscription.payment_succeeded` 事件中的 `chargedAmount` 主货币金额、`currency` 和 `paymentId`，再与服务端查询的订单、店铺、环境及唯一成功付款核对；订阅还要求付款属于当前周期，且付款未退款。缺少金额或信息不匹配时不记录购买，明确的零金额可以记录，价格快照不作为实际收入。转化 outbox 与已验签 webhook 回执在同一事务提交，实际付款 ID 去重且续费分开计算。分析服务暂不可用后，经过验证的重复投递可继续处理待记录转化。试用不产生虚构收入；分析失败不撤销已提交的权益。分析仅继承本地 checkout 同意和活动标签，不信任 webhook 的同意字段，也不发送供应商链接或私人账号信息。

收银台身份使用稳定本地用户 ID。调用供应商前持久化本人幂等声明，重试复用同一引用，参数冲突返回 409。超过 23 小时的旧键被拒绝，避免 Waffo Pancake 24 小时缓存过期后重复操作；有意新购需换新键。收银台会话一小时过期，旧键重试不会创建新购买。包含 token 的收银台/门户链接仅返回给当前登录者，不保存到 D1，只接受 HTTPS `pancake.waffo.ai`。

## 状态与失败处理

已知 webhook 通过商户签名的只读 GraphQL 查询当前订单，再核验本地 checkout 引用、所有者、产品/币种/类型白名单、店铺和环境。浏览器支付返回不授予权限。其他销售来源的事件不能创建本地权益。门户换套餐必须核验新订单的来源以及原订单的真实替代反向关联，已替代状态不会被迟到事件清除。

D1 从主库开始读取。先读订单 revision，再查询供应商；比较更新与事件回执处于同一事务，避免并发旧结果覆盖。冲突、GraphQL/网络/D1 错误返回非 2xx，不虚假记录完成，供应商重试会重新读取当前状态。回执跨 isolate 和重启保留，未解决重放及业务保留要求前不可随意清理。

单次权益需要已完成订单和未退款的成功付款。订阅权益需要 active/trialing/canceling 状态、未来的明确周期结束日期，以及当前周期成功付款（或明确 trialing 状态）；canceled/expired/closed/未知/past_due 不授予权限。退款撤销其对应周期，历史退款不会抹去随后已付款的续费。本模板保守处理当前周期任意 `refunded` 状态，不计算部分退款余额；pending 退款的付款不用于授予权限。退款后的订阅依然保留门户，以管理尚未取消的订阅。

这是最近成功处理事件的本地状态投影，不是持续轮询供应商。所有事件丢失时，需重放经过验证的事件才能刷新；已知周期到期仍会在每次读取时生效。不提供自动对账定时器、发起退款 API、跨供应商迁移或业务配额。通常每个已处理事件产生一次供应商查询及 D1 读写，套餐替代可能再查询一次原订单。

## 验证与来源

在仓库根运行 `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-payment-waffo/tests/*.test.ts` 和 `node --test packages/cloudflare-worker/dsh-base-cloudflare-worker-payment-waffo/tests/runtime.test.mjs`。使用临时 RSA 密钥、供应商 fixture 和本地 workerd/D1，不产生真实扣款或商户请求。生产启用前仍须在商户沙箱验证当前 GraphQL schema、门户、收银台及真实投递签名。

已阅读购买的 TanStarter 支付实现、对账回归及其接受的实现决策作为行为参考。本包源码和测试为独立编写，未复制商业模板源码或 UI；本包 MIT 标签不改变商业模板许可。参考路径为购买模板中的 `src/payment/provider/waffo.ts`、`src/payment/waffo-query.ts`、`tests/unit/payment/waffo-reconciliation.test.ts`、`docs/others/implementation-decisions.md`。

主要实现依据：[Waffo Pancake SDK](https://github.com/waffo-com/waffo-pancake-sdk-ts)、[webhook 指南](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/webhook-guide.md)、[GraphQL 指南](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/graphql-guide.md)、[Workers Node crypto 支持](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)。

本次套餐和登录后续购流程另参考购买模板提交 `b101976ed1aa6d4fd39ca5a1e7f0b95a7c4777d7` 的 `src/components/pricing/pricing-card.tsx`、`src/components/pricing/create-checkout-button.tsx` 和 `src/config/payment.ts`。这是行为参考，未复制源代码；商业许可保留于原模板，详细来源列在 `dshBase.reference`。
