# Dsh-base 账号设置

[English](README.en.md)

`@dsh-base/client-settings-account` 是官方账号设置插件的完整运行时 fork，保留账号身份、余额、赠金、用量和充值界面。它新增一个由 Host 明确选择的不可用展示状态；Dsh-base 本地登录仍由独立的账号入口插件提供。

## 官方来源与复用决定

- 官方包：`@deepseek-ai/dsh-client-ui-settings-account`。
- 唯一来源：`.submodules/deepseek-harness/packages/client/ui-settings-account`，固定版本 `dsh-v0.2.2-rc.5`，提交 `9c2670d3bce5275e0d1610272958121af87787bb`，MIT 许可证。
- 完整保留 `src/`、`locale/`、源目录内的图片资源及上游许可证。上游 checkout 不做修改。

直接挂载官方插件或复用它导出的 `AccountSection`，都会在真实未登录且没有进行中的授权时显示居中的登录提示。官方没有提供让这个状态显示完整账号卡片的展示参数。用户明确要求保留完整账号内容，并仅将不可用操作置灰，所以本包完整 fork 官方运行时，新增最小展示参数。默认分支、原注册逻辑、字典和原 CSS 保持不变；没有新建另一套账号界面。

## 展示与权限

稳定入口 `.` 和 `/client` 导出原插件的 `apply`、`inject`、类型，以及 `AccountSection`、本地 Loader 所需的 `name` 和 `Config`。

`AccountSection` 新增 `presentation?: 'auto' | 'full-unavailable'`：

- 默认 `auto` 保留官方渲染和行为。
- `full-unavailable` 仅在真实 `status === 'signed-out'` 且 `attempt === null` 时生效；未知状态、已登录状态和任何授权尝试仍走官方分支。
- 该状态保留官方身份卡、账号信息、余额卡、赠金和“更多”操作布局；余额与赠金显示官方 `balanceSignedOut` 文案，不伪造金额，也不显示残留的私有账号信息。
- 账号信息、用量和充值链接均移除 `href` 与 Host 点击回调，并设置 `aria-disabled="true"`、`tabIndex={-1}`。不会构造平台 URL、打开页面或触发本地登录。
- `AccountAvailability.module.css` 仅为这一状态增加与官方 Button 相同的禁用透明度、鼠标样式，并关闭启用态悬停效果；原 `AccountSection.module.css` 保持字节一致。

这个参数只决定可见性，不提供认证能力或数据权限。匿名快照和权限边界由 Host 提供；独立的 `client-account-launcher` 在下方放置 Dsh-base 登录提示与按钮，不把本地账户冒充 DeepSeek 平台账户。

## 组合与差分验证

组合 ID 为 `client:settings-account`，`origin: fork`，顺序 `69`，替换官方账号插件。原官方条目必须保留在清单中并禁用，避免重复注册。

所有差分列在 [host-adaptations.json](host-adaptations.json)：修改 `AccountSection.tsx`，新增稳定入口和禁用样式文件；`AccountOnboarding.tsx` 的一个纯类型导入指向已部署的模型提供方 fork，避免与停用原件重复声明 `settings.models` 类型命名空间，不改变运行时界面或行为。升级上游固定版本时，重新审查这些差分和源文件导出契约。

运行 `node --test packages/client/dsh-base-client-settings-account/tests/*.test.mjs` 验证来源、许可证、完整文件清单及逆向差分；测试按二进制比较图片、原 CSS 和语言文件。账号状态、禁用交互和默认分支的渲染对照由应用的账号验收覆盖。本包不实现平台登录、计费或匿名私有数据访问。
