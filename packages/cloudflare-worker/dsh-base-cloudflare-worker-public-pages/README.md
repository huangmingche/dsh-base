# 公开页面注册

独立 Worker 插件。内容插件通过 `publicPages.register(owner, provider)` 声明实际文档，路由、SEO、sitemap、llms 和统计读取同一服务。注册不会放宽任何私有 API 权限。

文档明确声明访问范围、发布状态、索引许可、真实语言版本及发布时间。草稿、撤回内容、未来发布内容和私有内容不出现在匿名清单；缺少译文返回 404。重复路径、底座路径和保留的私有命名空间被拒绝。取消注册立即移除该提供方。

部署 `indexing` 默认关闭。只有 `environment: "production"`、`enabled: true` 与真实 HTTPS `authBaseUrl` 同时成立才允许索引；Staging 的 HTML 返回 noindex，sitemap 为空且 robots 不发布 sitemap 地址。登录页允许抓取以读取 noindex，服务端身份与所有权校验仍独立生效。

固定官方 locale/web 包没有服务端内容发布注册契约，复用决策见包元数据。没有新增基础设施、定时任务或模型调用。

验证：`node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/tests/*.test.ts`。
