# 官方客户端的 Workers Host 兼容接缝

本插件向官方 DSH 客户端提供 Workers Host 服务。UI 布局和交互由官方插件负责，服务适配不复制官方源码。

访问服务直接挂载原样官方 `dsh-api-remote-access/client` 与 Typert registry。接缝内部隔离的原样官方 Gateway 是真实 Connection 的唯一 generation owner，负责 `$events`、断连恢复和生成式 `$mount`；现有 Host namespace 由 Cordis facade 保留。官方生成器从固定子模块生成声明及 `/remote` 运行模块到忽略的 `.artifacts/typecheck`，不修改或复制上游源码。生成目录的第三方依赖按 Vite browser/import 条件解析到应用安装，不改写或 externalize 生成模块。Host 按认证用户解析真实 owner DO 后才发送访问 baseline，客户端在 baseline 到达前没有权限；共享非 owner Peer/grants 尚未实现，不伪造。旧 wire-bootstrap 保留为禁用库存。访问快照与智能体工具权限相互独立。

公开首页先共享一次真实账户读取。匿名或认证结果未知时，官方 RemoteAccess 保持初始关闭状态，生成式 namespace 贡献保留为待挂载登记及真实撤销句柄；不启动 Gateway/WebSocket、私有 Host RPC 或 owner SSE，也不阻塞 Loader 完成。确认登录后才挂载原样 Gateway 和已登记贡献。账户读取失败保留真实错误，不伪装成退出。静态页面不轮询账户；窗口重新获得焦点、页面重新可见或明确认证动作会刷新；只有用户发起且尚未结束的登录流程按两秒短轮询，最多十分钟。确认首次从匿名登录、退出或切换 owner 时重载页面，重新读取该账户的插件组合，并撤销官方 RemoteAccess 在载体断连时会保留的旧 owner baseline。

设置和定时任务通过官方 Connection RPC 调用 Host。设置描述、命名空间、版本冲突和持久化结果均以 Host 为准；网络故障、拒绝和缺失能力不会转换为浏览器内存中的成功。Schedule 完整页面及其侧栏、详情和会话贡献由官方 ui-schedule 提供。

原样官方权限插件读取真实会话权限目录、持久 `/permission` 命令回执和 Host 权威投影。Worker/Think 权限服务执行 R2 操作检查及审批策略；客户端不制造权限结果。已认证 owner 的 SSE 变化流使设置、任务及凭据在标签页之间刷新；初次连接和重连快照关闭读取与订阅的竞态，重复 revision 不触发刷新循环。通知仅含 revision/topic，不含私密值。

在仓库根目录验证：

```sh
node packages/client/dsh-base-client-session-adapter/tests/remote-access.test.mjs
node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/account-session.test.ts
node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/settings-remote.test.ts
```

访问测试贯穿真实 Cordis、Connection、Gateway、Typert、RemoteAccess 与 Worker mux，覆盖认证 baseline、九个效果、逆序释放、失败回滚、调用方卸载、1006 后真实 generation 恢复和再次挂载。请先运行 `pnpm check:types` 生成官方 `/remote` 运行模块。RPC 测试覆盖参数、CAS、错误细节、网络拒绝及权限命令的真实回执、拒绝和无效回执拦截。

固定版本升级时必须重新审查 `dshBase.reuse.sourceEntries`。完整复用说明见 [REUSE.md](REUSE.md)。

模型编辑器将 Host 中账号保存的密钥视为官方 `file` 来源，显示固定掩码，并按 Host 的写权限允许删除，缺少传输或网络失败不会伪装成空配置或成功写入。旧的未注册 `sessions` 假实现已删除，实际会话生命周期归官方 api-session-controller。插件运行时库存来自实时 composition inspection，保留禁用原件、来源和观察到的 fiber 状态。官方设置中的内置插件页面展示完整客户端、Worker 与 Think 库存；插件页按功能展示自有组件，同时列出固定上游目录中的可选插件包。

