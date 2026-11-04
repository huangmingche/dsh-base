# Session Wire

Worker Host 与浏览器共用的纯传输适配器，把持久消息和真实执行状态投影为官方 Session 日志，不复制官方源码。官方 mux、旧 Host 载体和历史分页使用同一投影。

一个用户 requestId 对应一个 turn；模型调用和工具执行构成多个 step。等待审批不结束 turn，拒绝工具保留错误结果并允许模型继续解释。完成、失败、取消和 fork 截断只采用 Host 的真实状态。排队输入不会越过当前执行；旧消息身份只使用 Host 明确证明的映射。

新执行记录每个 SDK step 的稳定身份、开始时间、结算时间和工具时钟。Host 将一个 SDK 消息展开为相同身份的逐步记录，实时结算与刷新历史不会重复步骤。审批后晚到的工具结果延长原 step，保留原助手结算时间。实际工具参数通过官方 `tool-call-delta` 流传给原样工具节点，参数生成时即可显示 preparing 状态，不提前伪造持久工具调用。

进入 Step 的起点独立于 assistant 消息持久化。首个 token 前失败或取消时，即使没有 assistant 行，live 与重载仍生成同一个 Step，以真实进入时间开始、权威终态时间结束。尚未进入模型 Step 的输入不会凭空产生 Step。

fork 保留 Host 提供的官方 `buildForkSeed` 精确日志前缀与截断闭合事件；继承消息不重新生成事件，新输入接在该 seed 后。模型选择采用官方 `{ lastUsed, next }`，并保留 reasoningEffort。`lastUsed` 来自受信执行请求记录；实际 provider 响应型号作为独立证据保留，未知响应或旧来源不会用当前选择补齐。

Host 的持久 projection revision 与聊天日志 cursor 是独立域；snapshot/control 对投影只比较其 revision。历史缺少真实终态、时钟或来源时明确保留未知。Think 执行引擎仍与原生 DSH 引擎不同，契约映射不等于完整引擎等价。

`pnpm check:session-wire` 直接运行 pinned 官方 Conversation assembler、turn-process、tool definition 和真实 ModelDirectory，覆盖工具准备态、逐步结算、审批晚到时钟、重复帧、重新加载、精确 fork seed、Pro/effort 持久投影及错误终态。测试不访问模型；部署后的真实浏览器流程仍需单独验收。
