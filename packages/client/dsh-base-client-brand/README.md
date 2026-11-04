# 官方侧栏品牌显示文字接缝

官方 brand 插件只在 `DSH_CLIENT_BUILD_PROFILE === 'official'` 时注册槽位；非 official 构建下 `apply()` 直接返回，侧栏因此走官方 `SidebarRoot` 的 fallback。本包只占用官方公共槽位 `sidebar.brand.name`，返回纯 `<span>dsh-base</span>`，使产品名在各语言中一致。

mark 槽位不注册：继续显示官方 fallback（`FishLogo size=24`，存在 `DSH_CLIENT_VERSION` 时外面再包一层点击复制版本）。不写 CSS、不修改布局、排版或交互，`<span>` 直接继承官方排版。

用户明确批准（2026-11-13）：侧栏显示代码名 `dsh-base`，各语言一致；产品显示名 `DeepSeek Harness Base` 用于 README 与文档，不进入侧栏。唯一无法避免的差异是官方 name fallback 内部同时渲染「本机构建名称 + 版本行 + 点击复制版本」，占用 name 槽位后这段 fallback 不再渲染，所以名称行不再有版本；设置页的当前版本行与 mark 上的点击复制版本不受影响。`dshBase.reuse` 记录该 no-op 事实、用户批准差异与缺口；官方 brand 插件保持官方默认 enabled（no-op），既不标 disabled，也不声明 replaces。

浏览器验收：`node apps/web/scripts/acceptance-local-ui.mjs` 断言侧栏品牌为 `dsh-base`（各语言一致）；部署后可用 `node apps/web/scripts/acceptance-sidebar-brand.mjs` 复核中英文品牌、官方 mark fallback 与侧栏结构。
