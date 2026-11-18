# P13 设置面板官方对齐审计（源码级）

- 审计人：Architect · 2026-11-14
- 性质：只读审计，不改代码
- 依据：CEO 2026-11-14 17:49 指令、AGENTS.md 官方复用协议
- 基线：`.submodules/deepseek-harness`（pin `dsh-v0.2.2-rc.1` / `66491b05e3`）；dsh-base 当前工作树
- 说明：本文所有行号均为上述基线中的实际行号，可直接复查

## 0. 结论（先看这段）

1. **设置面板的壳、通用行、账号卡、插件页、预设页用的都是官方组件**，不是自研视觉。真正自建的只有三处：模型页（官方没有只读组件）、账号页 4 条灰项（官方未登录态没有这个块）、More 菜单（官方 `AccountMenu` 被 `account/watch` 门控）。
2. **「100% 官方」不可达**，卡点只有两条 access：`settings/describe`（官方设置外壳整个注册在它后面，`ui-settings-general/src/client/index.ts:191`）与 `account/watch`（官方账号入口与分区，`ui-settings-account/src/client/index.ts:333,336-341`）。不放宽这两条（红线），官方外壳在匿名态就不存在，我们只能「复用官方组件 + 自建接线」。
3. **合规缺口很小，且不是 UI 问题**：fork 的 `gaps` 已登记导航投影、版本行、以及面板的 `disabled/disabledReason` 扩展（第 4 条），launcher 也有对应 deviation；真正剩下的是两处工程瑕疵——`ModelAccessCard.tsx` 是**没有任何引用的死代码**，以及 launcher 用深层 `src` 路径导入我们自己的 fork（该包已导出 `SettingsPanel`）。删除死代码 + 改走包导出的成本 0.1–0.2 轮。
4. 唯一「官方无此状态、建议删掉以对齐」的是账号页 4 条自创灰项（余额/订阅/用量/充值）——官方未登录只显示一张登录卡。

## 1. 官方设置 UI 的完整构成

### 1.1 外壳

| 项 | 官方实现 | 位置 |
| --- | --- | --- |
| 侧栏占用 `sidebar.settings` | `ui-settings-general` 注册 `SettingsRoot` | `.submodules/.../ui-settings-general/src/client/index.ts:191-194` |
| 注册前提 | 整个注册包在 `ctx.remoteAccess.whenAccess('settings/describe', …)` 内 | 同上 `:191` |
| 子槽声明 | `settings.section`、`settings.general.item`、`settings.launcher` 等 | 同上 `:225` 起 |
| 通用分区 | `settings.section` id `general` order 0 | 同上 `:249-258` |
| 面板几何 | 800×800、188px 左栏、`role="dialog"`、`useModalLayer` | `SettingsRoot.module.css:84-106`、`SettingsRoot.tsx:57-110` |

### 1.2 5 个分区

| 分区 | 官方包 | order | 注册位置 | 额外门控 |
| --- | --- | --- | --- | --- |
| 账号 | `ui-settings-account` | −10 | `index.ts:333,336-341` | `account/watch` + **仅 `credential-stored` 时注册**（未登录不出现） |
| 通用 | `ui-settings-general` | 0 | `index.ts:249-258` | 随外壳（`settings/describe`） |
| 模型 | `ui-settings-models` | 10 | `index.ts:136-141` | 无（注册不需要数据）；数据需 `remote.llm/credentials/settings`（`:67-70`） |
| 内置插件 | `ui-settings-plugins` | 15 | `index.ts:76-83` | 无；内容来自 `settings.plugins.tab` 槽 |
| Agent 预设 | `ui-agent-preset` | 20 | `index.ts:283-289` | 无；数据需 `remote.agentPresets/settings` |

### 1.3 通用 12 行（官方顺序）

