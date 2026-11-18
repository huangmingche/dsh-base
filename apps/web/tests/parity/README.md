# 官方组件浏览器对照

`run-anonymous-sidebar.mjs` 对照固定版本官方与标记分叉的侧栏、顶部 More 和工作区空态，覆盖中英、明暗主题及展开、收起、移动端抽屉，共 12 组。侧栏和 More 通过真实 SlotRegistry 注册，工作区复用官方 viewing store；签入状态的布局、图标、文案、样式、像素及点击动作必须一致。截图前仅清除两侧焦点和 hover，避免抽屉初始聚焦产生暂态 Tooltip；不屏蔽产品区域或放宽像素比较。真实匿名组合另由 `node apps/web/scripts/acceptance-anonymous-sidebar.mjs` 验证：8 语言三种侧栏形态、额外中英暗色、可点击入口、插件与任务公开浏览、指针及快捷键触发共享登录弹窗、顶部两个官方菜单项、底部设置/登录、Hero 工作区登录门控、菜单焦点归还与嵌套弹层 Escape、公开页完整登录返回地址，以及匿名壳内 popstate 后 22 秒的地址保留。直接打开受保护的 agent 文档仍须跳转登录，返回参数只包含服务器可见的路径和查询；浏览器保留片段。浏览器必须零私有 API、零私有 WebSocket、零 401；独立直接请求继续要求 401。默认使用本地构建，显式设置 `DSH_BASE_URL` 可检查 Staging，使用独立匿名浏览器，不读写账号偏好。匿名公开浏览及操作时登录是用户明确要求并登记的 Host 行为差异；私有 RemoteAccess 没有扩大。

`node apps/web/scripts/acceptance-auth-modal-local.mjs` 使用临时 D1 和真实 Better Auth 验证登录弹窗：桌面/手机明暗主题、官方控件尺寸、焦点约束、关闭/遮罩/Escape、失败与成功登录、用户名和邮箱、关闭与开启注册、返回地址限制及匿名私有接口 401。账号及写入只存在于本机临时环境，不代表部署验证。

`pnpm acceptance:auth-primitives` 直接渲染固定子模块稳定导出的 `Modal`、`Button`、`Input` 作为参考，对照本地账号弹窗实际使用的标题、说明、关闭按钮及表单控件。覆盖中英、明暗主题及桌面/手机视口，比较几何、计算样式、像素及输入框焦点状态；采用一致的软件渲染避免 GPU 栅格噪声，不放宽像素阈值。已纳入 `acceptance:parity`。它证明控件复用，不声称官方提供相同的本地账号流程。

参考控件位于官方 Modal 的相同滚动层中，仅使用空白占位和相对定位匹配自有表单占据的位置，不复制或修改官方样式；聚焦比较逐页激活后读取和截图。真实登录验收另覆盖 390×360 短屏：24px 上下边界、内部滚动、关闭按钮，以及底部继续和创建账号操作的可达性。

在仓库根目录运行：

```sh
pnpm acceptance:parity
```

完整命令串行运行各个 runner；插件管理器用例数以其当前报告为准，其余数量以各 runner 报告为准。`node apps/web/tests/parity/run.mjs` 只运行其中 22 个主对照用例。完整验收状态以当前命令输出为准；每个 runner 的报告保留在证据目录，不能把全部用例都称为像素对照。

脚本使用应用已安装的 Vite 和 Puppeteer，构建隔离 fixture、启动临时本机 preview、运行 Chromium 后关闭两者。它不访问部署账号、不创建真实任务、不调用模型。所有 runner 使用共享的 macOS/Linux/Windows 浏览器查找器；可通过 `CHROME_PATH` 指定浏览器。证据默认输出到 `apps/web/dist/parity-evidence/` 中的成对 PNG 和 JSON 报告。

并行运行支持目录覆盖的脚本时，为每个脚本分别设置独立的绝对 `DSH_PARITY_BUILD_DIR` 和 `DSH_PARITY_OUTPUT`。未支持目录覆盖的脚本保持串行；不能让 preview 读取另一脚本正在重建的目录。只隔离产物与证据，完整保留各脚本的场景及断言。

