# @dsh-base/client-shell-extras

已按用户要求停用。侧栏“更多”只保留锁定版本官方 `ui-entry-customization` 的“浏览更多插件”和“创建你的插件”；“关于 <品牌名>”“联系支持”“环境”三行是自有扩展，不属于官方菜单。

包元数据与 pack 清单均标记 `disabled: true`，构建不生成模块 resolver，运行时不注册 `dsh-base-more` 槽位。源码仅作为停用实现保留；旧文档中的 P6 偏差批准已被本次移除请求取代。`client-site-config` 由站点品牌功能独立使用并已恢复启用；它每次启动读取一次公开配置，不恢复这些菜单项。

官方插件源码、入口名称、顺序及浏览导航保持不变。保留创建入口不代表已实现官方 Creator 预设；当前 Host 仍明确拒绝不支持的 `cordis`，本次移除扩展不新增该能力。

验证：`tests/order.test.ts` 检查真实生成组合中侧栏扩展无可执行 resolver、公开站点服务正常启用；`apps/web/scripts/acceptance-site-config-local.mjs` 对照官方导出的语言字典，验证实际菜单、站点名称和每次启动一次的公开配置读取，打开菜单不增加请求。
