# 与官方 DSH 的差异及边界

对照源只使用 `.submodules/deepseek-harness` 的 `dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）。更新于 2026-11-10。本文记录工作树能力；具体构建、部署和验收版本以 [完成状态](completion-status.md) 为准。

**尚不能声称整个产品已达到官方 DSH 的 100% UI/UX 和执行语义等价。** 清单覆盖、实际插件激活、组件对照和完整产品行为是不同层次的证据。禁用入口只是如实呈现缺口，不等于完成该功能，也不构成保留差异的批准。

## 本轮纠正的实现缺口

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

长连接可能被 Cloudflare 回收，但“断连后无法恢复”不属于必须保留的平台差异。本轮同步浏览器和 Tail 在旧中间版本捕获一次 `loadShed` 与 `session/follow` 的 1006 断连；它不证明固定超时或具体 CPU/内存原因。官方 [WebSocket 生命周期](https://developers.cloudflare.com/workers/runtime-apis/websockets/#connection-lifetime) 也要求客户端重连并恢复状态。适配层必须沿官方 RemoteStream 契约恢复物理载体故障，同时保留真实业务和协议错误；对应修复及最终云端验证以完成状态为准。

## 尚未完成的集成，不能称为平台硬限制

| 差异 | 缺少什么，为什么还不能启用 | 保留的边界 |
| --- | --- | --- |
| 图片输入与模型视觉 | 官方 attachment-local 使用 Sharp、完整解码和精确归一化验证。Cloudflare Images/WASM 提供实现路径，但当前尚无通过同等 EXIF、动画、alpha、颜色空间、像素/字节预算及批次原子入库验收的适配器。 | 官方文件入口仍在；图片限额为零，服务器明确拒绝。普通文件可上传，不能把 base64 当已完成图像处理。 |
| Agent 读取 PDF/Office 内容 | 浏览器官方预览已实现；Agent 侧仅能按授权读取原始文件。缺少可验证的解析/转换服务和模型上下文适配。 | 不把预览成功或原始字节读取称为文档理解。 |
| 完整子代理、父子会话轨迹与取消树 | Think facet 与官方 Agents 的 Session 身份、凭据、inbox/step、所有权、持久 settlement、后代取消协议未完整接通。Worker/DO 可以承载并发子代理，限制是当前架构集成。 | 不注册虚假的 `delegate_task`；历史 facet 数据保留可读，执行明确拒绝。 |
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
| GitHub Template repository 开关 | 属于用户审查后的 GitHub 发布配置；本轮只部署 Worker，不进行 Git commit/push 或 GitHub 发布。 |

仅有两项已批准的品牌差异（2026-11-13 用户确认）：侧栏显示代码名 `dsh-base`（各语言一致），名称行不再显示版本（官方 name fallback 的版本行随槽位占用消失）。产品显示名 `DeepSeek Harness Base` 用于 README 与文档。设置中的版本保留。其他不等价点均继续作为待解决缺口，不以“最佳实现”或清单覆盖代替验证。


## Current deployed verification (`ef8fb5d4`, 2026-11-10)

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

- 语言设置使用官方 `@deepseek-ai/dsh-client-locale` 原样行为：内置 `zh` 显示为“中文”，内部 id 不变；旧 `client-locale-label` 显示名 fork 已随 Commit 1 移除，不再存在显示名偏离。

- 侧栏品牌使用用户 2026-11-13 批准的显示文字接缝 `@dsh-base/client-brand`：只占用官方公共槽位 `sidebar.brand.name`，侧栏显示代码名 `dsh-base`（各语言一致）；产品显示名 `DeepSeek Harness Base` 用于 README 与文档，不进入侧栏。官方 brand 插件在非 official 构建下本就不注册（保持 enabled 的 no-op），mark 走 SidebarRoot 官方 fallback（`FishLogo` 与点击复制版本），布局、排版与交互全部沿用官方，无 CSS、无 fork、无复制源码；官方品牌插件保持官方默认启用状态。唯一无法避免的差异：官方 name fallback 内部同时渲染版本行与点击复制版本，占用该槽位后这段内容随 fallback 一起消失；设置页的版本行不受影响。

- Plugins 页面由官方插件原样承载并保持官方列表/详情/空态与样式；插件清单是只读投影（适配 seam 提供，无 owner 级开关、无写接口），不可管理项保留真实只读原因。Add plugin 与安装、升级、registry、物理卸载一律返回明确不可用原因（部署 Worker 无包管理器/进程运行时），不伪造成功。

- R1（已随 Commit 1 移除）：Cloudflare AI Gateway 托管 provider 整体删除，部署为 BYOK-only；设置 → Models 只保留官方 DeepSeek provider，不存在 Gateway 行、绿灯或平台认证状态。
