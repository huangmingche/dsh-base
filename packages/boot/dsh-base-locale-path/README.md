# @dsh-base/locale-path

公开 URL 语言前缀的**唯一真源**。生产代码不得手写任何前缀字面量（规范值 `/zh-CN`、退役值 `/zh`、大小写别名或六种裸 id），也不得自造 `stripLocale` / `localizePath`；`pnpm check:locale-path` 会扫生产源并报红。

- 路径：中文 `/zh-CN`，其余六种 `ja / es / fr / de / pt / ru` 各加裸 id 前缀，英文无前缀。
- 路径 token ≠ locale id：`zh-CN` 是路径段、`zh` 是 locale id，模块提供 `localeForPathSegment` 反查；`LOCALE_IDS` 仍是 8 个官方 id。
- `<html lang>` / `hreflang` 用 BCP-47：`zh` → `zh-CN`，其余 7 个同 id（`hreflangFor`）。
- 大小写归一：`/zh-cn`、`/ZH-CN`、`/Zh-Cn` 等由 `canonicalizeLocalePath` 生成规范路径，调用方 301；其余六种同样（`/JA` → `/ja`），不给中文开特例。
- `/en/*` 是英文前缀形态，`splitLocalePath` 返回 `needsLocaleRedirect`，301 目标直接用 `canonicalPath`，调用方不许自己拼。
- 前缀只解析最外层；`/assets/*`、`/api/*`、`/plugins/events`、`/sitemap.xml`、`/robots.txt` 不参与前缀解析。
- 退役的 `/zh` 不再有语言语义，按普通路径处理。

消费者：`worker-seo`、`client-locale-url`、`client-route-address`（三者均由守卫强制 import，`all consumers wired`）。前缀规则只有这一份，改这里，三个消费者同时生效。
