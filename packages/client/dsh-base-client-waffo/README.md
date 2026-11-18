# Waffo Pancake 支付界面

通过官方 `plugins.bundle.config` 槽位为 `dsh-base:waffo` 提供方案、结账和账单内容。官方插件管理器继续负责页面标题、导航和布局；本插件使用原样官方 `Button` 与导出的设置字段样式，不注册设置页，不改动 DeepSeek Platform 的账号、余额或充值入口。固定版本官方 DSH 没有 Waffo Pancake SaaS 支付界面，因此使用独立的本地插件。商业模板仅作为流程参考，本包没有复制模板或官方源码。

公开读取 `GET /api/payments` 与登录状态；仅在支付已配置且登录真实有效时读取 `GET /api/payments/account`。游客操作打开现有登录流程。购买意图在当前标签的 sessionStorage 保留最多 30 分钟，登录后核验真实会话再恢复；意图包含套餐 ID、同一本地返回路径、语言和 UUID 幂等键，已绑定用户不能换账号恢复，网络重试保留同一键。最终价格由 Waffo Pancake 托管页面显示，返回地址不授予权益。账单管理仅使用服务端提供的真实入口。跳转只允许 `https://pancake.waffo.ai`，拒绝用户信息和非默认端口，并保留提供方的签名片段。401 清除私有账单状态，卸载中止请求。

支持官方八种语言，配置缺失、加载失败、退款、权益无效均有明确状态。本次验证没有发起真实付款。

检查：`node --experimental-strip-types --test packages/client/dsh-base-client-waffo/tests/*.test.ts`，`node --test packages/client/dsh-base-client-waffo/tests/*.test.mjs`。覆盖真实槽位注册、官方控件渲染对比、匿名/停用请求隔离、类型边界、跳转域名、幂等重试与请求生命周期。

本插件通过 `publicPluginConfigurations` 兼容服务按生命周期登记自己的公开 bundle 配置入口；匿名用户可查看状态，账号和管理员动作仍由面板与服务端鉴权。卸载插件会注销入口，不开放组件级私有配置。

浏览器检查：`node packages/client/dsh-base-client-waffo/tests/payment-panel-browser.mjs`。在实际支付面板上，用中英文、明暗主题、桌面和窄屏的八种组合对比官方按钮几何和样式，并完整执行游客选购、登录与同一意图恢复；供应商目的页由本地 fixture 截获，不产生真实付款。证据写入 `.artifacts/waffo-payment-panel-browser/`。

本次套餐和登录后续购流程另参考购买模板提交 `b101976ed1aa6d4fd39ca5a1e7f0b95a7c4777d7` 的 `src/components/pricing/pricing-card.tsx`、`src/components/pricing/create-checkout-button.tsx` 和 `src/config/payment.ts`。这是行为参考，未复制源代码；商业许可保留于原模板，详细来源列在 `dshBase.reference`。