| order | id | 官方组件 | 注册位置 | 数据来源 |
| --- | --- | --- | --- | --- |
| −20 | permission | `PermissionRow` | `ui-permission-presets/src/client/index.ts:170` | `remote.permissions`（宿主策略） |
| 0 | language | `LanguageRow` | `locale/src/client/index.ts:623-629` | `configForms('locale')` |
| 10 | appearance | `AppearanceRow` | `ui-theme/src/client/index.ts:621-629` | `configForms('ui-theme')` |
| 11 | font-size | `FontSettingsGroup` | 同上 `:631-643` | 同上 |
| 12 | transcript-view | `TranscriptViewRow` | `ui-chat/src/client/apply.ts:193-196` | `configForms('ui-chat')` + presentation policy |
| 15 | developer-tools | `DeveloperToolsRow` | `ui-settings-general/src/client/index.ts:84` | `configForms.developerTools`（`ui-settings`） |
| 16 | shortcuts | `ShortcutsRow` | `ui-shortcuts/src/client/index.ts:43-47` | `ctx.shortcuts` + localStorage `dsh.keybindings.v1` |
| 17 | link-opening | `LinkOpeningRow` | `ui-chat/src/client/apply.ts:155-159` | `configForms('ui-chat')` |
| 20 | composer-enter | `EnterBehaviorRow` | `ui-conversation/src/client/apply.ts:199-207` | `configForms('ui-conversation')` |
| 30 | performance-usage | `PerformanceUsageRow` | `ui-chat/src/client/apply.ts:182-191` | presentation policy |
| 90 | session-log | `UploadRow` | `ui-settings-session-log/src/client/index.ts:37` | 上传服务（账号级） |
| 100 | current-version | `CurrentVersionRow` | `ui-settings-general/src/client/index.ts:100` | 构建期版本（纯本地） |

## 2. 我们的每一处自建/偏离

### 2.1 匿名壳：`packages/client/dsh-base-client-account-launcher/src/client/AnonymousSettingsPanel.tsx`

| 项 | 内容 |
| --- | --- |
| 现状 | 直接复用 fork 导出的官方 `SettingsPanel`（`:15`），5 分区路由在 `:287-294`，通用 12 行在 `:257-279` |
| 官方形态 | 官方 `SettingsRoot` 在 `sidebar.settings` 槽内、由 `settings/describe` 门控 |
| 差距 | 壳组件本身官方；差异是「由我们调用面板 + 自给 rows/renderSlot」 |
| 判定 | **fork（既有）+ 官方组件直渲**，无新 fork |
| 登记 | launcher `gaps` 第 5 条已写；但 fork 包本身未登记扩展（见 2.2） |

### 2.2 fork 改造：`packages/client/dsh-base-client-settings-navigation`

| 改造 | 位置 | 官方原样？ | 登记状态 |
| --- | --- | --- | --- |
| 导航取 `entriesOfSlot` 胜者（原 fork 理由） | `src/client/index.ts`（`entries`→`entriesOfSlot`） | 否 | `reuse.gaps` 已登记 |
| 导出 `SettingsPanel`/`SettingsPanelProps` | `index.ts:38` + `SettingsRoot.tsx:14` | 官方不导出 | `reuse.gaps` 第 4 条已登记 |
| 导航 cell 增加 `disabled`/`disabledReason` 扩展 | `SettingsRoot.tsx`（`sectionNavState`）+ `src/client/panel-rows.ts` | 官方没有禁用态 | `reuse.gaps` 第 4 条已登记 + launcher deviation |
| `ModelAccessCard.tsx` + `modelAccess` inject | `src/client/ModelAccessCard.tsx`（自带 CSS 与 locale key） | 官方没有此卡 | **死代码：全仓无任何引用**；`inject` 里的 `modelAccess` 也未被使用 |
| `CurrentVersionRow` 追加 upstream 版本行 | `src/client/CurrentVersionRow.tsx` | 官方无该行 | `reuse.gaps` 已登记（第 2、3 条） |
| `entry.ts`（Loader 契约包装） | `src/client/entry.ts` | 我们所有包的常规形态 | 无需登记 |

