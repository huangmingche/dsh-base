# 匿名账号入口（`@dsh-base/client-account-launcher`）

在侧栏底部 `sidebar.settings` 槽位为**匿名会话**提供官方形态的「⋯ 更多」账号菜单；已登录时官方 `AccountMenu` 继续接管，全局只渲染一个入口。

## 官方复用决策

| 路径 | 结论 | 原因 |
| --- | --- | --- |
| 原样挂载官方账号插件 | 不能提供匿名入口 | 官方账号菜单与设置外壳受 `account/watch`、`settings/describe` 私有 Host 权限门控；匿名无权访问，不能为显示入口而放宽权限。 |
| 原样渲染官方 `AccountMenu` | 不可行 | 组件菜单项是硬编码数组，匿名「设置」会打开没有 section 的空设置壳；把设置项改道登录页等于伪装。 |
| fork 官方账号包 | 完整匿名账号内容需要 | 完整布局位于未登录早返回之后，没有可用导出或展示参数。本入口组合完整标记的 `@dsh-base/client-settings-account` fork 的稳定导出，保留私有 Host 权限。 |
| **最小自研 + 复用官方组件** | **采用** | 只组合匿名菜单、设置内容与本地登录区；交互、a11y 和样式复用官方，新增身份提示单独本地化。 |

## 复用面

- 官方 `Menu` + `MenuItemButton`（`ui-primitives`）：菜单交互、键盘、`aria-disabled` 说明与 tooltip。
- 官方 `AccountMenu.module.css`（经包 `exports` 的 `./src/*` 面 import，不复制）：`.root/.trigger/.label/.anchor/.signedOutMenu`，含 32px More 行与折叠态 36×36。
- 官方 `IconEllipsisOutlineMedium` / `IconSettingsOutlineMedium` / `IconPaperPlaneOutlineMedium` / `IconUserOutlineMedium`。
- 官方 `settings.account` 8 语言词表（`more/settings/contactUs/signIn/menu`）。绑定失败会显式抛错，不静默显示原始 key。
- 匿名设置面板：复用本仓 fork `@dsh-base/client-settings-navigation` 已导出的官方 `SettingsPanel`（800×800 两栏壳、遮罩、焦点陷阱），右栏直渲 12 个官方 General 行组件（`LanguageRow` / `AppearanceRow` / `FontSettingsGroup` / `PermissionRow` / `TranscriptViewRow` / `DeveloperToolsRow` / `ShortcutsRow` / `LinkOpeningRow` / `EnterBehaviorRow` / `PerformanceUsageRow` / `UploadRow` / `CurrentVersionRow`，均经 `./src/*` 面），store 用官方工厂与官方 `bindSnapshotSelector`（`ui-renderer/src/client/bind.ts`）；5 个分区标签取官方 `settings.account` / `settings` / `settings.models` / `settings.plugins` / `settings.agentPreset` 词表，行文案取各自官方命名空间，绑不上显式抛错。

## 行为

| 项 | 匿名态 |
| --- | --- |
| 设置 | 启用；点击打开匿名设置面板（见下「匿名设置面板」） |
| 意见反馈 | 置灰 + 本地化原因「登录后可用。」（8 语言；法律确认上游表单前不放开） |
| 登录 | 菜单中的本地登录动作通过共享 `requestLogin()` 打开应用内弹窗；关闭保留原页面，成功后的返回地址经过同源校验。账号页的官方 DeepSeek 按钮不调用本地登录。 |

## 状态机与让位

- 注册在官方 single 槽 `sidebar.settings`，`priority: 1`（影子）：官方/我们的设置外壳默认 `priority: 0` 永远能注册并成为 winner（最低 priority 渲染）；官方出现时本项自动被遮挡，`slots.subscribe` 再将其 dispose；官方离开后重新注册。
- **确认 signed-out 后**才注册：先 `ctx.inject(['remote.account'])` 读 `getState()/watch()`（seam 内部读公开端点 `GET /api/auth/get-session`，匿名返回 `null`）；若服务始终未出现，才回退直接读该公开端点。不触碰 `remoteAccess`、不新增访问策略。
- `/login` 文档直接 return（与 `auth-login` 的公共文档守卫一致），不注册任何东西。

## 测试与验收

