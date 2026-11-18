# ADR-0005：匿名「更多」账号菜单

- 状态：已接受（Accepted；06:22 B、12:40 对齐官方壳、13:57 D6 定稿、P12 五分区可开，见 §13.2、§17、§18.7、§19）
- 日期：2026-11-14（v7，见 §15 修订记录）
- 决策人：CEO（2026-11-14 06:10）；架构：Architect
- 关联：PRD §7、P9（匿名壳门禁，另开卡）
- 代码基线：`dsh-base` @ `4e635a2`；DSH pin `dsh-v0.2.2-rc.1` / `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- 本文档只描述设计，不含代码改动

## 1. 背景

线上（staging）匿名打开 `/` 时返回 200 应用壳，侧栏只有品牌、Workspaces 与「No sessions yet」，**没有登录入口、不跳登录页**。

根因链条（已逐行核对）：

1. `/` 被 `packages/boot/dsh-base-public-pages/src/index.ts` 的 `PUBLIC_PAGES` 判为公开文档，worker 只在「非公开 HTML 导航」时 `302 /login?next=`（`packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts:182-198`），因此 `/` 不触发跳转。
2. 匿名访问壳时 `loadControl()` 读 `/api/plugin-manager` 得 401，降级为空选择（`packages/boot/dsh-base-client-core/src/client/control.ts:82-92`）。
3. `remoteAccess/follow` 硬性要求 `invocation.user.id`（`packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-access.ts:10-14`），匿名必拒 → 客户端 access 恒为 false。
4. 官方账号 UI 的注册全部包在 `ctx.remoteAccess.whenAccess('account/watch', …)` 里（`.submodules/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts:313,316,333,336`），入口不注册。
5. 更外层还有一道门：**整个设置外壳本身**也挂在访问权后面。我们的 fork `dsh-base-client-settings-navigation` 在 `whenAccess('settings/describe')` 内才向 `sidebar.settings` 注册 `SettingsRoot`（`packages/client/dsh-base-client-settings-navigation/src/client/index.ts:193-194,218`），官方同样（上游 `ui-settings-general` 的用例明确断言：无 settings 访问权时 `sidebar.settings` 为空，`ui-settings-general/tests/shell.client.spec.ts:91-93`）。匿名侧栏底部因此**没有任何设置区域**，官方齿轮 fallback 也不例外——fallback 齿轮位于 `SettingsRoot` 内部的 `settings.launcher` 槽 fallback 里（`SettingsRoot.tsx:226`），外壳不挂载就没有它。

结论：缺的不是一个按钮，而是「匿名态由谁拥有侧栏底部」这件事没人拥有。为匿名放开 owner 访问权属安全否决，因此需要一个独立于 `remoteAccess` 的匿名入口，且它必须挂在**外壳不依赖 settings 访问权**的那个槽上。

## 2. 决策

新增一个 client 插件 `@dsh-base/client-account-launcher`，在 **`sidebar.settings`** 槽位为**匿名会话**渲染官方式「更多 / More」账号菜单：

- 槽位改为 `sidebar.settings`（由 `ui-sidebar` 无条件渲染，owner props 只有 `{ wide }`），不再使用 `settings.launcher`——后者在匿名态根本不存在。
- 触发按钮：省略号图标 + 官方 `t('more')`，与官方未登录态完全同构。
- 菜单项：设置（**启用** → 打开匿名设置面板，见 §16）、意见反馈（置灰 + 「登录后可用」）、登录（启用 → `/login?next=…`）。
- 实现用官方 `Menu` + 三个官方 `MenuItemButton` 子组件（不是 `Menu` 的 `items` 数据行，理由见 §4.3）。
- 注册优先级 `priority: 1`：官方/我们的 fork `SettingsRoot` 用默认 `priority: 0`，永远成为 winner；我方是影子，官方消失后自动转正（语义见 §4.2）。
- 只在确认匿名（`signed-out`）之后才注册；已登录时不注册，官方 `AccountMenu` 独自存在。
- 不 fork 官方包、不复制官方源码、不改访问策略、不改 `apps/` 代码、不手写 roster。

## 3. 复用路径判定（为什么不原样挂载、也不 fork）

按 AGENTS.md「官方复用协议」逐条尝试，三条都撞硬阻塞：

| 路径 | 结论 | 硬阻塞（可复现位置） |
| --- | --- | --- |
| 原样挂载官方插件 `@deepseek-ai/dsh-client-ui-settings-account` | 不可行 | `settings.launcher` 注册在 `whenAccess('account/watch')` 内（上游 `ui-settings-account/src/client/index.ts:333`），且其外层设置外壳又受 `settings/describe` 门控（我们的 fork `dsh-base-client-settings-navigation/src/client/index.ts:193-194`）；匿名两道都拿不到，永不注册。放开任一 access = 安全否决。 |
| 原样挂载官方 `AccountMenu` 组件（提供匿名 face） | 不可行 | 双重不可行：① 它的菜单行是 `items` 数据数组（上游 `AccountMenu.tsx:74-79`），而 `disabledReason`（tooltip + `aria-describedby`）只存在于 `MenuItemButton` 组件行（`ui-primitives/src/Menu.tsx:20` 的 `MenuItem` 只有 `disabled`；`:58-64` 的 `MenuItemButtonProps` 才有 `disabledReason`），结构上就表达不了「置灰 + 说明」；② 匿名态要打开的 settings 内容本身不存在（§1 第 5 条），硬开是假可用。 |
| fork 官方包 | 不可行 | `scripts/conformance/check-official-reuse.mjs:72`：active client fork 必须写 `dshBase.client.replaces` → 会禁用官方账号插件整行，已登录态 UI 全丢；逐字复制还会被同脚本 `43-48` 判为 unmarked exact official source copy。 |
| **自研最小插件 + 复用官方组件/样式/文案** | **选定** | AGENTS「官方候选都失败后才自研」的条件成立；CEO 已签字同意本次自创 UI 偏离（见 §13）。 |

「最小自研」的边界：只写触发按钮结构、三个菜单行、导航函数。其余全部官方：

- 菜单容器与键盘/焦点遍历：官方 `Menu`（支持组件行子节点，`Menu.tsx:224` 的 `children`）。
- 不可用行语义：官方 `MenuItemButton` 的 `disabled` + `disabledReason` → `aria-disabled`、tooltip、隐藏描述（`Menu.tsx:58-64,96-123`）。
- 图标：`IconEllipsisOutlineMedium`（`ui-primitives/src/icons/index.tsx:61`，经 `.` 入口 `src/index.ts:129` 导出）。
- 样式：**import** 官方 `AccountMenu.module.css`（在包 `exports` 的 `./src/*` 面内），不复制。官方已写好未登录态行：32px More 行、折叠态 36×36（该 CSS `:6,:14`）。
- 文案：`ctx.locale.bind('settings.account')` 复用官方 8 语言词表（`more/settings/contactUs/signIn` 见 `ui-settings-account/src/client/locales.ts:17-19,32,53-55`）。官方 `apply()` 在 `whenAccess` 之前无条件注册该命名空间（`index.ts:49-50`），只要 `client:account` 在 roster（现状即如此）就可用。
- 唯一新文案：置灰原因「登录后可用」，官方词表没有这一语义，放本插件自己的 8 语言模块，登记 `reuse.gaps`。

## 4. 架构：包、槽位、结构

### 4.1 包

```
packages/client/dsh-base-client-account-launcher/
  package.json
  src/client/index.tsx              apply()：守卫 /login、确认匿名、以 priority 1 注册
  src/client/AnonymousLauncher.tsx  官方 Menu + 三个 MenuItemButton
  src/client/next-url.ts            buildLoginHref（纯函数）
  src/client/locales.ts             8 语言置灰原因 + 兜底标签
  tests/next-url.test.ts
  tests/items.test.ts
```

元数据要求：

- `name`: `@dsh-base/client-account-launcher`
- `exports`: `{".": "./src/client/index.tsx", "./client": "./src/client/index.tsx"}`
- `dsh.client`: `{ platform: "web", inject: ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-settings-account"] }`
- `dshBase.client`: `{ id: "client:account-launcher", origin: "custom", order: 73 }`（排在 `client:account` 的 69 之后，保证官方命名空间已注册）
- `dshBase.reuse`: `mode: "custom"`；
  - `official`: `["@deepseek-ai/dsh-client-ui-settings-account", "@deepseek-ai/dsh-client-ui-primitives"]`
  - `sourceEntries`: `["@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.module.css"]`
  - `sourceReviewCommit`: `"66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db"`
  - `reason`: 写明三条失败路径（§3 表格）与选定理由
  - `gaps`: 置灰原因文案自写；组件结构对照上游 `AccountMenu.tsx` 手写、非 fork，pin 升级需复核
  - `userApprovedDeviations`: CEO 2026-11-14 签字（见 §13）
- 进 `packs/base/pack.json` 与 composition，由生成器产出 roster。

### 4.2 槽位与单槽冲突语义

`sidebar.settings`：

- 槽位声明：`ui-sidebar/src/client/index.ts:91`，`{ kind: 'single', scope: 'root' }`。
- 渲染点：`SidebarRoot.tsx:432`——**无条件渲染**，位于 `.settingsArea`（整宽块级容器，`SidebarRoot.module.css:646-668`；折叠 rail 下 `display:flex; justify-content:center; width:auto`）。运行时 props **只有 `{ wide }`**。
- 匿名态实际占用：**空**。上游用例明确断言无 settings 访问权时 `entries('sidebar.settings')` 为空（`ui-settings-general/tests/shell.client.spec.ts:91-93`）；线上匿名页实测底部无设置齿轮也印证这一点。
- 已登录态实际占用：我们的 fork `SettingsRoot`（`dsh-base-client-settings-navigation/src/client/index.ts:193-194,218`），其内部再声明 `settings.launcher` 等子槽，官方 `AccountMenu` 就挂在 `settings.launcher` 上。

单槽冲突语义（决定我们能否与官方共存）：

- 同一 `single` 槽、**相同 priority** 重复注册会直接抛错：`single slot "…" already has a registration at priority 0`（`ui-slots/src/index.ts:1216-1222`）。
- **不同 priority 则互相遮蔽，最小 priority 渲染**（`ui-slots/src/index.ts:775,1287`；"lowest renders"）。
- 因此我方注册 `priority: 1`：官方/`SettingsRoot`（默认 0）永远是 winner，我方是影子；官方消失后我方成为最小 live 条目，自动转正。**不需要在官方出现时 dispose 自己**——依赖 priority 语义比状态机更稳；若 dispose，反而要额外处理「官方消失后重新注册」，且会在 access 撤销的瞬间产生空窗。

### 4.3 组件结构

对齐上游 `AccountMenu.tsx:65` 的未登录触发按钮，菜单行改用组件子节点（`Menu` 的 `children`，`Menu.tsx:224`）：

```tsx
<div className={css.root} data-inset={false}>
  <Menu
    side="top" portal autoFocus
    listClassName={css.signedOutMenu}
    anchor={
      <button type="button" className={css.trigger}
        data-collapsed={!wide} data-signed-out="true"
        aria-haspopup="menu" aria-expanded={open}
        aria-label={t('menu')}>
        <IconEllipsisOutlineMedium size={14} />
        {wide && <span className={css.label}>{t('more')}</span>}
      </button>
    }
    onClose={() => setOpen(false)}
  >
    <MenuItemButton icon={<IconSettingsOutlineMedium size={16} />}
      disabled disabledReason={copy.afterSignIn} onSelect={() => {}}>
      {t('settings')}
    </MenuItemButton>
    <MenuItemButton icon={<IconPaperPlaneOutlineMedium size={16} />}
      disabled disabledReason={copy.afterSignIn} onSelect={() => {}}>
      {t('contactUs')}
    </MenuItemButton>
    <MenuItemButton icon={<IconUserOutlineMedium size={16} />}
      onSelect={() => { setOpen(false); location.assign(buildLoginHref(...)) }}>
      {t('signIn')}
    </MenuItemButton>
  </Menu>
</div>
```

- 为什么不用 `items` 数据行：`MenuItem` 只有 `disabled`，没有 `disabledReason`；`disabledReason` 只存在于 `MenuItemButtonProps`（`Menu.tsx:20` vs `:58-64`）。要满足 AGENTS「置灰 + 本地化原因 + 可被读屏获取」，必须用组件行。
- 布局：`.settingsArea` 是整宽块级容器，官方 CSS `.root{flex:1}` 在此不生效但无害，`.trigger{width:100%}` 保证整宽；折叠态由 `.collapsed .settingsArea` 居中 + 官方 `.trigger[data-collapsed='true']` 的 36×36 承担，实现时需实测两种宽度。
- 折叠态：`data-collapsed={!wide}`。
- 键盘与 aria：全部由官方 `Menu` / `MenuItemButton` 承担；不自加 `tabIndex`、不包额外可聚焦元素。

## 5. 状态机：匿名确认、注册与影子

### 5.1 判定

- 数据源：`ctx.inject(['remote.account'], …)` 后调用 `remote.account.getState()`（本仓 seam 提供的账号视图，内部读公开端点 `GET /api/auth/get-session`，匿名返回 `null`）。
- 持续更新：消费 `remote.account.watch`（seam 已实现，2s 轮询、变化才 yield），`AbortController` 跟随 effect 生命周期。
- 不使用裸 `fetch`，不为该功能新增端点。

### 5.2 注册策略（首帧写死）

1. **确认 `signed-out` 之后才注册**，首帧什么都不渲染。
   - 依据：匿名态侧栏底部本来就是空的（`SettingsRoot` 及其 fallback 齿轮都不挂载，§4.2），所以「先空一帧再出按钮」不构成视觉回退；已登录用户则永远不会看到我方按钮，零风险。
   - 反例：若首帧就注册，已登录用户会先看到匿名菜单再被官方替换，产生闪烁，不可接受。
2. 读取失败（异常/401/网络错）→ **fail closed**，不注册。
3. 注册参数 `priority: 1`：
   - 与官方/`SettingsRoot` 的默认 0 不同 → 不会抛 `already has a registration at priority 0`；
   - 低 priority 渲染（`ui-slots/src/index.ts:775,1287`）→ 官方在时我方不可见；
   - 官方消失后我方自动成为最小 live 条目 → 转正，无需重新注册。
4. **不要在发现非我方条目时 dispose**：那会破坏自动转正，并在 access 撤销瞬间产生空窗。让位完全交给 priority 语义。`ctx.slots.subscribe('sidebar.settings', …)` 只保留给测试断言/诊断，不作为让位机制。
5. `/login` 文档直接 return（与 `dsh-base-client-auth-login` 的 `apply()` 守卫同款）。
6. **不调用 `remoteAccess` 的任何写操作，也不改变访问策略。**

### 5.3 三态行为

| 状态 | `sidebar.settings` 占用 | 侧栏底部可见 |
| --- | --- | --- |
| 匿名（无会话） | 我方（priority 1，唯一 live） | 我方「更多」菜单 |
| 已登录 | 我方不注册；`SettingsRoot`（priority 0） | 官方 `AccountMenu`（头像 + 名字） |
| 会话过期（页面已加载） | `SettingsRoot` 撤销后我方成为最小 live | 官方让位后我方出现 |

## 6. 菜单行为规格

| 项 | 匿名态 | 依据 |
| --- | --- | --- |
| 设置 `t('settings')` | **启用** → 打开匿名设置面板（§16） | CEO 06:22 定为 B：匿名要真正可用。面板只含本地可生效项（语言/外观/字号字体），需账号的 7 类不出现 |
| 意见反馈 `t('contactUs')` | 可见 + `disabled` + `disabledReason`（「登录后可用」） | CEO 2026-11-14 06:10 决定：匿名态置灰，**不**沿用上游飞书外链（避免把用户与设备信息导向第三方表单） |
| 登录 `t('signIn')` | 启用 → `location.assign(buildLoginHref(...))` | 唯一主路径 |

- 项顺序、图标沿用官方：设置 / 意见反馈 / 登录（下游 `AccountMenu.tsx:74-79`）。
- 置灰项必须可访问：`aria-disabled="true"` + 原因可被读屏获取（官方 `MenuItemButton` 机制提供，`Menu.tsx:96-123`）。
- 已登录态不出现「登录」项、匿名态不出现「退出登录」项——由「已登录不注册 + 单槽唯一可见」保证。

### 6.1 置灰原因文案（8 语言）

| locale | 文案 |
| --- | --- |
| en | Available after sign-in. |
| zh | 登录后可用。 |
| ja | サインイン後に利用できます。 |
| es | Disponible después de iniciar sesión. |
| fr | Disponible après connexion. |
| de | Nach der Anmeldung verfügbar. |
| ru | Доступно после входа. |
| pt | Disponível após iniciar sessão. |

菜单标签本身不重写，全部取官方 `settings.account` 命名空间。

## 7. next 回跳规则

```
next = encodeURIComponent(location.pathname + location.search + location.hash)
href = `/login?next=${next}&locale=${ctx.locale.getSnapshot().active}`
```

- 保留语言前缀：`/zh-CN/app/session/abc?x=1#y` 登录后回同一地址。
- 保留 query 与 hash。
- `locale` 参数让登录页按当前语言渲染（`dsh-base-client-auth-login` 的 `LoginSurface` 读 `?locale=`）。
- 回跳安全已就绪：`loginReturnPath()` 只保留 pathname+search+hash，异源回退 `/`（`dsh-base-client-auth-login/src/client/return-url.ts:2-11`）。
- 登录成功走整页 `location.assign`，返回后是 owner boot，不需要 SPA 内状态同步。

## 8. 文案、主题、视觉一致性

- 语言：标签取官方 8 语言命名空间；仅置灰原因自写 8 语言（§6.1）。绑定失败必须显式失败，不做静默降级——否则会带半截文案上线（单测覆盖 8 locale 均能解析 `more/settings/contactUs/signIn`）。
- 主题：颜色全部来自官方 CSS module 的 `--dsw-alias-*` / `--dsh-sidebar-*` token，深浅色自动跟随；菜单卡片样式用官方 `.signedOutMenu`，不自带颜色。
- 视觉验证不用自动像素 diff（环境差异易误报），采用 DOM 断言 + 人工截图复核：
  - DOM：`data-signed-out="true"`、`aria-haspopup="menu"`、折叠态 `data-collapsed="true"`、菜单卡片命中官方 `.signedOutMenu`、置灰项 `aria-disabled="true"` 且有说明文本。
  - 截图：匿名 8 locale × 深浅 = 16 张；折叠态 2 张（zh/en）；已登录回归 2 张。

## 9. 测试与验收计划

| 层 | 内容 | 必须有反例 |
| --- | --- | --- |
| 单测（node） | `buildLoginHref`：语言前缀 / query / hash / 深链 / 已编码字符；菜单行状态：三项 enabled/disabled/disabledReason | 异源 `next` 回退 `/`；空 pathname |
| 组件桩测（`apps/web/tests/parity/*-fixture.tsx` 同款） | stub slots + stub `remote.account`；匿名渲染「更多」、点登录只触发一次导航、置灰项 `aria-disabled` 有描述 | 已登录 → 不注册；注册参数 priority = 1；槽内已有 priority 0 条目时不抛错 |
| 槽位语义测试 | 同一 `sidebar.settings` 上官方（0）+ 我方（1）并存时：可见条目唯一、`entries()` 为两条但渲染只有官方；官方 dispose 后我方转正 | 同 priority 注册应当抛错（用于证明我们确实没踩同优先级） |
| 隔离实例（miniflare） | 匿名 `/` 与 `/zh-CN/`：底部按钮在、菜单三项、点登录落 `/login?next=…&locale=…`、登录后回原地址 | 已登录：官方头像菜单，全局 `[aria-haspopup="menu"]` 计数 = 1；会话过期：官方让位、我方出现、不双份 |
| 线上回归（staging） | 上面三条 + 8 locale + 深浅 + 折叠态截图 | 匿名无「退出登录」；已登录无「登录」；点置灰项无任何导航或请求 |

命令门禁：`pnpm check:reuse`、`pnpm check:boundaries`、`pnpm check:packs` 必须全绿。

## 10. 工作量与风险

交付项（Coder）：

1. **0.5 轮** — 技术验证：跨包 import 官方 `AccountMenu.module.css`（CSS Modules 作用域是否一致）、`Menu` + `MenuItemButton` 行在官方键盘遍历里的行为、`sidebar.settings` 上 0/1 双优先级并存与转正（含折叠态两组宽度）。此步不过即换方案，不往下铺。
2. **1 轮** — 新包 + 元数据 + 进 `packs/base` 与 composition + 匿名确认/priority 注册/导航/8 语言。
3. **0.5–1 轮** — 测试三层 + 截图基线 + 双语文档（README 中英、`docs/official-differences*.md`、`docs/typed-remote-mapping.md`）。

合计 2–2.5 轮；QA 0.5 轮；Designer 0.2 轮（只审截图基线）。

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| R1 跨包 CSS module 导入失败 | 唯一真实技术风险 | 交付项 1 先验；退路是按官方 38 行重写自有 CSS module（非逐字，登记 gaps），人工比对视觉 |
| R2 官方 locale 命名空间不可用 | 账号插件被禁用或改名 | 退路：自带 8 语言标签，登记重复文案 |
| R3 双条目窗口 | access 撤销瞬间，`entries('sidebar.settings')` 可能短暂有两条（官方 + 我方影子）；有代码按 `entries()` 遍历而非取 winner | 渲染层由 single/priority 保证唯一；验收加「遍历型消费者」回归（设置快捷键、导航 ledger）；窗口期不得产生重复导航 |
| R4 pin 升级结构漂移 | 上游 `AccountMenu` / `SidebarRoot` 变化 | `sourceReviewCommit` + 截图基线；升级时复核槽名、props、CSS 类名 |
| R5 匿名壳仍可交互 | 入口给了、门禁没给 | 边界写死：本卡不做门禁，另开 P9 |
| R6 折叠态视觉 | 窄侧栏 36×36，`.settingsArea` 改 flex 居中 | 验收必须含 `wide=false` 用例 |
| R7 匿名设置面板的写路径 | 官方主题/语言/字号全部写 host 设置文档，匿名必 401 | 由 §16.3 本地设置文档承接；§16.8 R8–R13 另有配套风险 |

## 11. Security 判定

**不需要 Security 评审**，前提是本 ADR 被严格照做：不碰 `remoteAccess`、不放宽 owner 端点、不新增公开端点、不伪造 access。

硬规则：匿名分支里出现任何访问策略相关改动（放开 `whenAccess`、给匿名发 owner baseline、放宽 `settings/describe`、新增公开读接口），**立即停手转 Security 评审**，不得在实现中「顺手」放宽。

## 12. 给 Coder 的实施清单

1. 建包 `packages/client/dsh-base-client-account-launcher`，按 §4.1 写 `package.json` 全字段（含 `dshBase.reuse` 与 `userApprovedDeviations`）。
2. 实现 `next-url.ts` 纯函数并先写单测（含异源回退）。
3. 实现 `locales.ts`（§6.1 八条），并写「官方命名空间 8 locale 均可解析」的断言。
4. 实现 `AnonymousLauncher.tsx`：官方 `Menu` **+ 三个 `MenuItemButton` 子组件**（不用 `items` 数据行）+ 官方 CSS module + 官方图标/标签；置灰项走 `disabled`/`disabledReason`。
5. 实现 `index.tsx`：`/login` 守卫 → `ctx.inject(['remote.account'])` → 确认 `signed-out` 后以 **`priority: 1`** 注册到 `sidebar.settings`；读取失败 fail closed；**不要**在发现非我方条目时 dispose；首帧渲染空。
6. 追加 `packs/base/pack.json` 行，跑生成器，不手改 roster。
7. 补 `apps/web/tests/parity/account-launcher-fixture.tsx` 与验收脚本三态用例（含 launcher 计数、priority、转正断言）。
8. 双语 README 与 `docs/official-differences*.md`、`docs/typed-remote-mapping.md` 同步。
9. 实现 §16 匿名设置面板：本地设置文档（`local-settings-document.ts` + `settings-remote.ts` 模式判定）→ 官方 `Modal` + 三个官方行组件 → 「设置」项接线。
10. 本地文档白名单只允许 `ui-theme` / `locale`，写前用官方 schema 校验；不存 secret。
11. 验收补 §16.7 八条（含网络零 `settings/*` 请求、零 console error）。
12. 全绿门禁：`check:reuse`、`check:boundaries`、`check:packs`。

## 13. CEO 决定

### 13.1 已决（2026-11-14 06:10）

1. **做 C 方案**：复刻官方 DSH 未登录态的「更多」账号菜单，入口指向我们自己的 `/login`（带 `next` 回跳）。
2. **意见反馈匿名态置灰**，不沿用上游飞书外链（8 语言文案见 §6.1）。
3. **匿名壳门禁另开卡（P9）**：本 ADR 只提供入口，不解决「匿名在壳内可交互、接口 401」的问题。

### 13.2 已决：设置项走 B（2026-11-14 06:22）

CEO 改口：**设置项不置灰、不跳登录，匿名要真正能用设置**。落地为「匿名设置面板 + 本地设置文档」，设计见 §16。

| 选项 | 做法 | 判定 |
| --- | --- | --- |
| A | 给匿名放开 `settings/describe` | **作废**：匿名可读 owner 配置，安全红线 |
| B | 匿名专用设置面板（只含本地可生效项） | **采纳**：CEO 2026-11-14 06:22 拍板 |
| C | 置灰 + 「登录后可用」 | **作废**：原 v2 基线，被 B 取代 |
| D | 保持可点，点击改道 `/login` | 未采纳：不满足「匿名真正可用」 |

**与 PRD 的关系**：PRD §7 已同步改写；ADR 与本决策冲突时，设置项以 B 为准，其余条目仍以本 ADR 为准。

## 14. 参考（代码位置）

| 用途 | 位置 |
| --- | --- |
| `sidebar.settings` 槽声明 | `.submodules/deepseek-harness/packages/client/ui-sidebar/src/client/index.ts:91` |
| `sidebar.settings` 渲染与布局 | 同包 `src/client/SidebarRoot.tsx:432`、`SidebarRoot.module.css:646-668` |
| 匿名态槽位为空（官方用例） | 同包 `ui-settings-general/tests/shell.client.spec.ts:91-93` |
| 我们 fork 的注册与门控 | `packages/client/dsh-base-client-settings-navigation/src/client/index.ts:193-194,218` |
| 单槽冲突与 priority 语义 | `.submodules/deepseek-harness/packages/client/ui-slots/src/index.ts:775,1216-1222,1287` |
| 官方账号插件与槽位门控 | `ui-settings-account/src/client/index.ts:49-50,313,316,333,336` |
| 官方菜单组件（结构基线） | 同包 `src/client/AccountMenu.tsx:56,65,74-79,85` |
| 官方菜单样式（import 对象） | 同包 `src/client/AccountMenu.module.css:6,14,17,23` |
| 官方 8 语言词表 | 同包 `src/client/locales.ts:17-19,32,53-55` |
| `Menu` 数据行 vs 组件行 | `ui-primitives/src/Menu.tsx:20,58-64,96-123,224` |
| 图标导出 | 同包 `src/icons/index.tsx:61`、`src/index.ts:129` |
| 账号视图 seam | `packages/client/dsh-base-client-session-adapter/src/client/index.ts:546-563`、`src/client/account-transport.ts` |
| 匿名访问被拒 | `packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote-access.ts:10-14` |
| 公开文档策略 | `packages/boot/dsh-base-public-pages/src/index.ts`（`PUBLIC_PAGES`） |
| 登录跳转与回跳 | `packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts:182-198`、`packages/client/dsh-base-client-auth-login/src/client/return-url.ts:2-11` |
| reuse 校验规则 | `scripts/conformance/check-official-reuse.mjs:43-48,72` |
| 官方主题服务的 host 绑定与写路径 | `.submodules/deepseek-harness/packages/client/ui-theme/src/client/index.ts:300-334,596-643` |
| 官方语言服务的 host 绑定与写路径 | 同仓 `packages/client/locale/src/client/index.ts:256-262,581-587` |
| configForms 写链与恢复 | 同仓 `packages/client/ui-settings/src/client/config-form.ts:145-162,250-300` |
| 设置线协议形状 | 同仓 `packages/settings/settings/src/types.ts:22-44,57-64` |
| 官方 schema（不手写） | 同仓 `packages/client/ui-theme/src/theme-settings.ts`（`ThemeSettingsSchema`）、`packages/client/locale/src/locale-settings.ts:35`（`LocaleSettingsSchema`） |
| 官方行组件契约 | `ui-theme/src/client/AppearanceRow.tsx:22-31`、`FontSettingsGroup.tsx:20-28`、`locale/src/client/LanguageRow.tsx:17-25` |
| 本地 401 现状（前缀 boot） | `packages/client/dsh-base-client-locale-url/src/client/address.ts:42-45` |

## 15. 修订记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1 | 2026-11-14 | 首版：`settings.launcher` + `Menu` items 数据行 |
| v2 | 2026-11-14 | 槽位更正为 `sidebar.settings`（`settings.launcher` 匿名不存在，§4.2）；改用 `Menu` + `MenuItemButton` 子组件（`disabledReason` 只在组件行，`Menu` 的 `items` 数据行不支持）；注册改 `priority: 1` 影子策略（同优先级抛错、最低 priority 渲染）；首帧策略写死为「确认匿名后注册」；设置项标注待 CEO 裁决（§13.2） |
| v3 | 2026-11-14 | 设置项改判 B（§13.2、§16）：启用并打开匿名设置面板；A 作废、C 置灰作废；新增 §16 匿名设置面板设计（本地设置文档 + 官方行组件复用 + 字号/字体可行性结论 + 验收与风险）；工作量更新为 3.5–4 轮 |
| v4 | 2026-11-14 | CEO 12:40 追加「匿名面板对齐官方壳」：新增 §17（复用 fork 内官方 `SettingsPanel`、5 分区导航、通用 12 行四类处理、原因文案、验收、工作量 5.5–6 轮、R14–R19）；§16.4 面板壳改以 §17 为准 |
| v5 | 2026-11-14 | CEO 13:57 追加 D6：新增 §18（纯客户端偏好 6 项/界面 8 行转可用、禁用降为 2、本地设置文档白名单扩展、验收与 R20–R26）；§17.3/§17.6 加注「以 §18 为准」，实测与最终工作量待 Coder 结论补录 |
| v6 | 2026-11-14 | 补录 Coder D6 可行性小结并定稿路线（§18.7）：匿名槽 entries=0 → 改用「官方行组件 + 官方类自建 store + 官方 configForms」；白名单 `ui-chat`/`ui-conversation`/`ui-settings`；`LinkOpeningRow` 实测可渲染，R22 解除；分类表落点定稿、禁用 2 行；D6 增量 1.5 轮、P8 约 7 轮 |
| v7 | 2026-11-14 | CEO 拍「5 分区都可点开」：新增 §19（P12）——壳加分区间路由、逐分区内容契约（账号官方 signed-out 卡片+灰项、模型本地只读声明、插件官方只读 tab、预设官方 section）、复用路径表、安全边界、验收、3.5–4.5 轮与 R27–R33；§17.2 加注分区状态以 §19 为准 |

## 16. 匿名设置面板（B 方案，CEO 2026-11-14 06:22）

### 16.1 结论

匿名「设置」项**启用**，点击打开匿名设置面板。面板只含三类本地可生效项：语言（8 种）、外观（深/浅/跟随系统）、字号与字体。**字号/字体经核对可本地生效，因此做**（依据见 §16.5）。

实现分两层：

- **写路径**：在 settings seam 里新增「匿名本地设置文档」。官方 `ConfigForms` / `ThemeRuntime` / `LocaleRuntime` 一行不改，读写天然落本地；已登录时原样透传 Host RPC。
- **面板**：官方 `Modal` + 直接渲染官方 `LanguageRow` / `AppearanceRow` / `FontSettingsGroup`，喂官方 store 工厂与官方 8 语言命名空间。

### 16.2 为什么不能直接用官方服务写

核过源码：官方这三项**全部经 Host 设置文档持久化**。

- 主题/字号/字体：`ui-theme` 在 apply 里 `ctx.configForms.get<ThemeSettings>(THEME_SETTINGS_NAMESPACE)` 构造 `ThemeRuntime`（`ui-theme/src/client/index.ts:596-600`）；`setTheme` / `setFontSize` / `setFontFamily` 先改内存与快照，再 `this.write(() => this.host.mutate(...))`（同文件 `:300-320`）。
- 语言：`locale` 插件 `ctx.configForms.get<LocaleSettings>(LOCALE_SETTINGS_NAMESPACE)` 构造 `LocaleRuntime`（`locale/src/client/index.ts:581-582`）；`setLocale` 改内存后 `void this.host?.set(...)`（同文件 `:256-262`）。
- 写入链：`ConfigFormController.mutate` → `ctx.remote.settings.mutate`（`ui-settings/src/client/config-form.ts:145-162`）；失败还会 `recover()` → `mirror.load()` → `settings/describe`，一次交互可能是**多次**网络往返。
- 匿名态这条链必 401（`/api/session-host` 要求会话）。且 `ThemeRuntime.write` 是 `void operation().finally(...)`、`LocaleRuntime` 是 `void host?.set(...)`，拒绝会变成 unhandled rejection → console error。PRD §7-8「无 host 写 / 无 401 / 无 console error」会直接判红。

**顺带发现的既有问题**：匿名访问带语言前缀的地址（如 `/zh-CN/`）时，`synchronizeLocaleAddress` 在 boot 会调 `locale.setLocale(initial.locale)`（`packages/client/dsh-base-client-locale-url/src/client/address.ts:42-45`），按上述链条会发起 `settings/mutate` → 401。B 方案的本地文档落地后这条一并消失；交付项 1 先用网络面板确认现状（当前按「会发生」处理）。

### 16.3 本地设置文档（写路径）

位置：`packages/client/dsh-base-client-session-adapter/src/client/local-settings-document.ts`，由 `settings-remote.ts` 在**确认匿名**时启用。

- 模式判定：复用账号 seam 的 `get-session` 真相（`account-transport.ts`）。只有明确 `null` 才进本地模式；读取失败/未知 → **不启用**（照旧走 RPC，宁可失败也不误写本地）。
- `describe`：不发网络请求，返回 `{ writable: true, hasDocument: false, namespaces: [themeView, localeView] }`。
  - `schema` 取官方导出并序列化：`ThemeSettingsSchema.toJSON()`（`ui-theme/src/theme-settings.ts`）、`LocaleSettingsSchema.toJSON()`（`locale/src/locale-settings.ts:35`）。**不手写 schema。**
  - 形状对齐官方线协议（`packages/settings/settings/src/types.ts:22-44,57-64`）：`autoGenerate / ns / schema / value / base / user / applies / secrets / revision`。
- `mutate` / `update` / `replace`：只接受白名单命名空间 `ui-theme`、`locale`；用官方 schema 校验后写 localStorage（键 `dsh-base.anonymous-settings.v1`），递增 revision，返回 accepted view；其它命名空间一律拒绝。
- 已登录：完全走现有 `settings/*` RPC，行为与现状一致。
- 效果：`ThemeRuntime` / `LocaleRuntime` / `ConfigForms` 的全部读写自动落在本地文档——
  - 主题/字号/字体：boot 时 `adopt()` 从本地 section 恢复（`ui-theme/src/client/index.ts:322-334`）；
  - 语言：`locale.preference` 落本地，裸地址也保留；带前缀地址仍由 URL 优先。
- **没有**新增公开端点、没有改 Worker 鉴权、没有碰 `remoteAccess`；本地文档只存两个偏好命名空间，不存任何 secret。

### 16.4 面板 UI

> **v4 起面板壳以 §17 为准**：不再用 `Modal` 拼装，改为复用我们 fork 里的官方 `SettingsPanel`（800×800 两栏 + 5 分区导航 + 12 行）。本节以下描述仅保留行组件与文案的复用方式。

- 容器：官方 `SettingsPanel`（见 §17.1）；以下行组件直接渲染。
- 三个官方行组件直接渲染（`./src/*` 导入，登记 `sourceEntries`）：
  - `LanguageRow`（`locale/src/client/LanguageRow.tsx`）：8 语言下拉；
  - `AppearanceRow`（`ui-theme/src/client/AppearanceRow.tsx`）：深/浅/跟随系统三格；
  - `FontSettingsGroup`（`ui-theme/src/client/FontSettingsGroup.tsx`）：字号 + 字体（text/code/terminal）。
- props 组成（与官方注册一致）：`PropsRuntime<'settings.general.item'>`（owner props 是空标记，`ui-settings/src/client/contract/slots.ts:100-106`）+ `PropsStore<官方 store>` + `PropsLocale<'settings.locale' | 'settings.theme'>` + injected face。
  - injected face 直接调官方服务：`locale.setLocale(id)`、`theme.setTheme(id)`、`theme.setFontSize(role, px)`、`theme.setFontFamily(role, value)`。
  - store 用官方工厂：`createLanguageRowStore()` / `createAppearanceRowStore()` / `createFontRowStore()`，按官方 `sync(...)` 语义喂快照（`ui-theme/src/client/settings-store.ts:24-70`）。
  - 待 spike：非槽位渲染时 `PropsStore.useStore` 的取法。官方 store 实例已提供 `getSnapshot/subscribe`，可用 `useSyncExternalStore` 包一层；`dsh-base-client-settings` 已有「直接用官方 row 组件 + 自建 store」的先例。
- CSS：行组件自带官方 module css；面板容器只写间距，不复用官方设置壳的导航/分组（导航里全是需账号项）。
- 8 语言：标签取官方 `settings.locale` / `settings.theme` 命名空间——两个插件都在 `whenAccess` 之外无条件注册（`locale/src/client/index.ts:586-587`、`ui-theme/src/client/index.ts:598`），不新写文案。
- 键盘/焦点：官方 `Modal` 的焦点陷阱 + 行组件自带控件；Esc 关闭，焦点回「设置」项。

### 16.5 字号/字体可行性结论

**可本地生效，做。** 依据：`setFontSize` / `setFontFamily` 只改 `ThemeRuntime` 内存快照并 `publish()`，由 `installThemeStyles` 落到 CSS 变量，不依赖任何 Host 能力。范围用官方 `FONT_SIZE_SPECS`（text/code/terminal 各自 min/max/default）；字体是自由输入，空值恢复内置栈。
前提只有一个：写路径必须是 §16.3 的本地文档，否则每改一次字号都会打一次 host 写。

### 16.6 面板边界

面板只出现：语言、外观、字号/字体。以下 7 类需账号项**一个都不出现**、不做假入口：模型、插件、账号、网络搜索、子代理、会话日志、Agent 循环。已登录时本面板不出现（launcher 不注册），由官方 `SettingsRoot` 接管。

### 16.7 验收（与 PRD §7 对齐）

1. 匿名点「设置」→ 面板打开；只含三类项；7 类需账号项在 DOM 中**不存在**（不是隐藏）。
2. 语言：8 种切换 → URL 前缀随之变化，刷新后语言与地址都保留，首屏 `lang`/文案正确。
3. 主题：深/浅/跟随系统生效，刷新保留；系统主题变化时「跟随系统」跟随。
4. 字号/字体：按官方范围可调，刷新保留。
5. 网络：面板所有操作**零** `settings/*` 请求、零 401/403、零 console error / pageerror。
6. 已登录零变化：官方设置面板照旧；`[aria-haspopup="menu"]` 计数 = 1。
7. 截图：面板 8 locale × 深浅 16 张；菜单 16 张 + 折叠 2 张 + 已登录回归 2 张。
8. `check:reuse`、`check:boundaries`、`check:packs` 全绿。

### 16.8 风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| R8 本地文档 schema 漂移 | 官方 schema 变化导致 `decode` 失败、偏好读不回 | 只用官方导出的 schema 对象，不手写；pin 升级时编译期或验收即暴露 |
| R9 官方行组件直渲绑定 | 非槽位上下文取 `PropsStore.useStore` 的方式 | 交付项 1 spike；退路：`useSyncExternalStore` 包 store 实例；再不行用官方 primitives 复刻行并登记偏离 |
| R10 匿名/已登录误判 | 已登录用户被误判匿名 → 设置写落本地、host 不更新 | 只在 `get-session` 明确 `null` 时启用本地文档；未知一律走 RPC；session 出现即整页刷新 |
| R11 本地文档越界 | 误存非白名单命名空间或 secret | 白名单只允许 `ui-theme` / `locale`；其它拒绝 + 单测；不存任何 secret |
| R12 localStorage 不可用 | 隐私模式/配额 | 降级为内存，不抛错；验收覆盖 |
| R13 既有 401（前缀 boot） | §16.2 末尾 | 同批由本地文档消除；交付项 1 先复现取证 |

### 16.9 工作量

- 交付项 1（0.5 轮）：spike（本地文档 schema round-trip、官方行直渲、网络零请求）+ 复现既有 401。
- 交付项 2（1.5 轮）：本地设置文档（describe/mutate/update/replace + 白名单 + 校验 + 持久化 + 模式判定）。
- 交付项 3（1 轮）：面板 UI + 「设置」项接线 + 8 语言/主题 + 官方行组件直渲。
- 交付项 4（0.5–1 轮）：测试 + 面板 16 张截图 + 双语文档 + `official-differences` 登记。

合计 **3.5–4 轮**（Coder），QA 0.5–1 轮，Designer 0.2 轮。比 PRD 注记的「B 比 A 多 1.5 轮」多约 1–1.5 轮，差额来自本地设置文档——这是 PRD「无 host 写 / 无 401」与官方实现之间的必要成本，砍掉它只剩「接受 401」这条路，不可行。


## 17. 匿名设置面板对齐官方壳（CEO 2026-11-14 12:40）

### 17.1 壳：复用我们 fork 里的官方 `SettingsPanel`，不另起壳

**结论**：把 `dsh-base-client-settings-navigation/src/client/SettingsRoot.tsx:57` 里已经存在的 `SettingsPanel`（内部组件，当前未导出）**导出并加两个可选字段**（`rows[].disabled` / `rows[].disabledReason`），匿名面板直接复用它 + 官方 `SettingsRoot.module.css`。几何、两栏、遮罩、焦点陷阱、`role="dialog"`/`aria-modal` 全部官方：`.panel` 800×800、`grid-template-columns: 188px minmax(0,1fr)`、`height: min(800px, calc(100vh - …))`（`SettingsRoot.module.css:84-106`）。

按 AGENTS 复用协议逐条：

| 路径 | 判定 | 理由 |
| --- | --- | --- |
| 原样挂载官方 `SettingsRoot` | 不可行 | 它是 `sidebar.settings` 槽位占用者（侧栏触发器 + 面板 + 5 类子槽声明），整棵依赖 `settings.section` / `settings.general.item` / `settings.section.icon` 的注册。匿名态没有 settings 访问权，这些 registration 一个都不会发生；驱动它等于在匿名态重建整套 settings 插件图（5 分区 + 12 行 + 图标槽），且它与侧栏触发器绑定，不是弹窗组件。 |
| fork 官方包 | 不适用（已 fork） | `dsh-base-client-settings-navigation` 本身就是 `@deepseek-ai/dsh-client-ui-settings-general` 的 fork（`dshBase.forkOf` 已登记）。再 fork 一份会产生两套壳、两份漂移；在现有 fork 上加可选能力是成本最低、漂移最小的做法。 |
| 全自研壳 | 不必要 | 800×800/188px/遮罩/焦点/键盘都在官方 CSS 与 `useModalLayer` 里，自建必然重复且产生视觉偏差。 |
| **复用 fork 的内部 panel 组件** | **选定** | 复用面最小：只加两个可选 row 字段（默认关闭，登录态渲染路径不变），几何与交互 100% 官方。 |

### 17.2 导航：5 个分区全部显示

> **§19（P12）起，4 个需账号分区的策略改为「可点开 + 内容只读/置灰」，不再整行置灰。** 本节保留 v4 的展示要求（顺序、图标、标签官方一致），分区状态以 §19 为准。

- 顺序与官方注册一致：账号 −10、通用 0、模型 10、插件 15、Agent 预设 20（`ui-settings-account/src/client/index.ts:341`、`ui-settings-general/src/client/index.ts:251`、`ui-settings-models/src/client/index.ts:138`、`ui-settings-plugins/src/client/index.ts:78`、`ui-agent-preset/src/client/index.ts:285`）。
- 标签取官方命名空间（5 个均在 `apply` 顶层无条件注册，8 语言齐全）：

| 分区 | 命名空间 | 注册点 |
| --- | --- | --- |
| 账号 | `settings.account` | `ui-settings-account/src/client/index.ts:49` |
| 通用 | `settings` | `ui-settings-general/src/client/index.ts:68,102` |
| 模型 | `settings.models` | `ui-settings-models/src/client/index.ts:45,83` |
| 插件 | `settings.plugins` | `ui-settings-plugins/src/client/index.ts:26,37` |
| Agent 预设 | `settings.agentPreset` | `ui-agent-preset/src/client/index.ts:131` |

- 4 个需账号分区：`aria-disabled="true"`、不可聚焦激活、显示原因「登录后可用」（我们自己的 8 语言文案，§6.1 同一条）；通用分区默认选中且可用。
- 图标：官方走 `settings.section.icon` 槽，匿名态该槽不存在，因此图标放进 panel row 数据（取自各官方包的同一图标组件，经 `ui-primitives` 导出），并在 `reuse.gaps` 登记「pin 升级复核图标来源」。
- 行高/字号/间距由官方 CSS 承担（`.navCell` 40px、`.navLabel` 22px 行高、图标 16px）。

### 17.3 「通用」分区 12 行

> **§18（D6）已定稿，本节的分类与禁用计数以 §18 为准**：禁用行 2（权限、会话日志），6 项转可用（路线见 §18.7）。

按 order：权限 −20、语言 0、外观 10、字号 11、会话显示 12、开发者工具 15、快捷键 16、链接打开 17、回车行为 20、性能用量 30、会话日志 90、当前版本 100。

四类处理方式：

| 类 | 适用行 | 做法 | 风险 |
| --- | --- | --- | --- |
| A 可用（官方组件 + 本地设置文档） | 语言、外观、字号 | §16.4 不变，组件直渲 + 官方 store + 本地文档 | 低 |
| B 官方组件 + stub store（组件原生有不可用态） | 会话日志 | 官方 `UploadRow` + `createSnapshotStore({status:'unavailable', writable:false})`；本仓 `dsh-base-client-settings` 已有同款先例 | 低 |
| C 官方组件 + `fieldset disabled` 包裹 + 原因 | 权限、会话显示、开发者工具、快捷键、链接打开、回车行为、性能用量（7 行；第 8 个禁用行是 B 类的会话日志） | 官方组件照渲，外层 `fieldset disabled` + `aria-disabled` + 本地化原因行；先例 `dsh-base-client-account-availability` 的 `UnavailableBillingSection` | 组件内若有非表单可点区域，`fieldset` 拦不住 → 逐行 spike，拦不住的降 D |
| D 官方 primitives 复刻（最后手段） | 仅当 B/C 会渲染错误数据或崩溃 | 官方行样式 + 官方标签 + 灰态 + 原因 | 视觉偏差，必须登记 |

**「当前版本」行（已裁定，2026-11-14）**：`CurrentVersionRow` 的 props 只有 `PropsRuntime` + `PropsLocale<'settings'>`（`ui-settings-general/src/client/CurrentVersionRow.tsx`），不读 host，能真实显示版本；灰掉它会与「不造假、不隐藏可用信息」冲突。**裁定：按只读可用行真实渲染，不置灰，不计入禁用行。**

### 17.4 原因文案

统一「登录后可用」8 语言（§6.1），分区级与行级共用同一条；不新造第二套措辞。

### 17.5 边界

- 唯一入口：launcher 的「设置」项；全站只有一个匿名设置弹窗实例。
- 关闭与焦点：`SettingsPanel` 已用 `useModalLayer(panel, true, onClose)`（`SettingsRoot.tsx:64`），Esc/遮罩关闭、焦点陷阱由它提供；关闭后焦点回「设置」项。
- 不改已登录：新增字段默认 `false`，`SettingsRoot` 现有渲染路径与 slot ledger 零变化；必须有已登录回归用例。
- **不**向官方槽位注册假 section/假行：匿名面板的数据全部来自我们自己的 row 数据，不碰 `ctx.slots` 的 settings 槽。

### 17.6 验收

> **§18（D6）生效后，本条计数以 §18.5 为准**（禁用行 = 2）。以下保留 v4 快照。

1. DOM：5 个导航行 + 通用 12 行**全部存在**，顺序与官方一致；4 个分区与 **8 个行**（会话日志、权限、会话显示、开发者工具、快捷键、链接打开、回车行为、性能用量）`aria-disabled="true"` 且原因可读；语言/外观/字号真生效；当前版本行为只读可用。
2. 键盘：Tab 顺序合理，disabled 项不可激活；Esc 关闭；焦点回触发按钮。
3. 网络/存储：沿用 §16.7-5（零 `settings/*` 请求、零 401、零 console error）。
4. 已登录零变化：官方设置面板与导航完全照旧。
5. 截图：面板 8 locale × 深浅 16 张 + 导航展开态 2 张；菜单沿用 §16.7-7。

### 17.7 工作量与风险

- 交付项 A（0.5 轮）：导出 `SettingsPanel` + 增加 `disabled/disabledReason` + 登录态回归。
- 交付项 B（0.5 轮）：5 分区导航、图标、disabled 语义、8 语言原因。
- 交付项 C（2 轮）：12 行逐行分类与适配（3 可用 + 1 只读可用 + 8 禁用，含逐行 spike）。
- 交付项 D（1 轮）：DOM/键盘/截图矩阵 + 双语文档 + `official-differences` 登记。
- **P8 总计约 5.5–6 轮**（Coder；§16 原估 3.5–4 轮 + 本轮对齐增量 1.5–2 轮），QA 0.5–1 轮，Designer 0.2 轮。

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| R14 官方行组件脱离槽位渲染 | props/store 绑定方式不匹配 | 逐行 spike；退路 D |
| R15 `fieldset` 拦不住非表单交互 | 组件内有 div+onClick | 逐行验证；拦不住降 D |
| R16 图标来源 | 匿名态 `settings.section.icon` 不存在 | 图标进 row 数据，取官方同一图标；pin 升级复核 |
| R17 panel 改造影响登录态 | 改了我们 fork 的共享组件 | 可选字段 + 默认 false + 登录态回归用例 |
| R18 无 host 数据时组件崩溃/渲染假数据 | 部分行依赖 host store | 命中即降 D；不允许假数据上线 |
| R19 「当前版本」行口径 | 已裁定只读可用，实现若误置灰会与验收冲突 | 验收断言：禁用行 = 8，当前版本行存在且可读 |


## 18. 纯客户端偏好行转可用（D6，CEO 2026-11-14 13:57）

### 18.1 决定

匿名设置面板里，「纯客户端偏好」的 6 项 / 界面 8 行不再置灰，改为**真正可用**：

- `transcript-view`（工作步骤展示、收起时机、收起回复、代码工作视图）
- `developer-tools`
- `shortcuts`
- `link-opening`
- `composer-enter`
- `performance-usage`

仍然禁用（2 行）：`permission`（宿主权限策略）、`session-log`（需账号上传）。
当前版本行维持 §17.3 的只读可用结论。

### 18.2 依据

1. **官方语义本来如此**：DSH 的 Host 权限与 DeepSeek 账号解耦——未登录时官方设置基本都能打开，这些偏好存的是浏览器端行为开关，不是账号能力。
2. **我们的做法是按「权限工程」划的线，不是产品语义**：之前把 9 行一并置灰，是因为匿名态拿不到官方设置壳的 host 设置访问；现在有了 §16.3 的客户端本地设置文档，这条工程理由对纯客户端偏好不再成立。
3. **不违反「不造假」**：可用 = 真的本地生效 + 刷新保留；不是把禁用控件伪装成可用。
4. **零网络**：全部读写仍走本地设置文档或官方既有的 localStorage，不新增请求、不碰 `remoteAccess`、不改 Worker 鉴权。

### 18.3 分类表（12 行三态）

| 行 | order | 状态 | 官方组件 / 包 | 数据源（已核） | 落点 |
| --- | --- | --- | --- | --- | --- |
| 权限 | −20 | **禁用** | `ui-permission-presets` | 宿主权限策略（owner） | — |
| 语言 | 0 | 可用 | `LanguageRow` / locale | 本地设置文档 | `locale` |
| 外观 | 10 | 可用 | `AppearanceRow` / ui-theme | 本地设置文档 | `ui-theme` |
| 字号 | 11 | 可用 | `FontSettingsGroup` / ui-theme | 本地设置文档 | `ui-theme` |
| 会话显示 | 12 | **转可用** | `TranscriptViewRow` / ui-chat | hooks：[`transcriptView`、`collapseTiming`、`foldedReplies`、代码工作视图]（`SnapshotStore`） | `ui-chat`（官方类自建 store） |
| 开发者工具 | 15 | **转可用** | `DeveloperToolsRow` / ui-settings-general | `ctx.configForms.developerTools`（ConfigForms 自持） | `ui-settings`（schema 仅 `enabled: boolean`） |
| 快捷键 | 16 | **转可用** | `ShortcutsRow` / ui-shortcuts | `ctx.shortcuts` 服务（catalog/config/fixedCatalog） | 官方已用 localStorage `dsh.keybindings.v1` |
| 链接打开 | 17 | **转可用** | `LinkOpeningRow` / ui-chat | hooks：[`linkOpening`、`browserAvailable`] + setter；实测 browser tab = true，行会渲染 | `ui-chat` |
| 回车行为 | 20 | **转可用** | `EnterBehaviorRow` / ui-conversation | hooks：[`busyEnter`] + setter（`submissionPolicy`） | `ui-conversation`（官方类自建 store） |
| 性能用量 | 30 | **转可用** | `PerformanceUsageRow` / ui-chat | hooks：[`performanceUsage`] + `performancePolicy.setMode` | `ui-chat`（官方类自建 store） |
| 会话日志 | 90 | **禁用** | `UploadRow`（stub store） | 需账号上传服务 | — |
| 当前版本 | 100 | 只读可用 | `CurrentVersionRow` / ui-settings-general | 仅 `t` | — |

命名空间已核：`CHAT_SETTINGS_NAMESPACE = 'ui-chat'`（`ui-chat/src/chat-settings.ts:6`）、`DEVELOPER_TOOLS_NAMESPACE = 'ui-settings'`（`ui-settings/src/developer-tools-settings.ts:5`，schema 只有 `enabled`）、快捷键官方在 Web 上写 localStorage `dsh.keybindings.v1`（`ui-shortcuts/src/client/locales.ts:60`）。

### 18.4 机制

1. **官方行组件 + 官方类自建 store（Coder 实测修正）**：匿名态 `settings.section` / `settings.general.item` 的 entries = 0——设置外壳声明在 `settings/describe` 的 access gate 内，槽声明本身都不注册，所以**官方插件已注册的行实例不可达**。改为：直接用官方行组件，store 由官方导出的 store 工厂 / policy 类（`./src/*` 导入，登记 `sourceEntries`）实例化，读写挂在官方 `configForms` 服务上。不移动槽声明、不碰 access gate。
2. **本地设置文档白名单扩展**：扩 `ui-chat`、`ui-conversation`、`ui-settings` 三个命名空间（Coder 实测确认），仍只接受预置清单、仍用官方 schema 校验、仍不存 secret。
3. **快捷键不扩白名单**：官方本来就写 localStorage，直接复用同一 key，不另起。
4. **零网络**：本地文档承接全部写；已登录时原样走 host RPC，行为不变。

### 18.5 验收

1. 6 项可用且**真生效 + 刷新保留**（行为验，不只看 UI 状态）：会话显示三项展开后可改，开发者工具开关影响诊断视图，快捷键可改并生效，链接打开方式生效，回车行为生效，性能用量生效。
2. 总行数仍 12；禁用行 **= 2**（权限、会话日志），均 `aria-disabled` + 原因；当前版本行只读可用。
3. 零 `settings/*` 网络请求、零 401/403、零 console error / pageerror；且不注册任何 settings 槽条目（匿名 `settings.section` / `settings.general.item` entries 仍为 0，证明没走「伪造官方 registration」的歪路）。
4. 已登录零变化：官方设置面板与相同项的行为、持久化位置均不变。
5. 截图：面板 8 locale × 深浅 16 张不变；另加 6 项展开态 2 张（zh/en）。
6. 登录前后不串味：匿名本地值不迁移、不覆盖 host；登录后读 host。

### 18.6 风险与退路

| 风险 | 说明 | 退路 |
| --- | --- | --- |
| R20 白名单扩展面 | `ui-chat` / `ui-settings` / `ui-conversation` 是否只含纯客户端偏好 | 逐字段核对 schema；含账号语义的字段不放行，该行退回禁用并登记 |
| R21 匿名本地值与 host 同名命名空间 | 登录后可能串味或覆盖 | 只读 host、不回写本地；登录即整页刷新；验收第 6 条卡死 |
| R22 ~~`LinkOpeningRow` 可能渲染 `null`~~ | **已解除**：Coder 实测 `sidebarRightTabs` 的 browser tab = true，该行会正常渲染 | 无需退路 |
| R23 快捷键 key 不一致 | 另起 key 会与官方编辑器读写分裂 | 固定 `dsh.keybindings.v1`，不复用会另造一份 |
| R24 UI 可用但行为未生效 | 部分 policy 可能另有 host 侧来源 | 逐行「行为验」而非「UI 验」；不生效即退回禁用 |
| R25 ~~§17 计数需同步~~ | **已同步**：§17.3 / §17.6 注记已改为「禁用 2 行、以 §18 为准」；PRD 验收由 PM 同步 | 无需动作 |
| R26 白名单变大后的隐私面 | 本地文档可能存到非偏好数据 | 仍只存预置清单、无 secret；Security 口径不变（不碰访问策略） |

### 18.7 Coder 可行性小结与定稿路线（已回，CEO 拍 go）

**关键事实（Coder 实测）**

- 匿名态 `settings.section` / `settings.general.item` entries = **0**：设置外壳的槽声明在 `settings/describe` 的 access gate 内，匿名连槽声明都不注册，因此**官方插件已注册的行实例不可达**。
- 服务层实测可用：`configForms`（`unavailable` / `writable:false`，等白名单放行后即可写）、`shortcuts`（config ready，catalog 17 条）、`sidebarRightTabs`（browser tab = true）。
- 逐项：`developer-tools`、`shortcuts` 可直接驱动；`transcript-view` / `composer-enter` / `performance-usage` / `link-opening` 的 store 需用「官方类 + 官方 `configForms` 服务」自建实例。
- 由此 `LinkOpeningRow` 会正常渲染（仅在 browser 未注册时 `return null`），**R22 解除**。

**定稿路线（CEO 2026-11-14 拍 go）**

1. 6 项全做，不做降级；**不移动槽声明、不碰 access gate**。
2. 行组件用官方导出件；store 用官方导出的 store 工厂 / policy 类（`./src/*`，登记 `sourceEntries`），读写挂官方 `configForms`。
3. 本地设置文档白名单扩 `ui-chat` / `ui-conversation` / `ui-settings`。
4. 快捷键复用官方 localStorage `dsh.keybindings.v1`，不另起 key。
5. 禁用行降为 2（`permission`、`session-log`），面板仍 12 行；当前版本行只读可用。
6. 工作量：D6 增量按 **1.5 轮**计入（区间 1–1.5 取上限），**P8 合计约 7 轮**（§17 的 5.5–6 + 1.5），最终以 Coder 排期卡为准。

**交付时仍需自证（写进 Coder 证据）**

- `ui-chat` / `ui-conversation` 命名空间逐字段只含纯客户端偏好（R20）。
- 匿名本地值与 host 同名命名空间在登录后不串味（R21）。
- 6 项是「行为生效」而非仅 UI 状态（R24）。


## 19. 匿名设置面板：5 个分区都可点开（P12，CEO 2026-11-14）

### 19.1 口径与决定

CEO 拍板：**5 个分区都要能点开**，内容按可得数据只读展示，拿不到的内容项置灰 + 8 语言原因；**不要求与官方完全一致**。这覆盖 §17.2「4 分区整行置灰」和上一轮「账号分区匿名不显示」的建议。

- 壳沿用 §17 的 `SettingsPanel`（我们 fork 内的官方面板），只增加「分区切换」：左侧 5 行全部可点、可聚焦；右侧按选中分区渲染。
- 账号分区不再隐藏、不再整行灰：点开后是官方未登录卡片 + 我们补的灰项（余额/订阅/用量/充值）+ 原因。
- 新增数据访问仍然只走三样：**自建壳 + 已有只读 seam + 匿名本地设置文档**。

### 19.2 壳与分区路由

- 左侧 nav：5 行（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），全部 `aria-disabled="false"`、可键盘选中；行内不再有原因（原因下沉到内容区）。
- 右侧内容区：`general` 复用 §17 的 12 行；其余 4 个分区按 §19.3 各自渲染。
- 焦点/Esc/遮罩沿用 `SettingsPanel`（`useModalLayer`，`SettingsRoot.tsx:64`）。
- 唯一入口仍是 launcher 的「设置」项；单实例。

### 19.3 逐分区内容契约

#### 19.3.1 账号与余额

- **可复用官方未登录分支**：`AccountSection` 在 `signedIn === false` 时早返回一个 `<section class="signedOut">`，含标题 `t('settingsSignedOutTitle')`、说明 `t('settingsSignedOutDescription')`、主按钮 `t('signIn')`（`ui-settings-account/src/client/AccountSection.tsx:149-160`）。官方组件原样直渲，我们只提供 signed-out 的 account 快照与 `start`。
- 登录按钮：`start` 直接 `location.assign(buildLoginHref(...))`（与 §7 同一函数，带 `next` 与 `locale`）。不打开官方 SignInDialog（我们的登录是我们的 `/login`）。
- 余额/订阅/用量/充值：官方未登录分支里**不渲染**这些行，因此我们补一小段「不可用项」列表，用官方行样式（标题 + 灰值），4 项各带原因（8 语言）：
  - 余额：`登录后可查看余额。`
  - 订阅/套餐：`登录后可查看订阅。`
  - 用量：`登录后可查看用量。`
  - 充值：`登录后可充值。`
  该段是我们自创 UI（官方此状态下没有对应区块），登记 `userApprovedDeviations`。
- 不调用 `account/watch`、不调用 `remote.account` 的写接口；账号快照由我们的 account seam 提供 signed-out 视图。

#### 19.3.2 模型

**推荐：只读本地声明目录，不新增公开端点。**

- 数据面：复用客户端已有的 `buildFallbackModelCatalog`（`packages/client/dsh-base-client-session-adapter/src/client/model-catalog-fallback.ts`），它已内置 2 个 provider × 2 个模型的名称、`available:false` 与明确原因（owner key 未配置 / gateway 未启用）。
- 渲染：provider 分组 + 模型行只读、灰态；每行一个原因（沿用 fallback 里的 `unavailableReason`，补 8 语言）。
- 为什么不是新公开端点：模型是否可用取决于 owner 的 key（BYOK），公开端点只能返回静态名单，语义与本地声明相同，却多一个接口面、一套缓存与一份安全评审；等到确实需要「服务端真实可用性」时再单独立项（记入 §19.7 不做清单）。
- 成本：一个只读列表页（官方 primitives + 官方模型图标/排版），0.5 轮量级。

#### 19.3.3 内置插件

**推荐：直渲官方只读清单 tab + 我们的只读 seam。**

- 本部署目前没有任何 `settings.plugins.tab` registrant，因为该槽声明在设置外壳里、匿名不存在——这是缺声明，不是缺数据。
- 官方 `PluginInventorySettingsTab` 可直接渲染（`ui-settings-plugin-inventory/src/client/index.ts:56-66` 的组件；注入面很窄：`list`、`presetName`、`resolveText`、`hooks.clientSync`、`retryClient`），其中 `list` 用我们已有的只读 seam（`remote.pluginInventory.list()`，返回真实 client loader 条目 + Think 声明行）。
- `hooks.clientSync` 取 `ctx.modules.entries.state`；若匿名态 `modules` 服务不可用，用空快照 stub；`retryClient` no-op。
- 安装/更新/卸载仍由只读 seam 返回「明确不可用」，页面里不出现可用写入按钮。
- 成本：0.75–1 轮（直渲 + stub + 空态兜底）。

#### 19.3.4 Agent 预设

**推荐：先只读真列表，「设为默认」置灰；白名单扩 `agentPreset` 作为可选项排后。**

- 数据面：`remote.agentPresets.list()/read()` 已是我们的只读 seam（`fixed-agent-presets.ts:34-55`），返回 pinned 声明列表，可列真名字。
- 渲染：官方 `AgentPresetSection` 直渲（待 spike：它需要 `AgentPresetSectionInjected` 的 `load/view/closeView/hooks`，store 工厂若未导出，退路是用官方 primitives 复刻只读列表并登记偏离）。
- 「设为默认」写的是 settings 命名空间（`writeDefaultPreset`，`ui-agent-preset/src/client/settings-store.ts`）：先置灰 + 原因；若要真可用，把 `agentPreset` 加入匿名本地文档白名单（+0.5 轮，仍零网络）。
- 成本：0.75–1 轮（只读）；+0.5 轮（可写默认）。

### 19.4 复用路径（逐项）

| 分区 | 路径 | 官方件 | 是否新增 fork |
| --- | --- | --- | --- |
| 通用 | §17 自建壳 + 官方行组件直渲 | `LanguageRow`/`AppearanceRow`/`FontSettingsGroup` 等 | 否（壳复用既有 fork 的 `SettingsPanel`） |
| 账号 | 自建壳 + 官方 `AccountSection` 直渲 + 自创灰项段 | `AccountSection.tsx` | 否（灰项段自创，登记偏离） |
| 模型 | 自建壳 + 官方 primitives 自建只读列表 | 无官方只读组件可挂；不 fork | 否 |
| 插件 | 自建壳 + 官方 `PluginInventorySettingsTab` 直渲 | `PluginInventorySettingsTab.tsx` | 否 |
| Agent 预设 | 自建壳 + 官方 `AgentPresetSection` 直渲（退路 primitives） | `AgentPresetSection` | 否 |

- 全部走 `./src/*` 导入的，登记 `sourceEntries` 与 `sourceReviewCommit`；不新增 fork，不复制官方源码。
- 官方「原样挂载插件」仍不可行：5 个分区的注册都在 `settings/describe` 门控之后（§17.1），这条结论不变。

### 19.5 安全边界（红线不变）

- 不放开 `settings/describe`、`account/watch`、`pluginManager/listBundles` 给匿名。
- 自建壳是**渲染**不是**授权**：5 个分区组件不得调用任何 owner-only remote。审计清单（交付项 1 逐页核对）：`remote.settings.*`、`remote.account.*`、`remote.pluginManager.*`、`remote.llm.*`、`remote.credentials.*` 在匿名路径上一次都不出现于网络。
- 只读数据来源限定为：`remote.pluginInventory`（已有只读 seam）、`remote.agentPresets`（已有只读 seam）、fallback 模型目录（纯本地）、账号 signed-out 快照（我们的 seam）。
- 本地文档仍只允许既有白名单（`locale`/`ui-theme`/`ui-chat`/`ui-conversation`/`ui-settings`；可选再加 `agentPreset`），不存 secret。

### 19.6 验收

1. 5 个分区全部可点开、可键盘选中；每页至少一条**真实内容**：账号 signed-out 卡片、模型 2×2 声明、插件清单行、预设 pinned 列表、通用 12 行。
2. 不可用项：可见 + `aria-disabled="true"` + 8 语言原因（账号 4 项、模型每行、预设「设为默认」）。
3. 网络断言：面板全程无 `settings/*`、`account/*`、`pluginManager/*`、`llm/*`、`credentials/*` 请求；零 401；零 console error / pageerror（沿用 §16.7-5 的测法）。
4. 已登录零变化：官方设置面板与 5 分区行为照旧；`[aria-haspopup="menu"]` 计数 = 1。
5. 截图：5 分区 × zh/en × 深浅 = 20 张；导航 8 locale 快照 8 张。
6. 门禁：`check:reuse`、`check:boundaries`、`check:packs`、`pnpm check` 全绿。

### 19.7 成本与排期

| 交付项 | 内容 | 轮次 |
| --- | --- | --- |
| A | 壳加分区间路由（复用 §17 面板）+ 安全审计清单 | 0.5 |
| B | 账号分区（官方 signed-out 卡片 + 4 项灰段） | 0.5–0.75 |
| C | 模型分区（本地只读声明） | 0.5 |
| D | 插件分区（官方 tab 直渲 + stub） | 0.75–1 |
| E | 预设分区（官方 section 直渲 + 设为默认置灰） | 0.75–1 |
| F | 验收证据 + 双语文档 + 偏离登记 | 0.5–0.75 |
| **合计** | | **3.5–4.5 轮** + QA 0.5–1 轮 |

- **排期冲突**：P12（本节）优先，P10 顺延；E 的「可写默认预设」（+0.5 轮）也顺延到 P10 之后。
- 不做（本 ADR 延续）：公开模型目录端点、动态 OG、D1 配置、插件安装/更新写操作、账务真实数据。

### 19.8 风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| R27 官方组件脱离槽位直渲 | runtime/store 绑定不匹配（尤其 `AgentPresetSection`） | 交付项 1 逐页 spike；退路 primitives 复刻并登记 |
| R28 账号灰项段是自创 UI | 官方 signed-out 分支不含余额/订阅行 | 只作状态说明，不给数字或链接；`userApprovedDeviations` 登记 |
| R29 模型声明与真实可用性差异 | fallback 目录是声明，不代表实际可调 | 文案强制「未配置/登录后可用」，不显示「可用」绿标 |
| R30 `modules` 服务匿名缺失 | 插件 tab 的 `clientSync` 依赖它 | 空快照 stub；`retryClient` no-op |
| R31 预设写入需 settings | 「设为默认」依赖 host settings | 先置灰；白名单扩 `agentPreset` 后可用（顺延） |
| R32 疑似绕过 access gate | 自己渲染分区组件 | 不调用任何 owner remote；网络断言卡死（19.6-3）；Security 口径不变 |
| R33 排期挤压 | P12 与 P10 冲突 | P12 优先，E 的可写部分顺延 |

## 20. 匿名账号页身份分离（2026-11-17 修订）

用户要求保留官方账号页原本 UI/UE，将 Dsh-base 登录提示与按钮作为独立新增区放在下方。本节覆盖 §19.3.1、§19.4 账号行及 R28 中“四条自建灰项”的当前适用性；原文保留为历史决定，不再作为该区现行设计。

- 官方区域直接渲染固定版本导出的 `AccountSection` signed-out 分支，保留其原字典与 CSS，不覆盖高度、居中、边距、字体或按钮样式。
- DeepSeek Platform 身份与本地 Dsh-base 身份分开。当前没有 Platform 授权适配，官方区域由 `disabled fieldset` 保留为不可用状态，并给出八语言 `platformUnavailable` 说明。官方登录按钮不调用本地 `requestLogin()`，也不伪造专属 API Key、余额或账单能力。
- 移除四条自建余额/订阅/用量/充值灰行。在下方独立 `data-dsh-base-account-sign-in` 区展示 Dsh-base 账号提示，复用官方 `Button` 与 `AccountSection` 行样式，只有这个新增按钮打开本地登录弹窗。
- 继续使用已有 `client-account-launcher` 插件及已登记的导出组件，不新增 fork，不复制官方源码，不把能力塞入 App。
- 不放开匿名 `account/watch`、`settings/describe` 或任何私有资料权限；只读面板不发送私有账号请求。登录是本地身份验证，不是 DeepSeek 授权。

验收范围：官方区域与固定版本组件的渲染对照；官方登录不可用且不会打开本地认证；四条旧灰行不存在；仅新增 Dsh-base 按钮打开本地弹窗并能关闭回焦；八语言、深浅色和窄屏；无私有请求或权限放宽。实际执行与部署证据以[完成状态](completion-status.md)为准，本修订不宣称已经完成部署。

## 21. 匿名账号页保留完整官方内容（2026-11-17）

用户进一步要求内容区域对齐原版完整账号页，未登录时只将依赖账号的区域置灰。本节覆盖 §20 的居中 signed-out 占位选择；身份分离和底部 Dsh-base 登录入口继续保留。

官方 `AccountSection` 在 `!signedIn && !active` 时提前返回占位；完整身份卡和账单卡没有独立导出，不能通过既有 Host 合同获得该布局。因此新增完整标记的 `@dsh-base/client-settings-account` fork，来源为固定子模块 `packages/client/ui-settings-account`，原件仍在组合清单中禁用。fork 默认 `auto` 模式不变，新增显式 `full-unavailable` 展示合同，只对真实 signed-out 且无授权 attempt 的快照生效。

完整布局复用原有账号身份、账号信息、余额、赠金、用量及充值区域，保持原 CSS 和八种语言词典。无账号资料或钱包时使用官方未登录文案，不伪造金额、profile 或登录状态；不可用 Platform 链接没有 href，不能跳转或调用认证。底部单独追加 Dsh-base 登录行，只有该按钮打开本地登录弹窗。私有 Host 权限不变。

验收分开记录：默认模式与原件逐状态直接对照；完整匿名布局属于用户批准的扩展，检查官方源码差分、共享结构样式、真实匿名状态、禁用导航以及独立本地登录。不能宣称上游本来就有完整匿名页面，也不能用伪造认证状态构造视觉参照。证据将写入 `.artifacts/acceptance/account-full-layout/`。

## 22. 匿名模型设置复用官方界面（2026-11-17）

用户要求模型内容尽量还原官方 UI。本节覆盖 §19 的 R29 自建列表与“未配置/登录后可用”文案。未登录只说明不能读取账号状态，不能据此判断缺少凭据或平台未启用。

已有完整标记的 Models fork 新增显式 `public-declarations` 展示合同，保留真实 `configured:false`、`active:false` 和未知 credential；原有 `auto` 分支不变。复用未修改的官方 CSS、ProviderEditor、DeepSeekModelsEditor、CustomProviderCard 及八语言词典。只读表单可浏览与展开，写入禁用；添加提供商在原按钮处请求本地认证，不建立可写草稿。Gateway 使用原卡片和独立 signed-out 本地快照，不创建会监听或读取真实远端的 GatewayStore。

公开模型、DeepSeek schema/defaults 提取到纯数据支持包，与现有 Worker 和 client 插件共用。这个支持包不是独立运行的插件。匿名 Host 不接受 Context/Remote，写入一律拒绝，编辑器挂载时的发现调用只返回本地声明。没有新增公开私有数据端点、凭据访问或权限放宽。

验收分别比较默认 Models 与固定官方原件，以及匿名只读 ProviderEditor 与固定原件。匿名整体布局是用户批准的展示扩展，不声称官方已有这一完整匿名页面。浏览器覆盖八语言、主题、窄屏、详情及登录回焦；实际报告与版本见完成状态。