日志反馈服务尚未实现，所有官方反馈入口保持可见禁用，Remote 和 `/feedback` 明确拒绝。settings sidecar helper 的双层 Result、版本冲突与 CAS 回归保留为未挂载协议测试，不代表日志反馈能力。

补充验证：`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/chat-feedback.test.ts`、`node packages/client/dsh-base-client-session-adapter/tests/feedback-contract.test.mjs`、`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/plugin-inventory.test.ts`。

目录选择复用原样官方 browse 插件，目录读取/创建按原参数调用 Host；创建文件夹与注册工作区分开，原生系统选择器明确不可用。工作区文件只来自真实 Host 文件服务，不再以虚拟对话文件掩盖失败。智能体目录只描述Cloudflare Think 模式组合，切换和读取官方声明不可用且官方控件可见禁用。账号读取/退出检查真实 HTTP 结果；账单服务返回官方允许的缺失值，由可用性接缝禁用账单入口。`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/host-capabilities.test.ts` 覆盖这些失败与传输契约。

文件引用遍历的 Host 故障及取消会保留失败，不返回伪造的空/部分成功结果。上传保持官方 FileUploadRuntime、后台 Worker 与进度逻辑，encoded 文件及历史附件走真实 Host RPC；历史图片的 base64 由官方 Session 客户端解码。未配置图像处理 binding，因此图片数量上限为零，原官方 picker/drop 本地化拒绝图片；Host 同样返回 `IMAGE_PROCESSOR_UNAVAILABLE`，共享文件入口仍用于普通文件，不宣称视觉能力。验证：`node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/attachment-remote.test.ts` 和 `node apps/web/tests/parity/run-upload.mjs`；后者是受控 HTTP 下的真实官方浏览器协议测试，真实 R2 回执消费另由 Host 验收覆盖。
模型和推理强度完整传给 Host，仅投影真实确认值。旧 Host 若忽略请求中的 effort，接缝明确拒绝；不把输入回显当作执行成功。`tests/model-selection-remote.test.ts` 覆盖透传、确认值、缺失确认及传输异常；`tests/owner-invalidations.test.ts` 覆盖跨客户端通知、重连、去重、坏帧及生命周期。


投影版本由 Host 的 SQLite 事务生成，与聊天事件游标独立。所有 baseline、控制帧、rename 回执和旧 SSE 接缝使用同一服务器版本；客户端不再用 `Date.now()` 构造序号，也不在收到快照后读取更新的 state 重算旧版本值。缺少真实版本的旧 Host 会明确失败。这个版本域仍不是官方统一事件日志的 consistent cut，保留为已登记兼容差异。

`$stream` 直接使用官方稳定导出的 `RemoteStream`。只有物理载体故障转换为可恢复的 CarrierError；业务及协议故障保持终止，旧传输回退仅用于真实 endpoint-unavailable。审批使用官方 `PendingApproval` UI waterfall，按 Session 保留 scope、AbortSignal 和单次读取；只有明确用户决定才提交 Host，异常不会自动拒绝，变更通知可重试同一决定。只有已经明确选择的决定遇到瞬时网络/HTTP 失败时，才按 250ms、1s 最多两次幂等重试；连接恢复和 owner baseline 也触发恢复。读取待审批项没有轮询 interval，UI 异常、撤回与取消绝不会转换为 rejected。

## 匿名本地设置文档

匿名（公开 `GET /api/auth/get-session` 明确返回 `null`）时，settings 的 `describe` / `mutate` / `update` / `replace` 由本接缝的本地文档回答，不发起任何 `/api/settings/*` 请求：

