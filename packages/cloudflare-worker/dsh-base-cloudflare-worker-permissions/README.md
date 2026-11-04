# Workers 会话权限

本包是固定版本 `@deepseek-ai/dsh-permission-presets` 的完整标记分支。官方预设派生、默认值、命令、投影和三个权限事件的算法保持原样；只把必需的原生 shell 执行器依赖替换为实际执行检查的逻辑 R2 文件边界。它不是原生 shell、PTY 或操作系统沙箱。

来源为 `.submodules/deepseek-harness/packages/interaction/permission-presets`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，MIT。`src/presets.ts` 对应官方 `src/index.ts`；`src/types.ts`、`src/client.ts`、八种语言 JSON 和 MIT 许可证直接保留。元数据记录 `forkOf` 与 Worker 组合项 `cloudflare:worker:permissions`。

修改范围：依赖 `permissionExecutor` 取代 `shell`；不伪造 Agent 服务，已有 Agent 的初始化监听仍保留，Host 通过公开适配方法调用相同初始化算法；新增 Host 同步接口和 R2 检查。官方 Session、SessionProjectionRegistry、ApprovalService 均从稳定导出原样装配。`read-only` 通过官方预设配置表加入，Auto review 未配置且不可选择。

`createPermissionRuntime()` 完成装配后返回同步的 `initializeSession`、`selectPreset`、`snapshot`、`catalog`。真正新会话传 `null`，使用当前用户默认值；旧会话的空日志传 `[]`，遵循官方已恢复会话的默认规则，不能被后来改变的用户默认值重写。日志保存完整官方 `seq/time/type/data`，选项变化写入 `permission/preset`、`sandbox/mode`、`approval/policy`；重复选择不写入。重放产生的 `session/end-seed` 只在发生真实变化时随内部日志保存。

Session Host 的 `PermissionStore` 要求真实 `transactionSync`，在同一事务中合并权限日志、有效快照和 Host 通知事件，保留模型等已有投影；不提供无事务降级。会话的 `permissions` 投影仍是官方 `{ currentValue }`，内部执行快照另存 `{ currentValue, sandbox, approval }`。用户默认值只影响以后新建的会话，分支继承源会话权限。

默认权限设置的表单选项和写入校验共用实际挂载服务的预设配置表。`settings/mutate`、`update`、`replace` 在全部操作完成后校验最终值；未知名称、不可用的 Auto、派生 Custom 和错误类型会在 SQL 写入前拒绝，不改变 revision 或发布通知。删除该项或用空对象替换仍可恢复组合默认值。真实 SQLite 与 Remote 回归覆盖这些路径、事务回滚和 SQL 故障。

工具每次产生文件效果前必须读取最新持久策略，再调用 `assertFilePermission`。只读禁止模型写入；workspace-write 只允许会话所属 workspace；full access 可以访问同一认证 owner 的其他逻辑 workspace，永远不能跨账号。路径不隐式解码，不接受穿越、反斜杠、NUL 或别名段。用户主动编辑文件与模型工具执行分别授权。文件沙箱不控制网络 fetch，也不提供 POSIX、进程或 shell 隔离。

`approval: never` 表示拒绝需要用户同意的操作，不是自动批准。记忆写入等仍需同意；已经等待审批的操作应由 Host 的持久审批流程拒绝并恢复续答。工具和审批的接线、重启恢复测试归 Session Host / Think 包；本包不宣称单独完成全部执行链。

验证：`pnpm check:permissions` 比较真实、未修改的官方服务与本分支的默认/重放/同包别名/漂移/无操作行为，检查 R2 边界，并使用实际 SQLite 验证事务回滚、默认隔离、分支、重启和并发串行顺序。Host 的 `remote-permissions.test.ts` 检查真实 owner 路由、最新默认值、错误传播和严格参数校验。测试不访问云端或调用模型。

`commands/list` 返回官方权限命令描述；`commands/execute` 使用官方解析器与本完整分支原始处理器。Host 在同一事务中保存 `command/run`、权限变化、`command/done` 和按认证 RPC ID 幂等的真实执行回执；同 ID 不同内容冲突，重复交付不重复执行，附件拒绝不触发上传。失败回执通过 Remote 错误显示，仍带真实 `commandId`，不会在前端伪造成功。

审批策略提示由原样官方 `ApprovalService.setPolicy` 产生，当前策略说明由原样 `SystemPrompt` / ApprovalService context 产生，不复制或改写其提示字符串。`ApprovalPolicyAgentPort` 只借出真实 Session 与非唤醒 `inject` 接收端，不是原生 Agent；两处窄调用随上游 pin 复核。Host 将通知 outbox 与策略事实在同一事务保存，初始化、同值选择及失败事务均不入队。Think 在真实下一模型步骤读取并持久化原始 ID/source 的通知；重启、命令重试和后续 SDK 步骤不会重复注入，也不会增加用户请求或 turn。

当前命令日志及模型上下文通知尚未并入共享官方聊天轨迹；这不提供原生 Agent inbox 的完整调度/取消协议。执行检查仍读取最新持久策略。原生 `tool-fs` 的单次 `sandbox_permissions` / `justification` 升级授权没有暴露，R2 使用会话常驻策略。这些是实现差异，不是 Workers 的物理限制；不能宣称命令轨迹和完整原生沙箱行为已全部等价。`approval-context.test.ts` 用真实 DO/SQLite、安装版 Sessions 和 AI SDK 多步骤 fixture 验证切换、回滚、重启及非唤醒行为，无线上模型调用。
