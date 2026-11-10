# @dsh-base/cloudflare-worker-llms

独立生成 `/llms.txt` 及规范的语言前缀地址，返回 `text/plain; charset=utf-8` 与对应 `content-language`。Markdown 正文包含站点名称、简介和已登记公开页面的实际链接。不会抓取站点、调用 AI、导出私人会话或编造 `.md` 全文地址。

`seo.llms.enabled` 默认开启，关闭时返回真实 404；`introduction` 可覆盖默认本语言简介，`guidance` 可补充站点说明。Worker 从当前 `publicPages` 目录读取链接，包括业务插件登记的页面。仅列出已发布、允许收录且具备当前语言版本的页面。资源不宣称搜索引擎或模型会采纳这些内容。`/en/*` 和大小写前缀以 301 规范化并保留查询参数。

## 配置与权限

通过已有 `siteSettings.read(env)` 读取同一份站点文档；已保存值优先，尚未保存时使用统一部署默认值。不新增数据库、账户配置、定时任务或常驻服务。管理员仍通过 `/api/site-settings` 的服务端账号白名单与 revision CAS 保存；插件不另建写入口。每次仅处理本插件的明确路由，不为静态资产或 AI 请求读取配置。

路由在 `@dsh-base/public-pages` 中统一登记，匿名 GET/HEAD（包括 `Accept: text/html`）不会被重定向到登录页。HTTP 优先级 20 先于静态资源兜底。成功响应 `no-store`；HEAD 无正文，其他方法 405；存储故障返回明确 503，HEAD 故障同样无正文，不回退到过期配置。

## 复用决策

已核查固定版本官方 locale 与 ui-plugin-manager：它们提供浏览器语言与设置展示契约，没有本资源的 Workers HTTP 实现。挂载或 fork 都不能补齐该能力，因此实现独立 custom Worker 插件；不复制官方代码，不修改官方 UI。

## 验证

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-llms/tests/resource.test.ts
```
