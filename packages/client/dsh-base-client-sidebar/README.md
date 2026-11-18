# 侧栏导航

固定版本官方 `@deepseek-ai/dsh-client-ui-sidebar` 的完整浏览器 fork。来源为 `.submodules/deepseek-harness/packages/client/ui-sidebar`，提交 `9c2670d3bce5275e0d1610272958121af87787bb`，MIT 许可证。

可固定面板、共享面板图标和工作区滚动行为直接继承自官方。登录检查只作用于相应入口的激活。

保留官方布局、品牌槽、折叠动画、快捷键提示、面板列表和页脚。未登录时新会话、插件和自动化任务均可点击：新会话打开登录弹窗，已挂载的插件和自动化任务公开面板可先浏览。“更多”保留官方结构。

## Host 适配

- `navigationAccess` 只描述已检查的 SaaS 登录状态，不授予官方 `RemoteAccess` 权限。
- 新会话在匿名状态请求登录；真正创建仍需要已登录状态与真实 `session/create` 权限。回调执行时再次检查登录状态。
- 插件和自动化任务的公开目录以优先级 1 注册原版图标和名称；公开或已授权的真实面板以优先级 0 注册并自动取代它们。没有真实面板时，即使已登录也保持禁用。
- 可选 `useNavigationAccess` 与 `unavailableReason` props 将可见性和操作权限分开；不提供时组件维持官方渲染。
- 禁用状态沿用官方菜单的透明度、光标和 Tooltip，保留键盘焦点、`aria-disabled` 与原因说明。没有修改私有 Gateway。

原组件没有可配置的禁用/可见性接口，外层包装不能修改内部按钮，因此采用有标记 fork。公共槽和词典命名空间继续使用官方类型身份。四个面板图标/词典源入口通过官方已声明的 `./src/*` 导出复用，并在 `dshBase.reuse.sourceEntries` 登记；升级上游固定版本时必须复核。

`tests/fork-source.test.mjs` 检查所有继承文件与明确的改动清单。浏览器验收比较已登录界面与固定版本官方实现，并验证匿名入口与操作隔离。
