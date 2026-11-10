# SaaS 插件

简体中文 | [English](saas-plugins.en.md)

对应用户选择的 1–8、14–18、28，共 14 个逻辑插件包、28 个运行时组件。每包分别包含一个 Client 插件和一个 Worker 插件。生产成员由包元数据生成；`packs/` 只分组，不决定加载成员。界面使用官方 `plugins.bundle.config` 槽位、Button、Input、Modal 和主题样式，不替换官方设置页或 DeepSeek Platform 账单。

| 编号 | 插件包 | 实现与权限 |
| --- | --- | --- |
| 1 | Dsh-base Waffo Pancake 支付 | 托管结账、签名门户、订单/订阅及退款状态同步；原始签名 webhook、D1 幂等和权属核验。本人看订单，管理员看汇总。 |
| 2 | Dsh-base 邮件 | Cloudflare Email / Resend；验邮、重置密码、订阅确认和支持消息。没有公开任意收件人发信 API。 |
| 3 | Dsh-base Google 登录 | Better Auth 官方 Google OAuth，绑定部署回调域；关闭自动跨账号合并。未配置保持不可用。 |
| 4 | Dsh-base 账号资料 | 名称、本人 R2 图片头像、修改密码并撤销其他会话。名称单独保存保留现有头像。 |
| 5 | Dsh-base 用户管理 | 分页查找用户、封禁/解禁、角色标记、撤销会话。真正管理权限只由 `SITE_ADMIN_USER_IDS` 授予。 |
| 6 | Dsh-base API 密钥 | 本人创建、列表和撤销；原始密钥仅创建时返回一次，数据库存摘要，含过期、速率限制和 `profile:read` 权限。不会替代浏览器会话。 |
| 7 | Dsh-base 套餐权限 | Worker `entitlements.authorize` 按已核验的 Waffo Pancake 订单授权，缺配置/失效/退款时拒绝。业务插件必须在自己的服务端调用它；不能只依赖按钮隐藏。 |
| 8 | Cloudflare 文件 | 复用现有 R2，上传、分页、本人下载/删除、受限图片预览。每文件 10 MiB，每账号 100 MiB / 200 项，D1 原子配额预留。 |
| 14 | Dsh-base 邮件订阅 | Resend 联系人、waitlist 邮箱确认、本人订阅状态与退订。公开提交需明确同意和 Turnstile 服务端验证。 |
| 15 | Dsh-base 联系支持 | 验证后发送至部署指定的支持邮箱，HTML 转义、大小限制、D1 限流和幂等。 |
| 16 | Dsh-base 业务通知 | 支付事务内写入通知 outbox，Discord / 飞书按需投递；不确定投递须管理员明确审核后重试。没有公开消息转发接口。 |
| 17 | Dsh-base Crisp 客服 | 配置后点击才加载 Crisp；卸载清理界面状态，不自动向第三方发送账号身份。 |
| 18 | Cloudflare KV 缓存 | 有界 TTL、`public:` 命名空间、管理员清理单项。仅缓存可失效的公开数据，禁止用于会话、支付、权限判断或私有数据。 |
| 28 | Dsh-base 运营概览 | 管理员查看 D1 真实账号、订单、订阅、退款和邮件状态计数。缺表标记不可用，不使用模板演示图表或混加币种金额。 |

包名中的 `cloudflare-worker-` 表示运行平面。显示名称按能力来源区分：自有 SaaS 业务使用 Dsh-base，明确依赖 Cloudflare R2/KV 的文件与缓存使用 Cloudflare；不会把 Waffo Pancake 或 Resend 标成 Cloudflare 产品。

## 配置来源

新增 SaaS 特性开关和供应商非秘密设置统一位于 `apps/web/deployment.local.json` 的 `saas` 对象；`DSH_SAAS_JSON` 可整体覆盖。键名见 `apps/web/deployment.example.json`。未知字段会拒绝，不能在此保存密钥。Client 只读取各服务的安全状态投影，不保存第二份部署配置。认证域、管理员 ID、D1/R2 绑定仍使用现有部署顶层配置。

