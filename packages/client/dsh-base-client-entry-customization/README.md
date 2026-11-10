# 更多菜单

组合范围：默认应用只在登录后加载工作台。以下未登录分支属于组件或 Host 的独立契约，仅在隔离测试中使用。

固定版本官方 `@deepseek-ai/dsh-client-ui-entry-customization` 的完整浏览器 fork。来源为 `.submodules/deepseek-harness/packages/client/ui-entry-customization`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，MIT 许可证。

保留官方左侧栏、会话视图和右侧栏的三个槽及全部菜单结构、图标和文案。未登录时“浏览更多插件”直接打开已挂载的公开插件目录，“创建你的插件”先打开登录弹窗。没有增加关于、支持或环境入口。

官方组件没有可注入的可用性字段，且会隐藏没有导航服务的浏览入口，因此使用有标记 fork。新增可选 `useNavigationAccess` Hook 和 `unavailableReason` 回调；没有 Host 注入时保持原版行为。公共词典命名空间沿用官方类型身份，CSS 与词典未改动。

`navigationAccess` 处于检查中或错误时，账号动作保持关闭。匿名创建动作触发登录，不创建草稿；浏览插件依赖真实的公开或已授权 `pluginNavigation` 服务。回调执行前重新核对账号状态。已登录后继续使用原版创建插件草稿流程，不修改权限或私有 Gateway。

`tests/fork-source.test.mjs` 检查继承源码与明确改动。专项浏览器验收检查公开浏览、操作级登录门控、键盘操作和已登录官方样式对比。

匿名创建会等官方菜单完成关闭和焦点归还后，再打开登录弹窗；关闭弹窗时焦点回到持久的“更多”按钮。
