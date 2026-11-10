# Client Core

此包是浏览器启动与静态模块运输的兼容层，不是可组合的功能插件。应用入口把生成的组合交给 `startClient`；它直接复用当前固定官方源码导出的 `BootPage`、`bootClient`、Loader、`mountClient` 和静态模块种子。官方 `./src/*` 入口及审查提交记录在 `package.json` 的 `dshBase.reuse` 中。

源码位于 `packages/boot/dsh-base-client-core`，公开包名保持 `@dsh-base/client-core`。`dshBase.boot.kind: browser-support` 将它明确归为浏览器支持库：不声明插件组合项，不承载产品功能；客户端插件仍属于 `packages/client/`。边界检查和严格类型检查继续按 client 平面覆盖此包，Worker、Think 和平台中立共享包不能导入它。

客户端插件可以在 `dshBase.client.documentRoutes` 声明公开文档的精确路径。匹配时只通过官方 Loader 启动这些声明者，不读取私有控制状态、不启动其他应用插件，也不挂载私有壳。禁用的公开文档声明仍保留路由所有权，启动会明确失败，不会回退到私有组合。当前 `/login` 由登录插件负责界面和官方主题资源。其他路径继续使用完整生成组合，保留官方库存与真实 fiber 状态。

`node packages/boot/dsh-base-client-core/tests/document-routes.test.ts` 验证精确匹配、禁用时拒绝启动及不修改私有库存。构建后运行 `pnpm acceptance:local` 验证中英文登录页只发出 `/api/auth-policy`、不创建 WebSocket、只启动登录 fiber，以及登录后的完整官方组合。该启动隔离不代替 Worker 的身份验证和访问控制。

完整壳启动与 Host seam 共享一次已验证的账户快照。确认匿名时跳过私有插件控制读取，使用静态组合；已登录后的控制读取失败保留为错误。账户请求在初始读取、显式登录过程或页面重新获得焦点时更新，不空闲轮询。流等待可立即取消，已打开的私有流在注销、账户切换或认证错误时撤销；这不改变 Worker 端鉴权。`node packages/boot/dsh-base-client-core/tests/control.test.ts` 验证匿名零私有控制请求及真实错误，`node packages/client/dsh-base-client-session-adapter/tests/account-session.test.ts` 验证共享快照和取消边界。
