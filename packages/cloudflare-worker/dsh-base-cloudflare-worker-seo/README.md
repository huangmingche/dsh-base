# @dsh-base/cloudflare-worker-seo

HTML 文档 SEO Worker 插件：为公开页面生成完整本地化 `<head>`，为 noindex 页面保留受限元信息。sitemap、robots、manifest 和 llms 资源由各自独立的 Worker 插件提供。通过 `siteSettings` 读取站点配置：已保存的完整文档优先；尚未保存时由 `@dsh-base/site-config/settings` 统一解析部署 `SITE_SEO_JSON`、旧品牌绑定与内置默认值。数据库读取故障返回明确的 `503`，不会改用旧值。

## Head（每页）

- `title` / `meta description` / `meta keywords`：页级 `pages[path]` → `PublicPage.copy[locale]` → `locales[locale]` → `locales.en` → 硬兜底；
- 规范地址与实际译文的 hreflang 链接。有英文版本时输出 `x-default`。语言路径由共享模块生成，`zh` 映射为 `zh-CN`。
- Open Graph：`type` / `site_name` / `title` / `description` / `url` / `locale`（当前语言）/ 其他实际译文的 `locale:alternate` / `image` + `width` / `height` / `type` / `alt`；
- Twitter 卡：`card=summary_large_image` / `title` / `description` / `image`，配置了 `site.twitter` 才输出 `twitter:site`；
- JSON-LD：`WebSite`（name/url/inLanguage）+ `Organization`（name/url/sameAs/email），JSON 转义防止 `</script>` 逃逸；
- 图标区：`favicon.svg` + `favicon-dark.svg`（默认仅声明此主题配对，保留显式自定义 ICO/PNG 覆盖）/ `apple-touch-icon` / `manifest`（按 locale 前缀）/ `theme-color`；
- 登录和私有页面仅保留品牌元数据并输出 `noindex, nofollow`。部署关闭收录时，已发布的公开页面仍显示本地化元数据。Staging 会为这些页面添加 `noindex, nofollow`。

## 资源边界

本插件只处理 HTML GET/HEAD。可选 `siteManifest` 生产者存在时才输出本语言 manifest 链接；生产者缺席时仍保留独立图标与主题色。sitemap、robots、manifest、llms 路由归各自独立 Worker 插件所有，全部读取同一站点文档，不新增缓存或数据库。

HTML 返回 `text/html`、`no-store` 和对应语言。HEAD 无正文，包括配置读取故障的 503 响应。静态资产、AI 请求和其他元数据资源不会通过本插件触发配置读取。

## 资产

默认十件资产在 `apps/web/public/`：黑白 SVG、ICO（16/32/48）、16/32 PNG、Apple touch（180）、192/512、maskable 512 和分享图片。`node scripts/assets/generate-site-assets.mjs` 从固定版官方 `@deepseek-ai/dsh-client-ui-primitives` 稳定导出的 `FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX` 生成，保持侧栏小鲸鱼比例。网页图标均为透明底：精确使用内置 `/favicon.svg` 配置时，按官方 `link media` 方式为浏览器浅色/深色主题选择黑色/白色 SVG；自定义 SVG 保持单一资源，不注入默认鲸鱼。默认 head 不再声明 ICO/PNG，避免浏览器将备用图标选作标签页图标；这些文件保持透明黑色，可直接访问，自定义路径配置不变。Apple touch、安装图标和分享图片保留独立深色底板；maskable 图形位于安全圆内。生成工具仅在开发时运行，不引入 Worker/browser 运行时依赖；`pnpm check:site-assets` 校验来源和产物。

默认资源的 head、manifest、OG URL 使用生成的内容哈希作为 `v` 参数，已保存配置仍保留原路径。自定义地址、查询参数和片段不改写；可通过全局设置的 `seo.icons` / `seo.image.url` 指向自有资源。缺失资产仍返回真实 404。

## 验收

```sh
pnpm check:seo                       # 配置 + head/JSON-LD/manifest + sitemap/robots + assets 单测
pnpm acceptance:seo-local            # 本地 Worker：8 语言 head 快照、资产 status/content-type、manifest、sitemap、robots、JSON-LD、404 守卫、301/noindex
node apps/web/scripts/acceptance-locale-routes-local.mjs   # 301/noindex/sitemap 无回归（需 DSH_ACCEPTANCE_OUT）
```

## 复用决策

官方 DSH 没有为 Workers 部署提供公开 HTML head 的 Host 服务；`@deepseek-ai/dsh-client-locale` 是浏览器运行时，不能生成可抓取文档。因此这是 custom worker 插件，只服务公开文档层，不改官方 UI。
