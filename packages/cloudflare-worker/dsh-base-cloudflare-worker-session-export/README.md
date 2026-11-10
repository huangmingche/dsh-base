# 会话导出兼容层

在请求级 Cordis 上下文中原样挂载固定版本的 `@deepseek-ai/dsh-session-log-export`。提供官方的 `GET/HEAD /api/session.markdown` 和 `GET/HEAD /api/session.export`，复用官方 Markdown 格式化器、ZIP 流和路由；界面由官方客户端插件提供。

每次请求先验证登录账号，再选择该账号的 Session Host Durable Object。标题与完整已提交对话来自同一个快照，不受浏览器已加载页数限制。附件必须已实际提交给所选会话，并通过 R2 内容摘要与长度校验；调用者不能提供对象键或账号。响应禁止缓存，失败信息不包含内部路径、R2 键或凭据。重复查询参数、非读取方法和跨域请求明确拒绝。

导出是当前 Host 已提供的 Think 对话事件投影，不能视为官方原生执行引擎的完整运行日志。未提交的流式 token、当前投影没有记录的原生运行事件不会伪造。旧消息时间沿用现有投影语义。当前部署不支持子智能体，普通 fork 的继承内容只出现一次，不把源会话或兄弟会话当成后代。图片处理不可用时明确失败。普通附件沿用 8 MiB 上限，逐个校验、分块送入官方 ZIP 流；无需新基础设施、定时任务或外部网络请求。

ZIP 的 HEAD 和 GET 都通过官方当前格式解码器校验。缺少可靠结束状态的旧日志会明确拒绝 ZIP 导出，不补造生命周期事件；Markdown 仍可复制。导出的标题元数据使用当前名称，避免 fork 继承的旧标题覆盖新名称。

`/export` 复用官方命令定义与处理器。账号 Host 原子保存命令生命周期和幂等回执，不启动模型或伪造 Agent；参数路径和附件明确拒绝。与权限命令相同，这些命令记录尚未合入当前对话事件投影。取消下载会停止附件读取并释放请求级插件。

回归覆盖真实 Host 的 prompt → cancel、完整历史、fork、当前格式恢复、账号隔离、附件校验、HEAD、取消和命令重试。

回归测试：`node --experimental-strip-types --import ./packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs packages/cloudflare-worker/dsh-base-cloudflare-worker-session-export/tests/routes.test.ts`。
