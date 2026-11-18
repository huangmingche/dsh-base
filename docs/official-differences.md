# 与官方 DSH 的差异及边界

对照源只使用 `.submodules/deepseek-harness` 的 `dsh-v0.2.2-rc.5`（`9c2670d3bce5275e0d1610272958121af87787bb`）。更新于 2026-11-18。本文记录工作树能力；具体构建、部署和验收版本以 [完成状态](completion-status.md) 为准。[English](official-differences.en.md)

**尚不能声称整个产品已达到官方 DSH 的 100% UI/UX 和执行语义等价。** 清单覆盖、实际插件激活、组件对照和完整产品行为是不同层次的证据。禁用入口只是如实呈现缺口，不等于完成该功能，也不构成保留差异的批准。

<a id="rc5-upgrade"></a>

## 0.2.2-rc.5 的官方插件变化

对照 rc.4 和 rc.5 的标签树，两个版本在 `packages/*/*` 均有 374 个包，包名集合、`dsh` 声明和 `exports` 映射一致。剔除版本号后，7 个既有包有变化，其中 1 个声明了客户端入口。[逐包对照表](evidence/dsh-v0.2.2-rc.5-packages.tsv)

| 官方包（省略 `@deepseek-ai/dsh-` 前缀） | rc.5 的变化 |
| --- | --- |
| `base`、`web` | 默认组合改为自动选择搜索提供方，网页抓取仍默认使用 HTTP。搜索和就绪检查都读取会话的模型路由。`deepseek-official` 和 `deepseek-account` 优先使用 DeepSeek 服务端搜索，其他路由和缺少路由的请求优先使用 DeepSeek Search API。 |
| `tool-web`、`tool-cordis` | 网页搜索工具把模型路由传入每个查询，包括批量查询。Cordis 的服务目录同时更新搜索调用和提供方查询说明。 |
| `web-search-deepseek`、`web-deepseek-api` | 服务端搜索优先返回提供方随来源给出的非空摘要，缺少摘要时尝试提取匹配的引用片段。Search/Fetch API 包只更新文档。 |
| `client-ui-settings-web-search` | 官方「网页搜索与获取」卡片更新八种语言。选择「自动选择」时说明跟随当前模型的规则并提供指南链接，原「DeepSeek（旧版）」更名为「DeepSeek 服务端搜索」。 |

上游允许显式选择提供方。选中的提供方缺失或不可用时，请求返回对应错误。自动模式下，如果首选不可用，就使用唯一可用的提供方。零个可用时报告不可用，多个可用时要求显式选择。DeepSeek 服务端搜索不按搜索次数收费，Messages 请求仍可能消耗模型 token。

Web 组合挂载官方设置插件。Workers Host 在 `web/listProviders` 报告目录不可用，插件页使用同一官方表单显示禁用状态。该部署可单独使用 Cloudflare Think 的 `fetch_url` 抓取获准网址。官方搜索路由和计费规则适用于挂载相应搜索提供方的 Host。

复查了 16 个派生包的上游目录，除清单版本以外均无变动。29 个包共声明 216 条源码入口，去重后有 156 个。跨标签实际变化的入口有两个，均来自 `dsh-client-ui-settings-web-search`。`WebSearchCard.tsx` 用于插件管理的不可用表单及 Web 对照测试，`locales.ts` 用于 Web 测试对照。两者共涉及三条声明。逐包结果可在仓库根目录通过以下命令复现。

```sh
node scripts/dsh-source/compare-packages.mjs dsh-v0.2.2-rc.4 dsh-v0.2.2-rc.5
```

<a id="rc4-upgrade"></a>

## 0.2.2-rc.2 至 rc.4 的官方插件变化

对照来源是参考子模块内四个官方标签的 Git 树。下表按官方 workspace 层级 `packages/*/*` 统计包名，包含插件及其支持库。Web 列只统计声明 `dsh.client` 的包，双端插件的 Host 代码变化也在统计中。包名变更分别计入移除和新增。

| 相邻标签 | 新增／移除包 | 有版本号以外变更的既有包 | Web 新增／移除／既有包变更 |
| --- | ---: | ---: | ---: |
| rc.1 → rc.2 | 10／9 | 363 | 2／1／89 |
| rc.2 → rc.3 | 1／0 | 10 | 1／0／6 |
| rc.3 → rc.4 | 0／0 | 3 | 0／0／1 |

- **rc.2**（`ddac96760b`）。新增 `agent-team`、`client-ui-agent-team`、`tool-agent-team`、`client-ui-account-notifications`、`error`、`mcp-manager`、`office-kit`、`tool-office`、`terminal-panel`、`util-ripgrep`。移除四个实验性 Team 包名及 `api-account-controller`、`deepseek-account-platform`、`office-to-pdf`、`web-search-exa`、`web-search-perplexity`。团队模式进入默认 Web 组合，平台账号服务与通知界面分包。其他变化包括面板固定操作、会话／工作区菜单、分别配置搜索与抓取计费、Office 工具及 MCP 服务器管理。363 个既有包中，157 个涉及源码、资源、组合或契约。其余 206 个只有其他清单字段变化，如发布文件与依赖，部分还更新了测试或文档。
- **rc.3**（`38a6a5c965`）。新增可选的 `deepseek-chat-import` 对话导入插件包及客户端。上游配套调整了可复用工作区选择器、新会话旁的侧栏插槽、目录选择器、会话导出归档及插件目录。导入依赖受账号授权的归档上传、工作区和会话持久化。官方默认组合将导入设为可选，Workers 保留其可用性展示。
- **rc.4**（`3f321d32bf`）。`llm` 和 `llm-deepseek` 将 DeepSeek Messages 流的拒绝终态分类为 `CONTENT_REFUSED`，保留供应商说明及用量。`experimental-liveshare` 改用 Electron 的 Node 模式启动隧道进程。Workers/Think 继续通过 Chat Completions 调用模型，本地桌面隧道不可用。上游修复只适用于对应传输及运行时。