参考侧直接渲染固定子模块导出的官方组件；适配侧渲染实际插件注册得到的组件。Schedule 注册经过原样官方 `mountAccess` 服务（受控 owner baseline）、参考侧官方 ui-schedule 的 apply、适配侧完整标记 Schedule 分叉的 apply，以及 Workers Schedule RPC 接缝，验证主页面、侧栏、会话卡片和悬浮项确实全部注册。本 fixture 不模拟生产鉴权；真实 Connection/Gateway、生成的 `$mount`、Host 认证快照和重连由 session-adapter 的 remote-access 回归及完整壳验收验证。数据来自可控 RPC fixture，比较 en/zh 下空白、加载、错误、列表、手动创建，以及已恢复的原样官方权限插件、终端和日志上传的可见禁用态。权限选择使用实际插件注册的组件，以键盘调用返回持久回执的命令 fixture；实际策略执行与跨标签页投影另由 Host 和完整壳验收验证。

每组比较文本、控件、disabled 属性、几何尺寸和相同视口的截图字节。截图前统一走 `stability.mjs` 的 `settle()`：等待 `document.getAnimations()` 全部结束、双 `requestAnimationFrame` 与一帧静默后再截图；像素不一致时重新 settle 并重试最多 3 次，只有最终仍不一致才判红，每次重试以 `{"parityRetry":{label,attempts}}` 打印，便于发现「总是靠重试才通过」的用例。判据仍是像素完全一致，不放宽阈值。创建交互还检查 Host 拒绝后草稿保留、重试参数不变。终端/日志控件的禁用交互不能触发动作。

**范围限制：** 这是指定组件的视觉与交互契约验证，不是整个应用 100% UI/UX 对齐证明，也不证明真实 Host 支持所有规则。真实鉴权、持久化、会话执行和完整 shell 必须由独立本机/部署验收覆盖。浏览器日期与时区固定；截图前统一焦点以避免背景标签页的焦点差异。

反馈新增六组对照：会话表单、消息表单、点赞/点踩，分别覆盖中英。缺少日志反馈服务时均保留官方表面并禁用，交互不会提交。fixture 使用官方 common 词典处理共享按钮文案。

模型搜索键盘回归：`node apps/web/tests/parity/run-model-keyboard.mjs`。五组用例覆盖中英 Enter/Tab：不可用模型零提交、提示/菜单保留，可用模型每次恰好提交一次；共享目录额外拒绝缺失和过期模型。`run-commands.mjs` 的六组用例覆盖 `/model` 弹出菜单的禁用选项及键盘路径。

`run-gateway-provider-ui.mjs` 用 8 组中英/明暗/1440+720 对照，把恢复的 Gateway provider 行与官方 Models 行的文本、控件、几何和截图对齐，另覆盖加载/错误/错误恢复/不可用/展开中英六种状态的截图；平台路由的真实出词与开关语义由部署侧验收覆盖，不在浏览器 fixture 内。

`run-plugin-manager.mjs` 的参考侧始终渲染锁定官方原组件，适配侧使用真实 Host inventory seam 与标记的 UI fork。独立 oracle 从 pinned 清单、locale 和图标读取18个候选，不读取产品生成目录。用户批准的差异先直接断言：主列表/完整 More 使用与 builtin 相同的 neutral「不可用」Tag，无异常/未安装胶囊和重复 OS 红句；详情保留未安装事实，真实 Worker 验收另检查精确的本地化部署说明。随后只排除这些精确标记的批准元素，对其它文字、图标、控件、几何和所有滚动视口逐像素比较；未遮盖截图另存用于审阅。正常状态、无效 marker、真实平台/请求/操作/元数据/运行失败做**无遮盖**对照，保证真实异常不会被美化成不可用。另有带明确不可用 marker 的运行失败：先断言开关保持禁用，只规范化原版该开关的 disabled 属性，再对照所有异常标签、诊断内容与像素；不遮盖真实错误。18项直接开启均拒绝且零控制写入；3个本地可管理包继续验证关闭/重开。Cloudflare AI Gateway 复用官方单个插件包卡片和两个真实组件详情行；详情与固定版本官方页面进行不遮罩对比。组件开关只读，唯一的插件包开关一次修订同时保存两个成员。真实本地 Worker 验收还检查关闭/开启后的持久化状态和刷新后的客户端 fiber，全程不调用模型。原有4个 Built-in 表单和管理不可用状态仍被覆盖。`acceptance-local-ui.mjs` 验证真实组合中 fork active、原包 disabled、上述目录呈现/详情说明/开关禁用。测试不能作为全应用100%对齐或未适配能力已经可用的声明。

