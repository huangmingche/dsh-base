# @dsh-base/cloudflare-worker-manifest

独立生成 `/manifest.webmanifest` 及规范的语言前缀地址，返回 `application/manifest+json` 与对应 `content-language`。提供 `siteManifest.path`；SEO 只有在该服务存在时才输出 manifest 链接。

名称、描述、主题色和安装图标全部来自同一站点配置；语言决定 `lang` 和 `start_url`。图标 URL 沿用共享渲染器的内置资产版本与管理员覆盖规则。`/en/*` 和大小写前缀返回保留查询参数的规范 301。

## 配置与权限

通过已有 `siteSettings.read(env)` 读取同一份站点文档；已保存值优先，尚未保存时使用统一部署默认值。不新增数据库、账户配置、定时任务或常驻服务。管理员仍通过 `/api/site-settings` 的服务端账号白名单与 revision CAS 保存；插件不另建写入口。每次仅处理本插件的明确路由，不为静态资产或 AI 请求读取配置。

路由在 `@dsh-base/public-pages` 中统一登记，匿名 GET/HEAD（包括 `Accept: text/html`）不会被重定向到登录页。HTTP 优先级 20 先于静态资源兜底。成功响应 `no-store`；HEAD 无正文，其他方法 405；存储故障返回明确 503，HEAD 故障同样无正文，不回退到过期配置。

## 复用决策

已核查固定版本官方 locale 与 ui-plugin-manager：它们提供浏览器语言与设置展示契约，没有本资源的 Workers HTTP 实现。挂载或 fork 都不能补齐该能力，因此实现独立 custom Worker 插件；不复制官方代码，不修改官方 UI。

## 验证

```sh
node --experimental-strip-types packages/cloudflare-worker/dsh-base-cloudflare-worker-manifest/tests/resource.test.ts
```