Web profile 原样挂载 `client-ui-agent-team` 与 `client-ui-account-notifications`。Workers 缺少团队服务时，主会话沿用官方团队模式开关，禁用并提供八种语言的说明；子会话按官方规则隐藏开关。官方通知内容需要 DeepSeek 平台账号服务。已有的账号适配器以 `credential-stored` 表达已登录的本站用户，通知查询由本地 Host 适配，不持有平台凭据时不向 DeepSeek 发送请求。Workers 部署继续将本机 shell、PTY、Office 与桌面进程能力标记为不可用。

rc.4 的模型设置沿用官方提供商编辑器。Workers 的重试策略由部署管理，选择器显示本地化说明并置灰，服务端拒绝账号级修改。密钥和端点仍可按账号权限编辑。

rc.2 新增的首页像素鲸鱼由官方品牌插件注册到 `conversation.hero.frame`。通用设置的更新频道沿用官方桌面桥接条件，只在宿主提供频道服务时出现。官方网页搜索与抓取的提供商目录需要 Host 实现 `web/listProviders`。本部署通过该接口报告目录不可用，Cloudflare Think 的网页抓取工具独立运行。

rc.2 的 `dsh-mcp-manager` 是官方默认 Web 组合中的 Host 插件，负责服务器配置、连接状态、探测和重启。当前 Workers/Think 组合没有挂载该管理器。`stdio` 传输依赖本机子进程，超出本部署的运行范围。远程 `streamable-http` 使用 HTTP，当前还没有接入其账号凭据、连接生命周期和 `mcpManager/watch`、`probe`、`restart` 契约。

官方文件侧栏的 `workspaceFiles.search` 按名称或路径查询当前账号会话所属工作区的 SQLite 文件索引，可筛选隐藏文件和排除路径。每次请求先跳过版本控制目录、被排除的路径和按请求隐藏的目录，再扫描最多 2,000 个候选文件，返回最多 512 项匹配。扫描未完成时返回 `incomplete`，匹配超过上限时返回 `truncated`。只有请求要求遵循 ignore 规则，并且搜索范围内存在适用的本机规则文件时，Host 才返回搜索不可用。

