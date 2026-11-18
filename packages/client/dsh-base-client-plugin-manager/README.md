# @dsh-base/client-plugin-manager

锁定官方 `@deepseek-ai/dsh-client-ui-plugin-manager` 的完整标记 fork，来源为 `.submodules/deepseek-harness/packages/client/ui-plugin-manager`，commit `9c2670d3bce5275e0d1610272958121af87787bb`，MIT。完整 `src/`、`locale/` 与许可证保留；包根和 `/client` 仅导出浏览器入口，原 Host registry-probe 源码不导出、不加载、不启动。

官方插件已经直接挂载验证。列表 `PackageCard` 与 `packageStatus` 是内部实现，现有导出组件和 slots 不能单独替换列表状态胶囊与错误行，因此按官方复用协议 fork，而不是复制片段或用 CSS 隐藏错误。原页面结构、图标、配置、导航、安装流程、控制器、错误处理、全部 CSS 和官方语言字典保留。

## 插件页缩放

官方插件页头会测量展开和折叠布局。部分浏览器缩放比例下，把工具栏的宽度写回页面会因取整而触发换行，导致「添加插件」被裁切。派生包沿用官方按钮和断点，工具栏按内容宽度布局，并以测量值限制可用空间。页面存在 CSS 缩放时，测量值先换算为布局坐标。

## Host 可用性适配

Host seam 通过显式扩展字段 `deploymentAvailability: 'not-adapted'` 声明部署未适配目录项，不再把它伪装成 `error`。字段由真实 `packageView` 投影保留；未知值不会改变官方状态。

- 只有已标记、官方、文件缺失、未安装、未启用、没有安装目标且没有运行行的条目，使用「不可用」中性胶囊。它直接复用官方 `Tag tone="neutral"`，与内置设置的八语言文案和几何一致。
- 主列表移除这类条目的「未安装」胶囊；没有伪造的错误就不会产生重复操作系统红字。详情仍保留真实未安装/来源事实，原 `plugins.detail.section` 扩展继续给出可阅读的 Workers 限制。
- 显式标记始终使开关禁用；字段本身不会创建 fiber、安装目标或管理权限。Host 和数据 seam 仍独立拒绝激活。
- 真实 Host 错误、元数据错误及失败的运行行优先显示异常。未标记条目的原版状态、原因及行为不变，不修改全局「异常」翻译，不隐藏错误 CSS。

这是用户明确批准的可用性呈现调整，记录于 `dshBase.reuse.userApprovedDeviations`。来源登记、替换关系和固定 commit 位于 `package.json`；被替换的官方插件保留为禁用清单。

## 组合插件的组件说明

Cloudflare AI Gateway 复用官方 `BundleInfo.rows`，以一个插件包包含设置界面与平台模型服务两个真实组件。Host 对组件声明 `readOnlyReason: 'unaddressable'` 并附加 `managedByBundle: 'Cloudflare AI Gateway'`，表示组件只能通过所属插件包统一切换。完整组件清单、entry id、运行阶段及开关状态仍由真实 Host 投影提供。

标记 fork 仅将这个明确的 Host 说明投影到组件开关的八语言 tooltip（例如「由 Cloudflare AI Gateway 开关统一管理」）；禁用逻辑、官方 Switch、CSS 和布局均不变。字段只接受非空字符串且必须伴随 `unaddressable`，未知/无效值、其他拒绝原因及普通可写组件都保持原版行为。组件级管理接口拒绝独立切换；兼容的旧成员写入同样受插件包原子开关约束，显示说明不会授予权限。

## 验证

`node --test packages/client/dsh-base-client-plugin-manager/tests/*.test.mjs` 检查真实 Host 投影、严格目录边界、错误优先级、八语言一致性、组件统一管理说明，以及整个官方源码/资源的漂移。漂移回归仅允许三个既有源文件中的已审查 Host 适配与自有 `availability.ts`、`bundle-management.ts`、`management-policy.ts`、`group-summary.ts`，其他官方内容逐字比较；pin 更新必须重新审查。

