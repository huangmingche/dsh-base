# 反馈可用性接缝

官方反馈插件与控制器保持挂载。通过公开的 SlotRegistry 读取原注册，再以同一个注入控制器注册官方导出的 FeedbackDialog 和 MessageFeedbackActions 包装层。

当前部署没有官方对话日志反馈服务。会话与消息反馈表单使用官方现成禁用状态，提交按钮显示八种语言的不可用原因；点赞/点踩图标置于不改变布局的禁用 fieldset 内，保留官方图标、样式与本地化说明。所有反馈 Remote 和 `/feedback` 明确拒绝，不把 settings sidecar 当作日志提交成功。

可见性、原控制器连通性、禁用鼠标/键盘交互及中英渲染通过 `node apps/web/tests/parity/run.mjs` 与固定版本官方组件比较。`dshBase.reuse.sourceEntries` 记录源码导出，用于升级审查。该验证只覆盖列出的表面，不代表整站 100% UI 保真。
