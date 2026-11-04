# 官方客户端的 Workers Host 兼容接缝

本插件向官方 DSH 客户端提供 Workers Host 服务。UI 布局和交互由官方插件负责，服务适配不复制官方源码。

访问服务直接挂载原样官方 `dsh-api-remote-access/client` 与 Typert registry。接缝内部隔离的原样官方 Gateway 是真实 Connection 的唯一 generation owner，负责 `$events`、断连恢复和生成式 `$mount`；现有 Host namespace 由 Cordis facade 保留。官方生成器从固定子模块生成声明及 `/remote` 运行模块到忽略的 `.artifacts/typecheck`，不修改或复制上游源码。生成目录的第三方依赖按 Vite browser/import 条件解析到应用安装，不改写或 externalize 生成模块。Host 按认证用户解析真实 owner DO 后才发送访问 baseline，客户端在 baseline 到达前没有权限；共享非 owner Peer/grants 尚未实现，不伪造。旧 wire-bootstrap 保留为禁用库存。访问快照与智能体工具权限相互独立。

设置和定时任务通过官方 Connection RPC 调用 Host。设置描述、命名空间、版本冲突和持久化结果均以 Host 为准；网络故障、拒绝和缺失能力不会转换为浏览器内存中的成功。Schedule 完整页面及其侧栏、详情和会话贡献由官方 ui-schedule 提供。

原样官方权限插件读取真实会话权限目录、持久 `/permission` 命令回执和 Host 权威投影。Worker/Think 权限服务执行 R2 操作检查及审批策略；客户端不制造权限结果。已认证 owner 的 SSE 变化流使设置、任务及凭据在标签页之间刷新；初次连接和重连快照关闭读取与订阅的竞态，重复 revision 不触发刷新循环。通知仅含 revision/topic，不含私密值。

在仓库根目录验证：

```sh
node packages/client/dsh-base-client-session-adapter/tests/remote-access.test.mjs
node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/settings-remote.test.ts
```

访问测试贯穿真实 Cordis、Connection、Gateway、Typert、RemoteAccess 与 Worker mux，覆盖认证 baseline、九个效果、逆序释放、失败回滚、调用方卸载、1006 后真实 generation 恢复和再次挂载。请先运行 `pnpm check:types` 生成官方 `/remote` 运行模块。RPC 测试覆盖参数、CAS、错误细节、网络拒绝及权限命令的真实回执、拒绝和无效回执拦截。

固定版本升级时必须重新审查 `dshBase.reuse.sourceEntries`。完整复用说明见 [REUSE.md](REUSE.md)。

凭据读取/写入直接返回 Host 结果，缺少传输或网络失败不会伪装成空配置或成功写入。旧的未注册 `sessions` 假实现已删除，实际会话生命周期归官方 api-session-controller。插件目录来自实时 composition inspection，保留禁用原件、来源和观察到的 fiber 状态；管理动作不可用；这些是运行时行，不是已安装 bundle，真实库存由官方设置中的内置插件页面展示，bundle 目录为空。

日志反馈服务尚未实现，所有官方反馈入口保持可见禁用，Remote 和 `/feedback` 明确拒绝。settings sidecar helper 的双层 Result、版本冲突与 CAS 回归保留为未挂载协议测试，不代表日志反馈能力。

补充验证：`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/chat-feedback.test.ts`、`node packages/client/dsh-base-client-session-adapter/tests/feedback-contract.test.mjs`、`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/plugin-inventory.test.ts`。

目录选择复用原样官方 browse 插件，目录读取/创建按原参数调用 Host；创建文件夹与注册工作区分开，原生系统选择器明确不可用。工作区文件只来自真实 Host 文件服务，不再以虚拟对话文件掩盖失败。智能体目录只描述Cloudflare Think 模式组合，切换和读取官方声明不可用且官方控件可见禁用。账号读取/退出检查真实 HTTP 结果；账单服务返回官方允许的缺失值，由可用性接缝禁用账单入口。`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/host-capabilities.test.ts` 覆盖这些失败与传输契约。

文件引用遍历的 Host 故障及取消会保留失败，不返回伪造的空/部分成功结果。上传保持官方 FileUploadRuntime、后台 Worker 与进度逻辑，encoded 文件及历史附件走真实 Host RPC；历史图片的 base64 由官方 Session 客户端解码。未配置图像处理 binding，因此图片数量上限为零，原官方 picker/drop 本地化拒绝图片；Host 同样返回 `IMAGE_PROCESSOR_UNAVAILABLE`，共享文件入口仍用于普通文件，不宣称视觉能力。验证：`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/attachment-remote.test.ts` 和 `node apps/web/tests/parity/run-upload.mjs`；后者是受控 HTTP 下的真实官方浏览器协议测试，真实 R2 回执消费另由 Host 验收覆盖。
模型和推理强度完整传给 Host，仅投影真实确认值。旧 Host 若忽略请求中的 effort，接缝明确拒绝；不把输入回显当作执行成功。`tests/model-selection-remote.test.ts` 覆盖透传、确认值、缺失确认及传输异常；`tests/owner-invalidations.test.ts` 覆盖跨客户端通知、重连、去重、坏帧及生命周期。


投影版本由 Host 的 SQLite 事务生成，与聊天事件游标独立。所有 baseline、控制帧、rename 回执和旧 SSE 接缝使用同一服务器版本；客户端不再用 `Date.now()` 构造序号，也不在收到快照后读取更新的 state 重算旧版本值。缺少真实版本的旧 Host 会明确失败。这个版本域仍不是官方统一事件日志的 consistent cut，保留为已登记兼容差异。

`$stream` 直接使用官方稳定导出的 `RemoteStream`。只有物理载体故障转换为可恢复的 CarrierError；业务及协议故障保持终止，旧传输回退仅用于真实 endpoint-unavailable。审批使用官方 `PendingApproval` UI waterfall，按 Session 保留 scope、AbortSignal 和单次读取；只有明确用户决定才提交 Host，异常不会自动拒绝，变更通知可重试同一决定。只有已经明确选择的决定遇到瞬时网络/HTTP 失败时，才按 250ms、1s 最多两次幂等重试；连接恢复和 owner baseline 也触发恢复。读取待审批项没有轮询 interval，UI 异常、撤回与取消绝不会转换为 rejected。