- 命名空间白名单：`ui-theme`、`locale`，以及匿名面板真正可改的客户端偏好 `ui-chat`、`ui-conversation`、`ui-settings`（官方 schema/default 校验）；其他命名空间的写入返回 `settings/namespace-unavailable`，不做本地伪造。快捷键不走本白名单，官方 `ui-shortcuts` 自己持久化在 localStorage `dsh.keybindings.v1`。
- 校验只用官方导出的 `ThemeSettingsSchema` / `LocaleSettingsSchema`；非法值返回 `settings/invalid`。版本不符或损坏的存储文档按 fail-closed 丢弃，不投影旧值。
- 只写 localStorage 键 `dsh-base.anonymous-settings.v1`：不存 secret、不写 cookie、不触碰 Host；没有新增公开端点，未改 `remoteAccess`。
- localStorage 不可用（隐私模式/配额）时降级为内存态，界面不崩；刷新后这些偏好会丢失，这是已登记的边界。
- 已登录路径完全不变：会话可见时一律走原有 Host RPC，本地文档不被读写（惰性构造，已登录页面从不构造；验收计数 `reads=0 / writes=0`）。
- 语言/主题/字号复用官方 `ThemeRuntime` / `LocaleRuntime` 的读写；boot 期 `locale.setLocale` 的 `settings/mutate` 同样落在本地文档。
- 单测（官方 schema 校验、白名单、冲突、存储降级、损坏文档）：`node --experimental-strip-types --import ./packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs packages/client/dsh-base-client-session-adapter/tests/local-settings-document.test.ts`

`sessionModelCatalog` 为已登记的模型选择 fork 提供按会话读取的 Host 数据接缝，透传准确 `sessionId`，保留读取失败及逐模型禁用状态；不修改官方零参数 `session/modelCatalog` 的账号语义。匿名目录请求先验证共享账户结果并返回认证错误，不发私有 HTTP。会话禁用原因使用当前八语言 locale，优先保留 Host 提供的具体说明。

凭据 Remote 的 describe/set/unset 在调用私有 Host 前验证共享账户快照；匿名返回认证错误，认证读取失败保留原错误，不把凭据目录伪装成成功的空对象。`tests/chat-feedback.test.ts` 覆盖匿名零私有调用、单次账户读取、真实错误和登录后恢复。

## 原版可选 bundle 目录

构建期从锁定版本 `@deepseek-ai/dsh-official-bundles` 的稳定导出读取
`OPTIONAL_BUNDLES` 与 `ON_DEMAND_BUNDLES` 清单。前者只提取已导出的
`package.json`、`locale/*.json`；图标按官方 `PluginLocalizedMeta.icon` /
`readPluginMeta` 契约读取 manifest 声明的包内图片，生成 data URL，未导入未导出的
图片模块。后者原样使用官方 `OFFICIAL_ON_DEMAND_CATALOG` 元数据。生成结果记录
pin、资源来源和原始 `listedByDefault`，不加载任何 bundle JavaScript、Node Host、
工具或进程，也不包含安装目标。

尚未适配的候选标记为 `missing`、未安装、关闭及独立的
`deploymentAvailability: "not-adapted"`；行列表为空，不编造运行 fiber，也不把
预期的部署限制伪装成错误。明确标记的官方管理页 fork 将它显示为中性灰色“不可用”，
列表不重复红字或“未安装”；详情保留安装事实与 Workers 限制说明。真实错误仍使用
官方异常状态。开关保持禁用，直接调用启停也在任何持久化请求之前拒绝。
适配层设置候选的 `listedByDefault`，使官方管理页可以显示不可用条目。主列表和「更多」沿用固定官方版本的筛选与排序规则。自有分组使用本地化名称，标记为 `official: false`。

生成：`node scripts/composition/generate-official-bundle-catalog.mjs`；漂移检查追加
`--check`。回归：`node --test scripts/conformance/tests/official-bundle-catalog.test.mjs`
及 `tests/plugin-inventory.test.ts`。

