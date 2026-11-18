# ADR-0006：SEO 配置包 + 完整 head / sitemap / manifest + 默认站点资产

- 状态：已接受（设计定稿，实施待派）
- 日期：2026-11-14
- 决策人：CEO（方向已拍）；架构：Architect
- 关联：P8 之后的 SEO 插件任务
- 约束：Workers 原生（无 Node API）、不加不必要运行时依赖、一切皆插件、双语文档

## 1. 背景与现状

线上与代码核对结果：

| 项 | 现状 | 证据 |
| --- | --- | --- |
| head 基础 | title / description / canonical / 8 语言 hreflang / x-default / OG 四条已注入 | `packages/cloudflare-worker/dsh-base-cloudflare-worker-seo/src/index.ts:79-95` |
| 站点文案 | **硬编码在插件里**（8 语言 `copy`），站点名 `SITE_NAME = "dsh-base"` 也硬编码；env 的 `SITE_BRAND_NAME` 没有用于 SEO | 同文件 `:23,31-63`；`apps/web/cloudflare.config.ts:54-56` |
| sitemap | 只有 `/` 的 8 条；`localizedPaths: ["/"]` | 同文件 `:110-119`；`packages/boot/dsh-base-public-pages/src/index.ts:26-28` |
| robots | 已有，含 sitemap 指向与登录/API/agent 排除 | 同文件 `:121-124` |
| locale 301 | 已有：大小写变体、`/en/*` 归一到裸地址 | 同文件 `:152-162` |
| 缺失标签 | keywords、og:url、og:locale、og:image、twitter 卡、JSON-LD、图标/manifest 链接 | 同上，无 |
| 资产 | `/favicon.svg`、`/favicon.ico`、`/manifest.webmanifest`、`/og.png` 都被 SPA 兜底成 HTML | `apps/web/cloudflare.config.ts:20`（`notFoundHandling: "single-page-application"`） |
| 资产路由 | `isDocumentNavigation` 只排除 `/favicon.svg`、`/favicon-dark.svg`、`/manifest.webmanifest`；`.ico`/`og.png` 靠「末段含点号」侥幸不算文档，但最终仍落 ASSETS → SPA | 同文件 `:126-130` |
| 配置底座 | 无 D1 站点配置表、无管理员角色；站点事实走 env | `deployment.local.json`、`cloudflare.config.ts` |
| 既有测试 | `check:seo` 已有三份：public-pages、sitemap、document-meta | `package.json` 的 `check:seo` |

## 2. 决策

1. 新增 boot 配置包 `@dsh-base/site-seo`：类型 + 默认值 + 纯函数校验/解析（零运行时依赖，可 `node --experimental-strip-types` 直测，沿用 `sitemap.ts` 的先例）。
2. 扩展 `cloudflare-worker-seo`：完整 head、动态 `/manifest.webmanifest`、配置化 sitemap/robots、页级元数据回退。
3. 在 `apps/web/public/` 提交默认站点资产集，并修 `cloudflare-worker-assets` 的 SPA 回落（资产缺失返回 404，绝不返回 HTML）。
4. **不改 app 代码**：只新增一个 boot 包、改两个 worker 插件、加静态资产；`deployment.local.json` / `cloudflare.config.ts` 的改动属于部署配置，不是应用逻辑。

**本次不做**：D1 站点配置表与后台 UI、动态 OG 图生成（Workers 原生无图像库，且会引入重依赖）、多页内容（当前只有 `/`）、按页社交卡定制、per-page schema.org 类型（Article/Product 等）。

## 3. 配置单一事实源

### 3.1 为什么不是「复用现有 env 散字段」

8 语言 × title/description/keywords，再加图标集、社交账号、清单 manifest、页级 sitemap 覆盖——散成几十个 env 变量会失控、无法校验、无法按页扩展。也不做 D1（本次范围外）。

### 3.2 三层优先级

```
部署 env `SITE_SEO_JSON`（单变量 JSON）
  > boot 包内 `DEFAULT_SITE_SEO`（构建期随代码）
  > 极小硬兜底（哪怕 JSON 全空也能渲染）
```

- `apps/web/deployment.local.json` 增加可选 `seo` 段，`cloudflare.config.ts` 把它 `JSON.stringify` 成 `SITE_SEO_JSON` 绑定。
- 之所以选**单变量 JSON** 而不是一串 env：结构随包演进时只改一个绑定的内容，不新增绑定；部署覆盖只需改一个值。
- 环境变量在部署时注入，改配置需重新部署，但**不需要改代码**。

### 3.3 结构

