# @dsh-base/locale-path

The **single source of truth** for public URL language prefixes. Production code may not hand-write any prefix literal (canonical `/zh-CN`, retired `/zh`, a case alias, or one of the six bare ids), and may not define its own `stripLocale` / `localizePath`; `pnpm check:locale-path` scans production sources and fails on either.

- Paths: Chinese `/zh-CN`, the other six languages under their bare id (`ja / es / fr / de / pt / ru`), English unprefixed.
- Path token ≠ locale id: `zh-CN` is the path segment and `zh` the locale id; `localeForPathSegment` owns the reverse lookup, while `LOCALE_IDS` stays the eight official ids.
- `<html lang>` / `hreflang` use BCP-47: `zh` → `zh-CN`, the other seven keep their id (`hreflangFor`).
- Case normalization: `/zh-cn`, `/ZH-CN`, `/Zh-Cn` and the six siblings (`/JA` → `/ja`) get a canonical path from `canonicalizeLocalePath` and a 301 from the caller; Chinese gets no special case.
- `/en/*` is the explicit English prefix form; `splitLocalePath` reports `needsLocaleRedirect` and the 301 target is `canonicalPath`, never a caller-joined string.
- A prefix only resolves at the outermost segment; `/assets/*`, `/api/*`, `/plugins/events`, `/sitemap.xml` and `/robots.txt` never participate.
- The retired `/zh` has no language meaning any more and behaves as an ordinary path.

Consumers: `worker-seo`, `client-locale-url` and `client-route-address` (all import-enforced by the guard until it prints `all consumers wired`). The rules live here only; change them once and all three consumers follow.