另有一处 **export discipline** 问题：launcher 直接深层导入 `@dsh-base/client-settings-navigation/src/client/SettingsRoot.tsx`（`AnonymousSettingsPanel.tsx:15`），而该包的 `./client` 入口（`entry.ts` → `index.ts`）已经 `export { SettingsPanel }`。应改为包导出。

### 2.3 通用 12 行的「自建 6 项」

| 行 | 组件 | 我们自建的部分 | 官方注册为何不可达 | 登记 |
| --- | --- | --- | --- | --- |
| transcript-view | 官方 `TranscriptViewRow` | store/policy 实例化 + `configForms('ui-chat')` | 槽声明在 `settings/describe` 门控之后，匿名 entries=0 | gap 第 3、4 条 |
| developer-tools | 官方 `DeveloperToolsRow` | 走 `ctx.configForms.developerTools` | 同上 | 同上 |
| shortcuts | 官方 `ShortcutsRow`（`Reference.tsx`） | `ctx.shortcuts` + `shell.overlay` 已注册 store | 同上 | 同上 |
| link-opening | 官方 `LinkOpeningRow` | store + `configForms('ui-chat')` | 同上 | 同上 |
| composer-enter | 官方 `EnterBehaviorRow` | `submissionPolicy` + `configForms('ui-conversation')` | 同上 | 同上 |
| performance-usage | 官方 `PerformanceUsageRow` | `performancePolicy` | 同上 | 同上 |

**结论：这 6 行不是自建 UI，组件、样式、文案全是官方的；我们只补了「官方行需要的 store/policy 接线」**，因为匿名态拿不到官方 registration。这一点必须在登记里写清，否则会被误判成自研。

另两行（permission、session-log）走官方组件 + `fieldset disabled` 包裹（`AnonymousSettingsPanel.tsx:223-243`），先例是 `dsh-base-client-account-availability` 的 `UnavailableBillingSection`。

### 2.4 账号页：官方 `AccountSection` + 4 条自创灰项

| 项 | 位置 | 官方形态 |
| --- | --- | --- |
| 官方未登录卡 | `AnonymousAccountSection.tsx:12,15` 直渲 `AccountSection` + 官方 CSS | `AccountSection.tsx:149-160`：标题 + 说明 + 登录按钮，无余额区 |
| 4 条灰项 | `AnonymousAccountSection.tsx:56-66`（balance/subscription/usage/topUp） | **官方没有这个块**，未登录分支直接 return |
| 登记 | launcher `gaps` 第 8 条 + `userApprovedDeviations` | 已登记 |

### 2.5 模型页：官方 primitives 自建

| 项 | 位置 | 官方形态 |
| --- | --- | --- |
| 只读清单 | `AnonymousModelsSection.tsx:12` 仅用官方 `Tag` | 官方 `ui-settings-models` 分区需要 owner 的 `settings/llm/credentials` remote，无只读组件 |
| 数据 | 本地 `buildFallbackModelCatalog`（session-adapter 导出） | 官方是 Host 实时读 |
| 登记 | launcher `gaps` 第 9 条 | 已登记 |

### 2.6 插件页 / 预设页

| 页 | 现状 | 判定 |
| --- | --- | --- |
| 插件 | 官方 `PluginInventorySettingsTab` 直渲（`AnonymousPluginsSection.tsx:16,32`），`list` 走只读 seam，`clientSync`/`retryClient` 由我们 stub（`:58-65`） | **seam**；stub 注入面未在 gaps 单列，建议补一句 |
| 预设 | 我们 fork 的 `AgentPresetSection` 直渲（`AnonymousPresetsSection.tsx:14`，来自 `@dsh-base/client-agent-preset/client`） | **fork（既有）**；只读 roster 来自只读 seam |

### 2.7 More 菜单与匿名入口

