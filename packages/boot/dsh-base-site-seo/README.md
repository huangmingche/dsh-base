# @dsh-base/site-seo

站点级 SEO 的单一配置源：类型、默认值、三层合并与逐字段校验，零运行时依赖（无 npm import），可直接 `node --experimental-strip-types` 测试，Worker 冷启动只带这一份纯解析代码。

## 三层优先级

1. 部署 env `SITE_SEO_JSON`（单变量 JSON，由 `apps/web/cloudflare.config.ts` 从 `deployment.local.json` 的 `seo` 段注入）；
2. 包内 `DEFAULT_SITE_SEO`（随代码发布的 8 语言文案、图标集、`og.png`、manifest 默认值）；
3. `HARD_FALLBACK_COPY`（即使所有字典都不可用也能渲染的极小兜底）。

## fail-open

`resolveSiteSeo(env)` 永不抛错、永不返回 500：

- 非法 JSON、超长文档（> 256 KB）、非对象、字段类型错误都**逐字段回退**默认值；
- 每个回退记录在返回值的 `problems`（`SITE_SEO_JSON: ...`），Worker 插件去重后 `console.warn`；
- URL 字段拒绝凭据、query、fragment，尾斜杠归一；`robots.extraLines` 拒绝 `User-agent:` 与换行注入；`pages[*].lastmod` 只接受配置里的 ISO 日期，**不读时钟**。

## 结构

`SiteSeoConfig`：`site`（名称/可选 url/Twitter/GitHub/联系邮箱）、`locales`（8 语言 title/description/keywords/ogImageAlt）、`icons`（8 个路径）、`image`（OG 四件套）、`manifest`（短名/主题色/背景色/display）、可选 `robots`、可选 `pages`（页级覆盖）。

## 渲染器（`src/render.ts`）

- `renderHead`：description/keywords/canonical、实际译文的 alternates，有英文版本时添加 `x-default`、`og:url`、`og:locale` + alternate、OG image 四件套、Twitter 卡、默认 2 个 icon（仅黑白透明 SVG 按浏览器主题配对；自定义 SVG 和显式 ICO/PNG 覆盖保留原配置）+ apple-touch + manifest + theme-color；全部走同一个 `escapeHtml`。
- `renderJsonLd`：`WebSite` + `Organization` 两个 `application/ld+json` 图；`inLanguage` 随 locale，`sameAs` 取社交链接；JSON 转义防止 `</script>` 逃逸。
- `renderManifest`：`/manifest.webmanifest` 的 JSON（name/short_name/description/start_url/scope/display/theme_color/background_color/lang/icons）。
- `resolvePageCopy` / `resolvePageImage`：页级 → locale → English → 兜底；页级图片按站点 origin 解析为绝对地址。

## 部署覆盖示例

```json
{
  "seo": {
    "site": { "name": "Example", "url": "https://example.com", "twitter": "@example" },
    "locales": { "en": { "title": "Example", "description": "Example site", "keywords": ["example"] } },
    "robots": { "disallow": ["/private"], "extraLines": ["Crawl-delay: 1"] },
    "pages": { "/": { "lastmod": "2025-01-31", "changefreq": "monthly", "priority": "0.8" } }
  }
}
```

未写的字段沿用默认值；改配置不需要改代码，但需要重新部署。

## 测试

`pnpm check:seo`（`tests/site-seo.test.ts` 校验配置解析，`tests/render.test.ts` 校验 head/JSON-LD/manifest 原文与转义）。