```bash
node --experimental-strip-types --test packages/client/dsh-base-client-account-launcher/tests/*.test.ts
pnpm --dir apps/web build
node apps/web/scripts/acceptance-account-launcher.mjs   # 隔离实例：菜单 8 语言 × 深浅、面板 8 语言 × 深浅、5 分区 × zh/en × 深浅、导航 8 语言、hover/滚底等、已登录回归
```

回归范围包括返回地址、菜单状态、8 语言账号身份与不可用说明、模型声明文案、官方命名空间绑定失败和影子注册决策。账号页另验证官方分支保真、旧四灰行移除、独立本地登录入口及匿名零私有请求；具体执行结果按发布记录，不沿用旧用例数量。

## 边界

- 匿名壳门禁（非本卡 401 等）不在本包，属 P9。
- 意见反馈外链属上游表单，匿名态不链接；`reuse.gaps` 已登记。
- 长语言（de/ru/es/ja/pt）的「内置插件 / Agent 预设」分区标签按官方单行省略号截断，属上游本地化问题，本包不额外改宽度或换行。

## 匿名设置面板（完整官方形态，9 行真实可用）

「设置」项复用本仓 fork `@dsh-base/client-settings-navigation` 里**已导出的官方 `SettingsPanel`**（800×800、`188px + minmax(0,1fr)` 两栏、遮罩、焦点陷阱、Esc），不另起壳。该面板仅新增可选 row 字段 `disabled` / `disabledReason` / `icon`（默认不设置，登录态渲染路径不变，有单测与已登录验收覆盖）。

- 左导航 5 个分区全部显示、**全部可切换**（可键盘选中），顺序与官方注册一致：账号 −10 / 通用 0 / 模型 10 / 插件 15 / Agent 预设 20。标签取官方 5 个命名空间；不可用原因下沉到内容区，导航行不再整行置灰。
- **账号与余额**：通过完整标记的 `@dsh-base/client-settings-account` fork 的稳定 `/client` 导出，使用 `full-unavailable` Host 展示合同。账号身份、账号信息、余额、赠金、用量和充值沿用完整官方布局及词典，状态仍是 `signed-out`、`attempt: null`，无私有资料或虚构金额。平台操作置灰且无导航地址；下方独立的 Dsh-base 账号行使用官方按钮，仅该按钮请求本地登录。用户本轮要求覆盖此前居中占位方案，见 [ADR-0005 §21](../../../docs/dsh-base-ADR-0005-anonymous-more-menu.md)。
- 右栏「通用」**12 行**：**9 行可改 + 1 行只读可用（当前版本，取自所选应用的 `package.json`）+ 2 行禁用**（`permission` 宿主权限策略、`session-log` 需账号上传），顺序与官方一致。
- 9 个可改行的驱动（全部官方实现）：
  - **语言 / 外观 / 字号**：官方 `LanguageRow` / `AppearanceRow` / `FontSettingsGroup` + 官方 store 工厂；写路径走匿名本地设置文档。
  - **工作步骤展示**（工作步骤展示/收起时机/收起回复）：官方 `TranscriptViewPolicy` 类（`ui-chat/src/client/transcript-view.ts`），与聊天页使用同一 `ui-chat` 配置表单，写入即时生效。
  - **开发者工具**：官方 `configForms.developerTools.enabled` + `setEnabled()`（服务级共享偏好）。
  - **快捷键**：官方 `ctx.shortcuts` 服务 + 官方 `shell.overlay` 里已注册的 `shortcuts` store（可打开官方快捷键参考面板）；键位沿用官方 localStorage `dsh.keybindings.v1`，**不另起 key、不进本地文档白名单**。
  - **链接打开方式**：官方 `ui-chat` 配置表单的 `linkOpening`（本地 store 先行、表单 best-effort 持久化，与官方行同一模式）。
  - **繁忙时发送行为**：官方 `ComposerSubmissionPolicy` + `ui-conversation` 配置表单（与 composer 使用同一表单）。
  - **性能与用量**：官方 `PerformanceUsagePolicy` + `ui-chat` 配置表单。
- 说明：匿名态 settings 槽图不存在（外壳在 `whenAccess('settings/describe')` 内），官方行没有注册实例可读；上述 4 项按 Architect 批准的路线使用**官方类 + 官方 `configForms` 服务**（同一配置表单、同一持久化链路），不新增交互与存储格式。

### 模型 / 内置插件 / Agent 预设（只读）