| 项 | 位置 | 官方形态 | 登记 |
| --- | --- | --- | --- |
| More 三行菜单 | `AnonymousLauncher.tsx` + `items.ts:1-26` | 官方 `AccountMenu` 注册在 `account/watch` 门控内（`ui-settings-account/src/client/index.ts:333`），且未登录时入口在 `settings.launcher` 槽 | `gaps` 第 1 条 + deviation 已登记 |
| 分区图标 | `AnonymousSettingsPanel.tsx:9-12,212-219` 从 primitives 取 | 官方走 `settings.section.icon` 槽，匿名无 registrant | `gaps` 第 6 条已登记 |

## 3. 逐项判断（挂载 / fork / 自建）

| 项 | 官方路径可行性 | 结论 | 成本 |
| --- | --- | --- | --- |
| 匿名壳 | 官方 `SettingsRoot` 需 `settings/describe`；不放开则不可挂载 | **fork（既有）复用组件，保留** | 0 |
| 通用 6 行接线 | 官方 registration 需外壳存在 | **被 access 阻断，必须自接线**；组件官方 | 0 |
| 账号未登录卡 | 官方 `AccountSection` 可直渲 | **已按官方** | 0 |
| 账号 4 灰项 | 官方无此状态 | **官方无，需 CEO 拍板** | 删除 0.2 轮 |
| 模型页 | 官方无可直渲组件 | **必须自建（最小）**；已有登记 | 0 |
| 插件页 | 官方 tab 可直渲 | **seam，已按官方组件** | 0（补 gap 0.1） |
| 预设页 | 我们 fork 可直渲 | **fork，已按官方组件** | 0 |
| More 菜单 | 官方 `AccountMenu` 被 `account/watch` 门控 | **必须自建**；已登记 | 0 |
| fork 的 `disabled` 扩展 | 官方无禁用导航态 | **已登记（gap 第 4 条）**；若 CEO 要 5 分区可开则必须保留 | 0 |
| `ModelAccessCard` | 官方无部署模型路由卡 | **官方无、且未被使用** | 删除 0.1 |

## 4. 核心问题：能否用「fork 官方 SettingsPanel + 官方各分区组件 + 数据 seam」替代现在的自定义面板？

**能，而且现在就是这个形态**——面板壳是 fork 导出的官方 `SettingsPanel`，账号卡/插件页/预设页是官方组件直渲，通用 12 行是官方行组件；没有任何分区是自画的官方视觉。真正做不到「100% 官方」的边界只有两条：

1. **`settings/describe` 不给匿名**（红线）：官方外壳、`settings.section`、`settings.general.item` 全部不可达 → 通用行只能自组 store/policy；这是**接线**不是 UI。
2. **`account/watch` 不给匿名**（红线）：官方 `AccountMenu` 与账号分区注册不可达 → More 菜单必须自写、账号卡必须直渲官方组件并自给 snapshot。

所以「对齐官方」的可达上限 = 现状形态；继续提升只剩两件事：删掉官方没有的账号灰项（0.2 轮），以及把 fork 扩展补登记（0.1–0.2 轮）。

## 5. 登记核对（漏登记清单）

| 对象 | 现状 | 是否漏 | 建议 |
| --- | --- | --- | --- |
| launcher `sourceEntries` | 29 条，覆盖全部 `./src/*` 导入（本次逐条比对，29/29 一致） | 否 | — |
| launcher `reuse.gaps` | 9 条，覆盖 More 菜单、6 行接线、账号灰项、模型页、图标、版本行 | 否 | 补一条 plugins 的 `clientSync/retryClient` stub |
| launcher `userApprovedDeviations` | 1 条（More 菜单 + 5 分区 + 账号灰项 + P12） | 否 | — |
| settings-navigation `gaps` | 4 条（导航投影、版本行、版本链接、面板 disabled 扩展） | 否 | — |
| settings-navigation `ModelAccessCard.tsx` | 无引用、无登记 | **是（死代码）** | 删除文件与未使用的 `modelAccess` inject |
| settings-navigation `userApprovedDeviations` | 空 | 可接受 | 批准记录在 launcher deviation 里；如要按包自证，可补一条 |
| 深层 src 导入我们自己的 fork | `AnonymousSettingsPanel.tsx:15` | **是（导出纪律）** | 改走 `@dsh-base/client-settings-navigation/client` |

