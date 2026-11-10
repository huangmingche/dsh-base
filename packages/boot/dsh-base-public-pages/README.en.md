# @dsh-base/public-pages

Shared public document and metadata route registry for auth, SEO, sitemap, manifest and llms plugins. It installs no HTTP handler and does not publish pages itself.

`PUBLIC_PAGES` currently registers only `/`; `@dsh-base/locale-path` owns language prefixes. SEO configuration describes registered pages without granting public access to new paths. Login and private product routes are excluded from indexing.

`PUBLIC_RESOURCES` explicitly registers sitemap, robots, manifest and llms. The former two use root paths; the latter two support canonical locale prefixes. Matching is exact and never grants a directory prefix. Each independent Worker producer owns its real response; absent producers are not simulated.

Verify with `node --experimental-strip-types packages/boot/dsh-base-public-pages/tests/public-pages.test.ts`.
