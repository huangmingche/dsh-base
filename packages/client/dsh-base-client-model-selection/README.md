# 官方模型选择兼容适配

源于固定子模块 `@deepseek-ai/dsh-client-ui-model-selection`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`；MIT 原始许可证见 `LICENSE`。官方界面无逐模型不可用状态，因此保留完整官方菜单和交互，仅适配 Host 目录的 `unavailable` / `unavailableReason`。

不可用模型保留可见并禁用。菜单的鼠标、Enter/Tab 和最终 effort 提交均校验最新目录；共享 `ModelDirectory.select` 还阻断 `/model`、过期选项及未知模型，返回 `session/model-unavailable`，不发出选择 RPC。`routable` 排除不可用模型。`/model` 选项将本地化不可用原因交给 `@dsh-base/client-commands` 的官方命令弹窗 fork，以禁用行显示。

`node apps/web/tests/parity/run-model-keyboard.mjs` 检查中英文 Enter/Tab 及共享目录拒绝路径；`node apps/web/tests/parity/run-commands.mjs` 对照原官方命令弹窗并检查鼠标/键盘禁用行为。每次升级固定版本均需复核 fork；不宣称整个应用完全等价。

Effort 依据真实 Host 目录：已接入的 DeepSeek 支持 off、low、high、max 和默认 high，选择通过 Host 持久化并传入执行请求。其他未声明能力的 Host 仍由 `reasoning.unavailable` 保留官方行并显示八语言禁用说明，菜单打开后能力撤回也不能提交。`node apps/web/tests/parity/run-model-effort.mjs` 对比原官方组件可用状态，并验证不可用状态、撤回及真实选择参数。该状态是服务能力差异，不是 Workers 无法支持推理强度。

模型目录按官方 SessionBinding 分别缓存，由 session-adapter 的 `sessionModelCatalog` Host 接缝读取该会话的账号/会话有效插件选择，不用全局当前会话猜测。原有 provider、settings、credentials 事件和连接重置刷新所有仍被保留的会话目录；刷新时撤回旧可用性，失败不回退账号目录，已释放 scope 的迟到响应不能写回。账号设置继续使用官方零参数目录；所有视觉组件不变。