```ts
interface SiteSeoConfig {
  site: {
    name: string; url?: string;            // url 缺省用请求 origin
    twitter?: string; github?: string; contactEmail?: string;
  };
  locales: Record<LocaleId, {              // en/zh/ja/es/fr/de/ru/pt
    title: string; description: string; keywords: string[]; ogImageAlt?: string;
  }>;
  icons: {                                 // public/ 内路径或绝对 URL
    svg: string; ico: string; png16: string; png32: string;
    appleTouch: string; icon192: string; icon512: string; maskable512: string;
  };
  image: { url: string; width: number; height: number; type: string; alt?: string };
  manifest: { shortName?: string; themeColor: string; backgroundColor: string; display: 'standalone' };
  robots?: { disallow?: string[]; extraLines?: string[] };
  pages?: Record<string, {               // 页级覆盖，可只写要改的字段
    title?: string; description?: string; keywords?: string[];
    priority?: string; changefreq?: string; lastmod?: string; image?: string;
  }>;
}
```

### 3.4 校验与回退

- `resolveSiteSeo(env)` 纯函数：解析 → 校验 → 合并默认 → 返回 `{ config, problems }`。
- **fail-open**：JSON 解析失败或字段非法，不回 500、不抛错：逐字段回退默认，`console.warn` 记录 `problems`（可被验收脚本抓取）。
- 字段级回退链：`pages[path]` → `locales[请求 locale]` → `locales.en` → 内置兜底。
- 不引入 zod 到 worker 包：手写字段校验（零依赖、可控 bundle 体积），单测覆盖非法输入。**理由**：worker 包每次冷启动都带这份代码，且本仓已有「纯函数 + node 直测」的先例（`sitemap.ts` 头注释）。

### 3.5 URL 归一

- `site.url` 缺省 = 请求 origin（staging/prod 各自正确，避免 canonical 串味）；显式配置时以配置为准。
- 资产与 OG 图先按路径解析为 `origin + path` 的绝对地址；末尾斜杠归一。
- 不做域名重定向（不改 Worker 路由语义）。

## 4. 插件扩展（`cloudflare-worker-seo`）

### 4.1 完整 head

| 标签 | 来源 | 备注 |
| --- | --- | --- |
| `<title>` | `page.title ?? locales[locale].title` | 保留现有 `replace` 注入 |
| `meta description` | 同上回退链 | |
| `meta keywords` | `page.keywords ?? locales[locale].keywords.join(", ")` | 每 locale 一份 |
| `link canonical` | `localizePath(path, locale)` | 现有逻辑不变 |
| 8 × `link alternate hreflang` + `x-default` | 现有 | **不回归** |
| `og:type/site_name/title/description` | 现有 | 值改取配置 |
| `og:url` | canonical | 新增 |
| `og:locale` / `og:locale:alternate` | locale 映射表 | 新增；`en→en_US, zh→zh_CN, ja→ja_JP, es→es_ES, fr→fr_FR, de→de_DE, pt→pt_PT, ru→ru_RU` |
| `og:image` + `og:image:width/height/type/alt` | `image` | 新增 |
| `twitter:card/title/description/image/site` | `image`、`site.twitter` | 新增；`twitter:site` 仅在配置时输出 |
| JSON-LD `WebSite` + `Organization` | `site` + locale | 新增；`inLanguage` 随 locale，`sameAs` 取社交链接 |
| `link icon` ×4 + `apple-touch-icon` + `manifest` + `theme-color` | `icons` / `manifest` | 新增 |
| robots noindex | `isNoIndexDocument` | 现有；noindex 页**不注入** canonical/OG/JSON-LD（维持语义） |

HTML 注入仍是字符串 `replace` + 统一 `escapeHtml`，新增标签全部走同一转义函数。

### 4.2 动态 manifest

`GET /manifest.webmanifest` 由 seo 插件返回：`name/short_name/description/start_url/scope/display/theme_color/background_color/icons[]`，全部来自配置；`content-type: application/manifest+json`；缓存与 `/` 一致（`no-store`，保守）。图标 URL 指向 5.4 的资产集。

### 4.3 sitemap

- 页集合 = `PUBLIC_PAGES` ∪ `config.pages`（同一 path 合并，配置覆盖）。
- `localizedPaths` = 声明了多语言变体的路径（本次仍只有 `/`）；不声明的不复制 8 份。
- `lastmod/changefreq/priority` 只来自配置，**不读当前时间**（保证可缓存、可复现、可断言）。
- XML 转义沿用 `sitemap.ts` 的 `escapeXml`。

### 4.4 robots

默认输出不变；`robots.disallow` 追加 `Disallow:` 行，`robots.extraLines` 原样追加（校验：拒绝 `User-agent:` 开头的注入行，避免覆盖块）。`/sitemap.xml` 指向保留。

