# @dsh-base/client-locale-label

Complete marked fork of pinned `@deepseek-ai/dsh-client-locale` (commit
`9c2670d3bce5275e0d1610272958121af87787bb`, MIT). The built-in `zh`
display label changes from “中文” to the explicitly requested “简体中文”. The
internal locale id stays `zh`; the persisted preference, `/zh-CN` route, language
selector, dictionaries and RPC contracts remain the official implementation.

This is a user-authorized display-name deviation; no user data is migrated
or rewritten. It is traceable through `dshBase.forkOf` / `dshBase.reuse.gaps`.

Global site titles enter through the official `LocaleFace` installation point.
`client-site-config/title-face` projects only the renderer's
`common/brand.localBuild` key from published titles, falling back from the active
language to English and then the site name. Before public titles arrive it
delegates to the original translation, as it always does for every other key
and namespace. Dictionaries stay unchanged; no duplicate dictionary or second
locale face is installed. The unchanged `AppFrame` / `DocumentTitle` continues
to own document titles and session-name prefixes. The adapter combines locale
and public-title subscriptions and releases both when disposed.

`siteConfig` is an explicit injected dependency. It has no locale dependency and
does not await public HTTP at startup, so concurrent composition can provide it
before locale-face installation without a service cycle.

`pnpm check:locale-fork` compares every `src/` file with the pinned official
package and allows only the Config schema export, Chinese label, and three
title Host integration edits. Any extra difference or a `forkOf.commit` that
does not match the pin fails. Follow ADR §9.5 when bumping the pin. Title and
subscription regressions live in `client-site-config/tests/title-face.test.mjs`.
