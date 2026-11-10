# @dsh-base/site-config

站点公开配置与编辑契约共享包，没有 DOM、Worker 或 React 依赖。

`./settings` 导出完整的 `SiteSettingsValues`、带版本和编辑权限的 `SiteSettingsSnapshot`、部署默认值解析器和严格的保存校验器。SEO、侧栏品牌和公开链接共享同一份数据。八种语言的标题、描述、关键词，以及图标、分享图片、manifest、robots 和已实现公开页面的 sitemap 设置均在此定义。

部署值在首次保存前提供默认配置；保存后的完整文档由站点配置 Worker 插件存入 D1。校验器拒绝未知字段、危险 URL、不完整文档和私有/不存在页面的 sitemap 覆盖。账号 ID、密钥和编辑权限不属于可保存文档。

根导出的旧 `SiteConfig` 用于公开投影与客户端服务兼容；已停用的 shell-extras 不因新增编辑功能而恢复。

官方没有站点部署配置契约；本包只共享数据结构。界面由独立 client-global-settings 插件通过官方设置组件和插件配置槽提供。

## 转化配置

`analytics.conversions` 独立于公开 page_view 开关，默认关闭，支持 `off` / `aggregate` / `google` 和公开活动标签白名单。严格校验拒绝未知模式、重复/无效标签及缺少 Measurement ID 的 Google 模式；不保存密钥、用户同意或访客标识。