### 4.5 顺序与兼容

- seo 插件与 assets 插件的 handler 先后决定 `/manifest.webmanifest` 命不命中 SPA；实现必须验证（交付项 1 的 spike），失败则由 assets 插件对 manifest 返回 404 兜底。
- locale 301 与 hreflang 判定逻辑**一行不改**，只替换元数据取值。

## 5. 资产

### 5.1 默认集（提交进 `apps/web/public/`）

`favicon.svg`、`favicon.ico`（内嵌 16+32）、`favicon-16x16.png`、`favicon-32x32.png`、`apple-touch-icon.png`(180)、`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`og.png`(1200×630)。

### 5.2 来源与许可

默认集由本仓品牌 SVG 一次性生成（dev-only 脚本，不进 CI、不加运行时依赖）；自有资产，不需要第三方许可登记。参考模板只借结构，不借图片（见 §10）。

### 5.3 替换方式

同名覆盖文件即可；或改 `config.icons` / `config.image.url` 指向 `public/` 内其它路径。

### 5.4 不 404 成 HTML（核心修复）

在 `cloudflare-worker-assets` 增加「静态资产表面」判定：

- 命中资产扩展名白名单（`.svg .ico .png .webp .avif .jpg .jpeg .gif .txt .xml .webmanifest .woff .woff2`）或显式路径（`/og.png`）时，若 `ASSETS.fetch` 返回 **404** 或 **`content-type: text/html`**（SPA 回落特征），改为返回 **404 纯文本/空体**。
- 判定优先级：`isDocumentNavigation`（无点号、非 API/agent/assets）仍归文档；带扩展名的请求一律不许回 HTML。
- 这样即使 seo 插件没命中某个资产路径，也不会再输出 HTML 壳。

### 5.5 content-type

按扩展名映射校正（`image/svg+xml`、`image/x-icon`、`image/png`、`application/manifest+json` 等）；若 ASSETS 给回 `text/html`，按 5.4 直接 404（更诚实，不伪造类型）。

## 6. 每页元数据

扩 `PublicPage`（`packages/boot/dsh-base-public-pages/src/index.ts`）：

```ts
interface PublicPage {
  path: string;
  changefreq?: string;
  priority?: string;
  lastmod?: string;                                   // 新增
  copy?: Partial<Record<LocaleId, {                   // 新增
    title?: string; description?: string; keywords?: string[];
  }>>;
  image?: string;                                     // 新增
}
```

- 全部字段可选：auth 侧只读 `path`，不回归。
- 合并顺序：`page.copy[locale]` → `site.locales[locale]` → `site.locales.en` → 内置兜底。
- `/login` 仍**不进** `PUBLIC_PAGES`（保持 noindex）；私有页判定不变。

## 7. 验收

### 7.1 单测（扩展 `check:seo`）

- 配置：默认值、合法 env、非法 JSON 回退、字段级回退、URL 归一、problems 上报。
- head：8 locale 快照，断言 title/description/keywords/canonical/9 alternates/og:url/og:locale/og:image/twitter/JSON-LD 数量与转义（含 `&"<>` 输入）。
- sitemap：页级 lastmod/changefreq/priority、xhtml alternates、XML 转义、只有 `/` 时仍是 8 条。
- manifest：字段与 icons 一一对应、`content-type: application/manifest+json`。
- robots：默认不变；`disallow`/`extraLines` 追加；拒绝 `User-agent:` 注入。
- 资产：9 个 URL 200 + 正确 content-type；未知资产 `/nope.png` → 404 且非 HTML；`.ico` 不再回 HTML。

### 7.2 集成验收

- 8 语言 head 快照（miniflare 或 staging）：每 locale 一份完整 `<head>` 原文。
- 资产 curl 记录：状态 + content-type 逐条。
- JSON-LD：`JSON.parse` 通过 + 必填字段（`@context`/`@type`/`name`/`url`/`inLanguage`）。
- 无回归：301 矩阵（大小写、`/en` 前缀）、`/login` noindex、私有页 noindex、`x-robots-tag`（复用 `apps/web/scripts/acceptance-locale-routes-local.mjs`）。

### 7.3 门禁

`check:seo`、`check:reuse`、`check:boundaries`、`check:packs`、`pnpm check`、`build` 全绿。

### 7.4 证据

8 份 head 快照、资产 curl 输出、JSON-LD 校验输出、sitemap/manifest/robots 原文；无需截图。

## 8. 成本与轮次

