# @dsh-base/agent-presets

本部署的 canonical Agent preset 身份：`dsh-base-think`（实际固定运行的 Think 组合）与官方 `standard`/`ptc`/`minimal`/`cordis`（保留官方含义，不别名到 Think）。

- 客户端、Worker、Think 与文档共用同一常量，避免字面量漂移；
- 官方 id 永远不等于固定运行时；显式使用官方 id 创建会话会被拒绝；
- 历史会话投影统一为 canonical `dsh-base-think`；
- 官方四模式的声明文案由 client 插件从 pinned 子模块的 `@deepseek-ai/dsh-web-app/presets/*.patch.yml` 生成，本包不复制官方声明。

## Availability copy

`./availability` 导出固定 `dsh-base-think` 组合与四个平台不可用官方模式的中性徽标/原因、读取/选择/Creator 文案。它是标记 `@dsh-base/client-agent-preset` fork 与 session adapter 的数据来源，不注册 slot、不渲染任何 UI。