## 6. 分三类结论

### 必须改（能对齐却没对齐）

1. 删除未使用的 `ModelAccessCard.tsx` 与 `modelAccess` inject；launcher 改用 `@dsh-base/client-settings-navigation/client` 导出 —— **0.1–0.2 轮**，无行为变化，纯减面与导出纪律。
2. 账号页 4 条灰项：**官方无此块，删掉即对齐**（保留登录卡与登录按钮）—— **0.2 轮**，需 CEO 点头（删除后该页与官方未登录态完全一致）。

### 可保留 + 补登记

3. 通用 6 行接线：官方 registration 被 access 阻断，组件/样式/文案全官方；在 gaps 里补「为何不能走官方注册」一句 —— 0.1 轮。
4. 模型页：官方无只读组件；已有 gap，补官方源码行号作为证据 —— 0.1 轮。
5. 插件页 stub 注入面：补 gap —— 0.1 轮。
6. More 菜单 / 分区图标 / 版本行：已登记，不动。

### 官方无此状态，需 CEO 拍板

7. **5 个分区都可点开**（官方匿名态下账号分区不显示）：产品决定，deviation 已登记；若 CEO 改回官方口径，则账号分区应隐藏而不是可开。
8. 账号页 4 条灰项（同「必须改」第 2 条，取决于 CEO）。
9. ~~`ModelAccessCard`~~：查实为**未被任何代码引用的死代码**，不属「官方无此状态」而是「没用起来」，按「必须改」第 1 条删除即可；若产品确需展示部署模型路由，另立卡设计并登记。

## 7. 风险与需实测

| 项 | 说明 |
| --- | --- |
| R1 预设页直渲 | store 工厂来自我们 fork 的导出，官方原版未导出；需在交付时用夹具复核只读态与官方视觉一致（Designer 并行审计覆盖） |
| R2 插件页 stub | `clientSync` 空快照与 `retryClient` no-op 属我们补的注入面，需实测不出现「重试」死按钮 |
| R3 fork 扩展 | `disabled` 扩展默认关闭，登录态无行为变化（已有单测）；但登记缺失是合规风险，不是运行风险 |
| R4 模型声明 | 只读声明与真实可用性不同，文案必须写「未配置/登录后可用」（已登记 gap） |

## 8. 安全边界（不变）

- 不放开 `settings/describe`、`account/watch`、`pluginManager/listBundles` 给匿名。
- 本审计不包含任何放宽 access 的建议；「对齐官方」若以放宽 access 实现，属安全红线，直接否决。
- 自建壳是渲染不是授权：匿名面板不得调用任何 owner-only remote（现有实现走只读 seam 与本地文档，审计未见越界调用）。

## 9. 对照 P13 卡验收项

| P13 卡要求 | 本报告位置 | 状态 |
| --- | --- | --- |
| 逐项回答「原样挂载 / seam / fork / 必须自建」 | §3 逐项判断表 | 覆盖 9 个自定义点 |
| 附官方包名 + 源码行号 | §1 官方构成、§2 每张表 | 全部标注 |
| 核对 `reuse.gaps` / `forkOf` / `userApprovedDeviations` / `sourceEntries` 漏登记 | §5 登记核对 | 4 类逐项核对 |
| 「官方组件不可达被迫」vs「本可改回官方」 | §3 判定列 + §6 三类 | 已分类 |
| 结论三分类 | §6 | 必须改 2 项 / 可保留补登记 3 项 / CEO 拍板 2 项 |
| 成本按交付项·轮次 | §3/§6 | 0.1–0.2 + 0.2 + 0.3 轮 |
| 安全边界不放开 | §8 | 明确不放开两条 access |
