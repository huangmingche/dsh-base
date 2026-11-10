# 公共站点配置服务

客户端 DSH 插件提供 `siteConfig` observable，主应用启动时读取一次 `/api/site-config`。快照包含共享默认值或最近一次成功读取的公开品牌与链接信息，不包含权限或秘密。

`client:brand` 是真实消费者，只填充官方侧栏名称槽位。全局站点表单保存成功后调用 `refresh()`，让名称更新；没有定时轮询。读取失败保留最近成功的快照，较旧的响应不能覆盖较新的刷新，插件销毁后不再发布或请求。

本插件重新启用不恢复已停用的 `client:shell-extras`，也不新增任何 More 菜单项。公开登录文档仍使用独立组合，不加载此服务。后端站点管理员权限由站点设置 API 单独执行。

检查：`node --test packages/client/dsh-base-client-site-config/tests/*.test.mjs`。

稳定导出 `./title-face` 提供官方 `LocaleFace` 的 Host 数据适配器，由已标记的
locale-label fork 在唯一安装点使用。它只投影 `common/brand.localBuild`：公开
`documentTitles` 尚未提供时使用官方翻译；提供后按当前语言、英文、站点名称回退。
其他命名空间和翻译参数原样传给官方服务。标题或语言变化更新同一 revision observable，
无关公开链接变化不触发全局翻译重绘；销毁时释放两边的订阅。它不注册第二份词典、
不修改布局，也不写入 DOM 标题；会话前缀仍由官方 `DocumentTitle` 处理。
