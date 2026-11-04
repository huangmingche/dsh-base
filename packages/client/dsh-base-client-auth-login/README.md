# 本地账户登录

独立客户端插件，使用官方 DSH 的 Button、Input 和 FishLogo。官方没有可直接挂载的本地产品账户登录页，因此这不是官方页面的 fork。已登录账户页面仍由官方插件提供。

公开只读 `/api/auth-policy` 明确返回 `signUpEnabled: true` 才启用注册。检查中、关闭、格式错误或请求失败时，注册入口保持可见、禁用并显示中英文说明；已有账户仍可登录。浏览器不持有管理员注册令牌。登录后仅允许同源返回地址。

验证：`node packages/client/dsh-base-client-auth-login/tests/registration-policy.test.ts` 和 `node packages/client/dsh-base-client-auth-login/tests/return-url.test.ts`。

通过 `dshBase.client.documentRoutes: ["/login"]` 声明公开文档。此路由仅由官方 Loader 启动登录插件，并直接安装官方主题样式和图标；不会启动私有应用的 RPC、WebSocket 或配置读取。

公开登录页使用官方默认 system 偏好、字体默认值和导出的 `ThemePresenter`，随系统浅色/深色变化更新官方 DOM 契约；背景使用官方 `--dsw-alias-bg-base`，没有独立色板。浏览器兼容测试执行实际插件 apply，验证两种配色及切换，而非只挂载表单组件。
