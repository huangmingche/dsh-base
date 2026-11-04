# Cloudflare Think Core

本插件以 Cloudflare Think durable submission 为执行权威，复用官方 DSH system-prompt 的公共入口，向 Session Host 提供准入、历史、取消及运行投影。它不是官方 DSH agent-loop 的等价实现；复用决策与差异记录在 `package.json`。

Host 使用稳定 requestId 提交，重连时恢复已有 submission；`ensureHistory` 只为尚无用户历史的实例播种，避免覆盖已准入执行。取消先写 durable tombstone，晚到准入仍会取消。父会话在 model step 和 tool call 前读取 Host 的 durable archive gate；Host 不可读时拒绝继续。已经发出的 provider 请求不提供 exactly-once 保证。动态子代理执行不可用；保留历史类绑定供已有记录读取，不提供虚假的 delegation 工具。

准入前独立更新当前分支中的指令快照，新快照追加到当前叶节点，避免 Think 批量 upsert 把旧上下文 ID 作为新消息的父节点而切断当前对话。旧分支上的指令记录先通过公开 Session 删除 API 安全拼接，再追加到活动分支。空文件或已删除文件会清除对应指令；Host 读取或 SQLite 写入失败会阻止准入，部分写入可重试。成功验证后才记录 requestId；重复准入及 marker 写入后的恢复不会重写指令。时间快照使用跨重启唯一 ID，下一次准入保留最新 20 条。

权限来自独立 fork 的官方 permission 服务，每次动作重新读取该会话的持久策略。`approval: never` 拒绝需要同意的动作，绝不自动批准 `remember_fact`；正在等待的审批由 Host 的持久策略和 alarm 恢复拒绝。逻辑 R2 模型写入有独立权限入口，用户显式文件编辑使用另一个服务。这里不提供 POSIX 进程 sandbox、任意 shell 或单次文件升级授权。

每次 `beforeStep` 读取官方 ApprovalService/SystemPrompt 生成的当前策略与持久变更通知。通知通过实际 Sessions 追加 API 保存为 `source:user-approval` 的非人类上下文，不唤醒模型、不成为新的准入请求或统计 turn。持久消息 ID 在重启时去重；私有 Symbol 关联在同一次 SDK 多步骤中识别已经插入的通知，既不按文本猜测，也不传入提供商参数。新输入刷新指令时保留这些通知。非法或不可读的权威策略上下文会阻止步骤继续。命令及通知的 canonical UI 日志、原生 Agent inbox 完整调度/取消语义仍是已记录差异。

验证由根目录 `pnpm check:session-host` 执行真实 SQLite Host 与 Think RPC port 的故障窗口测试，覆盖 RPC 响应丢失、重启、取消、归档 gate 和 usage replay。`tests/durable-context.test.ts` 另使用实际安装的 `agents/sessions` 与真实 SQLite 验证用户/助手历史保留、指令增删、旧分支修复及 Host/写入/准入故障恢复；不会访问生产 provider。

审批续跑通过 SQLite 事务保存逻辑输入、SDK 请求、审批决定与 continuation intent 的映射。`beforeTurn` 从实际已准入历史识别用户，实时帧携带该 requestId；`onChatResponse` 只更新匹配 SDK 请求的状态，旧 hook、取消后迟到结果及丢失 RPC 响应不会伪造完成或重复准入。并行审批齐备后才续跑，拒绝也是工具结果，不是取消用户请求。准备阶段可重试，SDK 已启动的执行交由其恢复机制处理，不盲目再调模型。旧随机消息 ID 只接受 Host 显式传入的已证明映射。模型请求参数在准入时冻结，审批续答沿用同一配置。受信请求记录更新 Host lastUsed；助手来源区分请求型号与实际 provider response.modelId，缺少响应证据时标为 unknown，保留 provider usage。切换模型或 effort 不会改写旧回答。

`tests/input-execution.test.ts` 使用真实 SQLite、已安装 Sessions、SDK 的实际工具审批转换及本包 hooks，隔离模型运输，覆盖同决定重放、冲突、并行审批、拒绝、错误、取消、旧 hook、重启、丢响应及旧身份别名。工具决定仍依赖 SDK 未公开的 `_applyToolApproval`，缺失时明确失败；模型续跑使用公开 `continueLastTurn`，这项兼容边界记录在 reuse metadata。

真实 `onStepEnd` 保存逐步累计统计，`onChatResponse` 按 SDK requestId 封存可重读快照；重复 hook 或旧 `takeTurnStats` 消费不会清除该持久结果。Host 对同一 SDK 快照只累计一次审批续跑的耗时、token 与 usage。无法从旧记录恢复的耗时不会伪造；页脚 turns/steps 由实际用户消息与持久 `step-start` 分区计算，包括同一 assistant 消息内的多个模型 step。

新执行通过实际 `onChunk`/`beforeStep`/`onStepEnd`/工具 hooks 记录参数流、step 身份和真实时钟；晚到审批工具时钟独立持久化，重新加载仍归属原 step。Host 将这些证据展开成稳定的单 step 行，模型种子过滤内部投影元数据。provider 未提供系统/工具 token 细分时，不用字符数估计冒充计量。

`beforeStep` 在推理和 live 推送前，通过可信内部 RPC 持久化 Step 起点；Host 同时校验冻结输入与真实 SDK 请求身份。写入失败会停止本次执行，重试沿用 Agent 已持久化的起点与身份。即使 provider 在首个 token 前失败、没有 assistant 消息，Host 历史仍能重建这个 Step，并用权威失败或取消时间闭合；不会合成模型回复。

旧 pending 请求若没有持久模型/effort 配置，不能可靠复原原执行，明确返回 `input_configuration_unavailable`。Host 保留审批与取消/重新提交路径，并停止盲目自动重试；不读取当前 picker 偷换旧请求模型。