三页都只读，数据只来自「本地声明 + 已有只读 seam」，不调用 `remote.settings` / `remote.llm` / `remote.credentials` / `remote.pluginManager`。

- **模型**： 匿名模型设置复用已有官方模型插件 fork 的卡片、只读配置表单和展开交互。公开模型及表单默认值与 Host 共用一份声明；凭据和 Gateway 账号状态保持未知，不再显示推断的“未配置”。添加提供商和底部登录按钮打开本地认证，查看详情无需登录；不读取私有配置或发送模型发现请求。
- **内置插件**：直渲官方 `PluginInventorySettingsTab`（`./src/*`，已登记 `sourceEntries`）。注入面：`list` 用已有只读 seam `remote.pluginInventory`（本地 client Loader 清单 + pinned Think 声明行，零网络）、`presets` 名称走官方 `presetDisplayText`、`resolveText` 走 `ctx.locale`；匿名没有 Host client 同步，`hooks.clientSync` 用 `{ syncing: false, failures: [] }` 空快照 stub，`retryClient` no-op（R30）。标题/说明取官方 `settings.plugins`，tab 文案取官方 `settings.pluginInventory`；没有写按钮。
- **Agent 预设**：直渲本仓 fork 的官方 `AgentPresetSection` + 官方 `AgentPresetSectionController`（本仓 fork 新增导出），roster 取本地只读 `remote.agentPresets`：4 个 pinned 官方模式带本地化 `unavailable` 原因（中性灰卡片 + 「不可用」徽标 + 原因文本），Cloudflare Think 是当前默认；与 composer 匿名菜单同为 **5 项**。4 个官方模式的「设为默认」为 `aria-disabled`，Think 行已是默认（原生 `disabled`），**没有可用的「设为默认」控件**；`makeDefault` 只做防御性拒绝（把 `selectUnavailable` 原因写进 store，不调 `remote.settings`）。Think 行没有官方 Cordis 声明可读，「查看配置」禁用并给出本地化原因。
- 守卫：面板在渲染时读取 `ctx.slots.entries('settings.section')` / `('settings.general.item')` 并写到 `data-anonymous-settings-sections` / `data-anonymous-settings-general-items`；验收断言两者均为 **0**（匿名不注册任何 settings 槽条目）。
- 禁用的官方行使用 stub 快照（不接 Host，控件全部禁用），显示官方默认值；`reuse.gaps` 已登记。
- 写路径：`ui-chat` / `ui-conversation` / `ui-settings` 纳入匿名本地设置文档白名单（官方 schema/default、不存 secret、零网络）；Esc 关闭并把焦点还给「更多」触发按钮。
- 面板不向官方 settings 槽位注册任何假 section/行：5 个分区与 12 行的数据都在本包自己的 row 数组里。

### 本地设置文档边界

写路径由 `@dsh-base/client-session-adapter` 提供（见该包 README「匿名本地设置文档」），本包只消费官方 `ThemeRuntime` / `LocaleRuntime` 的读写：

- 只在公开 `GET /api/auth/get-session` 明确返回 `null` 时启用；未知或请求失败一律走原有 Host RPC。
- 只写 localStorage 键 `dsh-base.anonymous-settings.v1`：命名空间白名单为 `ui-theme` / `locale` / `ui-chat` / `ui-conversation` / `ui-settings`（官方 schema/default），其他写入返回 `settings/namespace-unavailable`；不存 secret、不写 cookie、不触碰 Host。快捷键沿用官方 `dsh.keybindings.v1`，不进白名单。
- 校验只用官方导出的 `ThemeSettingsSchema` / `LocaleSettingsSchema`；非法值返回 `settings/invalid`，损坏或版本不符的存储文档 fail-closed 丢弃。
- localStorage 不可用（隐私模式/配额）时降级为内存态，界面不崩；刷新后这些偏好丢失，属已登记边界。
- 已登录零读写：本地文档惰性构造，已登录页面从不构造它（验收注入 `Storage.prototype` 计数，`reads=0 / writes=0`）；已登录整页走官方设置，本包不注册入口。

本地 Dsh-base 登录与 DeepSeek Platform 授权是两个身份契约。本地登录不表示已登录 DeepSeek、不授予专属 API Key 或账单能力，也不扩大匿名私有数据权限；完整账号布局由单独标记的官方账号插件 fork 提供，当前入口插件不复制官方源码。
