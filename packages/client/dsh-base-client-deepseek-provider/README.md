# @dsh-base/client-deepseek-provider

组合范围：默认应用只在登录后加载工作台。以下未登录分支属于组件或 Host 的独立契约，仅在隔离测试中使用。

pinned 官方 `@deepseek-ai/dsh-client-ui-settings-models` 的完整标记 fork。原
DeepSeek 提供商、密钥、endpoint 与模型目录编辑/语义保持官方实现；fork 增加独立、
运营者管理的 Cloudflare AI Gateway provider 行，通过官方 provider-card 显示状态，
避免落入桌面未知 namespace 的 YAML 编辑提示。Gateway 由独立插件贡献。
DeepSeek 的 `apiKeyEnv`、`baseURL` 和模型目录均写回真实 Host 执行：选择显式
`deepseek-official/<model>` 时，Host 解析 owner 配置并注入 direct provider；
本部署执行 OpenAI-compatible Chat Completions，因此 UI 协议提示同步为
OpenAI-compatible，而不是 Anthropic。Gateway 配置/凭据永不参与该 direct 路由。

## 匿名浏览

稳定 `/client` 入口导出 `ModelsSection`、`ModelsSectionController`、`createSettingsSchemaOperations` 和相关类型。默认 `presentation: 'auto'` 保留原来的账号视图与操作。

Host 可通过 `presentation: 'public-declarations'` 传入只含公开提供商声明的本地快照；页面沿用官方提供商卡片、只读表单、自定义设置展开区和“添加模型提供商”按钮。声明行无需设置 `configured: true`，该标志仍只表达原来的配置事实；公开展示始终强制只读。Host 不应提供或猜测所有者的凭据、可用性、私有设置或自定义模型。

可选 `onRequestAccess` 让原“添加模型提供商”按钮请求登录并立即返回，不把匿名快照标成可写，也不打开私有写入流程。展开、收起与取消仍使用原组件的本地交互。Host 的操作回调还须独立拒绝未授权调用，不能仅依赖界面置灰。

控制器合同只包含组件实际消费的 `store` 与 `load`；匿名 Host 可以提供本地声明快照，无需构造会读取私有设置及凭据的 `ModelsSettingsStore`。公共默认配置来自共享声明来源，不复制所有者的 user layer。Gateway 未登录状态由独立提供商插件表达，不把未知配置误报为已启用或已停用。

## 来源与验证

唯一上游来源为固定子模块 `packages/client/ui-settings-models`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，许可证 MIT。完整保留 `src/`、`locale/` 和许可证，原 CSS 与编辑器源码保持不变。

[host-adaptations.json](host-adaptations.json) 将既有 Gateway、Loader 和文案差分记在 `baselineChanges`，本轮公开展示合同记在 `changes`。运行 `node --test packages/client/dsh-base-client-deepseek-provider/tests/*.test.mjs`，反向应用差分后按字节核对全部源码和资源。应用验收另外比较官方组件的实际渲染与交互；新增参数不意味着平台计费、任意提供商或匿名模型调用已实现。