Cloudflare 品牌的自有组件共享固定版本 [Cloudflare 官方 create-cloudflare 模板](https://github.com/cloudflare/workers-sdk/blob/4335eacef350c98722418fbb58b012a6964e26d7/packages/create-cloudflare/templates/react/workers/ts/src/assets/cloudflare.svg)的原始云朵图标。`cloudflare-plugin-icon.ts` 保留原 SVG 字节、比例及双色，通过官方 `PluginLocalizedMeta.icon` 的 base64 图片合同接入；同一元数据覆盖列表、详情和组件行，不修改官方 Page/CSS，不热链远端资源，也不将本地插件标记为官方插件。包元数据记录来源提交、SHA-256 与 MIT 许可，浏览器资源随附图标的许可声明。

Cloudflare AI Gateway 通过官方 `BundleInfo.rows` 合并为一个管理入口，保留 client 与 Think 两个原始组件及完整运行库存。账号开关一次 CAS 写入两成员；旧成员名称仍作为整体开关别名。历史不一致配置以 Think 选择归一化，会话覆盖不变。只对客户端调用 Loader 更新，对 Think 刷新模型目录；实时应用失败以 CAS 回滚两成员，若回滚冲突则明确提示重载，不覆盖其他标签页的新选择。


## 完整可见性与操作权限

`scripts/composition/generate-owned-plugin-inventory.mjs` 根据包元数据和所选应用的 profile 读取自有客户端、Worker 与 Think 组件。各组件按 `packs/` 声明的分组恰好出现一次，已停用的条目也保留。启动、构建与未独立注册的引擎支持包不计入清单。Gateway 的客户端与 Think 组件共用一个开关，网页抓取与记忆各有独立开关。

「Dsh-base 全局」包含站点品牌、公开配置、SEO、站点发现文件、访问统计及设置界面。组件明细见[分组声明](../../../packs/global/pack.json)。Agent 预设、模型服务设置、附件和不可用的子智能体归入 AI 对话；导航、语言、权限、静态资源及已停用的侧栏扩展保留在基础功能。站点配置的管理员编辑权限独立于插件启停策略，全局分组及组件仍不可在此停用。

显示范围不读取 L1 白名单；L1 只决定操作权限。必需组件使用 `managementPolicy:required`，Worker 组件使用 `deployment`，由现有标记 fork 的禁用开关与中性说明呈现；服务端权限边界保持不变。客户端与 Worker 使用实际观察到的状态；Think 只呈现组合声明和账号选择，fiber 保持 null。子智能体继续明确标为不可用，不将只读、停用或未适配混为一谈。已认证库存缺少声明的客户端或 Worker 时返回错误，不静默丢行或伪造状态。

登录后，官方设置页的全局分组展示实际观察到的客户端和 Worker 条目，会话分组展示已声明的 Think 组件，包括 DeepSeek 提供者。官方原件与原版预设保持原样；显示元数据只为自有组件补充简短中英文名称、用途和已有 Cloudflare 图标。生成器检查分组覆盖及漂移；回归独立枚举源码声明，验证所有声明组件各出现一次、元数据覆盖、停用状态、只读调用无 HTTP 修改以及库存失败路径。

自有插件的显示名称统一使用品牌前缀：通用自有实现及官方 fork 使用 `Dsh-base`，Cloudflare 集成（Gateway、R2、KV 及 Cloudflare 基础设施组件）使用 `Cloudflare`。该前缀表示功能归属，不表示由 Cloudflare 官方发布。中英文列表、详情与设置库存共用同一份元数据；官方原版名称、包名、组合 ID、来源字段和已保存的控制状态不变。

侧栏可用状态由 `navigationAccess` 提供：区分正在检查、未登录、已登录和检查失败，不修改官方 RemoteAccess。目录浏览、选择和创建在未确认登录时先在客户端拒绝，不发送私有请求；服务端仍核验所有者权限。

Dsh-base 品牌的插件包与组件统一使用与网站同源的官方鲸鱼图标，通过现有元数据和插件页图标合同显示。品牌由 `meta()` 的显式参数决定，不按 Worker 包名前缀或翻译后的标题猜测；Cloudflare 图标保持不变。清单生成与 `--check` 同时生成或校验鲸鱼资源。
