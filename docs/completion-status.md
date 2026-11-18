# 当前实现与验收状态

简体中文 | [English](completion-status.en.md)

本页记录固定版本的源码及插件能力边界。部署与验收结果在实际检查后补录，每项结果只适用于所标明日期的构建。时间均为北京时间。

当前工作树固定在 `dsh-v0.2.2-rc.5`。已逐项核对上游 7 个变更包、16 个派生来源及固定源码入口。rc.5 的主要变化是网页搜索按会话模型选择提供方。Workers 继续提供官方设置界面和本地化不可用状态。使用离线提供方验证了 8 种路由场景，每种均核对就绪检查与实际选路，全程没有调用外部搜索或模型 API。[rc.5 升级对照](official-differences.md#rc5-upgrade)

本历史版本包含后续补入的修复。提交时间仅用于标识本次上游适配。后续 Staging 部署和验收按实际执行时间单独留档。

## rc.4 Staging 历史记录

2026-11-18 14:20（北京时间），官方 `dsh-v0.2.2-rc.4` 已部署到 Staging。Cloudflare Worker 版本为 `3d28bfe0-9318-440a-9384-238302b59d85`，上线时承接 100% 流量。完整 `verify:release` 退出码为 0。浏览器加载的入口资源与本地构建的 SHA-256 一致，隔离测试账号读到相同的 Worker 版本。[逐版插件对照](official-differences.md#rc4-upgrade)

该版本的线上插件清单包含 141 个客户端条目。官方团队和账号通知客户端已激活，对话导入列为可选、不可用。访客可浏览插件和自动化任务，创建会话时提示登录。匿名与隔离账号验收覆盖 23 个自有插件包、90 个组件和 12 份公开文档。公开页面与 SEO 的 83 项断言、定价页的 8 个浏览器场景均通过。Staging 保持 `noindex`，sitemap 为空。支付供应商未配置，本次验收未产生订单或付费推理请求。

同日 15:53:54（北京时间），插件页工具栏缩放修复随 Worker 版本 `3996c150-35ba-4e47-9456-a1a8c28a08bf` 部署到 Staging，上线时承接 100% 流量。浏览器入口和导航脚本的 SHA-256 均与本地构建一致。访客在中文界面、993 CSS 像素宽、2 倍显示密度和 110% 浏览器缩放下，滚动前后通过 108 项点击位置检查。实际点击刷新后工具栏仍可用，点击「添加插件」打开登录弹窗，下拉箭头展开两项添加方式。

同日 19:25:35（北京时间），Cloudflare 将 Staging 的 100% 流量切到 `7cbd01e9-91a1-4615-90ba-b402e3d29f7b`。完整发布检查通过，隔离账号的 Host 返回了相同版本。在真实浏览器中保存测试用 DeepSeek API 密钥后，刷新只显示固定掩码；按 Delete 并保存，再次刷新和查询 Host 均确认密钥已清空。全程模型请求为 0。线上工作区搜索能找到已有文件，指定排除该路径后结果中不再包含它。访客访问密钥状态和工作区搜索接口均返回 HTTP 401。含 2,000 个排除文件及嵌套忽略规则的边界场景在本地 workerd 验证。

切流后首次访问时，公开页面的 HTML 仍引用上一版入口，工具栏线上验收未通过。19:27 复验时，直接访问 `/`、`/zh-CN` 和 `/zh-CN/` 均返回新版入口，脚本 SHA-256 与本地构建一致，工具栏通过 108 项点击位置检查，公开页面与 SEO 的 83 项断言全部通过。

同日 20:47:52（北京时间），Staging 鉴权修复部署为 `daf68fbf-83ea-4e3f-9e11-0e109db1a70a`。截至 20:51:30 的 6,766 次请求中，鉴权接口的 5xx 为零。

rc.4 本地侧栏验收覆盖中英文、明暗主题和展开、折叠、移动端三种布局。官方与派生侧栏的主界面及「更多」菜单共 24 组截图逐像素一致。展开和移动端还通过键盘验证了将自动化任务移入「更多」并重新固定。13 项侧栏与工作区回归通过，包含未登录时从两个工作区选择入口请求登录。浏览器报告由 `pnpm acceptance:sidebar-parity` 写入 `apps/web/dist/parity-evidence/sidebar-navigation/report.json`。

本地 Workers 产物通过登录弹窗、账号入口、站点设置、SaaS 和 SEO 验收。账号入口覆盖八种语言并生成 85 张截图。站点配置保存并刷新后仍生效，普通账号写入返回 `403`。SaaS 界面覆盖 112 个场景，验证了 14 个插件包、跨账号文件隔离和模拟供应商的邮件确认流程。SEO 覆盖八种语言、10 个图标资源和 20 项路由检查。

## 插件与来源

底座对外提供工作台及其各语言首页。套餐与结账由工作台的 Waffo Pancake 支付面板提供。下方历史验收记录对应当时测试的构建。

官方来源仅为 `.submodules/deepseek-harness`，固定在 `dsh-v0.2.2-rc.5`，提交 `9c2670d3bce5275e0d1610272958121af87787bb`。App 入口只启动和分发生成的组合；产品能力位于插件包中。

| 当前声明口径 | 数量与含义 |
| --- | --- |
| 自有运行时组件 | 87 个：Client 48、Worker 32、Think 7。涵盖启用、禁用及明确不可用的声明，不等于 87 项可用功能。 |
| 自有复用方式 | 16 个 fork（Client 13、Worker 3）、12 个兼容接缝、59 个自建插件。按 `dshBase.reuse.mode` 统计；接缝不归类为 fork。 |
| 自有来源分类 | `origin: fork` 16 个、`origin: custom` 71 个；后者包含 12 个接缝和 59 个自建插件。`origin` 与复用方式是不同维度。 |
| 官方 Client 声明 | 92 个：58 个声明启用、34 个声明禁用；包含 API、服务及 UI 插件，不能称为 58 个 UI 页面。禁用行保留清单，不生成运行时模块解析器。 |
| 官方 Client 替换 | 13 个启用的自有 fork 通过 `replaces` 替换官方原件；原件保留禁用。它们不包含在上述 58 个官方启用行内。 |
| 展示分组 | 21 个逻辑插件包，完整覆盖 87 个自有组件；分组不决定生产组合成员，也不意味着可以动态安装。 |
| 浏览器支持库 | `client-core`、`client-session-host`、`client-saas-ui`、`client-browser-compat` 位于 `packages/boot`，标记 `browser-support`，提供启动、传输、共享 UI 组件及浏览器兼容支持；不独立交付产品功能，不计入 87 个运行时插件。 |

统计来自 `readClientMetadataRows` 和 `loadOwnedPluginInventory` 对当前元数据、profile、packs 的投影。`forkOf` 记录来源包、路径、固定提交和许可证；fork 的组合 `origin` 必须与其来源一致。升级官方 pin 时重新审查 fork 和已登记的 `./src/*` 导出使用。

Schedule 现由完整标记的 `@dsh-base/client-schedule` fork 提供，已不是原包直接挂载。唯一 Host 扩展是手动创建前的 `onBeforeCreate`：匿名页面用它请求登录，已登录路径不传该回调并保留官方行为。Plugins 页面同样由标记的 `client-plugin-manager` fork 提供，支持真实组件清单、用户批准的不可用状态和权限分离。

## 已实现范围与边界

| 范围 | 已实现 | 保留边界 |
| --- | --- | --- |
| 认证与侧栏 | Better Auth + D1；两态入口均可点击。插件与自动化页面先浏览；新会话、工作区及账号操作请求登录。匿名工作区列表留空。 | 公开声明不包含私有任务、配置或账号启用状态；服务端鉴权仍独立生效。注册依部署策略控制，第三方登录及邮件功能不能视为已配置。 |
| UI 与登录 | 保持官方布局、组件、图标和交互；fork 适配 Host。共享登录弹窗保留本地账号流程，直接组合官方 Modal、Button、Input，撤销此前 ChatGPT 视觉覆盖（验收版本及范围见下文）。 | 本地账号流程不同于官方 Platform 授权，行为差异登记在包元数据；局部对照通过不等于全产品 100% UI/UX 等价。其余缺口见[官方差异](official-differences.md)。 |
| 插件管理 | 87 个组件按 21 组展示；可见性、运行状态、可操作性分开。必需与部署管理组件只读，可选组件按管理范围控制。 | 动态安装、升级、物理卸载及生产插件 HMR 尚不可用。运行中的承载插件也可能只提供不可用说明。 |
| 站点与 SEO | Dsh-base 全局统一站点文档，支持管理员编辑、保存及版本冲突处理。页面 SEO、sitemap、robots、manifest、llms.txt、Google Analytics 各自为插件。 | GA 默认关闭，真实报表接收需运营者配置与验证；已扩展为公开页面浏览量及第一方转化日汇总，可选 Google 转化需明确同意。站点爬取规则不代替权限控制。详见 [SEO 插件说明](seo-plugins.md)。 |
| 会话、模型与权限 | 官方会话界面连接 Workers/Think；持久化模型与 effort；Gateway 与 BYOK 路由分离；权限、审批、存储隔离由服务端执行。 | Think 不是完整官方 Agent 执行器；模型推理、计费、恢复和历史证据必须按具体测试与部署说明，不能由侧栏验收推导。 |
| 会话标题栏操作 | 原样挂载官方 Markdown 复制、ZIP 下载和反馈菜单；Worker 接缝提供账号隔离的已保存事件与获准附件读取，本地应用入口保持可见。 | rc.4 将“在应用中打开”放在会话标题栏和会话行的菜单中。桌面启动与反馈提交仍不可用；ZIP 要求符合官方生命周期格式，不满足要求的旧日志明确失败，不补造原生事件或子会话。 |
| 工作区与文件 | 持久逻辑目录、工作区隔离、普通文件上传及官方浏览器预览。 | 不提供原生进程文件系统；图片处理、Agent PDF/Office 理解、PTY/终端执行仍有明确缺口。 |
| 自动化与预设 | Durable 调度与官方任务界面；四个官方预设声明可读，Cloudflare Think 为实际默认组合。 | 官方 Standard/PTC/Minimal/Cordis 执行未接入；声明可读不等于可启动。匿名任务页不读取私有任务。 |
| 子代理 | 保留 `cloudflare:think:subagent` 声明和兼容导出，并标记 `availability: unavailable`。 | 不注册 `delegate_task`，执行入口拒绝；不能把组件计数或兼容导出写成子代理已实现。 |

14 项 SaaS 能力共新增 28 个运行时组件，已包含在 2026-11-18 00:49（北京时间）的 Staging 部署中。外部供应商默认关闭。[SaaS 插件指南](saas-plugins.md)

## 2026-11-18 多应用改造与再次复核

工程通过 `dsh.apps.json` 声明独立部署的 Workers Web 应用，按应用隔离 profile、生成产物、依赖、配置、本地状态及云资源。共享插件继续位于 `packages/`，应用仅承担入口和组合。默认注册仍只有 `web`；第二应用在临时源码快照中验收，不在产品中额外创建示例应用。这不代表原生移动端、桌面安装包或跨应用账号互通已经实现，使用契约统一见 [AGENTS.md](../AGENTS.md#multi-application)。

提交前审查修复了新增应用失败后的回退：记录已打开或截断的文件，恢复组合元数据，只移除本次创建的空目录，并验证失败后可重新创建。工程、下游更新与构建相关的 61 项回归通过。支付插件复用元数据及双语 README 同步补充了已批准的公开定价页面和实际验收边界。

测试期间磁盘空间不足导致部分报告和截图写入失败。按用户授权清理可重建缓存及已确认废弃的临时文件，保留源码、数据库、个人文件、登录状态和验收证据。验收脚本新增清理保障，报告写入失败或浏览器关闭失败时仍释放其余资源；7 项语法检查及 10 项故障注入通过。原失败日志与后续完整重验分别保留，不把环境失败计为通过。

完整 `pnpm --dir apps/web build` 通过，包括源码校验、复用、运行面边界、分组覆盖、严格类型及回归检查。471 个 Client、141 个 Worker/Think 源文件通过类型检查，17 个 Worker JavaScript 模块可解析。真实本地工作台、认证、8 语言账号入口、全局设置、浏览器兼容、SaaS、公开内容和 SEO 验收通过。`pnpm acceptance:multiapp` 再次验证独立的第二应用构建、实际浏览器组合和匿名私有接口 `401`，结束后临时应用已清除，依赖源码未变。这些结果不代表全新依赖安装、真实外部供应商、GitHub Actions 或远程部署验收。

官方视觉与交互对照的全部 23 个原脚本最终退出 0，保留完整场景与断言；受磁盘不足影响的脚本在清理后完整重跑。插件管理重验覆盖 84 个场景、100 个滚动视口比较。各脚本使用独立构建及证据目录执行，不将分组运行描述成单次 `verify:release` 命令成功，也不将局部对照扩大为全产品完全等价。

该轮证据位于 `.artifacts/precommit-20261118-final/validation-summary.json`，多应用浏览器证据位于 `.artifacts/multiapp-acceptance/`。当时阻断提交的是 `picomatch` 高危公告。后续已修复共享依赖和 Cloudflare CLI 内嵌副本，完整审计通过。见[依赖安全检查](security-dependencies.md)。

## 2026-11-18 此前的提交前复核

该次复核在本地工作树中进行。应用入口只启动生成的组合，固定官方子模块保持干净。复用来源、运行面边界、分组覆盖、依赖契约和官方 UI 覆盖检查通过。各项能力的已知差异仍列在本文中。

- 公开内容包修正合法的 `./server-render` 导出，构建工具通过包声明解析 SSR 入口，实际内容构建及导出约束回归通过。
- 地址恢复接入官方导航取消契约。旧恢复不能覆盖后来打开的插件面板、会话、工作区或浏览器历史；元数据刷新不再误判为切换，首页继续由官方启动逻辑恢复。21 项真实官方服务回归及独立复核通过。实际浏览器挂起空会话恢复，打开 Plugins 后放行真实响应，连续观察 12 秒仍保持原面板；深链、刷新、前进后退及无效地址回归通过。证据为 `.artifacts/precommit-route-address-final-20261118/`。
- 同请求鉴权只读取一次会话，新请求重新校验；数据库读取失败返回 `503 auth_unavailable`，真实匿名或撤销会话仍拒绝访问。内部权限读取不做无法返回 Cookie 的续期；HTTP 分发保留类型化失败并停止后续处理。真实 workerd/D1 故障、撤销与响应回归通过。
- 已撤下页面的历史 SEO 配置可以读取和明确清理；保存仍校验已发布路径、管理员权限和修订号，不会重新发布撤下页面。
- 购买统计采用验签付款事件的实际 `chargedAmount`，与服务端查询的付款记录核对，缺失或不匹配不报告收入；迟到的客户端取消响应不会覆盖新账号的购买意图。支付、分析与权益回归通过。
- 线上验收脚本的规范语言地址改用共享路径函数，明确的历史地址重定向样例保留说明，语言路径守卫通过。

完整 `pnpm --dir apps/web build` 及最后的严格类型检查通过：471 个 Client、141 个 Worker/Think 源文件，17 个 Worker JavaScript 模块。真实本地完整工作台、登录流程、8 语言账号入口（85 张截图）、全局设置、浏览器兼容、公开内容、8 组定价场景和 SEO 验收通过。SaaS 另通过 112 项界面对照及 14 个插件的本地真实 Worker 流程。匿名私有数据权限未放开，外部供应商与模型调用仍不属于本轮实际外部验收。证据位于 `.artifacts/precommit-20261118/`；这些是本地结果，没有运行 GitHub Actions，也没有更新 Staging。

官方视觉与交互对照覆盖 `acceptance:parity` 的全部 23 个脚本，所有原场景和断言通过。前 7 项完成后主动停止串行调度器，剩余 16 项使用独立构建和证据目录分为三组执行，均首次退出 0；不将原调度命令的主动终止写成退出 0。覆盖核对与结果见 `.artifacts/precommit-20261118/parity-summary.json`。为缺少目录覆盖的 runner 补充了相同环境变量接口，默认行为未变；随后 131 项 conformance、语言路径与差异检查通过。验收 README 的旧清单数量和鲸鱼尺寸描述同步修正。

该次复核因 `picomatch@4.0.7` 的一项高危漏洞暂停了提交。后续修复及验证记录见[依赖安全检查](security-dependencies.md)。

## 2026-11-17 早期 rc.1 构建的公开内容与商业化本地验收

2026-11-17 参考用户购买的 `mkfast-template` 完成内容集合、实际译文、定价购买恢复、服务端权益和转化汇总的插件适配。新增公开内容与博客分组；原工作台和固定的官方源码保持原样。本次适配的线上验收范围和限制记录在 2026-11-18 00:49（北京时间）的 Staging 部署记录中。

- `pnpm --dir apps/web build` 通过完整仓库检查与生产构建：严格检查 470 个 Client 和 141 个 Worker/Think 源文件，17 个可部署 Worker JavaScript 模块解析通过。`pnpm acceptance:local` 使用真实本地 D1、R2、Durable Object 与浏览器验证登录、会话、插件管理、导出和设置；匿名页面没有私有请求或 WebSocket，外部模型请求为 0。缺失的桌面应用探测由专用兼容插件返回真实空能力目录，原官方禁用入口保留。
- 公开页面注册表统一路由、SEO、sitemap、llms 和统计。生产收录需要显式开启；Staging 不收录，法律草稿不发布。真实 404 同时覆盖未知页面、缺失译文和不存在的资源，规范地址跳转不能逃逸到外站。
- 新公开页面直接使用官方 Markdown、Button、FishLogo 和主题；中英明暗、宽窄屏及实际插件启动有浏览器验证。定价页覆盖 8 组浏览器场景；在组合中停用统计插件后，不再启动其代码或发送请求。
- 全局设置四组语言、主题与屏宽场景通过 56 次分区入口访问和 24 次精确像素对照，验证显式保存、分区重置和只读权限。新增回归还覆盖内容提供方停用、下游生成路径逃逸、真实支付通知去重、退款和到期后的调用拒绝。
- SEO 本地验收验证 8 个原有语言入口、10 项站点资源及 20 个路由守卫，并逐个检查实际公开页面的服务端正文和可用译文。

证据：`.artifacts/final-build.log`、`.artifacts/final-local-ui.log`、`.artifacts/final-public-content.log`、`.artifacts/final-seo.log`、`.artifacts/settings-parity-audit.log` 及 `.artifacts/public-content-evidence/`。Waffo Pancake 商户真实交易、Google 报表接收和搜索引擎收录仍需配置后的外部验收；本地测试不证明这些服务已经启用。新增页面的布局属于用户批准的扩展，不是官方已有页面。

## rc.1 会话菜单的本地验收记录

会话标题栏修复于 2026-11-17 通过本地验收，并已包含在 2026-11-18 00:49（北京时间）的 Staging 部署中。本轮原样启用官方 `dsh-session-log-export`，通过 Worker 导出以及 Client、Worker 本地应用可用性兼容插件连接 Host；不修改固定的官方源码。

- `pnpm --dir apps/web build` 通过，包含完整仓库检查、严格类型检查、复用来源、运行面边界、分组覆盖、安全及导出回归；17 个可部署 Worker JavaScript 模块解析通过。
- `pnpm acceptance:session-menu` 通过：中英、明暗、桌面及窄屏共 8 组，32 次官方像素精确对照，并覆盖键盘、复制、下载、错误、反馈和本地应用可用性。
- `pnpm acceptance:local` 通过：真实本地 Worker、D1、R2、Durable Object 与 Chromium 验证官方插件激活、命令目录、完整 Markdown 写入剪贴板、ZIP 实际下载与解压，以及反馈提交禁用；原有两种语言的侧栏、右栏、设置和会话回归同时通过。无外部模型请求。
- 服务端回归验证匿名/跨账号隔离、同会话附件准入及完整性、HEAD、取消、普通与 fork 会话的官方格式恢复、工具事件、命令幂等和真实 Cordis 可选注入生命周期。旧会话缺少可靠生命周期时拒绝 ZIP，Markdown 仍可读取；不宣称原生 Agent 完整执行日志等价。

证据：`.artifacts/session-menu-build.log`、`.artifacts/session-menu-parity.log`、`apps/web/dist/parity-evidence/session-menu/report.json`、`.artifacts/session-menu-local.log`、`.artifacts/acceptance/local-ui/report.json`。本轮线上验收未执行会话导出；上述下载与交互结论仍以真实本地验收为依据。

## 2026-11-18 00:49 的 Staging 历史验收

北京时间 2026-11-18 00:49 已部署 `cc4a884b-aebc-4750-bbea-0c87f0225e52` 到 <https://dsh-base-staging.jacksonai.workers.dev>。Cloudflare 部署记录确认 100% 流量，登录后的 Host 也返回相同版本；公开资源与本地构建的 SHA256 一致。增量表结构应用成功，没有重置数据库；未提交或推送。

**00:49 版本部署成功，验收中仍有失败项。**

| 验收范围 | 实际结果 |
| --- | --- |
| 发布前检查 | 完整构建、仓库规则与严格类型、本地账号/存储/会话、官方 UI 对照、浏览器兼容、SaaS、公开内容和 SEO 检查通过。修正了旧测试的 sitemap 收录预期、写死数量及初始化等待条件后，继续运行失败步骤及剩余检查；原先失败日志保留。 |
| 新增插件 | 匿名英文桌面、匿名中文手机、登录中文桌面均遍历 23 个插件包、90 个组件；新增插件来源和激活实例正确。最终严格脚本因后置鉴权检查失败，仍保留 `ok: false`。 |
| 公开页面 | 首页及 6 条公开文档登记正常；6 条文档的中英共 12 页有真实首屏正文并完成客户端水合，13 个公开 JS/CSS 与构建匹配。法律草稿、未知路径和缺失译文返回真实 404。 |
| SEO | 73 次匿名 GET/HEAD、83 项检查通过。canonical、实际译文 hreflang、博客结构化数据、robots、llms.txt、manifest 和图标正常。Staging 保持 noindex、空 sitemap；私有页面要求登录，私有 API 匿名返回 401。 |
| 定价浏览与登录入口 | 最终独立复验中英、明暗、宽窄共 8 组通过。Waffo Pancake 关闭、套餐为 0，页面如实显示不可用，没有伪造价格、订单或购买按钮；真实结账和购买恢复未执行。 |
| 数据与权限 | 仅允许一次精确命中既有空会话的官方幂等恢复，返回原 ID。会话、列表、工作区、历史和权限前后指纹相同；未新建会话、修改业务配置、发起支付或调用模型。 |

00:49 版本的线上验收记录了以下问题。

- 该版本的 `client-route-address` 异步启动恢复可能覆盖用户刚打开的 Plugins 面板。上文记录的本地修复和回归测试晚于此次部署。
- 北京时间 00:51:12.770，`GET /api/auth/get-session` 返回过一次 503，平台日志确认该响应；完整定价复验未再现。01:03:33.758–01:03:52.183 期间，已登录账号的 `permissionSnapshot` 返回过一次 401；随后同一 cookie 的状态审计成功。根因尚未确认，不能视为已修复，也没有通过反复重跑将最终严格脚本改写为通过。

发布证据为 `.artifacts/staging-publication-release.json`、`staging-deployment-after.json`、`staging-schema-plugins.log` 及 `staging-release-*.log`（均在 `.artifacts/`）。线上证据为 `.artifacts/acceptance/publication-staging/cc4a884b-aebc-4750-bbea-0c87f0225e52/report.json`、`.artifacts/acceptance/pricing-staging/summary.json`、`.artifacts/acceptance/plugins-staging-new/summary.json`，各轮失败证据保留在对应 `attempt-*` 目录。Google 实际报表接收及搜索引擎收录未做外部验收。

### 上一版鲸鱼尺寸的历史验证

2026-11-17 已验证版本为 `ec6286dc-6606-463d-a7f7-4639606bca17`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。按用户确认的视觉校准，Dsh-base 鲸鱼在插件卡片、包详情和组件详情中为 24px 宽，在组件行为 20px 宽；保留官方 36/30px 图标区域及 48/40px 外框，图形等比居中。Cloudflare、官方原版图标、页面 CSS 和权限保持原样。

完整仓库检查、生产构建和最终严格类型检查通过。4 组中英明暗对照遍历 21 包、83 组件，验证图形尺寸、比例、图标区域和外框的居中，以及四处展示与官方 `FishLogo` 的像素一致性；动态主题和图标归一化恢复通过。Staging 中文暗色桌面、英文浅色手机各遍历全部包与组件，确认 16 个 Dsh-base 包、56 个 Dsh-base 组件使用校准后的尺寸，无页面错误、失败请求或业务写入。线上入口匹配本地产物，精确版本承接 100% 流量。

证据为 `.artifacts/whale-size-build.log`、`.artifacts/whale-size-types.log`、`.artifacts/whale-size-ui.log` 和 `.artifacts/acceptance/whale-size-staging/`。本次纠正原先将含留白的插件画布尺寸直接用于紧贴轮廓的鲸鱼视框的问题；属于用户批准的品牌适配，不声称官方规定了鲸鱼插件尺寸。

### 上一版登录提示精简的历史验证

2026-11-17 已验证版本为 `d8adb385-db7d-4b0f-b9a0-0f71db09a6e1`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。按用户要求，登录弹窗移除第三方登录按钮下方重复的不可用提示段落和对应描述引用；按钮保持官方禁用样式及本地化提示，Google 可用性仍由服务端策略决定。改动位于现有登录插件，已登记用户批准的行为差异。

完整检查与生产构建通过；8 组登录弹窗对照、56 项官方组件像素比较和 8 项邮件/Google 流程检查通过。Staging 中英、桌面/手机 4 组只读验收确认段落消失、三个按钮仍禁用、分隔线正常衔接、Escape 可关闭，且无页面错误、失败请求或业务写入；部署资源与本地产物一致，精确版本承接 100% 流量。证据为 `.artifacts/auth-provider-hint-build.log`、`.artifacts/auth-provider-hint-parity.log`、`.artifacts/auth-provider-hint-email.log` 及 `.artifacts/acceptance/auth-provider-hint-staging/`。

### 上一版 Waffo Pancake 名称的历史验证

2026-11-17 已验证版本为 `f97490a9-0c0f-4e1c-bb23-269c7be257b2`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。支付插件的完整名称统一为 **Dsh-base Waffo Pancake 支付**（英文 **Dsh-base Waffo Pancake payments**）；插件包、Client/Worker 组件及 8 种语言的支付提示同步更新。技术标识、支付行为与权限未变，继续复用官方插件管理布局和网站鲸鱼图标。

完整仓库检查、86 项 SaaS 回归与生产构建通过；中英明暗 4 组插件图标对照通过。Staging 中英、桌面/手机 4 组只读验收核对列表、详情及两个组件的全称，入口资源匹配本地产物；8 类私有接口仍拒绝匿名读取，注册仍关闭，支付仍按未配置状态展示。Cloudflare 确认上述版本承接 100% 流量。

证据为 `.artifacts/waffo-pancake-build.log`、`.artifacts/waffo-pancake-ui.log`、`.artifacts/acceptance/waffo-pancake-staging/report.json` 和该目录的 `version.json`。本次为名称修正，不扩大支付供应商的验证范围。

### 上一版插件品牌图标的历史验证

2026-11-17 已验证版本为 `78f25ed3-e9d6-4bfa-83ab-84920b328aa7`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。16 个 Dsh-base 插件包与 56 个 Dsh-base 组件统一使用网站同源的官方鲸鱼；5 个 Cloudflare 插件包、27 个 Cloudflare 组件和官方原版图标保持不变。插件清单仍为 21 包、83 个自有组件，未新增能力或修改权限。

- 完整仓库检查和生产构建通过，上游子模块干净；整个插件管理 fork 的来源差分守卫通过。鲸鱼元数据从固定官方稳定导出生成，渲染只识别精确的自有图标，其他 SVG 保留官方图片隔离。
- 中英、明暗 4 组专项验收覆盖全部 21 包、83 个组件；列表、包详情、组件行和组件详情均直接对照官方 `FishLogo` 像素。系统主题与手动主题相反、动态切换和旧 parity 图标归一化/恢复均通过。专项已加入长期 parity 门禁。
- Staging 中文暗色桌面和英文浅色手机各遍历全部包与组件，鲸鱼形状、颜色与侧栏同源，Cloudflare 图片不变；无页面错误、失败请求或业务写入。部署入口资源匹配本地产物，Cloudflare 确认精确版本承接 100% 流量。

证据为 `.artifacts/whale-icons-build.log`、`apps/web/dist/parity-evidence/owned-plugin-artwork/report.json`、`.artifacts/acceptance/plugin-artwork-staging/report.json` 和该目录的 `version.json`。本轮仅验收用户批准的品牌图标调整，不扩大 SaaS 外部供应商的验证范围。

### 上一版 SaaS 插件的历史验证

2026-11-17 已验证版本为 `22e18ce1-5cbe-49be-8bc2-6e54cd74192e`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。本轮完成所选 1–8、14–18、28 共 14 项 SaaS 能力，新增 14 个 Client 和 14 个 Worker 插件；当前清单共 21 个逻辑插件包、83 个自有运行时组件。新面板填入官方配置槽位并复用官方组件；上游固定子模块保持干净，App 仍只承担组合入口。

| 验证 | 结果与范围 |
| --- | --- |
| 源码与构建 | 完整仓库检查、生产构建通过；最终严格类型检查覆盖 449 个 Client 和 123 个 Worker/Think 源文件，86 项 SaaS 回归通过，1,209 处官方导出复用检查通过，17 个 Worker JavaScript 模块可解析。 |
| UI 与交互 | 新 SaaS 面板 112 项浏览器案例通过；官方 UI 对照原始 21 个脚本全部通过。并行部分使用独立构建目录，保留原断言与完整脚本覆盖。 |
| 真实本地组合 | 使用临时 D1、R2、KV 和 Better Auth 验证资料保存、文件隔离、API 密钥创建/使用/撤销、管理员权限及已配置联系/订阅流程。29 个 Worker 全部 active，14 个新增 Client active，来源正确。插件 schema 可重复应用。 |
| 原有发布门禁 | 本地完整界面、10 类真实认证、8 语言账号入口、全局设置保存及浏览器兼容验收通过。普通用户访问两个管理接口的预期 403 被明确验证，不算作成功读取数据。 |
| Staging | 中英、桌面/手机共 4 组，逐一打开 14 个新面板，均显示 21 个插件包；8 张截图，入口资源与已验构建一致，无页面错误、失败请求或业务写入。8 类私有 API 匿名返回 401，注册仍关闭，未配置支付返回不可用。Cloudflare 部署记录确认上述精确版本承接 100% 流量。 |

证据见 `.artifacts/saas-parity-complete.json`、`.artifacts/saas-ui-browser/report.json`、`.artifacts/acceptance/saas-local/report.json` 和 `.artifacts/acceptance/saas-staging/`；汇总为 `.artifacts/saas-release-report.json`。线上仅做只读匿名验收，账号写入和供应商异常在本地真实运行时及受控供应商夹具中验证。外部供应商默认关闭；真实 Waffo 商户沙箱、Google OAuth、邮件送达、通知和 Crisp 仍需运营者配置并验收。本轮不宣称完整官方执行语义等价。

### 上一版匿名模型页的历史验证

2026-11-17 已验证版本为 `ae511dc9-f3d7-43ba-ba38-e8cf1ea90cda`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。匿名模型页撤销自建只读列表，复用已有标记的官方 Models fork：提供商卡片、只读 API 密钥表单、自定义设置、关闭/编辑及添加提供商交互。公开声明与 Host 共用 schema/defaults；凭据和 Gateway 状态保持未知，管理操作触发本地登录。没有新增运行时插件或放开私有权限。

- 完整检查和生产构建通过，1135 处官方导出复用检查及 3 项 fork 源码/资源守卫通过；最终凭据展示调整另通过严格 Client 类型检查。
- 28 组默认 Models 整页直接对照官方原件，另 8 组匿名只读编辑器各比较 3 个阶段，共 52 次 DOM、样式和像素直接对照；2 组列表凭据防误报及最终 2 组编辑器未知状态回归通过。匿名整页是用户批准的扩展，不称作上游原始匿名页。
- 本地 8 语言、85 张截图及 6 类模型/凭据接口匿名 401 验证通过；30 个匿名浏览场景通过，私有请求、WebSocket、页面错误均为 0。原有 BYOK 保存回归与 8 组 Gateway 样式/状态回归通过。
- Staging 中英桌面/手机 4 组、8 图通过，入口资源匹配已验构建；嵌套登录关闭回焦正确，无私有请求或业务写入。13 个 Client fork 均来源正确且 active，原件禁用；版本精确匹配，8 类私有 API 的匿名探测为 401，注册保持关闭。

本轮证据汇总于 `.artifacts/acceptance/anonymous-models-parity/report.json`，展示合同见 [ADR-0005 §22](dsh-base-ADR-0005-anonymous-more-menu.md)。公开模型声明不等于已配置或可调用，未执行线上模型推理，也不宣称全产品 UI/UX 已全部等价。

### 上一版完整账号布局的历史验证

2026-11-17 已验证版本为 `f629c32f-0fd3-4e5a-9d84-2aa788c9be57`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。账号内容保留完整官方身份卡、账号信息、充值余额、赠金余额、查询用量与充值布局。真实匿名状态使用官方未登录文案，仅平台操作置灰且无导航。底部独立 Dsh-base 登录继续使用官方按钮。完整标记的账号插件 fork 保留默认行为、官方 CSS 和词典，上游子模块未修改。

- 全部检查和生产构建通过；1123 处官方导出复用校验，完整源码及资源差分 3 项通过。
- 默认模式 36 组真实 Host 状态直接对照官方原件，DOM、样式及像素精确一致；原菜单与账单保护另 4 项通过。
- 完整匿名布局中英、明暗、桌面/手机 8 组对照通过，参照独立的官方共享样式规范。这是用户批准的扩展，不冒称上游原始匿名分支。
- 本地 8 语言、85 张截图、真实账号和嵌套登录验收通过；30 项匿名场景中私有请求、WebSocket 及错误均为 0。
- Staging 中英桌面/手机 4 组、8 图通过；13 个 Client fork 来源及 active fiber 正确，官方原件禁用。版本精确匹配；5 类匿名私有请求仍为 401，注册仍关闭，无业务写入。

证据汇总为 `.artifacts/acceptance/account-full-layout/report.json`。展示差异见 [ADR-0005 §21](dsh-base-ADR-0005-anonymous-more-menu.md)；本轮不代表已经接入 DeepSeek Platform 认证或计费，也不代表全产品 UI/UX 已全部等价。

### 上一版居中账号占位的历史验证

2026-11-17 已验证版本为 `6a3f26d0-41f5-4c63-a4a0-131ae062afbb`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。匿名账号设置恢复官方 `AccountSection` 的原始居中布局、文案和控件；移除四条自建账单灰行。下方独立追加 Dsh-base 登录区，只有新增按钮打开本地账号弹窗。未接入的官方 DeepSeek Platform 入口保持可见、禁用，并提供本地化原因。

| 验证 | 结果与范围 |
| --- | --- |
| 构建与复用 | 完整构建及检查通过；复用守卫确认 1069 处官方 import 使用已声明导出，上游子模块无修改。 |
| 官方 UI 对照 | 匿名账号区 8 组中英、明暗、桌面/手机对照的 DOM、文字、几何、计算样式和像素精确一致；原已登录账单及菜单 4 项回归通过。 |
| 完整账号验收 | 8 语言、85 张截图，覆盖账号身份分离、设置导航、真实登录、嵌套弹窗及关闭回焦。 |
| 匿名边界 | 30 项本地匿名浏览场景通过；0 私有请求、0 WebSocket、0 浏览器错误。 |
| Staging | 中英桌面/手机 4 组、8 张截图通过，部署入口资源匹配本地构建；运行时版本精确匹配。注册仍关闭，5 类匿名私有请求仍为 401，线上无业务写入。 |

证据位于 `.artifacts/acceptance/anonymous-account-parity/`：`build.log`、`reuse.log`、`parity/report.json`、`account-billing-parity-report.json`、`account-launcher/report.json`、`anonymous-local/report.json`、`staging/report.json`、`staging-version.json`。新增对照纳入 `acceptance:parity`，账号集成验收纳入 `verify:release`。这是账号页及权限边界验收，不代表全产品 UI/UX 等价，也不代表已经接入 DeepSeek Platform 登录或账单。

### 之前的登录弹窗验证基线

2026-11-17 已验证版本为 `8c1423a8-c748-4d51-8c14-cb8dcc6e00bc`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。共享登录插件保留本地账号流程，直接复用固定官方版本的 Modal、Button、Input；自定义弹窗外壳、胶囊样式及配色已移除。没有修改官方子模块或扩展匿名权限。

| 验证 | 结果与范围 |
| --- | --- |
| 完整构建与检查 | `.artifacts/acceptance/auth-official-style/build.log`：完整构建、类型、来源复用、插件边界及相关回归全部通过。 |
| 官方控件对照 | `primitives/report.json`：中英、明暗主题、桌面/手机 8 组，56 项几何、计算样式和像素精确一致；只证明所比较控件，不把本地账号流程称为官方 Platform 登录。 |
| 真实本地认证 | `real-auth/report.json`：临时 D1 + Better Auth 的 10 类检查通过，含用户名/邮箱登录、无效密码、注册策略、安全返回、焦点及关闭、390×360 短屏滚动与操作可达性。 |
| 匿名浏览与门控 | `anonymous-local/report.json`：30 个场景通过；浏览器私有请求、WebSocket、错误均为 0。 |
| Staging UI | `anonymous-staging/report.json`：中英桌面/手机 4 组、8 张截图；新会话和添加插件触发官方样式弹窗，关闭与回焦通过，0 私有请求、0 WebSocket、0 浏览器错误。部署入口资源与本地构建一致。 |
| 版本与权限 | `staging-version.json`：运行时精确版本匹配；注册仍关闭，5 类私有 API 的匿名请求仍返回 401，线上无业务写入。 |

上述报告均位于 `.artifacts/acceptance/auth-official-style/`。控件对照纳入 `acceptance:parity`，真实认证回归纳入 `verify:release`；本轮没有执行模型推理或宣称完整 UI/UX 等价。

### 之前的来源分类验证基线

2026-11-17 的已验证版本为 `51ec0e7f-d96c-4a85-8b2f-5138b7408aed`，地址为 <https://dsh-base-staging.jacksonai.workers.dev>。本轮修正 11 个 fork 的来源错标，并为 manifest、profile 和生成清单加入来源一致性守卫；不更改业务权限。

| 验证 | 结果与范围 |
| --- | --- |
| 完整构建与检查 | `.artifacts/acceptance/plugin-provenance/build.log` 记录完整构建及要求的检查通过；conformance 为 116 项，包含本轮新增的 4 项来源一致性回归。 |
| Client 来源与实际激活 | 已登录线上验收确认 12 个 Client fork 均为 `origin: fork` 且 fiber active；对应 12 个官方原件均禁用、fiber 为 null。 |
| Worker 来源与实际激活 | 同一验收读取真实 Worker 清单：15 个 Worker 均 active，其中 3 个 fork 来源正确。 |
| 状态与权限 | 会话、设置、插件控制前后不变；无浏览器错误、失败请求或业务写入。独立版本探测匹配上述版本，注册关闭；5 类私有 API 的匿名探测仍返回 401。 |

线上来源证据为 `.artifacts/acceptance/plugin-provenance/authenticated-staging/report.json`；精确版本与匿名拒绝证据为同目录 `staging-version.json`。本次验收不包含模型推理，也不把来源分类测试当成完整 UI 像素对照。

### 之前的侧栏验证基线

2026-11-17 的 `21bf1c45-8a5c-4ff5-a1b2-32741124a172` 是此前匿名工作区空态修复的已验证版本，不能把其测试计为本轮重新执行。

| 历史验证 | 结果与范围 |
| --- | --- |
| 构建与侧栏回归 | 12 项侧栏单测、30 项本地匿名矩阵、12 项官方侧栏对照、4 项 Staging UI 用例。 |
| 实际匿名交互 | en/zh、桌面/移动端工作区列表留空，添加工作区打开登录弹窗；0 私有请求、0 WebSocket、0 业务写入，无页面或请求错误。 |
| 官方样式对照 | 12 项覆盖 en/zh、浅色/深色、展开/折叠/移动布局，以官方槽位注册和工作区 store 对照 SidebarRoot、More、空工作区列表；不代表整个产品逐像素覆盖。 |

历史证据位于 `.artifacts/acceptance/workspace-empty-state/report.json`、`staging-version.json`、`staging-ui.json`、`parity-report.json` 和 `anonymous-local/report.json`。验收产物始终按版本与范围使用，不自动证明后续构建。

## 历史证据与发布规则

旧状态页及其部署、推理和迁移记录已移入[历史快照](history/2026-11-17-pre-audit-completion-status.en.md)；其中的旧数量和“current”表述仅代表当时记录，不适用于当前工作树。更早记录保存在 [2026-11-10 历史](history/2026-11-10-pre-alignment-completion-status.md)。

发布前对同一工作树运行要求的源码、类型、安全、复用、边界与回归检查，再构建并部署该产物；线上验收核对确切 Worker/Host 版本。新增 UI 或交互按对应官方组件和实际组合验收，保留未覆盖范围。保持 owner 存储身份稳定；不以发版为由新建空命名空间。具体运行时边界见 [runtime-parity](runtime-parity.md) 与 [Remote 映射](typed-remote-mapping.md)。
