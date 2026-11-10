# Site discovery and conversion measurement

[简体中文](seo-plugins.md) | English

Publishing, configuration and downstream extension rules live only in [AGENTS.md](../AGENTS.md#公开内容收录与商业化). This document describes implementation boundaries, not deployment or live-provider readiness.

| Capability | Implemented | Boundary |
| --- | --- | --- |
| Page SEO | Titles, descriptions, canonical, hreflang, OG, Twitter, WebSite and Organization JSON-LD | Only existing translations are linked; SEO settings cannot create routes |
| sitemap.xml | Lists published, indexable pages on the configured production origin | Staging serves an empty sitemap |
| robots.txt | Private-path rules and a sitemap pointer only when indexing is enabled | Login remains crawlable for noindex; authentication still enforces private access |
| Manifest and icons | Independent manifest, transparent monochrome whale favicons and separate installation icons | Not a publication or authentication mechanism |
| llms.txt | Site summary and real published, indexable language variants | No private conversations or fictional full-text links; no ranking guarantee |
| Plans and checkout | The Waffo Pancake panel in the workbench displays configured prices and features and restores checkout after sign-in | Checkout requires a configured payment provider |
| Entitlements | Explicit paid operations authorize on the server; platform AI rechecks before every call | Unmapped operations retain free behavior; BYOK is unchanged; stale UI state cannot bypass refunds or expiry |
| Measurement | Public page views plus first-party daily signup, first-completion, checkout and purchase counts; optional Google conversions | Defaults off; Google conversions require explicit consent; no reliable unique-user or cross-device attribution |

The base registers the workbench homepage in eight languages. Auth, SEO, sitemap, llms and page-view measurement share its public page registry. Products can register their own pages through Worker plugins. Unknown URLs and missing translations return HTTP 404.

Global settings retain one versioned D1 document, server-verified administrator access, same-origin writes and conflict detection. Page override choices come from the active registry. Removing a provider retracts its navigation and discovery links; old SEO overrides cannot republish it.

Conversions originate from confirmed outcomes: the authentication hook records registration, durable session completion records activation, and verified payment notifications with actual paid amounts record purchase. D1 batches save deduplication receipts and daily totals. Analytics failures do not undo transactions or access. Google receives no account identifiers, conversation content, visitor IP, Referer or arbitrary query values; campaign labels use an explicit allowlist. Live GA reports, Waffo Pancake merchant transactions and search indexing require separately configured operator acceptance. HTTP success does not prove reporting ingestion.

First-party conversions add per-event D1 writes; optional Google mode adds bounded outbound requests. See [implementation status](completion-status.en.md) for current inventory and the last verified deployment.
