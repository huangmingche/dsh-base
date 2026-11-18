# @dsh-base/client-plugin-management

官方 Plugins 页的管理补充插件（seam）。它只通过 pinned 官方的
`plugins.item`、`plugins.detail.section` 与 `plugins.row.config` slot 补足不可用入口和管理说明，不替换
官方 Plugins 列表、安装/更新/卸载、错误/加载/空态或页面样式。

可管理的可选能力由 `toggleable: "L1"` 的 pack 清单生成：Think 的 fetch、memory、
AI Gateway，以及客户端 Gateway provider 卡。Worker 组合是部署级，Think 投影由
Session Host 在下一轮读取 owner 选择后应用。必需客户端外壳不可自锁，未打包
inventory 不可启用。中英等 8 种语言文案与插件管理页一致。

客户端 Gateway 卡与 Think Gateway provider 保留为两个真实组件，通过一个
Cloudflare AI Gateway 插件包开关按账号统一管理。官方详情槽按明确的插件包标识
选择八语言说明：开关同时管理模型设置卡片与账号的平台模型默认启用状态；
会话中的显式覆盖仍有效，不取消进行中的请求，也不影响自带 API Key。
成功保存后，经官方 `llm/adapters-updated` 通知刷新模型选择器及 Gateway 状态；
其他标签页收到同一持久选择变化也会重新读取 Host。部署关闭不能被账号/会话启用
覆盖，BYOK 与 fetch 不受 Gateway 禁用影响。详情不再将 Gateway 描述为仅客户端、
仅下次页面启动生效的功能。

官方 Plugins 页的启停开关读取和修改账号默认值；切换会话或语言不会把会话覆盖
混入这些开关。已有 fetch allowlist 配置仍提供账号/当前会话两个作用域，当前会话
来自官方 `uiSession.adapter.current` 订阅，与 URL 前缀无关。切换会话会重新读取
配置，旧读取/保存响应不能覆盖新编辑器；保存前再次核对目标，尚未读取完成或
会话已离开时禁止提交，也不会回退写入账号默认值。

缺失的官方 Subagent、Web search and fetch、Agent loop、Shell 配置入口通过原 `plugins.item` 补齐，标题、图标、排序、原说明和详情表单均复用固定版本导出的官方 Card/controller。仅在真实 settings describe 不包含对应 namespace 时注册；未知或读取失败不冒充缺失。数据源明确为 unavailable、只读且写入拒绝，未新增或伪造 settings namespace。官方 Tag 标注不可用，详情说明当前 Workers/Think 能力限制；真实 namespace 出现时官方条目接管，借助官方 slot priority 避免过渡重复。实验插件目录条目另外明确标注仅元数据、未安装未运行、不能从页面激活。说明覆盖八种语言；本 seam 保留官方槽位与配置卡结构，列表的部署不可用展示由下述独立 fork 负责。

验证：`node --test packages/client/dsh-base-client-plugin-management/tests/builtin-availability.test.mjs` 使用真实官方 Card、controller 和 SlotCore，覆盖四项缺失态、原描述、无私有请求、原条目接管、重复注册防护及八语言说明。

`node packages/client/dsh-base-client-plugin-management/tests/subagent-panel.test.ts` 验证明确的 Gateway 插件包分支、开启/关闭状态、相似名称隔离、八语言作用域说明及其他详情分支不变。

列表中的部署不可用标签由独立的、明确标记来源的 `client-plugin-manager` 官方 fork 负责；本包继续通过官方详情槽提供具体 Workers 原因。

自有插件的说明参考固定版本官方的 metadata 与详情文案：名称说明用途，简介使用简短动作句；账号范围、部署限制和不可用原因放在状态或详情中，不混入包名、运行平面、历史审计记录等实现说明。详情通过 Host 的 `managementPolicy` 区分“应用所需”和“部署管理”，不因开关不可修改而隐藏插件。仅在原只读原因明确为 `unaddressable` 时使用该扩展，未知字段保持原有说明。已有官方入口的名称和说明不改写。

`subagent-panel.test.ts` 同时覆盖完整八语言词条、只读策略与停用状态的区别，以及未知或可写条目不能被策略元数据重新标记。
