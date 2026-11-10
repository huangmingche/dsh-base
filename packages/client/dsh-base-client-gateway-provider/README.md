# @dsh-base/client-gateway-provider

组合范围：默认应用只在登录后加载工作台。以下未登录分支属于组件或 Host 的独立契约，仅在隔离测试中使用。

独立的 Cloudflare AI Gateway custom provider slot 插件（不是纯 seam）。官方 Models 页面通过标记的 @dsh-base/client-deepseek-provider fork 挂载，原 DeepSeek provider/编辑器保持官方实现；本插件通过官方
`settings.models.provider-card` 合同，为独立 provider id
`cloudflare-ai-gateway`（settings namespace `llm-cloudflare-gateway`）显示真实平台
可用状态、运营者托管/只读说明与真实 Gateway 模型目录。Gateway 设置不可由普通
用户编辑，Host 写入边界拒绝该 namespace。

插件列表使用一个 **Cloudflare AI Gateway** 插件包入口和一个账号开关，统一控制本插件的模型设置卡片与 Think 平台模型服务。官方详情保留“模型设置”和“平台模型服务”两个真实组件，组件开关只读并说明由插件包统一管理。历史包名、composition id 和 provider id 保持不变；旧配置以 Think 服务的选择归一化，避免改变既有模型执行权限。会话显式覆盖仍生效，自带 API Key 独立运行。

云平台认证就绪时，provider 名称旁使用官方 `credentialDot credentialDotConfigured` 绿色状态点（8px，与官方 DeepSeek 行同 class/token/位置）；该绿点仅表示平台认证已配置且可用，**不是 API key/凭据状态**，也不读取任何凭据。loading、error、unavailable、signed-out 不显示绿点，详情区保留诚实原因；不再使用自定义 Available/Unavailable/Checking/Error 文本标签。

匿名模型页通过 `createSignedOutGatewayStore(catalog?)` 提供纯本地视图，复用同一个 `GatewayCard` 及官方详情样式。状态与认证显示“登录后查看”；不会把未知状态说成未启用、未配置或可用。可选模型名称由调用方传入公开声明，字段仍称“模型”，不表示账号可调用。该视图不构造真实 `GatewayStore`、不读取 Host、不注册刷新监听；`start`/`load` 不改变未登录状态。登录后由账号页面另行提供真实状态源，不能通过刷新匿名视图提升权限。

状态卡默认折叠，直接复用 pinned 官方 `ModelsSection` 的紧凑行、28px 次要按钮和
编辑区样式：名称与官方状态点/操作按钮同行，原始 provider id 仅在展开详情中作为次要信息；
详情通过官方 Details 展开，字段层级为状态/认证/模型，运营者托管只读说明不被伪装
成可编辑表单；生产页面由 marked Models fork 的公共单卡状态通过显式
`GatewaySeatControl`（`gatewayOpen`/`onGatewayToggle`）控制，DeepSeek 与 Gateway 双向互斥。作为 standalone/parity fallback，在未传控制契约时插件仍保留
internal open state；该 fallback 不参与生产单卡状态。reactive store 使用 settings/llm invalidation、连接恢复与窗口 focus
刷新，带 generation fencing、卸载清理、loading/error/retry/unavailable；文案覆盖
en/zh/ja/es/fr/de/ru/pt。不进入未知 namespace 编辑器，不显示 cordis.patch.yml 提示，
只读取独立 Gateway provider 状态，不依赖 owner key。
