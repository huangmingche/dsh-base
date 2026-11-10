# 官方设置导航的 slot 投影修正

组合范围：默认应用只在登录后加载工作台。以下未登录分支属于组件或 Host 的独立契约，仅在隔离测试中使用。

源码来自只读固定子模块 `packages/client/ui-settings-general`，版本和 MIT 许可记录于 `dshBase.forkOf`，原始声明保留于 LICENSE。完整保留官方浏览器实现、样式和八语言词典。

唯一功能修改：设置导航及 onboarding 顺序从公共 `entriesOfSlot()` 读取每个 id 的有效注册，而非包含被遮蔽原件的原始 `entries()`。官方渲染器同样选择每个 id 的赢家，因此可用性接缝注册禁用组件后，导航应只出现一次。直接挂载原插件会重复导航；导出 SettingsRoot 不能重新声明原注册拥有的 child slots，故需要此最小 fork。额外 entry.ts 仅提供本项目 Loader 的 Config/name 契约。

验收运行 `node apps/web/tests/parity/run-settings-navigation.mjs`：真实 SlotCore 注册及 apply 投影驱动官方 SettingsRoot，比较中英原始参考和影子注册后的导航/交互，并验证每个项目仅出现一次。


通用设置版本行在官方当前版本后追加 pinned 上游 release 的 `DeepSeek Harness` 名称与 tag。应用版本从 `apps/web/package.json` 读取；上游仓库 URL 与 encode 后的 release URL 在构建时从 `dsh-source.lock.json` 的 `repository`（去 `.git`）和 `tag` 派生并注入。`DeepSeek Harness` 链接仓库，tag 链接 pinned `/releases/tag/<tag>`；原生锚点使用 `target="_blank" rel="noopener noreferrer"` 与 focus-visible 样式。组件内不写版本/URL 常量，不做 latest 追踪，pin 升级后自动更新；窄屏自然换行。
## 匿名面板扩展（可选字段）

`SettingsPanel` 现在导出（`src/client/SettingsRoot.tsx`，另经 `./client` 再导出），并给 `SettingsSectionRow` 增加三个可选字段：`disabled`、`disabledReason`、`icon`。官方 section 注册不设置它们，因此登录态导航单元格的属性、样式与激活路径完全不变；投影逻辑抽到 `src/client/panel-rows.ts` 并由 `tests/panel-rows.test.ts` 覆盖（缺省/false/仅 reason 均回到官方行为）。匿名账号入口用这三个字段渲染「其余 4 个分区可见但禁用 + hover 原因」；这是使用方行为，不属于本 fork 的默认渲染路径。
