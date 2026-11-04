# @dsh-base/cloudflare-worker-session-host

Workers-native fork 目标：官方 DSH Session Remote 契约。

## 状态

已进入 Worker composition。它实现官方 `ui-conversation` / `ui-chat` 所需的
Workers-native Session Host，并在同一个 Durable Object 上提供官方 `session/*`
RPC 桥：

- session list / cursor、state、history page 与完整转录 `history` 读取、projections
- rename / selectModel / models、create / fork
- prompt / claim / cancel / updateQueue
- durable event journal + follow()、control() SSE（自定义 transport 的内部实现）
- 官方 `session/*` RPC 端点（unary：list/state/projections/page/create/fork/rename/selectModel/modelCatalog/cancel/prompt）
- Host tasks：durable schedule store + alarm 引擎（after/at/every/daily/weekly/cron/rrule），官方 schedule/* 端点与 delivery history
- 后台维护任务：durable interval 注册 + run journal（cleanupFiles / pruneSchedules / recoverSubmissions），由 alarm 执行
- 加密凭据：AES-GCM（`CREDENTIALS_KEY` secret）存储、describe/set/unset；claim 时解密注入 Think；仅在未配置 BYOK 且部署显式允许平台调用时回落 AI Gateway，模板默认关闭平台调用
- 持久 settings 文档：`settingsDescribe` / `settingsMutate`（revision compare-and-set，冲突返回 settings/conflict）
- 审批：`pendingApprovals` / `resolveApproval`（approval-gated toolCallId 与 durable-pause executionId），批准后的 continuation 会同步回 durable transcript
- 官方 `session/state` 队列投影 + `session/updateQueue`（edit/remove；steer 显式不可用），alarm 成功 claim 后会继续调度下一条 queued 输入
- 普通文件上传：官方二进制/Remote 入口把字节持久化到 owner 隔离的 R2，receipt 与 prompt 原子准入；Think 按需校验读取，不复制整文件到 Agent SQLite。图片处理器不可用，官方 intake 保留并按零图片上限本地化拒绝；不沿用旧构建的图片推理成功声明。
- 真实 workspace 文件：R2 `FILES` 保存不可变版本、DO SQLite 保存元数据；官方 `workspaceFiles/list|stat|read|readBytes|changes` 桥与 `Conversation.md` 首次读取播种
- 官方 `toolResults/watch` mux 流：把 durable `tool/result` 事件投影成 tool result inspection value
- 官方 `workspace/*` RPC 端点（unary：create/initializeDefault/rename/delete/insertBefore/insertSessionBefore/archiveSession/unarchiveSession/pinSession/unpinSession），复用同一个 Workspace registry、排序与 archive/pin flag
- 官方流式端点 `session/follow`、`session/control` 已通过 Worker
  `/api/remote.mux` 的 logical stream 提供（`src/remote-streams.ts` + 共享
  `@dsh-base/session-wire` 事件投影）；assistant token delta 仍走 Agent 直连的
  `/api/agent-live` WebSocket。
- 官方工作区流 `workspace/follow` 订阅提交后的 owner 变更并读取 `workspaceState()`，先发
  `baseline`，状态变化时发完整 `replace`（`src/remote-workspace.ts`）

## 归属与持久性

- **创建与重试**：底层 Host `create` 在同一 SQLite transaction 中创建 Session 与 Workspace membership；同 ID 重试不覆盖模型、标题、时间戳、历史、队列、状态或位置。官方 `session/create` 复用同目录、同请求 Workspace 中未归档的空会话；已有内容、正在运行或已归档时返回真正的新 Session ID，旧会话保持原样。目录冲突返回 `session/conflict`，不存在的 Workspace 返回 `workspace/not-found`，同时传 `workspaceId` 与 `cwd` 返回 `gateway/bad-request`。
- **目录边界**：`cwd` 只能指向已经注册的 logical Workspace。不支持在任意未注册目录创建官方 ungrouped Session，明确返回 `gateway/endpoint-unavailable`，不会忽略路径或自动制造新的 Workspace；该差异记录于 package reuse metadata。官方 composer 使用 `workspaceId` 的流程可正常复用已有空会话。

- **按账号隔离 Agent**：Client 只知道 `sessionId`，Worker 映射成
  `owner:<userId>:<sessionId>` 的 Agent DO 名；`/api/agent-live` 与
  `/agents/...` 都做 owner 校验，两个账号即使撞同一个 `sessionId` 也不会共享
  Think 历史。
- **Alarm 驱动 claim**：`prompt` 只持久化 submission 并设置 DO alarm；即使
  composer 标签页在 claim 请求落地前关闭，alarm 也会把回合跑完。claim 是幂等的
  （alarm 与浏览器并发 claim 时按当前 Host 状态返回）。
- **原子替换**：消息整表替换使用 `DurableObjectStorage.transactionSync`，
  follow/page 不会读到 DELETE 与 INSERT 之间的半成品。
- **稳定数据身份**：保持已部署的 `owner:<userId>:default-v49`；代码升级不再更换
  DO 名。`SESSION_HOST_STORAGE_ID` 是持久数据地址，应用绑定仍指向 `default-v49`。
  旧代数据恢复先读取并验证快照和 R2 sidecar，再在一个 SQLite 事务中导入、
  验证行数并写完成标记。任何阶段失败都会返回可重试的 503，禁止建立空默认状态。
  已有账号数据保留，重复恢复不覆盖当前数据。

## 上游来源

- 包：`@deepseek-ai/dsh-api-session-controller`
- 路径：`packages/api/session-controller`
- commit：`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- license：MIT
- 官方源码只存在于 `.submodules/deepseek-harness`；本包只做 Workers-native 适配。

## 验证

```bash
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/contract.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/agent-name.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-workspace.test.ts
```

## Worker API

Worker 路由：

```text
POST /api/session-host
GET  /api/session-host/follow?sessionId=...&after=...
GET  /api/session-host/control
```

`follow` 返回 SSE：

```text
event: session
data: {"seq":1,"type":"submission.queued",...}
```

请求：

```json
{ "method": "list", "params": {} }
```

支持：

```text
create / list / state / page / history / projections / rename / fork
selectModel / models
```

持久化：`SessionHostObject` Durable Object + SQLite。

## 验证

```bash
pnpm check:session-host
node apps/web/scripts/acceptance-session-host.mjs
```

## 官方 session RPC 桥

`src/remote.ts` 在通用 `wireRpc` 服务上注册官方 unary 端点：

```text
session/list      session/state       session/projections
session/create    session/fork        session/rename
session/selectModel                   session/modelCatalog
session/cancel    session/page
```

每个端点接收官方 `{ args }` 载荷，并通过 `handleSessionHostRequest()` 分发到与
`POST /api/session-host` 相同的 `SessionHostObject`，因此官方和自定义调用共享同一份
持久化数据。错误以 Remote 信封返回（`gateway/arguments-invalid`、
`gateway/bad-request`、`session/not-found`、`gateway/internal`）。

`session/page` 通过共享的 `@dsh-base/session-wire` 事件投影构建完整持久转录，因此
`event.seq` 与 `session/follow` 快照处于同一稠密序列空间。`throughSeq` 是包含式截断
（`-1` 返回空页），`beforeSeq` 是更旧一页的排他上界，`maxMessages`/`turnWindow`
按官方向后截断规则生效。direct-subagent 地址返回 `session/subagent-unavailable`；
超过已观察日志末端的切点返回 `gateway/bad-request`。

`session/fork` 桥接受原始或投影后的 `messageId` 与官方 `atSeq`。投影后的
assistant ID 保持稳定；`atSeq` 精确保留已存在的事件前缀，直接复用官方
`buildForkSeed` 关闭开放工具/步骤，不复制切点之后的结果。前缀持久保存，
刷新、继续对话和再分叉不会恢复被排除的内容。`prompt` 保留在自定义 transport。

### 官方 workspace RPC 桥

`src/remote-workspace.ts` 在同一 `wireRpc` 服务上注册官方 unary 端点：

```text
workspace/create                 workspace/initializeDefault
workspace/rename                 workspace/delete
workspace/insertBefore           workspace/insertSessionBefore
workspace/archiveSession         workspace/unarchiveSession
workspace/pinSession             workspace/unpinSession
```

- `create` 按 path 幂等解析，返回 `{ workspace, created }`；`initializeDefault`
  返回 `{ workspace }`（无默认 Workspace 时返回 `{}`）
- `insertBefore` 返回完整 `{ workspaceIds }`，`insertSessionBefore` 返回
  `{ workspace }`；两者都重排 Host 的 position 并按官方错误码返回
  `workspace/not-found` / `workspace/move-invalid`
- `archiveSession` 在同一 SQLite 事务中检查 queued/running/awaiting-approval/continuing turn 和 active targeted schedule；未指定 `stopActivity` 时按官方 `workspace/session-active` 返回活动明细。指定 `true` 时先持久化归档、清除 pin 并删除活动定时任务，再取消 Think 请求；失败保留归档并由 alarm 重试。Prompt 原子准入及 Think 的 model/tool step 都检查归档状态。返回完整 `{ archivedSessionIds }`。动态子代理执行已显式禁用，不注册 `delegate_task`；历史 facet 保留存储与读取，但 model/turn/step/tool 入口统一拒绝。官方 descendant-lineage 活动/停止生命周期仍未实现，不宣称等价。
- `pinSession`/`unpinSession` 返回完整 `{ pinnedSessionIds }`。Host 不新增排序列：
  flag 行按 `rowid` 记录写入顺序，`INSERT OR REPLACE` 让新 pin 排到最新；对已
  pin 的 Session 重复 pin 不写 flag，因此保持原位置（与官方 registry 一致）。
  unpin 后重新 pin 会回到最前；其它 flag 写入不影响仍处于 pin 状态的相对顺序
- `workspace/follow` 是 mux logical stream：首帧 `baseline`，之后每次变化发送完整
  `replace`；仅由提交后的 owner 通知触发读取，相同状态不重复发帧，读取失败显式结束流；流取消即释放订阅。内部 SSE 每 15 秒最多发送一条纯注释保活，受消费者背压约束；仅保留一个待完成的迭代器读取，取消会清除计时器。这不产生状态轮询、领域事件或投影版本，也不掩盖真实 WebSocket 断连

所有失败都以 Remote 信封返回（`gateway/arguments-invalid`、`gateway/bad-request`、
`workspace/not-found`、`workspace/move-invalid`、`session/not-found`、
`gateway/result-invalid`）。

## 执行权威与恢复

Think 是已经准入的消息与执行结果的权威；Host 是未准入队列、会话目录、设置和调度的权威。
新建或 fork 的空 Agent 只从已完成的 Host 历史初始化；已有 Agent 历史不会被覆盖。
提交使用同一个 `requestId` 幂等准入；Host 失去 RPC 响应后，alarm 重新连接同一项 Think 执行，
不会凭经过两分钟就把回合判定失败。SQLite 原子写入提交、用户消息和队列事件；同步 Agent
转录时原子保留尚在队列中的输入。取消先送达 Think，持久取消标记也阻止延迟到达的准入。

`page` 与 `history` 在同一个 SQLite 快照读取消息及输入生命周期。同一个持久 request
拥有审批前后的全部 assistant step；等待审批仍属活动状态，后续排队输入不能越过它。
审批决定与续跑状态原子提交，alarm 恢复该决定，不重新提交原始 prompt。多个并行工具
审批须全部回答后才继续模型；拒绝工具仍可能得到正常完成的模型解释。只有 Think 的
真实终态才能发布 completed、failed 或 cancelled。已归档的待审批输入在取消传输失败后
仍会由 alarm 补偿取消。

审批仅接受 `approved`、`rejected` 及官方 Allow once 入口的明确兼容值 `allowed-once`
（持久化前归一为 `approved`），并验证互斥的工具/执行身份。可操作审批卡必须关联 owner 内真实、非终态的
输入；已取消、失败、归档及 fork 截断历史不能授权动作。旧随机 user id 只有在 prompt
存在唯一一对一关系时才显式传给 Think；有歧义的旧记录或导入历史保留 unknown，不编造
完成结果或耗时。Fork 保留已证实的终态，截断中的回合使用官方 `forked` 结果。
每个 assistant step 的模型来源取自当次实际解析的模型，并保留于 Host 历史；该元数据
不会进入模型的历史输入。缺少证据的旧消息来源保持 unknown，不按当前会话选项倒推。

初始执行及审批续跑的 steps 按实际 `step-start` 分区统计，不按 assistant 数据行计数。

SDK 续答消息携带的重复 Step 证据按稳定身份去重，工具结果按同一用户轮次内的真实 SDK `toolCallId` 合并，旧 input 快照不能覆盖已记录的结果。读取旧版本损坏的 completed 历史时，Host 只读取 Agent 的持久消息，事务重验 request/row/call 身份后补回真实 terminal 工具结果；不调用模型或工具，不改变消息顺序、执行状态或累计计量。证据缺失保留未知，传输或事务失败显式返回可重试错误。

续跑统计从 Think 的持久 SDK requestId 快照读取；累计指标与去重标记在同一次 projection
写入中保存，终态写失败后的恢复不会重复累加，逻辑 turns 也不会因审批增加。
只读 `runtimeInfo` 返回该 Host 自身的 `WORKER_VERSION.id`，供部署后验收精确等待版本就绪。

会话权限通过完整标记的官方 permission-presets fork 实现，R2 操作逐次检查持久策略。
默认值只影响新会话，`never` 拒绝需要审批的操作。它不声称提供原生进程沙箱或网络策略。
设置 `update` 深合并对象、替换数组/标量，保留 revision 冲突检测；原生设置文档不可用，
`hasDocument` 为 false。Theme、locale、developer-tools 默认值按锁定的官方契约提供。

审批策略的官方通知与权限事实原子保存，`approvalModelContext` 从同一快照返回官方当前策略文本和通知 outbox。读取本身不启动 Agent；Think 在下一真实步骤保存非人类上下文，保留原消息 ID/source 并在重启及 SDK 多步骤中去重，不改变用户历史、队列、turn 或累计计量。初始化、同值选择和失败事务不产生通知；新 fork 不继承父会话待投递通知。命令/通知尚未进入统一聊天日志，原生 inbox 的完整调度/取消语义仍是差异。

故障窗口验证：

```bash
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/migration.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/execution-recovery.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/contract.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/sqlite.test.ts
node --import ./tests/official-runtime-hook.mjs tests/turn-lifecycle.test.ts
```

官方 Schedule 表单提交的 DTSTART/RRULE 直接由 `@deepseek-ai/dsh-util-time` 的稳定 RRule 导出解析与计算，支持 TZID、DST、COUNT、一次性/每日/每周及官方其余受支持规则。修改 timing 会重算下一次触发；手动运行不消耗或移动原定 occurrence；迟到的定时运行采用官方最新到期 occurrence 语义。

凭据读取遵循 fail-closed：已保存的 BYOK 读取或解密失败会中断 claim 并等待重试，不会当作未配置密钥而静默切换至平台 provider。只有实际未设置 BYOK 时才使用平台回退。


## 目录浏览

官方 `directoryPicker/list` 与 `directoryPicker/createDirectory` 由同一 owner SQLite 的逻辑目录表提供，复用官方 `DirectoryListing` 类型。Host 负责绝对路径规范化、面包屑、隐藏项和子目录路径，单层最多返回 1000 项并如实设置 `truncated`。现有 Workspace 路径及祖先无需迁移即可浏览；创建目录不会提前注册侧栏 Workspace，选择后由官方 `workspace/create` 注册。并发重名创建返回 `directory-picker/exists`，缺失父目录和非法路径明确失败。`directoryPicker/pick` 不支持原生操作系统选择器，返回 `directory-picker/unavailable`。这是逻辑工作区，非宿主机器文件系统，差异记录在 reuse metadata。

固定 Agent composition 仅接受 `standard`；`session/create` 在写入前拒绝其它 preset，不回显伪成功。

```sh
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-directories.test.ts
```

## 普通文件上传

`POST /api/session/uploadFileBinary` 直接复用固定版本官方 `file-upload/src/http-route.ts`；`fileUploads/upload` 接受相同业务协议的 base64 请求。所有请求先按登录账号路由至原有 owner Host。普通文件最多 8 MiB，按 SHA-256 存入账号隔离的 R2；写入成功后才创建会话专属 receipt。上传中断或 R2 失败不产生可用凭据。未消费 receipt 24 小时后失效，由现有 `cleanupFiles` 维护任务每轮最多清理 50 条；积压按 5 秒分批继续，删除失败按 60 秒重试。上传开始前持久化对象清理意图，覆盖 R2 写成功但 SQL 登记失败或进程中断的窗口；即时删除失败也不会遗失重试记录。只有 R2 删除成功才移除相关元数据；仍被已提交历史、分叉或其他上传引用的字节不会删除。每次上传使用独立物理对象键，内容标识仍为 SHA-256，避免旧对象清理与相同内容的新上传竞争。

官方 `session/prompt` 的 file part 解析 receipt，凭据消费与用户消息、队列和事件在同一 SQLite 事务中提交。失败回滚；相同 requestId 重试返回原提交，其他请求不能再次使用 receipt。Think 直接读取已提交 R2 内容，校验长度和散列，不将整份文件复制到 Agent SQLite。文本预览和只读 `read_uploaded_file` 工具每次最多 64 KiB；二进制返回原始 base64，未配置 PDF 或 Office 解析器。

官方历史保留 FileAttachmentRef，不暴露模型展开后的上下文。分叉在单事务中复制展示历史及独立会话读取授权，共享不可变 R2 字节；重建执行历史将 file 展示引用转换为可读取的文本上下文。分叉失败不会遗留半建会话，也不会覆盖已有目标。

图片正规化处理器未配置。实际 Host projection 与 follow 流均声明 `maxImagesPerMessage: 0`，保留官方图片 MIME 类型，使原控件在选择/拖入时本地化拒绝；服务端图片上传、读取及旧图片 admission 同样明确报 `IMAGE_PROCESSOR_UNAVAILABLE`。旧持久数据不会删除，不宣称图像能力等价。

```sh
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/uploads.test.ts
```

## 本轮协议与边界

模型与 Effort 在准入事务冻结，审批沿用原配置；响应型号与请求型号分别记录。owner 推送替代观察轮询，连接取消会释放订阅。投影使用真实持久版本，与聊天游标分域；完整原生事件日志仍是差异。历史分叉继承源当前权限，不复制父会话请求回执或切点后累计用量。权限命令执行/结果/幂等回执原子落盘，失败显式返回；独立命令轨迹尚未合入官方聊天日志，不能声称完整原生命令展示等价。

访问控制：`remoteAccess/follow` 在认证 mux 身份对应的真实 Host 可用后发送官方 owner baseline，直到取消保持连接。请求不得指定 owner/grants，非 owner Peer 共享策略尚未实现；访问服务权限与智能体工具 preset 独立。回归：`node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-access.test.ts`。
