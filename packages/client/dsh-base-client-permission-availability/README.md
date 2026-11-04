# 已停用的权限可用性接缝

当前 Host 已提供真实的会话权限策略、R2 操作检查与审批策略；当前组合直接挂载原样官方 `ui-permission-presets` 插件。本包保留为禁用清单项，不再替换官方插件，也不参与正常界面。

Vite 和一致性检查共用组合 metadata 读取函数，保留本包的 `disabled` 与停用原因；生成模块不会为本包创建 import、模块加载器或 namespace 加载器。因此其 locale 注册不会与已挂载官方插件重复。`scripts/conformance/tests/client-composition.test.mjs` 执行真实生成模块验证这一边界。

这里的导出组件接缝仅供明确缺少权限服务的其他 Host 使用：直接复用固定子模块的 `PermissionSelect`、`PermissionRow`，将不可用状态保持可见、禁用并提供八语言说明。`./src/*` 导出及审查 commit 保留在 metadata，升级固定版本时复审。没有修改或复制上游源码。
