# @dsh-base/cloudflare-worker-robots

生成 `/robots.txt`，返回 `text/plain; charset=utf-8`。默认禁止抓取 `/api/`、`/agents/`、`/app/session/`、`/app/workspace/` 及其语言前缀地址。爬虫可访问 `/login` 读取 `noindex`。站点配置可通过 `seo.robots.disallow` 和 `extraLines` 补充规则。

仅在部署已开启生产收录且存在 `siteSitemap` 服务时输出 `Sitemap:` 声明。Staging 省略该声明。私有数据仍由服务端鉴权保护。

## 配置与权限

通过已有 `siteSettings.read(env)` 读取同一份站点文档；已保存值优先，尚未保存时使用统一部署默认值。不新增数据库、账户配置、定时任务或常驻服务。管理员仍通过 `/api/site-settings` 的服务端账号白名单与 revision CAS 保存；插件不另建写入口。每次仅处理本插件的明确路由，不为静态资产或 AI 请求读取配置。

路由在 `@dsh-base/public-pages` 中统一登记，匿名 GET/HEAD（包括 `Accept: text/html`）不会被重定向到登录页。HTTP 优先级 20 先于静态资源兜底。成功响应 `no-store`；HEAD 无正文，其他方法 405；存储故障返回明确 503，HEAD 故障同样无正文，不回退到过期配置。

## 复用决策

已核查固定版本官方 locale 与 ui-plugin-manager：它们提供浏览器语言与设置展示契约，没有本资源的 Workers HTTP 实现。挂载或 fork 都不能补齐该能力，因此实现独立 custom Worker 插件；不复制官方代码，不修改官方 UI。

## 验证

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-robots/tests/render.test.ts
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-robots/tests/resource.test.ts
```