浏览器验收由应用的 plugin-manager parity runner 对照锁定的原版组件，分别验证获批的不可用差异与未改变的真实错误状态。

## 完整库存与管理范围

Host 可为只读条目声明 `managementPolicy: "required" | "deployment"`，分别显示「应用所需」和「由部署管理」。字段必须伴随 `readOnlyReason: "unaddressable"`，否则不改变官方行为。插件是否可见、是否安装、是否启用与实际 fiber 状态继续分别读取；字段不授予操作权限，也不把必需插件标成不可用。原开关及禁用逻辑保留，详情中的正常管理范围使用原版 `status` 样式，真实错误仍使用 `reason`；不增加 CSS 或布局。经过验证的管理归属字段同时传给官方详情 slot 的 subject，确保 Host 说明使用同一策略。

## 可选分类统计扩展

锁定的官方插件页未显示「内置插件配置」「实验性插件」「已安装插件」及「更多」分类数量，也没有分类标题 slot；详情中的「包含的组件」已有官方总数和状态统计，保持不变。用户明确要求缺少分类数量时新增独立 DSH 插件，因此本 fork 只提供稳定的类型入口 `/group-summary` 和 `dsh-base.plugins.group.summary` 单实例、根级、行内 slot。

页面向该 slot 提供同次渲染使用的可见卡片 key、真实组件 row id、读取状态，以及官方 `sectionCount` 样式类。配置入口来自 `ledger.items`，实验性主列表、已安装与更多分别来自原有 `extensions`、`mine`、`more` 数组；不重新筛选、不新增请求、不修改管理权限。统计计算和本地化呈现属于独立插件。没有贡献者时不显示统计；加载或失败状态由贡献者依据原始状态处理。此受限扩展记录为用户批准的差异，全部官方 CSS、字典和既有详情统计仍逐字保持。

## 详情导航的滚动位置

固定版本的官方页面在列表与详情之间复用同一个滚动容器，只更新导航状态，不重置滚动位置。以同一份 13 组件的插件包数据真实点击复现时，官方原版和本 fork 都会继承列表偏移，导致返回按钮或详情标题不可见；短详情被浏览器自动限制滚动范围时可能掩盖这一问题。

按用户要求修正这一已确认的上游缺口：在现有滚动容器上使用元素引用和布局 effect，仅在实际显示的逻辑页面身份变化时于首帧前归顶，包括列表、更多、插件包、配置页及贡献标签页之间的导航。同页刷新、状态更新、语言与尺寸变化不触发复位。返回列表也从顶部显示，本次不引入滚动历史策略。不重挂载容器，不修改官方 CSS、表单或全局窗口滚动；返回主列表时同步原有折叠标题的滚动测量。差异与用户授权记录在包元数据中。

浏览器专项 `run-plugin-navigation.mjs` 对照未修改的官方组件，从非零列表位置真实点击长详情；不在点击后人工归零，并验证同页更新不打断阅读。

## 自有插件品牌图标

用户批准 Dsh-base 插件包与组件统一使用网站鲸鱼。元数据提供真实 SVG data URL，由现有清单生成步骤从固定官方稳定导出 `FISH_LOGO_PATH`、`FISH_LOGO_VIEWBOX` 生成，生成文件不提交。`PackageArtwork` 只对这个精确值复用官方 `FishLogo`，使用官方主文字色；因此跟随界面手动明暗切换，不依赖操作系统主题。不解析或内联外部 SVG，Cloudflare 与其他图标、图标框、布局和权限保持原样。`/brand-artwork` 仅导出图标元数据合同。

鲸鱼的原生视框紧贴轮廓，不能直接沿用带留白的官方插件画布尺寸。按用户确认的视觉校准，保留 36/30px 图标区域及 48/40px 外框，在卡片与详情中居中显示 24px 宽鲸鱼，在组件行中显示 20px 宽鲸鱼；比例、主题颜色及官方 CSS 保持不变。