账户账单接缝：`node apps/web/tests/parity/run-account.mjs`（四组中英文用例）。对照原官方 AccountSection 的可见禁用态，验证鼠标、键盘、辅助点击、右键均不能发起账单导航，原官方 AccountMenu 的资料和退出登录交互保持真实。测试执行实际接缝注册并按注册的 locale 绑定词典，防止运行期缺失翻译器。

匿名账号完整布局：`node apps/web/tests/parity/run-anonymous-account.mjs` 覆盖中英、明暗、桌面/手机共 8 组。参考规范使用固定官方 AccountAvatar、CSS 和原子组件，验证用户批准的完整匿名布局，不声称上游存在同样的匿名分支。冻结真实 signed-out/attempt:null 快照；检查身份、余额/赠金未登录文案、三个禁用且无 href 的平台入口及独立本地登录。`run-account.mjs` 另有 36 组默认 auto 状态直接对比官方原件，覆盖未登录、未知、失败、真实授权过程与已登录；保留 4 组账号菜单/账单保护测试。真实 8 语言账号验收及 30 项匿名浏览验收分别约束焦点恢复和零私有请求。

设置导航集成回归：`node apps/web/tests/parity/run-settings-navigation.mjs`。使用真实 Cordis `SlotRegistry`、完整官方/适配 `apply` 和实际账户/预设接缝，验证原件与影子保留在原始库存，导航及 onboarding 仅投影生效项；账户注销/恢复仍只出现一行。中英文账户与预设共四组，对照官方 SettingsRoot 的文本、导航、几何和截图。这补足仅渲染单个组件无法发现的重复导航问题。

侧栏品牌是已登记的用户批准偏离（2026-11-13）：只占用官方 `sidebar.brand.name` 槽位，默认名称为 `dsh-base`；全局设置中的站点名称通过公开配置服务同步到这一槽位；官方 mark fallback（`FishLogo` 与点击复制版本）、布局、排版与交互全部沿用官方。唯一无法避免的差异是官方 name fallback 内的版本行与点击复制版本随槽位占用一起消失。原 `run-sidebar-brand.mjs` 及其夹具在 Commit 1 删除后未恢复，因此 parity 链不含品牌项；真实页面验收将名称与公开站点配置核对。

文件上传：`node apps/web/tests/parity/run-upload.mjs`。中英文真实官方 InputBar/ComposerAttachments 在 Host 图片上限为零时，通过 picker/drop 本地化拒绝图片且不发上传；普通文件入口保持可用。原 FileUploadRuntime 使用真实 Web Worker 和 Connection RPC 对受控 HTTP 测试回执、错误细节、取消、中文深链下的根路径上传。六个协议用例不替代真实 Host/R2 持久化和回执消费测试。

`node apps/web/tests/parity/run-model-effort.mjs` 的四个用例对照固定官方选择器的可用 root/effort 菜单像素，并逐项以键盘选择 off/low/high/max，对照真实请求；同时检查中英文不可用强度入口仍可见且禁用、能力撤回不提交、选择模型不携带 effort。共享目录与 `/model` 选择字段回归合并在 `run-model-keyboard.mjs` 的第 5 个用例中；不是对完整应用的等价声明。

另行运行 `pnpm acceptance:local` 检查构建后的真实 Worker、当前组合库存及启用 fiber、公开登录页无私有 RPC/WebSocket；`pnpm acceptance:browser-compat` 的 7 个用例检查真实 PDF/Excel Worker 和中英文注册策略。这两组不计入组件 parity 用例。部署和模型调用仍需独立线上验收。

侧栏会话引用生命周期：`node apps/web/tests/parity/run-sidebar-lifecycle.mjs`。五个用例使用真实官方 `ClientSessions`、`RemoteStream` 和 `SessionReference`：原实现会误报自己的取消；分叉取消不误报且引用仍真实拒绝；切换到新视图保留正确引用；真实 Host 失败仍是官方 error 状态；仍拥有的引用意外失效继续报告。它是生命周期契约回归，不计作像素对照。

