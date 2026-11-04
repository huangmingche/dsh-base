# 官方组件浏览器对照

在仓库根目录运行：

```sh
pnpm acceptance:parity
```

完整命令串行运行 13 个 runner，共 78 个用例：主对照 22、模型键盘 5、插件管理器 4、命令 6、目录/预设 6、账户 4、设置导航 4、侧栏品牌 4、上传 6、强度 4、侧栏引用生命周期 5、多步 Chat 渲染 4、输入框运行时 4。`node apps/web/tests/parity/run.mjs` 只运行其中 22 个主对照用例。完整验收状态以当前命令输出为准；每个 runner 的报告保留在证据目录，不能把全部用例都称为像素对照。

脚本使用应用已安装的 Vite 和 Puppeteer，构建隔离 fixture、启动临时本机 preview、运行 Chromium 后关闭两者。它不访问部署账号、不创建真实任务、不调用模型。所有 runner 使用共享的 macOS/Linux/Windows 浏览器查找器；可通过 `CHROME_PATH` 指定浏览器，`DSH_PARITY_OUTPUT` 指定证据目录；默认输出 `apps/web/dist/parity-evidence/` 中的成对 PNG 和 `report.json`。

参考侧直接渲染固定子模块导出的官方组件；适配侧渲染实际插件注册得到的组件。Schedule 注册经过原样官方 `mountAccess` 服务（受控 owner baseline）、官方 ui-schedule 的 apply 和 Workers Schedule RPC 接缝，验证主页面、侧栏、会话卡片和悬浮项确实全部注册。本 fixture 不模拟生产鉴权；真实 Connection/Gateway、生成的 `$mount`、Host 认证快照和重连由 session-adapter 的 remote-access 回归及完整壳验收验证。数据来自可控 RPC fixture，比较 en/zh 下空白、加载、错误、列表、手动创建，以及已恢复的原样官方权限插件、终端和日志上传的可见禁用态。权限选择使用实际插件注册的组件，以键盘调用返回持久回执的命令 fixture；实际策略执行与跨标签页投影另由 Host 和完整壳验收验证。

每组比较文本、控件、disabled 属性、几何尺寸和相同视口的截图字节。创建交互还检查 Host 拒绝后草稿保留、重试参数不变。终端/日志控件的禁用交互不能触发动作。

**范围限制：** 这是指定组件的视觉与交互契约验证，不是整个应用 100% UI/UX 对齐证明，也不证明真实 Host 支持所有规则。真实鉴权、持久化、会话执行和完整 shell 必须由独立本机/部署验收覆盖。浏览器日期与时区固定；截图前统一焦点以避免背景标签页的焦点差异。

反馈新增六组对照：会话表单、消息表单、点赞/点踩，分别覆盖中英。缺少日志反馈服务时均保留官方表面并禁用，交互不会提交。fixture 使用官方 common 词典处理共享按钮文案。

模型搜索键盘回归：`node apps/web/tests/parity/run-model-keyboard.mjs`。五组用例覆盖中英 Enter/Tab：不可用模型零提交、提示/菜单保留，可用模型每次恰好提交一次；共享目录额外拒绝缺失和过期模型。`run-commands.mjs` 的六组用例覆盖 `/model` 弹出菜单的禁用选项及键盘路径。

`run-plugin-manager.mjs` 的四组用例使用原样官方管理器的不可用态，Add 可见禁用，bundle 目录真实为空；运行时库存独立由官方 Settings 内置插件页展示。`run-host-capabilities.mjs` 的六组中英对照覆盖官方目录浏览器的创建拒绝、草稿保留、参数一致重试与目录选择，以及固定智能体配置的精确 View 禁用；单独官方内置预设参考仍可键盘打开帮助。项目自己的命名默认项属于 Custom，不伪造 Standard 配置。均不与全应用保真或持久 Host 验收混同。

账户账单接缝：`node apps/web/tests/parity/run-account.mjs`（四组中英文用例）。对照原官方 AccountSection 的可见禁用态，验证鼠标、键盘、辅助点击、右键均不能发起账单导航，原官方 AccountMenu 的资料和退出登录交互保持真实。测试执行实际接缝注册并按注册的 locale 绑定词典，防止运行期缺失翻译器。

