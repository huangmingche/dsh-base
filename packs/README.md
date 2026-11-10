# 能力包分组

简体中文 | [English](README.en.md)

生产插件清单由 `scripts/composition/metadata-roster.mjs` 生成：客户端读取包元数据、
`apps/web/composition.profile.json` 和锁定的官方库存；Worker/Think 读取各包元数据。
应用只消费生成清单，不能在入口里手写功能名单。

`packs/<id>/pack.json` 描述这些插件的能力分组、依赖关系及账号可管理范围。
它不选择生产清单成员。`check:packs` 独立解析 pack 并与生产清单逐行比较，
成员、字段、顺序或禁用状态漂移都会阻止发布。

`packages/` 回答“代码在哪里、在哪个运行平面执行”，`packs/` 回答“哪些插件共同组成一项能力、哪些允许账号管理”。
例如 `waffo/pack.json` 将 `@dsh-base/client-waffo` 和
`@dsh-base/cloudflare-worker-payment-waffo` 归为一个支付功能包，保留各自的插件契约与运行边界。
pack 只包含声明，没有 `src`、运行入口或独立安装生命周期。删除 pack 不会自动卸载插件或删除数据，
只会使分组覆盖检查失败；移除能力需要同步更新实际插件声明和组合关系。
`requires` 用于校验分组引用和依赖环，不代替插件的 `inject`、服务授权或实际加载顺序。

- `planes.client` 可以使用包名（读取该包的 `dshBase.client`）或完整条目；
  `planes.worker` / `planes.think` 使用包名，加载契约分别来自 `dshBase.worker` / `dshBase.agent`。
- 自有客户端插件优先只引用包名，避免重复维护 `id`、`module`、顺序和禁用状态。
  官方 profile 条目及确有 profile 覆盖的本地条目保留完整审计声明，与实际清单逐字段比较。
- 不声明空平面。重复成员、缺失元数据、未知依赖或循环依赖都拒绝。
- `requires` 声明其他 pack id。
- `toggleable: "L1"` 只用于已打包的可选客户端/Think 成员；不能包括必需客户端插件或 Worker。
  `none` 表示部署级管理。L1 清单仍是账号可管理模块的唯一来源。
- `reuse` 记录官方候选与复用决定；fork 的来源也必须记录在包的 `dshBase.forkOf` 中。

新增能力时，先遵循官方复用协议建立插件和 metadata/profile 条目，再更新对应 pack 分组。
运行 `pnpm check:packs` 和 `pnpm check`；生成的清单与 L1 模块表不提交、不手工编辑。

插件页面的完整自有库存由 `generate-owned-plugin-inventory.mjs` 从实际组合生成，
不再按 L1 可管理名单过滤。每个独立注册的客户端、Worker、Think 插件必须且只能属于
一个展示分组；未注册的启动、共享或构建包不作为插件条目生成。停用条目和不可用能力
保留声明，运行状态仍由实际 Loader 提供，生成器不创建 fiber 或模块解析器。

`none` 分组通过官方插件包卡片及组件列表只读展示。Gateway 保留一个功能入口和两个
组件，其他现有可选工具保留各自的开关。展示分组的 `dsh-base:<pack-id>` 是本地组合标识，
不是可从 registry 安装的包。操作权限继续由原有 L1 策略决定，不因可见性增加而放宽。
`pnpm plugin:owned-inventory` 生成数据，`pnpm check:owned-inventory` 检查漂移；
缺失、重复、跨运行平面或无独立插件契约的成员都会使检查失败。

插件管理包还包含独立的 `@dsh-base/client-plugin-counts`：通过已标记官方页面 fork 的可选数据插槽显示分类数量，使用页面实际展示的条目，不请求额外服务。已安装分类分别显示插件包数和组件数；More 包含主列表中的实验性插件，数量不可相加。

`global` 将站点名称、公开站点配置、SEO、独立发现文件、公共页面统计与全局设置界面归为“Dsh-base 全局”。
[全局分组清单](global/pack.json)中的组件保持各自的运行平面和加载声明；分组不授予修改站点配置的权限。
基础功能保留导航、语言、权限与静态资源等支撑功能，已停用的侧栏扩展仍保留在原分组。
Agent 预设、模型服务设置、附件读取和不可用的子智能体归入 AI 对话。
pack 数、页面展示的插件包数和组件数是不同口径：例如 `optional-think` 中的可选工具分别展示，
不能把目录数量当作页面插件包数量。分类数量始终来自实际清单，可运行
`pnpm check:packs` 与 `pnpm check:owned-inventory` 核对；不把启动库、共享类型或数据结构计作功能插件。