从 rc.1 到 rc.4，16 个派生包中有 13 个对应的上游源码目录发生了变化。其中 12 个客户端包涉及预设、命令、入口定制、提供商和模型选择、插件管理、自动化任务、账号与常规设置、左右侧栏及工作区，另一个是 Worker 会话控制器。客户端语言、权限预设和 API Gateway 三个派生来源的运行时代码在四个标签间一致。[派生包与 Host 适配层统计](completion-status.md#插件与来源)

[完整逐包对照表](evidence/dsh-v0.2.2-rc.4-packages.tsv) 记录包全名、四个标签中出现过的 `dsh` 声明字段，以及每次相邻比较结果。`+`、`-` 分别表示新增、移除。`P` 为目录迁移，`H` 为 `dsh` 声明，`E` 为导出，`M` 为其他清单字段，`C` 为 Cordis 补丁或 preset，`F` 为其余源码、资源或构建文件，`T` 为测试，`D` 为文档或许可证。`.` 表示除版本号外没有变化。参考子模块含有这四个标签时，在仓库根目录执行以下命令可重现该表。浅克隆可先从子模块的官方远端获取对应标签。

```sh
node scripts/dsh-source/compare-packages.mjs \
  dsh-v0.2.2-rc.1 dsh-v0.2.2-rc.2 dsh-v0.2.2-rc.3 dsh-v0.2.2-rc.4
```

## 当前清单与验证口径

当前组件、分组、复用方式和官方启用数量统一见[完成状态的插件清单](completion-status.md#插件与来源)，避免两份统计漂移。API、服务与 UI 均在清单中，不能将这些数量视为已实现页面或可用能力数量。`cloudflare:think:subagent` 明确不可用。

Schedule 现在由完整标记的 `client-schedule` fork 承载，通过可选 Host 回调 `onBeforeCreate` 在匿名手动创建任务前请求登录；已登录路径不传回调，保留官方行为。Plugins 由 `client-plugin-manager` fork 承载。二者均保留官方原件为禁用库存，不再称为原包直接挂载。

Staging 的部署与验收结果按实际测试日期和 Worker 版本记录。[实现与验收状态](completion-status.md)

## 用户批准的 SaaS 扩展

用户选择的 14 项 SaaS 能力分别注册 Client/Worker 插件，新增 28 个组件。固定版官方 DSH 没有对应的 SaaS 支付、邮件、用户治理等实现；新面板填入官方 `plugins.bundle.config`，直接使用官方控件和主题。没有替换官方账号账单或设置，也没有修改上游子模块。每包记录官方候选和无法挂载/ fork 的原因。服务配置和验证边界见 [SaaS 插件指南](saas-plugins.md)；此扩展不意味着官方平台登录或计费已接入。

## 本轮纠正的实现缺口

底座的公开页面目录登记了八种语言的工作台首页。Waffo Pancake 在工作台的插件面板中展示已配置的套餐并提供结账入口。业务项目可通过自有 dsh 插件提供文章、指南或独立定价页，并登记对应路径。[SaaS 插件与服务端权益校验](saas-plugins.md) · [SEO 与转化统计](seo-plugins.md)

会话右上角菜单此前缺失，是因为官方 `dsh-session-log-export` 仅列入禁用清单。现直接挂载固定版本的官方客户端，以 Workers 接缝连接服务端导出器。Markdown 和 ZIP 基于当前 Host 保存的事件及获准附件；不代表拥有完整原生 Agent 的请求日志或未记录历史。rc.4 在会话标题栏与会话行的菜单中注册“在应用中打开”。Workers 缺少本机应用启动服务。文件侧栏在工作区已选定、应用目录已加载且没有可打开该目录的应用时，用官方按钮显示本地化禁用提示。Host 返回可用应用时，沿用官方按钮和启动行为。会话 ZIP 使用上游新的 `attachments-missing.txt` 表达已获准、但 R2 确认缺失的附件。Worker 对跨会话附件和存储读取故障分别返回授权或读取错误。反馈仍使用官方对话框及已有禁用提交状态。

以下问题不属于 Workers 的硬限制，已沿官方协议补实现，并加入针对故障、重启或真实 SDK 的验收。最终测试与部署结果另记。

| 原差异 | 实现方式及边界 |
| --- | --- |
| Effort 只展示、不执行 | 官方模型目录及 `off/low/high/max`；会话持久化选择，在输入准入事务冻结模型与 effort，后续审批续跑沿用原配置；真实 SDK 请求体分别覆盖 Gateway/BYOK。 |
| Pro/Flash 使用过时别名，来源把请求型号当响应型号 | 使用锁定官方目录中的 canonical ID；请求配置和提供商实际返回的 model 分开记录。提供商未返回来源时保留未知。不能用上一轮对 `deepseek-reasoner` 的请求证明实际执行了 Pro。 |
| 所有权限控件一律禁用 | 完整标记 fork 官方 permission-presets，保留选择/派生/默认/三事实算法，Host 适配真实 R2 文件执行边界；每会话持久事实与新会话默认分离。`approval: never` 是拒绝需要审批的操作，不是偷偷批准。文件权限不声称限制网络。 |
| 跨标签页设置不刷新、Host 使用轮询 | owner DO 提供提交后的变更通知，初次订阅和重连有 baseline；官方消费者重新读取服务端状态。失败事务不广播，连接关闭释放订阅。 |
| 工具卡和步骤只能等整个回答同步；步骤时间重复使用回合开始时间 | 从真实 SDK 输入增量及步骤回调投影官方流与持久记录；首 token 前失败也先保存真实步骤起点，冷重载保留失败轨迹；Agent 重建同步不抹除已有 Host 时间/模型来源。旧记录没有精确时间时保留未知，不补造成功或时间。 |
| 审批已完成，但工具卡仍停在等待状态 | 在单一用户回合内去重 SDK 续跑重复携带的步骤，并合并真实工具结果，终态不被旧快照覆盖。对受影响的已完成旧记录，只从 Agent 已持久化的 SDK 消息事务修复；不会重新执行模型或工具，没有结果证据时不补造结果。 |
| `lastUsed` 一直为空 | 从实际执行时冻结的选择折叠，而不是从当前 picker 反推过去。提供商响应来源另存。 |
| 分叉按整个步骤取整，可能带入后续工具结果 | 直接复用官方稳定导出的 `buildForkSeed`，持久保存精确前缀与官方 fork closers；SDK 上下文也排除切点后的结果；重启、续写、嵌套分叉不重建被排除内容。默认取最新已关闭回合前缀，并保留工作区归属。 |
| 无效权限默认值可破坏权限目录和新会话创建 | 从实际官方服务配置表校验 mutate/update/replace 的最终值，拒绝时不写入、不增加 revision、不广播；清空配置仍按官方默认恢复。 |
| 审批界面异常或释放被当作拒绝、每隔 1.5 秒轮询 | 使用提交后的通知和真实会话订阅生命周期触发检查；同一会话串行、不同会话请求隔离。官方 PendingApproval 取消不产生决定，只有用户选择才提交；丢失回执时仅幂等重试原决定。HTTP、业务及界面错误不伪装拒绝。 |
| 模型不知道审批策略已改变 | 原样官方 ApprovalService 生成变更通知，SystemPrompt 生成当前策略上下文。策略与通知在同一 Host 事务保存，SDK 在下一步骤以稳定消息 ID 非唤醒注入；初始化、同值和失败事务不产生通知，重启不重复，不增加用户回合。 |
| 浏览器固定返回 owner 访问许可 | 启用原样官方 Typert registry 和 RemoteAccess 插件；隔离挂载的原样 Gateway 管理生成契约及唯一连接生命周期。收到鉴权 Host 的 owner baseline 前不授权，断连按官方协议恢复，卸载撤回命名空间和订阅。旧自写启动器保留为禁用库存。 |
| 认证限流只在单个 isolate 内存生效 | Better Auth 的正式数据库限流适配器使用现有 D1 表；跨 isolate、重启、窗口过期竞争及存储失败测试。限流范围是认证 HTTP 请求的 IP/路径，不冒充所有产品 API 的配额。 |
| Cron 不支持、每日/每周任务夏令时有误差 | 复用官方 `Cron` 和时区/本地时间解析；Cron 支持持久化、编辑、手动运行、迟到执行及重启，夏令时缺失时刻跳过、重复时刻只取较早一次。 |
| 预设设置整个 section 被禁用 | 完整标记 fork 官方 ui-agent-preset，保留全部官方行为；恢复官方四条内置模式及其真实声明：官方组件渲染名称/简介；当前部署不执行的官方模式显示中性灰不可用状态及本地化原因，只有真实声明加载失败才保留官方红色 broken 卡片；四份 pinned 声明可只读查看；`dsh-base-think` 是独立的真实固定默认项，不伪装成官方 Standard。只禁用真正不可用的操作：Cloudflare Think 模式的声明查看、Creator 入口（缺 Cordis Host runner）以及预设切换。 |
| 上下文细分缺少证据仍给估算数字 | 只展示真实已记录的统计。旧记录缺失的 token 分类不通过固定常数猜测。 |

## 真正受当前纯 Worker 部署约束的能力

这些边界指当前不配置容器、不安装用户本机伴随程序的部署，不代表 Cloudflare 全平台永久不能实现。

| 能力 | 确切约束 | 官方界面处理 |
| --- | --- | --- |
| 原生终端、PTY、任意子进程、依赖本机二进制的 shell 工具 | Worker isolate 没有可用的原生进程/PTY；Node compatibility 中 `child_process`/`tty` 为不可执行 stub。接容器或远程执行器是新增执行平面。 | 官方终端保留，操作禁用并显示本地化原因；不伪造输出。 |
| 用户电脑的原生目录、持久 POSIX 文件系统、原生设置编辑器 | R2 逻辑工作区不是用户电脑磁盘；Worker VFS 的可写临时目录也不提供持久原生文件语义。原生目录选择/编辑器需要浏览器授权或本机服务。 | 官方逻辑目录浏览、R2 文件及预览可用；本机选择/编辑不可用。 |

依据：[Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Workers filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)。

固定版本的 Node Gateway（`packages/api/gateway/src/stream-server.ts`）使用 `ws.ping()` 探测连接。Workers 的 `WebSocketPair` 提供消息与关闭事件，由原版客户端的重连机制重新建立订阅。长连接可能被 Cloudflare 回收，但“断连后无法恢复”不属于必须保留的平台差异。本轮同步浏览器和 Tail 在旧中间版本捕获一次 `loadShed` 与 `session/follow` 的 1006 断连；它不证明固定超时或具体 CPU/内存原因。官方 [WebSocket 生命周期](https://developers.cloudflare.com/workers/runtime-apis/websockets/#connection-lifetime) 也要求客户端重连并恢复状态。适配层必须沿官方 RemoteStream 契约恢复物理载体故障，同时保留真实业务和协议错误；对应修复及最终云端验证以完成状态为准。

## 尚未完成的集成，不能称为平台硬限制

| 差异 | 缺少什么，为什么还不能启用 | 保留的边界 |
| --- | --- | --- |
| 图片输入与模型视觉 | 官方 attachment-local 使用 Sharp、完整解码和精确归一化验证。Cloudflare Images/WASM 提供实现路径，但当前尚无通过同等 EXIF、动画、alpha、颜色空间、像素/字节预算及批次原子入库验收的适配器。 | 官方文件入口仍在；图片限额为零，服务器明确拒绝。普通文件可上传，不能把 base64 当已完成图像处理。 |
| Agent 读取 PDF/Office 内容 | 浏览器官方预览已实现；Agent 侧仅能按授权读取原始文件。缺少可验证的解析/转换服务和模型上下文适配。 | 不把预览成功或原始字节读取称为文档理解。 |
| 完整子代理、父子会话轨迹与取消树 | Think facet 与官方 Agents 的 Session 身份、凭据、inbox/step、所有权、持久 settlement、后代取消协议未完整接通。Worker/DO 可以承载并发子代理，限制是当前架构集成。 | 不注册虚假的 `delegate_task`；仅保留历史存储兼容导出，当前历史数据可读尚无验收证明；执行明确拒绝。 |
| 官方多预设执行、读取真实 child-root 声明 | 目录与声明读取已修复：四条官方模式以官方内置分组显示并标注真实执行缺口，四份 pinned YAML 可只读查看。实际运行仍是 Cloudflare Think 模式组合，未挂官方 Cordis child-root 执行生命周期；Coding Tools 关闭时 PTC/极简按官方行为隐藏。 | 不合成看似正确的 YAML；声明查看不等于能启动该模式。选择/创建官方 id 在 Remote、Host 与 legacy fallback 均显式拒绝，绝不静默别名成 Think。 |
| 插件安装、卸载、切换、运行时代码及生产 HMR | 当前为静态 literal composition；缺少受隔离的构建/加载器、持久 profile、依赖图失效与回滚。Dynamic Workers 有可行路径，但当前未接；本地 Vite HMR 与生产插件 HMR 是不同能力。 | 真实客户端 inventory/origin/fiber 可检查；没有冒充 Worker/Think 的运行库存，管理动作不可用。 |
| 官方通用 jobs/goals/runs、队列 steer | 现有清理/调度/恢复任务不等于官方后台 Session 任务。Think 引擎没有全部官方下一步骤输入和任务控制协议。 | 不用空数据或维护任务冒充成功的官方功能；支持的队列编辑/删除与不支持的 steer 分开处理。 |
| 任意未注册 cwd/无工作区会话 | 当前会话归属使用持久逻辑 Workspace，未实现官方全部无工作区目录语义。 | 不将用户指定的不存在目录静默改到默认工作区。 |
| 非 owner Peer 共享权限 | 官方 owner 访问状态流已接通；尚未提供共享 Peer 身份、动态 grant/revoke 与非 owner 策略管理。 | 服务端逐次验证 owner；请求不能指定或伪造 owner/grants，工具权限 preset 与服务访问权限分开。 |
| 事件历史的完整原生执行含义 | 当前仍是 Think 到官方 Session 的适配层；压缩、请求日志、策略历史与原生 DSH 引擎没有完整一一对应。新分叉精确保留已投影的会话事件，但不能凭空恢复未记录的历史策略/用量。 | 保留 reuse gap；不能把聊天测试通过扩大为执行引擎完全等价。 |
| 权限命令与策略通知轨迹 | `/permission` 的官方解析、执行、策略效果、命令回执及重试去重已接通；`command/run`、`command/done` 还未合并进聊天日志，缺少对应历史卡和查询输出。策略通知已真实传给下一模型步骤，尚未进入统一 UI 事件日志。 | 失败返回真实 Remote 错误；模型收到通知不等于已完成原生 inbox/历史展示，不声称已有完整命令轨迹。 |
| 自动审查、单次权限升级及历史策略分叉 | Auto review 集成未接；R2 只实施会话持久策略，没有 tool-fs 的 `sandbox_permissions`/`justification` 单次升级。聊天分叉继承源会话当前策略，未恢复所选历史切点的策略；投影版本也独立于聊天游标。官方策略通知已通过下一步骤 Host 端口接通，但不代表已挂原生 Agent 调度器。 | 执行始终检查最新持久策略；精确聊天分叉不等于精确策略历史分叉，不宣称单一原生日志或自动审查。 |

Cloudflare 官方明确支持 [Images 原始字节处理](https://developers.cloudflare.com/images/optimization/binding/) 和 [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)。因此本表列为未完成集成，而不是“Workers 无法实现”。上述缺口仍需实现和验收；本轮没有将其标成完成或获准永久偏离。

## 外部服务或历史证据约束

| 差异 | 分类与处理 |
| --- | --- |
| DeepSeek 平台余额、充值、使用量与官方账户 | 本地 Better Auth 不是 DeepSeek 平台身份；缺少正式身份/账单服务契约和授权配置。官方控件禁用，不制造余额或跳转。 |
| 官方会话日志上传、消息/会话反馈 | 官方插件走 DeepSeek Messages 的会话日志扩展；当前公开 Chat Completions Gateway 没有等价的日志存储契约。设置 sidecar 不算日志提交成功。 |
| 邮件验证、密码重置、Google 登录 | 可以配置，取决于运营者的邮件/OAuth 服务和凭据；不能为模板捏造配置。 |
| 旧消息时间、来源、工具结果，旧审批请求执行配置 | 生成当时没有保存的信息无法可靠追溯。明确未知；旧待续跑请求没有原配置证据时失败关闭，保留数据，可取消后重新提交。新请求保存真实配置。 |
| GitHub Template repository 开关 | 属于独立的 GitHub 仓库设置；本地构建和功能验收不能证明其当前状态，需单独核验。 |

品牌方面仅有两项已批准的差异（2026-11-13 用户确认）：侧栏显示代码名 `dsh-base`（各语言一致），名称行不再显示版本（官方 name fallback 的版本行随槽位占用消失）。产品显示名 `DeepSeek Harness Base` 用于 README 与文档。设置中的版本保留。其他不等价点均继续作为待解决缺口，不以“最佳实现”或清单覆盖代替验证。


## 匿名「更多」账号菜单与匿名设置面板（ADR-0005，2026-11-14）

以下记录当前工作树实现，具体部署状态以完成状态页为准，设计见 [ADR-0005 §16](dsh-base-ADR-0005-anonymous-more-menu.md)。官方在匿名态**不提供**侧栏底部账号入口：`AccountMenu` 注册在 `remoteAccess.whenAccess('account/watch')` 内，整个设置外壳注册在 `whenAccess('settings/describe')` 内，匿名两者都不挂载（设置齿轮是外壳内部 fallback，随外壳一起缺席）。CEO 于 2026-11-14 批准「全量 B」：匿名「更多」入口属自创 UI；设置项不置灰，点开完整官方形态的匿名设置面板（ADR §17）；意见反馈仍置灰。

| 偏离 | 官方原状 | 本实现与边界 |
| --- | --- | --- |
| 匿名「更多」账号入口（自创 UI） | 匿名侧栏底部没有账号入口，也没有设置齿轮 | 新插件 `@dsh-base/client-account-launcher` 在官方 single 槽 `sidebar.settings` 以 `priority: 1` 影子注册：官方或我们的设置外壳用默认 `priority: 0`，永远能注册并成为 winner（最低 priority 渲染），本项被遮挡后 dispose，外壳离开后重新注册。只在 `GET /api/auth/get-session` 明确 `null` 后注册；已登录不注册，官方 `AccountMenu` 独占。复用官方 `Menu` + `MenuItemButton`、`AccountMenu.module.css`、官方图标与 `settings.account` 8 语言词表，只有三项菜单结构与登录导航是自写的。未改 `remoteAccess`、未新增访问策略、未新增公开端点。 |
| 匿名设置面板（完整官方形态） | 设置项打开官方 800×800 设置外壳，5 个分区与 12 行经 Host 设置文档持久化（`settings/describe` / `settings/mutate`）；匿名没有该访问权 | 复用本仓标记 fork `@dsh-base/client-settings-navigation` 里已导出的官方 `SettingsPanel`（800×800、188px 两栏、遮罩、焦点陷阱），只给 row 数据加可选 `disabled` / `disabledReason` / `icon`（官方 section 不设置，登录态渲染路径不变，有单测与已登录验收）。左导航 5 个分区全显示且**全部可切换**（P12，见下）；右栏 12 行：**9 行真实可用**（语言/外观/字号走官方组件 + 匿名本地设置文档；工作步骤展示走官方 `TranscriptViewPolicy`、链接打开/性能用量走官方 `ui-chat` 配置表单、回车行为走官方 `ComposerSubmissionPolicy` + `ui-conversation` 配置表单、开发者工具走 `configForms.developerTools`、快捷键走官方 `ctx.shortcuts` + `shell.overlay` 已注册 store，键位存官方 `dsh.keybindings.v1`）、**1 行只读可用**（当前版本取自所选应用的 `package.json`）、**2 行禁用**（权限、会话日志，`fieldset disabled` + hover 原因）。匿名期间 `/api/settings/*` 请求为 0；Esc 关闭后焦点回到「更多」触发按钮；已登录时本入口不渲染，官方设置接管。匿名 settings 槽图在 access gate 内，政策行按 Architect 批准路线用官方类 + 官方 `configForms` 服务。 |
| 意见反馈匿名置灰 | 官方反馈入口指向 DeepSeek Messages 会话日志扩展所需的上游外链表单 | 匿名态可见但 `disabled`（`aria-disabled` + tooltip），原因 8 语言本地化（「登录后可用。」/ “Available after sign-in.”），不链接上游表单。CEO 2026-11-14 决定：等法务确认上游表单后再放开。 |

匿名账号最新方案（ADR-0005 §21）：新增完整标记的 `@dsh-base/client-settings-account` fork。默认官方行为保持；显式 `full-unavailable` Host 展示参数让真实未登录快照显示完整身份卡和余额、赠金、用量、充值区域，原 CSS 与词典不变。平台操作灰禁且无链接地址，不伪造账号、金额或授权状态。独立 Dsh-base 登录行仍在下方。此用户批准的扩展覆盖 §20 的居中占位方案，不恢复先前四条自建账单行，不开放私有数据权限。

其余三个分区只读：**模型**复用已有官方 Models fork 的卡片与只读编辑器，使用与 Host 共用的公开 schema/defaults；凭据及 Gateway 账号状态保持未知，详情可展开，添加提供商触发登录，无私有读取或网络模型发现。此项覆盖历史 R29 自建列表（ADR §22）；**内置插件**直渲官方 `PluginInventorySettingsTab`（`./src/*` 已登记 `sourceEntries`），`list` 接只读 seam `remote.pluginInventory`（本地 client Loader 清单 + pinned 声明行，零网络），匿名 `hooks.clientSync` 用 `{syncing:false, failures:[]}` 空快照 stub、`retryClient` no-op（R30）；**Agent 预设**直渲本仓 fork 的官方 `AgentPresetSection` + `AgentPresetSectionController`（fork 新增导出，controller 接受显式 `remote.agentPresets` face），4 个官方模式带本地化 `unavailable` 原因、Cloudflare Think 为当前默认，列表与 composer 匿名菜单同为 5 项；「设为默认」4 项 `aria-disabled`、默认项原生 `disabled`，没有可用选择控件（R31），`makeDefault` 只做防御性拒绝不调 `remote.settings`。面板全程 0 次 `settings/*`、`account/*`、`pluginManager/*`、`llm/*`、`credentials/*` 请求；`settings.section` / `settings.general.item` 匿名 entries 实测仍为 **0**（面板把实时计数写到 `data-anonymous-settings-sections` / `data-anonymous-settings-general-items` 供验收断言）。

### 复用与来源条目

官方 `Menu`、`MenuItemButton` 与面板内 primitives 走 `@deepseek-ai/dsh-client-ui-primitives` 的稳定入口；设置面板壳复用本仓 fork 的 `@dsh-base/client-settings-navigation/src/client/SettingsRoot.tsx`（`SettingsPanel`，可选字段扩展）；其余官方行经包 `exports` 的 `./src/*` 面导入，已登记在 `@dsh-base/client-account-launcher` 与 `@dsh-base/client-session-adapter` 的 `dshBase.reuse.sourceEntries`（`check:reuse` 校验来源真实存在）：

| 包 | 源条目 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-locale` | `src/client/LanguageRow.tsx`、`src/client/settings-store.ts` | 官方语言行与 `createLanguageRowStore` |
| `@deepseek-ai/dsh-client-ui-theme` | `src/client/AppearanceRow.tsx`、`src/client/FontSettingsGroup.tsx`、`src/client/settings-store.ts`、`src/client/index.ts` | 官方外观行、字号/字体组、row store 工厂与 theme 服务绑定 |
| `@deepseek-ai/dsh-client-ui-renderer` | `src/client/bind.ts` | `bindSnapshotSelector`：非槽位上下文绑定官方 row store（稳定入口未导出） |
| `@deepseek-ai/dsh-client-ui-settings-account` | `src/client/AccountMenu.module.css`、`src/client/AccountSection.tsx`、`src/client/AccountSection.module.css` | 官方菜单、未登录账号分支与新增本地账号行样式（跨包 import，不复制） |
| `@deepseek-ai/dsh-client-ui-theme` | `src/theme-settings.ts` | 本地设置文档的官方 `ThemeSettingsSchema` 校验（不手写 schema） |
| `@deepseek-ai/dsh-client-locale` | `src/locale-settings.ts` | 本地设置文档的官方 `LocaleSettingsSchema` 校验（不手写 schema） |
| `@deepseek-ai/dsh-client-ui-permission-presets` | `src/client/PermissionRow.tsx`、`src/client/settings-store.ts` | 权限行（stub 快照渲染官方禁用选择器） |
| `@deepseek-ai/dsh-client-ui-chat` | `src/client/settings/TranscriptViewRow.tsx`、`LinkOpeningRow.tsx`、`PerformanceUsageRow.tsx`、`src/chat-settings.ts`、`src/client/presentation-policy.ts` | 会话显示、链接打开、性能用量行与 stub 类型 |
| `@deepseek-ai/dsh-client-ui-conversation` | `src/client/settings/EnterBehaviorRow.tsx`、`src/client/contract/composer-submission.ts` | 回车行为行与 stub 类型 |
| `@deepseek-ai/dsh-client-ui-settings-general` | `src/client/DeveloperToolsRow.tsx`、`src/client/CurrentVersionRow.tsx` | 开发者工具行与当前版本行 |
| `@deepseek-ai/dsh-client-ui-shortcuts` | `src/client/Reference.tsx` | 快捷键行 |
| `@deepseek-ai/dsh-client-ui-settings-session-log` | `src/client/UploadRow.tsx`、`src/client/upload-preference.ts` | 会话日志行与 stub 类型 |
| `@deepseek-ai/dsh-client-ui-chat` | `src/client/transcript-view.ts`、`src/client/performance-usage.ts`、`src/client/settings/LinkOpeningRow.tsx` | 工作步骤展示/性能用量/链接打开的真实官方策略 |
| `@deepseek-ai/dsh-client-ui-conversation` | `src/client/input/submission-policy.ts`、`src/submission-settings.ts` | 繁忙时发送行为的官方策略与命名空间 |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | `src/client/PluginInventorySettingsTab.tsx` | 内置插件只读清单 tab（匿名面板直渲；`settings.plugins.tab` 槽在 access gate 内没有 registrant） |

Agent 预设分区不新增 `sourceEntries`：`AgentPresetSection` 与 `AgentPresetSectionController` 由本仓已标记 fork `@dsh-base/client-agent-preset` 导出（该 fork 的 `dshBase.reuse.gaps` 记录了这一导出扩展与显式 `remote.agentPresets` face 的适配）。

以上设置相关入口已对照 `dsh-v0.2.2-rc.5`（`9c2670d3bce5275e0d1610272958121af87787bb`）。两个包的 `sourceReviewCommit` 均指向该提交。每次升级固定版本都需复查这些 `./src/*` 条目。

## 历史部署验收（2026-11-10 记录，非当前版本）

以下保留当时部署的预设与模型验收记录，不用于证明当前工作树或后续部署。最新已验证版本与证据见[完成状态](completion-status.md)。

staging Worker `c2cb26b1-af74-4bbe-811b-2172c5070e11` (deployment
`c3fec801-0106-474b-935c-273c87f81251`, 100% traffic) restored the official
Agent preset catalog and read-only declarations through a complete marked fork
of `@deepseek-ai/dsh-client-ui-agent-preset`, and separates a platform
limitation from a real load failure. English and Chinese zero-model acceptance
verified four official rows in a neutral gray unavailable state plus canonical
`dsh-base-think`, all four pinned declarations, Coding Tools 5↔3, pointer/
keyboard guards and reload default, with the fork active and the official
original disabled inventory, and the fixed composition is displayed as `Cloudflare Think` / `Cloudflare Think 模式` (canonical id unchanged). Real declaration-load failures still render the
official red broken card/alert.
模型设置保留官方 DeepSeek provider 与编辑器，并通过官方 provider-card slot 新增独立的运营者托管 Cloudflare AI Gateway provider 卡。Host 目录/选择使用显式 provider 身份；Gateway 与 DeepSeek 分别执行，owner key 异常只影响 DeepSeek；旧 bare id 仅保留带标记的兼容路由。 General Settings shows the app version and the pinned upstream DeepSeek Harness name/tag on one localized line, with native links to the pinned repository and release URL. Settings → Built-in plugins also restores the official **Session plugins** group: Cloudflare Think is the six-row default composition from the shared `dshBase.agent` reader, the four pinned official declaration compositions are read-only through the official `definitionComposition` projection, and the global group remains the real client Loader inventory. Declared rows keep `fiberPhase: null`; no execution is claimed. This changes **catalog/read availability only**: official Standard/PTC/Minimal/
Cordis execution remains unavailable on this Workers-native Host, and
selection/creation with official ids continues to be refused rather than
aliased.

## 已登记的实现与偏差

以下记录当前保留的实现及其批准范围；历史部署中的存储状态不作为当前数据状态证明。

- 语言设置：Commit 2（P4a）恢复已批准的显示名 fork `@dsh-base/client-locale-label`（`dshBase.forkOf`：`@deepseek-ai/dsh-client-locale` / `packages/client/locale` / pin commit / MIT）。官方 locale 行保留为 disabled inventory，fork 以 `replaces` 接管；唯一差异是内置 `zh` 显示为「简体中文」，内部 id、持久化、`/zh-CN` 路由、语言选择器与全部词典保持官方。`pnpm check:locale-fork` 做漂移守卫：fork 的 `src/` 必须等于 pin 官方包加恰好两处批准修改，出现第三处差异或 `forkOf.commit` 与 pin 不一致即失败；升级流程见 ADR §9.5。

- 侧栏品牌使用用户 2026-11-13 批准的显示文字接缝 `@dsh-base/client-brand`：只占用官方公共槽位 `sidebar.brand.name`，侧栏显示代码名 `dsh-base`（各语言一致）；产品显示名 `DeepSeek Harness Base` 用于 README 与文档，不进入侧栏。官方 brand 插件在非 official 构建下本就不注册（保持 enabled 的 no-op），mark 走 SidebarRoot 官方 fallback（`FishLogo` 与点击复制版本），布局、排版与交互全部沿用官方，无 CSS、无 fork、无复制源码；官方品牌插件保持官方默认启用状态。唯一无法避免的差异：官方 name fallback 内部同时渲染版本行与点击复制版本，占用该槽位后这段内容随 fallback 一起消失；设置页的版本行不受影响。

- Commit 2 P7 恢复 `@dsh-base/cloudflare-think-subagent` 的**声明不可用 + 兼容导出**，不是子代理能力恢复：模型工具目录为空、不注册 `delegate_task`，系统提示明确写 `SUBAGENT_UNAVAILABLE_REASON` 并禁止声称已启动子代理；`DshSubagent` 类名与 Worker 导出保留、继承官方 Think 存储，但模型/turn/step/tool 入口统一带原因拒绝；交互式控制返回 `subagent/unavailable`。Commit 1 的 `deleted` 迁移已清空历史 facet，**当时部署存储为空、无历史可验；这不是当前数据状态的证明**，文档只能写兼容导出而不是历史读取可用；Worker `DshSubagent` Durable Object 以 sqlite 存储复活（原 `state: "deleted"` 墓碑为 stale，B 态部署日志已证），首次读取为空，不伪造历史。

- 侧栏 More 的自有“关于 / 联系支持 / 环境”三行已按用户本次要求移除，替代旧 P6 偏差批准。`client-shell-extras` 在元数据和 pack 清单中保持禁用；后续全局站点功能已为品牌消费者重新启用 `client-site-config`，见下文。标记的 `client-entry-customization` fork 保留官方浏览与创建入口及布局；浏览公开目录不要求登录，匿名创建先打开登录弹窗。登录后仍受真实 Host 能力限制；入口可点击不表示 Creator 执行已实现。

- Plugins 页由完整标记的 `@dsh-base/client-plugin-manager` 官方 fork 承载，原始包保留为禁用清单。用户明确批准的差异仅针对 Host 标记的未适配目录项：灰色“不可用”替代异常胶囊，列表撤掉重复 OS 红字与“未安装”，详情保留安装事实及 Workers 原因；真实错误、未标记条目、布局、图标、配置槽与管理操作沿用官方实现。目录字段 `deploymentAvailability: "not-adapted"` 独立于 error，开关仍禁用，Host 启用请求仍拒绝；不通过全局翻译或 CSS 隐藏错误。owner 开关仍由 `toggleable: "L1"` 的 pack 管理范围生成，动态安装/升级/卸载等 Workers 不支持的操作仍明确拒绝。

- 公开站点元数据由自建 Worker SEO 插件提供，sitemap、robots、manifest、llms.txt 与统计由独立插件负责；这些包含产品行为的插件不归类为兼容接缝：服务端改写 `<html lang>`、`<title>`、description、canonical 与 hreflang，并为 `/app/session/:id`、`/app/workspace/:id` 等私有文档注入 `noindex, nofollow`；`/sitemap.xml` 与 `/robots.txt` 返回真实内容与正确 content-type（此前是 200 + SPA HTML 软回退）。公开 URL 前缀由共享模块 `@dsh-base/locale-path` 统一生成：中文用 `/zh-CN`，其余六种用官方裸 id（`/ja /es /fr /de /pt /ru`），英文裸路径；`<html lang>`/`hreflang` 用 BCP-47（`zh` → `zh-CN`）。八种语言的工作台首页使用各自的规范地址，并通过 hreflang 互相引用。允许收录的生产部署将这些首页列入 sitemap，Staging 提供空 sitemap。大小写变体（`/ZH-CN`、`/JA`）与 `/en/*` 由模块生成的 `canonicalPath` 301 到规范形式，退役的 `/zh` 是普通路径、不再有语言语义。客户端 `client-locale-url` 只同步前缀（保留路径/query/hash），首屏 `lang`/`title` 由服务端 `renderHtml` 负责。`/api/site-config` 只返回白名单公开字段（环境标识、品牌名、公开链接），不读取任何 secret。

- Commit 2 恢复 Cloudflare AI Gateway 托管 provider（P2）。Think provider 只认领显式 `cloudflare-ai-gateway/*`，BYOK provider 只认领 `deepseek-official/*` 与历史裸 id，两个方向都不回退；平台路由必须同时满足 `PLATFORM_AI_ENABLED=true` 与 `AI_GATEWAY_ID`，否则在发出任何出站请求前失败（零出站），模板与 `deployment.example.json` 默认关闭。裸 id 在没有 owner key 时明确报错，不再隐式消耗平台额度（ADR §12，属有意行为变更）。Models 页恢复官方 slot 内的 Gateway provider 卡；平台关闭时卡片保留并显示本地化不可用原因（不隐藏、不伪造可用），绿灯沿用官方 `credentialDot` 语义：表示平台认证已就绪，不是 API key。

- 本轮用户批准新增“Dsh-base 全局”分组与站点配置编辑能力。官方没有站点 SEO 编辑插件；`client-global-settings` 使用原版 `plugins.bundle.config` 与公开的 SettingsForm/SettingsValueField，不修改官方管理页布局。`client-site-config` 为真实品牌消费者重新启用；`client-shell-extras` 继续禁用，关于/支持/环境菜单不恢复。侧栏仍使用原名称槽和官方图标，名称改为读取与 SEO 同源的已发布站点名称（本 Staging 默认仍为 `dsh-base`）。全局编辑权限由服务端账号 ID 列表判断，普通账号可查看。保存版本冲突与故障保留草稿并明确显示，不虚构成功状态。

## SaaS 侧栏账号边界

官方 Web Host 已具备宿主访问权，其模型账号退出不等于 SaaS 匿名访问。经用户在 2026-11-17 更新的明确要求，侧栏在两态均保留可点击入口：公开插件目录和自动化页面可先浏览；新会话、工作区操作及账号管理在操作时请求登录。标记的官方 fork 保留布局、图标与菜单；`client-public-navigation` 组合官方导出页面与公开 metadata，未读取私有任务、配置或账号启用状态。检查中和错误状态仍明确说明不可用，登录不会绕过真实 Host 能力检查。

用户在 2026-11-17 保留本地登录弹窗结构与分步流程，同时要求恢复官方 DSH 外观，覆盖此前 ChatGPT 视觉要求。`client-auth-login` 直接组合稳定导出的官方 `Modal`、`Button`、`Input`；使用官方默认标题、说明、关闭按钮及主题样式，不保留外观覆盖。官方账号插件使用 Platform 授权，本地用户名/邮箱与密码仍由 Better Auth 实现；这一账号流程差异保留在 metadata，而旧视觉偏差已撤销。启用 Google 登录插件并配置 Google OAuth 后可使用 Google 登录。Apple 和手机号入口保持禁用。所有工作区、任务和管理 API 保持服务器鉴权，未登录点击只打开弹窗，不先发送失败的私有请求。本段描述当前工作树；上线状态以完成状态页的具体版本和验收范围为准。