线上语义验收还要求一次用户请求只对应一个官方 turn：工具调用和审批续答必须在同一 turn 的后续 step，审批等待期间不能提前完成，工具结果必须先于调用 step 的结束。`acceptance-approval-ui.mjs` 与 `acceptance-official-ui.mjs` 读取真实官方 `session/page`，检查最终页面及刷新后每个 turn 只有一个完成过程，成功原因必须为 completed 且工具结果不能是错误。Pro 回合同时核对实际执行来源为 deepseek-official / provider-reported model，刷新后消息来源不变，模型入口仍显示 Pro。审批后的 sessionStats 及中英文截图底栏必须与真实日志的 turn/step 数量一致。纯断言回归为 `node apps/web/scripts/acceptance-turn-semantics.test.mjs`。这项语义要求不计入组件 parity 用例。

`node apps/web/tests/parity/run-chat-step.mjs` 运行 4 个中英文真实官方 AssistantNodeView / TurnProcessNodeView 用例：对照原生逐 step 日志与共享 SDK 投影的像素和内容，验证稳定唯一消息 ID、等待审批时不显示已完成、单 turn 多 step、重复读取与 reload。范围是这两个真实 renderer，不是整个 Chat 壳。

`node apps/web/tests/parity/run-composer-runtime.mjs` 运行 4 个真实官方 InputBar / SessionInputShell / Lexical / selector bridge 的快速键入、粘贴与提交用例。该隔离用例在 React 19 下也通过；它不冒充曾失败的完整桌面壳输入回归，完整壳必须另行验收。

独立自有插件 oracle 直接读取包元数据、profile 覆盖与 pack 成员关系。可见自有插件包完整展示当前 Client、Worker、Think 组合条目。必需与部署管理的插件包保留官方卡片、开关和详情行，仅将明确的 Host 管理归属说明显示为中性文本。详情与固定版本官方渲染器对照时，只规范化这一精确说明，同时保留原始截图。原生点击禁用控件，以及伪造 facade/HTTP 写入，均不得改变控制状态。真实页面另核验完整客户端声明与固定 Think 组合声明；Think 声明不会冒充已经观测到的 active fiber。

`run-plugin-counts.mjs` 通过官方 slot registry 挂载真实的可选数量插件。八组中英、明暗、1440/720 用例将分类数量与实际渲染的卡片核对，覆盖当前清单中的全部已安装组件、不可用条目、刷新后的成员变化、开关后的数量稳定，以及非 ready 状态下不显示错误的零值。测试通过文字实际边界验证标题与数量相隔 10px，计数保持官方辅助字号、行高、颜色与 400 字重；720 宽度用例额外将标题区域限制到 200px，验证摘要完整换行且无重叠或横向溢出，再恢复原始样式。参考侧为未挂载数量插件的同一 fork；只在明确断言数量后隐藏计数 span 进行像素对比，确保没有数量贡献时标题不留额外间距，并保留原始截图。挂载与渲染不得增加网络请求。完整管理器用例保持不挂载这一可选插件。

自有名称断言使用独立审查的 Cloudflare 集成组件集合、精确的本地化插件包名称，以及平台中立组件所需的 `Dsh-base` 拼写。本地与部署验收核对当前清单中的全部自有组件在插件包详情和完整设置清单中的名称一致性；固定版本官方目录继续使用原始名称断言。

`run-plugin-navigation.mjs` 用八个中英、1280/720、官方/适配观察检查真实指针导航，直接使用当前自有 AI 对话组件及官方配置 slot ledger。原官方页面在进入详情时继承列表滚动，返回按钮可能离屏；此已登记的修复在进入不同的列表、More、插件详情、组件配置或内置配置视图时归顶，并恢复列表 header。测试点击后不人工修正滚动。同一详情刷新严格保持 offset；resize 允许原生换行与滚动锚定调整，但保留首个可见组件且不归顶。测试配置内容仅用于让配置页可滚动。报告与原始截图保存在 `plugin-navigation/`；这是导航行为回归，不计作像素对照。

