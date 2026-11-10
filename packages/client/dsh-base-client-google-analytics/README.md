# Google Analytics 与转化同意

独立 DSH 客户端插件。公开页面浏览统计与转化统计分别配置，默认均关闭。生产环境先读取同源 `/api/public-pages` 的已发布页面及实际语言名单；名单不可用时不退回静态页面列表。公开但不收录的页面仍可统计；草稿、未发布语言、登录、工作区和会话地址不采集。Worker 再次校验页面，前端名单不能扩大权限。

启用公开页面统计并确认服务器就绪后，只向 `/api/site-analytics/google` 提交 `{ path }`。原生导航、回退及语言切换仍按官方行为执行，同一路径的状态或片段变化不重复计数。查询参数、浏览器标题、referrer、账号、Session/Workspace ID 和凭据不进入负载。请求不带 cookie 或 Referer；进入私有页面、停用或卸载时取消在途事件，失败不重试。

转化模式由管理员在统一站点文档中设置：`analytics.conversions.mode` 为 `off`、`aggregate` 或 `google`。`aggregate` 只使用第一方每日计数。`google` 也不会自动获得用户同意；用户在官方「设置 → 通用」插槽里的原版 Switch 明确开启后，当前标签页的注册、开始结账及已验证付款才可由服务端发送 Google 事件。未配置时该控件保留禁用状态及本地化说明。授权只保存在插件内存，撤销、刷新或卸载即重置，不写 cookie/localStorage/sessionStorage，不创建持久访客身份。后台首次完成 AI 回合只在服务器汇总，不继承浏览器授权。

`conversionConsentSnapshot()` 和 `conversionConsentHeaders()` 是账号/支付插件的最小契约。只有同意后，唯一的 `utm_campaign` 值且匹配管理员 `analytics.conversions.campaigns` 白名单时才保留活动标签；不保存完整 URL、其他查询参数或 referrer。支付插件在结账时保存本次明确同意，可信 webhook 据此归因该付款；浏览器没有提交 `purchase` 的入口。原始账号和订单 ID 不进入 Google。

固定版本官方 `product-analytics` 面向 Desktop RPC，包含账号与 Session 上下文，没有网站 GA4 或转化同意实现可挂载/派生。本插件复用官方 General 插槽、Switch 和字段样式，不改变官方导航，不注入 gtag 或第三方跟踪脚本。复用决策与源码入口在 `package.json`。Measurement Protocol 每条事件使用新随机标识，因此不宣称完整用户级归因或 Google 报表验证。参阅 [Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4)。

验证：`node --test packages/client/dsh-base-client-google-analytics/tests/*.test.mjs`。覆盖配置、发布名单、导航、去重、同意撤销及生命周期；实际 Chromium 在中英、明暗、桌面/窄屏八种组合对比原版 Switch 像素与键盘行为，检查无存储标识和第三方请求。全部网络事件在本地拦截，不向真实 Google 属性发事件。

公开页面子组合仅要求 `siteConfig`；官方 slots/locale 服务为可选 UI 注入，缺少工作台不妨碍公开页面统计。`siteAnalyticsConsent` 暴露同一内存控制器；`/consent-ui` 的 `PublicConsent` 复用同一字段与官方 Switch，供公开页按配置提供明确同意入口，不自动授权。
