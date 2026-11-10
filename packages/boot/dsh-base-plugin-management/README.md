# @dsh-base/plugin-management

客户端 composition 与 Worker 控制面共享的插件管理策略。

可选白名单**不手写**：它由 `toggleable: "L1"` 的 capability pack 清单经
`scripts/composition/generate-manageable-composition.mjs` 生成
（`src/manageable.generated.ts`，gitignored）。pack 清单是唯一真源；手写列表是
第二真源，`check:packs` 无法校验，出现即视为错误。

只有明确声明为 L1 的客户端/Think 成员可被账号启停。认证、HTTP、会话/传输、
持久化、布局、主题、语言、渲染器和插件管理入口等必需入口永远只读。Worker 平面
是部署级：加载器拒绝声明 worker 成员的 L1 pack。

包名与 Think 运行时名称通过显式映射连接（Gateway → `cloudflare-ai-gateway`、
fetch → `fetch`、memory → `memory`），不是新的能力白名单。Host 投影与 Think
过滤共享此映射；新增 L1 Think 成员缺少映射时直接失败，不按名称后缀猜成 fetch。

会话补丁只保存当前会话显式覆盖的字段并保留同层其他字段；读取时再逐字段覆盖
账号默认值。因此只改配置不会重置会话开关，也不会冻结后续账号默认值的变化。

Cloudflare AI Gateway 以一个官方 `BundleInfo` 多行插件包管理界面和平台模型服务，
继续使用 `@dsh-base/client-gateway-provider` 作为稳定管理标识；两个运行时插件仍各自
保留 composition 条目。成员关系从 `gateway-provider` pack 生成。账号开关和重置
接受任一旧成员标识，在一个存储事务和一个 revision 中更新两者；并发修改由 revision
比较保护。会话覆盖和管理员部署控制维持各自语义，不参与账号级联动。

旧账号可能分别开关过卡片和执行插件。读取账号配置时，以 Think 模型服务的选择为准
投影卡片状态；没有 Think 覆盖则继承原有默认开启。读取不会写入或增加 revision，也
不会因为过去隐藏过卡片而改变模型执行选择。下一次账号开关会原子持久化两个成员。