`run-global-settings.mjs` 在中英、明暗和 1280/720 视口的八组用例中，挂载真实全局设置插件的配置贡献。字段、保存按钮、只读字段和只读说明直接对照未修改的官方 `SettingsForm` / `SettingsValueField` 导出，共 32 组精确像素比较；参考夹具只用空白占位匹配控件流坐标及滚动层，不改变控件样式。通过浏览器原生 fetch 与受控接口响应验证保存、配置刷新、409 保留草稿、明确重新加载，以及普通用户无法提交。完整 SEO 编辑页不存在官方对应实现，因此不宣称整页对齐；真实身份、D1 持久化和公开页面输出由独立全局设置验收覆盖。证据保存在 `global-settings/`。

`run-global-settings-selects.mjs` 专门检查全局设置的页面路径、语言和更新频率三个原生选择器。参考侧直接使用固定版本官方 Models 的 `input` / `selectInput` CSS，不复制样式；八组中英、明暗和 1280/720 视口分别比较默认、焦点与只读状态，共 72 次控件几何、computed style 和精确像素对照。验证 32px 高度、240px 最大宽度、预留箭头空间和无横向溢出；行为覆盖添加页面只改草稿、阻止重复添加、切换语言不改配置、频率草稿随语言切换保留并进入保存请求，以及只读用户仍可切换查看语言。 证据保存在 `global-settings-selects/`。

`run-anonymous-models.mjs` 将匿名只读编辑器直接对照固定官方 `ProviderEditor`，分别检查初始、展开和重新打开状态；默认 Models 整页另按真实 owner/readonly/error 状态对照原件。公开模式不伪造配置或凭据，残留凭据也不能出现状态标记。整体匿名模型展示是明确批准的扩展，不声称原官方已有此页面。正式浏览器脚本另覆盖八语言、登录门控与零私有请求。

rc.5 网页搜索的参考界面来自固定子模块中的 `WebSearchCard` 与对应语言文件。`run-plugin-manager.mjs` 在中英文下打开「网页搜索与获取」，核对官方表单和 Workers 禁用表单的控件及像素，验证本地化说明和零私有 API 请求。另一个提供搜索目录的测试 Host 通过稳定的 `/client` 入口挂载官方插件，核对「自动选择」的提示与指南，实际切换到显式提供方，最后卸载插件并核对插槽已释放。[rc.5 插件对照](../../../../docs/official-differences.md#rc5-upgrade)

`pnpm acceptance:plugin-artwork` 是本地品牌图标的短回归，也在 `acceptance:parity` 末尾运行。复用真实插件管理页与 Host 元数据，覆盖中英、手动浅/深主题（系统偏好刻意相反）、桌面/手机宽度、全部自有插件包和组件。包列表、包详情、组件行及组件详情的鲸鱼均与稳定导出的官方 `FishLogo` 核对路径、比例、颜色、36/30px 图形区域、24/20px 鲸鱼宽度、48/40px 外框和同位置像素；另外验证已挂载图标随手动主题切换更新。Cloudflare 图标保留已审核资源哈希，官方插件图标逐项对照固定子模块目录；不触发写入。证据在 `apps/web/dist/parity-evidence/owned-plugin-artwork/`。

本地鲸鱼是用户批准的品牌差异。已有 `run-plugin-manager.mjs` 先保存原始截图，仅把参考侧 `src` 精确等于 canonical 本地鲸鱼 data URL 的图片替换为独立渲染的官方 `FishLogo` 参考，然后继续原有完整几何/像素比较并恢复 DOM。其他图标、布局和行为不参与归一化；短回归还验证该处理只影响指定图片且可完整恢复。

`node apps/web/tests/parity/run-session-menu.mjs` 验证固定版本的会话右上角更多菜单：先断言生产组合启用原样官方 `session-log-export` 插件，再调用其真实 `apply` 注册菜单和提示组件；中英、明暗、桌面/窄屏共 8 组，对照官方组件的文本、几何、样式及 32 张界面状态。交互覆盖 Escape 焦点归还、键盘复制完整 Markdown、深链下的根路径 HEAD 预检和 ZIP 下载、反馈委托、HTTP/剪贴板错误以及 `/export` 成功和失败事件。另比较本地应用控件在可用和不可用时的官方组件几何、像素与点击行为：缺失目录或应用目录时入口保持禁用且零派发，可用时完整保留官方启动意图。rc.4 的「在应用中打开」复用会话上下文菜单，并通过二级菜单选择应用。HTTP、剪贴板和下载载体受控，真实会话鉴权、持久化事件和 R2 附件 ZIP 字节另由 Worker 回归与完整壳验收验证。
