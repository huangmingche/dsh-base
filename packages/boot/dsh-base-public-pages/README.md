# @dsh-base/public-pages

公开文档和元数据路由的共享登记表，供鉴权、SEO、sitemap、manifest 与 llms 插件使用。它不提供 HTTP 处理器或自行发布页面。

`PUBLIC_PAGES` 目前仅登记首页 `/`；语言前缀由 `@dsh-base/locale-path` 统一处理。SEO 配置只描述已登记页面，不授予新路径公开权限。登录页与私有产品地址不参与索引。

`PUBLIC_RESOURCES` 明确登记 sitemap、robots、manifest、llms。前两者仅根路径，后两者支持规范语言前缀。匹配严格到完整路径，不放行子目录；独立 Worker 插件负责真实输出，生产者未挂载时不伪造资源。

验证：`node --experimental-strip-types packages/boot/dsh-base-public-pages/tests/public-pages.test.ts`。