| 交付项 | 内容 | 轮次 |
| --- | --- | --- |
| 1 | boot 配置包（类型/默认/校验/单测）+ deployment 配置接线 + handler 顺序 spike | 0.5 |
| 2 | head 完整化 + 动态 manifest + sitemap/robots 配置化 + 单测 | 0.75 |
| 3 | 默认资产集 + assets 插件 404 修复 + 资产测试 | 0.5 |
| 4 | 集成验收证据 + 双语文档（README 中英、docs 更新） | 0.25 |
| **合计** | | **2 轮** + QA 0.5 轮 |

不加运行时依赖；不引入 Node API（资产读取全部走 `ASSETS` binding）。

## 9. 风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| R1 SPA 回落修复误伤 | 按扩展名白名单可能把 `/app/session/a.b` 类路径当资产 | 文档判定优先（`isDocumentNavigation` 先行）；白名单只列已知静态扩展名；加回归用例 |
| R2 默认资产缺失 | 配置指向不存在文件 → 404 | 资产存在性测试 + 实施清单要求九件齐全；`build` 前置检查 |
| R3 head 注入转义 | 字符串 replace 拼接可被内容破坏 | 统一 `escapeHtml` + 特殊字符单测 |
| R4 配置体积/解析失败 | 8 语言文案 JSON 变大 | fail-open 回退默认 + `problems` 上报 + 大小上限 |
| R5 manifest 路由顺序 | seo 与 assets 谁先命中 | 交付项 1 spike；assets 对 manifest 兜底 404 |
| R6 og:locale 映射错误 | 社交卡语言标注错 | 映射表单测（8 项逐一断言） |
| R7 参考模板许可 | 商业模板授权范围 | 只借结构不复制代码/图片；`THIRD_PARTY_NOTICES.md` + 文档注明（§10） |
| R8 多域名 canonical | staging 快照带 prod 域名 | 缺省用请求 origin；配置 URL 仅在显式设置时覆盖 |

## 10. 参考与许可

参考 `projects/templates/mkfast-app`（CEO 购买的商业模板，授权复用；License 为 MkImage Personal/Team/Organization License）：

| 参考 | 用途 | 适配方式 |
| --- | --- | --- |
| `src/lib/seo.ts` | metadata 构造顺序（title/description/keywords/OG/twitter/canonical/alternates + 结构化数据） | 借结构，改写为 Workers 原生字符串注入 |
| `src/lib/sitemap.ts` | lastmod/changefreq/priority + xhtml alternates | 本仓 `sitemap.ts` 已有同构实现，仅补页级字段 |
| `src/routes/manifest[.]json.ts` | 动态 manifest 字段与图标清单 | 借字段集，改为 `/manifest.webmanifest` |
| `src/routes/robots[.]txt.ts`、`sitemap[.]xml.ts` | 路由组织 | 借路由形态 |
| `src/routes/__root.tsx` | 图标 link 集合（favicon 32/16/ico、apple-touch-icon、manifest） | 借集合，不复制 |
| `src/config/website.ts` | metadata/images.ogImage 的配置形状 | 借形状，按本仓三层优先级重写 |

不复制其框架代码（TanStack Start 与 Workers 原生不同），只适配已核过的结构；许可与出处登记到 `THIRD_PARTY_NOTICES.md` 与本文。

## 11. 实施清单（给 Coder）

1. 新增 `packages/boot/dsh-base-site-seo/`：`src/index.ts`（类型 + 默认 + `resolveSiteSeo`）、`src/render.ts`（head 片段、JSON-LD、manifest、sitemap/robots 输入适配）、`tests/*.test.ts`；`package.json` 无运行时依赖、`exports` 只暴露 `.`。
2. `apps/web/deployment.example.json` / `deployment.local.json` 增加 `seo` 段（可选）；`apps/web/cloudflare.config.ts` 注入 `SITE_SEO_JSON`。
3. 扩展 `cloudflare-worker-seo`：head 表（§4.1）、`/manifest.webmanifest`（§4.2）、sitemap/robots 取配置（§4.3/4.4）。
4. 扩 `PublicPage`（§6）并保持 auth 侧零回归。
5. 提交九件默认资产到 `apps/web/public/`。
6. 改 `cloudflare-worker-assets`：资产表面 404（§5.4），content-type 校正（§5.5）。
7. 扩 `check:seo` 测试 + 集成验收证据；`package.json` 的 `check:seo` 同步新测试文件。
8. 双语 README / `docs/` 更新（本 ADR 已给出结构，实施时补「如何替换资产/如何覆盖配置」段落）。
9. 全绿：`check:seo`、`check:reuse`、`check:boundaries`、`check:packs`、`pnpm check`、`build`。