外部供应商默认关闭。账号资料、用户管理、API 密钥、文件及运营概览依赖现有认证、D1、R2；管理操作仍要求本站管理员 ID。启用 KV 必须明确指定现有 namespace ID，不会自动创建常驻服务。

| 功能 | 非秘密配置 | Worker Secrets |
| --- | --- | --- |
| 账号功能 | `userAdminEnabled`、`apiKeysEnabled`、`filesEnabled`，默认开启 | 无新增 |
| Waffo Pancake | `waffoEnabled`、`waffoEnvironment`（test/prod）、`waffoStoreId`、`waffoPlans` | `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` |
| 邮件 | `emailEnabled`、`emailProvider`、`emailFrom`；Cloudflare 另填 `emailCloudflareAccountId` | `EMAIL_CLOUDFLARE_API_TOKEN` 或 `RESEND_API_KEY` |
| 验邮 | `emailVerificationRequired` | 复用邮件供应商；邮件不可用时不绕过必需验证 |
| Google | `googleEnabled`、`googleClientId`；OAuth 回调为 `AUTH_BASE_URL/api/auth/callback/google` | `GOOGLE_CLIENT_SECRET` |
| 套餐 | `entitlementFeatures: [{id,planIds}]`，引用 `waffoPlans` 的 ID | 无新增 |
| 订阅/联系 | `newsletterEnabled`、`contactEnabled`、`contactSupportEmail`、`turnstileSiteKey` | `TURNSTILE_SECRET_KEY`；订阅另需 `RESEND_API_KEY` |
| 通知 | `notificationsEnabled` | `DISCORD_WEBHOOK_URL`、`FEISHU_WEBHOOK_URL`，可配置其中一个 |
| Crisp | `crispEnabled`、`crispWebsiteId` | 无；website ID 是公开标识 |
| KV | `cacheEnabled`、`cacheNamespaceId` | 无 |

Waffo Pancake plan 只允许服务器登记的 `{id,name?,productId,type,currency}`，不能由浏览器提供金额、商户或产品。真实收银台沙箱及当前供应商 GraphQL 返回结构仍需用商户账号验证；本地签名夹具不是一次真实付款。邮件接受请求也不等于邮件到达收件箱。

## 数据与部署

新增持久化表的插件在自己的 `schema.sql` 中拥有表结构；`pnpm --dir apps/web schema:plugins` 读取插件清单并应用可重复执行的新增表/索引。Better Auth 管理字段和订阅恢复版本字段先查列再新增，不重复执行 ALTER，也不覆盖已有字段。部署脚本在发布 Worker 前执行该步骤；本地 `serve-local.mjs` 使用同一清单。

共用现有 D1、R2；只有启用 KV 才绑定 KV。没有 Containers、VM、轮询队列或新增常驻计算。通知在 webhook 请求或管理员重试时处理，支付成功不依赖通知发送结果。启用通知前必须应用 outbox 表；缺表会使 webhook 原子事务失败并等待重试。供应商凭据永不放入客户端、包配置、日志或公开清单。

订阅确认或退订请求结果不确定时，管理员可在插件面板恢复：核实原请求已结束，等待至少 60 秒，读取 Resend 真实状态后通过版本校验解锁，不盲目重发联系人写入。

## 验收范围

`check:saas` 覆盖本地真实 workerd、D1/R2/KV、多用户权限、并发预留、签名/幂等、邮件确认及外部服务异常；供应商网络由受控夹具替代。`acceptance:saas` 对照官方组件并检查新面板交互。完整仓库检查仍执行来源、导出、组合、分组、运行平面及严格类型守卫。

新 SaaS 业务在官方 DSH 没有对应实现，因此以自有插件新增到官方槽位，复用决定登记在各包 `dshBase.reuse`。用户购买的模板用于核对业务范围；本轮独立实现未把它的 UI 或商业源码误标成官方 DSH fork。供应商 SDK 和库的许可证由第三方声明生成器记录。
