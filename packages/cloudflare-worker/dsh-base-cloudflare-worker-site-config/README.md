# @dsh-base/cloudflare-worker-site-config

管理整个部署共用的站点配置，并向公开页面提供站点名称和链接。站点配置与账号偏好、会话配置分别存储；普通账号不能修改整个站点。

## 接口与权限

- `GET /api/site-settings`：登录后读取 `{ revision, values, source, canEdit }`；`values` 包含 `seo` 与 `links`。普通账号可以查看。
- `PUT /api/site-settings`：仅服务器 `SITE_ADMIN_USER_IDS` JSON 数组中列出的已登录用户 ID 可以保存。缺失、空值、格式非法或包含非字符串的名单全部拒绝写入。用户名、客户端角色与请求中的权限字段不参与授权。
- 保存请求为 `{ expectedRevision, values }`，要求同源 Origin 和 JSON，正文按实际字节数限制；未知字段、无效配置与非法版本号被拒绝。版本冲突返回 `409`，不覆盖其他管理员刚保存的内容。
- `GET/HEAD /api/site-config`：保留公开响应形状 `{ environmentLabel?, brand: { name }, links?, documentTitles }`。品牌取自同一配置的 `seo.site.name`，只返回公开字段，不返回用户 ID、管理员名单、权限、版本或绑定。

## 存储与发布

复用现有 `AUTH_DB`，执行本包 `schema.sql` 创建单行 `dsh_site_settings` 表，不新增服务。尚未保存时，revision 为 `0`、source 为 `deployment`，值由部署 `SITE_SEO_JSON`、旧品牌与链接绑定和内置默认值解析。保存后整个已校验文档优先，source 为 `saved`，revision 单调递增。SQLite 单条语句完成比较版本并写入；跨 isolate 的同时保存只接受一个版本。

`ctx.siteSettings.read(env)` 供 SEO 插件读取同一份配置。每次需要站点配置的请求使用 D1 `first-primary` 会话，不使用跨 isolate TTL 缓存。站点配置响应为 `no-store`，保存后下一次读取立即获得新文档。缺少绑定、未执行迁移、数据库故障或已存数据无效时返回 `503`；不会假装保存成功，也不会悄悄恢复部署旧值。静态资产与 AI 请求不查询该表。

图标使用现有资产路径或 URL，不提供上传。`client:site-config` 读取公开配置，品牌插件在官方名称槽中展示同源站点名称，官方标题组件使用同源的八语言 `documentTitles`。已取消的自定义“更多”菜单入口仍不恢复。

## 复用决策与验证

官方插件管理器的 `plugins.bundle.config` / `plugins.row.config` 是客户端配置入口，官方表单提供交互契约。官方 `config-editor` 持久化本地 profile，不提供部署级站点元数据、站点管理员权限或 Workers 原生存储，因此此包提供最小服务实现，账号设置保持原有作用域。

`node packages/cloudflare-worker/dsh-base-cloudflare-worker-site-config/tests/settings-runtime.test.mjs` 使用两个真实 workerd isolate 与持久化 D1，覆盖权限、输入校验、首次并发保存、CAS、跨账号一致、重启持久化、公开 SEO 输出、故障及静态资产/AI 请求无查询。测试中的认证 face 由 fixture 提供，生产环境使用 `ctx.auth.session`。

## 转化配置与发布路径

公开站点配置保留已校验的转化模式和公开活动标签，秘密不出 Worker。保存 Google 转化模式同样要求部署就绪；管理员编辑和 revision CAS 不变。测试通过真实 publicPages 服务与显式生产收录配置检验共享文档，并继续覆盖匿名拒绝、普通用户只读及跨源拒绝。
