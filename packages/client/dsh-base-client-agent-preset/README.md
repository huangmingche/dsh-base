# @dsh-base/client-agent-preset

完整、标记的官方 `@deepseek-ai/dsh-client-ui-agent-preset` fork（pinned `dsh-v0.2.2-rc.1`，commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，MIT）。

- 保留官方全部 controllers/components：真实 `load()`、introduce 动画、refusal Toast/dismissRefusal、main=false 处理、Coding Tools 菜单 effect、官方 guides、官方 CSS 与 locale；
- 仅适配 Host availability：
  - 新增独立的 `unavailable` 行状态表达平台限制，绝不复用官方 `broken` 错误状态；
  - `presetOptions` 保留 unavailable 行，不再在 composer 隐藏官方模式；
  - 官方 `AgentPresetSeat` 菜单项按 `unavailable`/`broken` 设为 disabled，description 展示本地化缺口，`onSelect` 防绕过；
  - `seat-store.select` 对 unavailable/broken id 返回 refused；
  - `AgentPresetSection` 将平台不可用卡片渲染为中性灰 + 本地化徽标/原因，不使用 `role=alert`；真实加载失败仍保留官方红色 broken 卡片；
  - 四份官方声明与指南仍可读；只有Cloudflare Think 模式 行（无官方声明）禁用 View；
  - Cordis unavailable/broken 时 Creator 入口保持可见但禁用；
  - Add-plugin 菜单的 Creator 入口使用同一 guard。
- 官方原 row 在 composition 中保留为 disabled inventory；本 fork 以 `replaces` 激活，真实 origin 为 custom。
- 声明只读来源是 pinned `@deepseek-ai/dsh-web-app/presets/*.patch.yml`，构建检查生成并校验。

验证：`node apps/web/tests/parity/run-host-capabilities.mjs`、`node apps/web/tests/parity/run-settings-navigation.mjs` 与本地完整 UI acceptance。
