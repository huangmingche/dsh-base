# 账户登录弹窗

同一客户端插件提供应用内登录弹窗与独立 `/login` 公开文档。侧栏、账号菜单、工作区和插件操作通过导出的 `requestLogin()` 请求登录；打开弹窗不授予权限，也不读取私有资料。应用内关闭后保留当前页面；独立登录文档关闭后回到当前语言的公开首页，避免未授权深链反复跳回登录；成功后仅返回经过同源校验的地址，受保护的操作由用户重新确认。

官方 `ui-settings-account` 的 AccountSection、SignInDialog 使用 Platform 浏览器授权，模型设置的 ApiKeyInput、SettingsSecretField 管理提供商密钥，均不提供本地 Better Auth 用户名/邮箱与密码契约。此插件保留本地账号流程，从稳定导出直接复用官方 `Modal`、`Button`、`Input`、图标及既有主题呈现器。弹窗采用官方默认标题、说明、关闭按钮、遮罩、颜色和尺寸；本地 CSS 只组织流程布局和语义提示。用户在 2026-11-17 保留弹窗结构与流程，同时要求恢复官方 DSH 外观，覆盖此前的 ChatGPT 视觉要求；元数据只保留本地账号流程的行为差异。

使用官方 `Modal` 的 body portal 与 `useModalLayer` 管理键盘焦点、Escape、遮罩关闭及回焦，不另建原生 `showModal()` 层或重复注册焦点管理。初始焦点遵循 `data-modal-autofocus` 契约；关闭与卸载仍取消待处理请求。用户名/邮箱先进入密码步骤；注册复用真实后端，公开 `/api/auth-policy` 只有明确 `signUpEnabled: true` 才允许提交。

用户于 2026-11-17 确认所选 SaaS 插件继续开发后，此流程增加忘记密码、单次 token 重置、必需验邮与重发，以及配置就绪时的 Google 授权码登录。所有新增步骤继续使用官方 Modal/Button/Input 与八语言文案。邮件或 Google 不可用时入口保留、禁用并解释；Apple 与手机号仍禁用。重置 token 只存于当前弹窗内存，读取后立即从 URL 清除，成功与取消再清理状态；回调只允许同源。匿名请求显示通用说明，避免在界面透露账号是否存在。

`tests/email-flow.test.ts` 验证策略与 URL；`tests/email-browser.test.mjs` 在本地浏览器覆盖禁用、申请重置、确认密码、token 清理、验邮/重发及 Google 跳转白名单，使用本地请求 fixture，不发送真实邮件或联系 Google。后端真实 token/OAuth 测试位于 Worker auth 包。

按用户要求，第三方登录按钮下方不再重复显示不可用说明；禁用状态及本地化按钮提示保留，Google 仍按服务端策略决定是否可用。

八种官方语言均有完整弹窗文案。验证：`pnpm check:client-adapters`、`pnpm acceptance:auth-modal-local`、`pnpm acceptance:anonymous-sidebar`。独立登录文档仍只启动声明的登录插件，不加载私有 RPC、WebSocket 或账号配置。

## 注册转化同意

注册请求只附带当前已挂载 Google Analytics 插件的内存同意快照；默认不带跟踪授权，不从账号资料推断同意。没有增加浏览器转化上报或第三方脚本，登录弹窗组件和布局不变。
