# @dsh-base/client-deepseek-provider

pinned 官方 `@deepseek-ai/dsh-client-ui-settings-models` 的完整标记 fork。原
DeepSeek 提供商、密钥、endpoint 与模型目录编辑/语义保持官方实现；fork 仅增加独立、
运营者管理的 Cloudflare AI Gateway provider 行，通过官方 provider-card 显示状态，
避免落入桌面未知 namespace 的 YAML 编辑提示。Gateway 由独立插件贡献。
DeepSeek 的 `apiKeyEnv`、`baseURL` 和模型目录均写回真实 Host 执行：选择显式
`deepseek-official/<model>` 时，Host 解析 owner 配置并注入 direct provider；
本部署执行 OpenAI-compatible Chat Completions，因此 UI 协议提示同步为
OpenAI-compatible，而不是 Anthropic。Gateway 配置/凭据永不参与该 direct 路由。