设置导航集成回归：`node apps/web/tests/parity/run-settings-navigation.mjs`。使用真实 Cordis `SlotRegistry`、完整官方/适配 `apply` 和实际账户/预设接缝，验证原件与影子保留在原始库存，导航及 onboarding 仅投影生效项；账户注销/恢复仍只出现一行。中英文账户与预设共四组，对照官方 SettingsRoot 的文本、导航、几何和截图。这补足仅渲染单个组件无法发现的重复导航问题。

侧栏品牌是已登记的用户批准偏离（2026-11-13）：只占用官方 `sidebar.brand.name` 槽位，侧栏显示代码名 `dsh-base`（各语言一致；产品显示名 `DeepSeek Harness Base` 用于 README/文档）；官方 mark fallback（`FishLogo` 与点击复制版本）、布局、排版与交互全部沿用官方。唯一无法避免的差异是官方 name fallback 内的版本行与点击复制版本随槽位占用一起消失。原 `run-sidebar-brand.mjs` 及其夹具在 Commit 1 删除后未恢复，因此 parity 链不含品牌项。

文件上传：`node apps/web/tests/parity/run-upload.mjs`。中英文真实官方 InputBar/ComposerAttachments 在 Host 图片上限为零时，通过 picker/drop 本地化拒绝图片且不发上传；普通文件入口保持可用。原 FileUploadRuntime 使用真实 Web Worker 和 Connection RPC 对受控 HTTP 测试回执、错误细节、取消、中文深链下的根路径上传。六个协议用例不替代真实 Host/R2 持久化和回执消费测试。

`node apps/web/tests/parity/run-model-effort.mjs` 的四个用例对照固定官方选择器的可用 root/effort 菜单像素，并逐项以键盘选择 off/low/high/max，对照真实请求；同时检查中英文不可用强度入口仍可见且禁用、能力撤回不提交、选择模型不携带 effort。共享目录与 `/model` 选择字段回归合并在 `run-model-keyboard.mjs` 的第 5 个用例中；不是对完整应用的等价声明。

另行运行 `pnpm acceptance:local` 检查构建后的真实 Worker、108 项库存及启用 fiber、公开登录页无私有 RPC/WebSocket；`pnpm acceptance:browser-compat` 的 7 个用例检查真实 PDF/Excel Worker 和中英文注册策略。这两组不计入上述 78 个用例。部署和模型调用仍需独立线上验收。

侧栏会话引用生命周期：`node apps/web/tests/parity/run-sidebar-lifecycle.mjs`。五个用例使用真实官方 `ClientSessions`、`RemoteStream` 和 `SessionReference`：原实现会误报自己的取消；分叉取消不误报且引用仍真实拒绝；切换到新视图保留正确引用；真实 Host 失败仍是官方 error 状态；仍拥有的引用意外失效继续报告。它是生命周期契约回归，不计作像素对照。

线上语义验收还要求一次用户请求只对应一个官方 turn：工具调用和审批续答必须在同一 turn 的后续 step，审批等待期间不能提前完成，工具结果必须先于调用 step 的结束。`acceptance-approval-ui.mjs` 与 `acceptance-official-ui.mjs` 读取真实官方 `session/page`，检查最终页面及刷新后每个 turn 只有一个完成过程，成功原因必须为 completed 且工具结果不能是错误。Pro 回合同时核对实际执行来源为 deepseek-official / provider-reported model，刷新后消息来源不变，模型入口仍显示 Pro。审批后的 sessionStats 及中英文截图底栏必须与真实日志的 turn/step 数量一致。纯断言回归为 `node apps/web/scripts/acceptance-turn-semantics.test.mjs`。这项语义要求不增加上面的离线浏览器用例计数。

`node apps/web/tests/parity/run-chat-step.mjs` 运行 4 个中英文真实官方 AssistantNodeView / TurnProcessNodeView 用例：对照原生逐 step 日志与共享 SDK 投影的像素和内容，验证稳定唯一消息 ID、等待审批时不显示已完成、单 turn 多 step、重复读取与 reload。范围是这两个真实 renderer，不是整个 Chat 壳。

`node apps/web/tests/parity/run-composer-runtime.mjs` 运行 4 个真实官方 InputBar / SessionInputShell / Lexical / selector bridge 的快速键入、粘贴与提交用例。该隔离用例在 React 19 下也通过；它不冒充曾失败的完整桌面壳输入回归，完整壳必须另行验收。
