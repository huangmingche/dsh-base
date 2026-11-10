# @dsh-base/cloudflare-worker-sitemap

生成 `/sitemap.xml`，返回 `application/xml; charset=utf-8`，并通过 `siteSitemap` 向 robots 插件提供该路径。

收录默认关闭。只有生产部署显式启用收录并配置有效的 HTTPS 站点源时才列出网址，Staging 的 sitemap 为空。Worker 读取 `publicPages.list(env)` 中已发布且允许收录的页面，只列出实际存在的译文。各语言地址通过 hreflang 互相引用，有英文版本时添加 `x-default`。`seo.pages[path]` 可为已登记页面提供 `changefreq`、`priority`，并在页面未声明 `lastmod` 时补充日期。私有地址和登录页均排除在外。

## 配置与权限

通过已有 `siteSettings.read(env)` 读取同一份站点文档；已保存值优先，尚未保存时使用统一部署默认值。不新增数据库、账户配置、定时任务或常驻服务。管理员仍通过 `/api/site-settings` 的服务端账号白名单与 revision CAS 保存；插件不另建写入口。每次仅处理本插件的明确路由，不为静态资产或 AI 请求读取配置。

路由在 `@dsh-base/public-pages` 中统一登记，匿名 GET/HEAD（包括 `Accept: text/html`）不会被重定向到登录页。HTTP 优先级 20 先于静态资源兜底。成功响应 `no-store`；HEAD 无正文，其他方法 405；存储故障返回明确 503，HEAD 故障同样无正文，不回退到过期配置。

## 复用决策

已核查固定版本官方 locale 与 ui-plugin-manager：它们提供浏览器语言与设置展示契约，没有本资源的 Workers HTTP 实现。挂载或 fork 都不能补齐该能力，因此实现独立 custom Worker 插件；不复制官方代码，不修改官方 UI。

## 验证

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-sitemap/tests/render.test.ts
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-sitemap/tests/resource.test.ts
```
