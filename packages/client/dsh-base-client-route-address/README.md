# @dsh-base/client-route-address

把官方 DSH 客户端的 Session / Workspace 选择映射成可寻址 URL，并通过官方 `uiWorkspace` 服务恢复深链。

## 地址

- `/app/session/:sessionId`：打开指定 Session；
- `/app/workspace/:workspaceId`：打开指定 Workspace（随后由官方 UI 选中它的 Session，地址变为 `/app/session/:id`）；
- 语言前缀只来自共享模块 `@dsh-base/locale-path`：`/app/session/:id` 是英文裸路径，`/zh-CN /ja /es /fr /de /pt /ru` 前缀分别对应其余 7 种语言，恢复选择和后续地址同步都保留当前前缀；
- 前缀只认最外层：`/zh-CN/app/session/:id` 是中文深链，`/app/session/zh-CN/:id` 不是；`/en/*` 会归一到裸路径。退役的 `/zh` 已无语言语义，未注册的文档地址由 Worker 返回 404。

## 行为

- 启动时等待官方 Session/Workspace 列表 ready，再按地址调用
  `uiWorkspace.openSession()` / `openWorkspace()`；
- 订阅官方 Session 列表，用户切换 Session 时用 `history.pushState` 同步地址，并按当前前缀重建；
- `popstate` 反向恢复地址，每次只保留最新的地址请求；
- 复用官方 `layout.beginNavigation()` 取消契约。启动或地址解析期间点击插件面板、切换 Session，或再次前进/后退，都使旧请求失效；旧请求不得重新选中会话、显示错误或回写地址；
- Workspace 连接交给官方 `openWorkspace()` 管理取消，通过 `beforeOpen` 确认实际提交。无需等待自动恢复完成，也不使用延时重选来覆盖用户操作；
- 不存在的 id 通过官方 `shell.overlay` + `Toast` 显示本地化提示，并回退 `/`；
- 不渲染导航 UI、不修改官方布局，官方 `uiWorkspace`/Session 列表仍是行为来源。

## 复用决策

官方 client 没有 URL router（无 pushState/popstate/hash），不会把 Session/Workspace 选择映射为浏览器地址；本插件复用官方 `uiWorkspace.openSession/openWorkspace`、`layout` 与 observables，只增加地址 seam。语言前缀规则由 `@dsh-base/locale-path` 单点提供，`check:locale-path` 保证本包不出现第二份前缀实现。详见 `package.json` 的 `dshBase.reuse`。

## 验证

`pnpm check:route-address` 覆盖地址编解码及实际固定版本官方 `LayoutController`、`UiWorkspaceService` 的延迟导航回归，包含同一轮事件中手动选中 Session 后列表变为 ready 的情况。`pnpm acceptance:route-address-local` 使用构建后的应用和隔离本地 Host，延迟真实空会话恢复请求，点击官方插件入口，再放行请求，验证主内容与侧栏选择持续一致；不访问线上数据或调用模型。
