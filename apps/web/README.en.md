# apps/web

[简体中文](README.md) | English

The generic DSH Base Web entry deploys the official DSH Web UI on Cloudflare Workers. The app owns entry points, deployment configuration and composition; capabilities live in the repository's `packages/`.

## Composition and source

- `src/client/main.tsx` passes `virtual:dsh-composition` to the client boot seam, reusing the official BootPage, loader and mount flow. Package metadata and `composition.profile.json` generate the roster.
- The root `scripts/composition/generate-worker-composition.mjs` and `generate-agent-composition.mjs` generate Worker and Think rosters. Generated files are not committed.
- All three production rosters use `scripts/composition/metadata-roster.mjs`: clients come from package metadata, the profile and official inventory; Worker/Think entries come from package metadata. `packs/` describes capability groups and L1 management scope, independently checked row for row by `check:packs`.
- Browser startup and transport support libraries live under `packages/boot/` with `dshBase.boot.kind: browser-support`. They retain client dependency boundaries and strict typechecking. Every package under `packages/client/` is an actual client plugin.
- Official source is read only from the pinned `.submodules/deepseek-harness`. Disabled official plugins remain in inventory without executable module resolvers.
- `window.__DSH_BASE_PLUGINS__` joins actual Loader fiber states to declared origins and replacement relationships. Inventory membership does not imply activation.
- Official plugins are mounted unchanged wherever possible. Seams and forks record reviewed source exports and the upstream commit in package metadata.

The Plugins page groups the components selected by the app profile and package metadata into the feature bundles defined in `packs/`. It also shows built-in settings and optional plugins from the pinned DSH release. Unadapted plugins keep their official names, artwork and descriptions, with a disabled action and an explanation. Settings → Built-in plugins shows the runtime inventory, including each entry’s availability.

The 14 added SaaS bundles contain 28 runtime components, one Client and one Worker per bundle: Waffo Pancake payments, email, Google sign-in, account profile, user management, API keys, plan access, files, newsletter, contact, notifications, Crisp support, KV cache and operations. These capabilities are implemented with local Worker and browser acceptance. External providers default off; composition activation does not mean a provider is configured, and controlled tests do not establish live payment or inbox delivery. Account, management, API key and file features reuse existing auth, D1 and R2; administrator actions still require the deployment allowlist. See the [SaaS plugin guide](../../docs/saas-plugins.en.md) for configuration and verification boundaries.

The sidebar More menu uses the marked official ui-entry-customization availability fork, preserving its layout and interaction with only Browse more plugins and Create your plugin. Custom About, support and environment rows were removed at the user's request. client-shell-extras remains disabled inventory. client-site-config now supplies the sidebar brand and site editor from the unified public document, without restoring custom menu entries.

Unadapted catalog entries carry explicit `deploymentAvailability: "not-adapted"`, separate from real errors. The official list has no per-card availability-badge slot, so the complete marked `@dsh-base/client-plugin-manager` fork adapts only this Host contract: neutral Unavailable labels match the built-in settings, and list cards omit repeated OS errors and Not installed tags. Details keep installation facts and deployment limits. Genuine loading, metadata and request failures retain official error states. The user explicitly approved this presentation difference; the original manager remains disabled inventory with no executable resolver.

## Host and storage

Better Auth 1.7.18 uses `AUTH_DB` D1. HTTP authentication limits use atomic counters in its native database backend, sharing budgets across Worker instances and restarts and rejecting authentication on database failure. `AUTH_SECRET` is a deployment secret; `AUTH_BASE_URL` must match the public origin. Email verification, password reset and Google sign-in are implemented, but email and Google providers default off. Their controls remain visibly disabled until configuration is complete. Required email verification is an explicit opt-in and is never bypassed when email is unavailable.

Session Host uses a stable `owner:<userId>:default-v49` Durable Object identity for each user, storing the session directory, workspaces, settings and tasks. Think owns the execution ledger; request IDs, per-session serialization and recovery coordinate the two. Code updates must not bypass migrations by changing storage identity. Legacy migration validates and commits the snapshot, sidecar and completion marker atomically after successful restoration.

`FILES` R2 stores workspace file versions; `CREDENTIALS_KEY` encrypts per-user credentials. The Think AI Gateway plugin provides models. Unavailable capabilities, including the complete official session permission runtime, process/PTY and log uploads, retain visible official controls with localized disabled explanations.

English uses the unprefixed `/`; Chinese uses `/zh-CN` (the other six languages use their bare id: `/ja`, `/es`, `/fr`, `/de`, `/pt`, `/ru`). Prefix rules come only from the shared `@dsh-base/locale-path` module; the retired `/zh` is an ordinary path and case variants 301 to the canonical spelling. The official locale runtime controls UI language, while URL and SEO plugins own addresses and public document metadata.

## SEO and site assets

HTML is owned by `@dsh-base/cloudflare-worker-seo`; separate sitemap, robots, manifest and llms Worker plugins own their resources, sharing the site-seo configuration and siteSettings service. The HTTP plugin dispatches by explicit request priority: auth 0, site configuration 10, SEO 20, regular APIs 100, static assets 1000. Asynchronous activation order never changes route precedence.

- The public homepage has a canonical URL, links to its eight language versions, social metadata, and `WebSite` and `Organization` JSON-LD. Downstream pages link to the translations their provider registers. Login and private pages carry `noindex` and omit canonical, Open Graph and JSON-LD metadata.
- `/manifest.webmanifest` sets a localized start URL. With production indexing enabled, `/sitemap.xml` lists published, indexable pages and `/robots.txt` links to it. On Staging the sitemap is empty and robots omits the sitemap link.
- site facts come from the site-config Worker service: a saved D1 document takes precedence; before the first save, deployment `seo` and legacy brand/link fields override shipped defaults. Editor writes are strictly validated, never silently replaced by defaults. Database failures return 503 so published configuration cannot unexpectedly revert.
- The ten default assets in `apps/web/public/` are generated with `node scripts/assets/generate-site-assets.mjs` from the pinned DSH stable exports `FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX`, sharing the sidebar whale geometry. Default favicon declarations use only the official transparent black/white SVG color-scheme pair, without competing unthemed ICO/PNG candidates. ICO and 16/32 PNG remain transparent black files for direct access and custom configurations; explicit custom resources are still advertised. Installation icons retain separate tiles. The assets include both SVGs, ICO, 16/32 PNG, Apple touch, 192/512, maskable 512 and the social image. `pnpm check:site-assets` checks provenance, dimensions and output hashes; shipped asset URLs include content versions to refresh old icons. Custom icon paths and query strings remain unchanged.
- a missing asset is a real 404 from the assets plugin: when a whitelisted extension resolves to 404 or `text/html` from ASSETS, the SPA shell is never served as an image, font or manifest.

Acceptance: `pnpm check:seo`, `pnpm acceptance:seo-local`, and `node apps/web/scripts/acceptance-locale-routes-local.mjs` (301/noindex regression).

## Dsh-base Global

Plugins → Dsh-base Global uses the official plugin-detail configuration slot and SettingsForm to edit the site name, public links, page copy in eight languages, icons, social image, manifest, robots, sitemap, llms.txt and Google Analytics. Official row configuration slots open focused editors while the aggregate view saves the same versioned document. The components listed in `packs/global/pack.json` provide branding, public configuration, editing, persistence, page SEO, discovery resources and public-page measurement. Agent presets, models, attachments and subagents belong to AI Chat; language, navigation and permissions remain in Essentials.

Signed-in users may view settings. Only verified account IDs listed in deployment `siteAdminUserIds` may save. Resolve the intended username to its immutable database ID before granting access; an empty list grants nobody access. `DSH_SITE_ADMIN_USER_IDS` overrides the list with a JSON array. IDs are passed only to the Worker, never to public responses or editable values.

`GET/PUT /api/site-settings` verifies login and same-origin writes. Saves carry `expectedRevision` and use an atomic D1 comparison; conflicts return 409 while retaining the local draft. Public `/api/site-config`, server-rendered HTML, icon links, manifest, robots, sitemap, llms.txt and measurement configuration read one document. Successful saves refresh the editor's sidebar name and localized browser title through the official session-title component. Icons and other head resources update on the next page load; other browsers use the new values on their next read. Login and session pages also use configured icons and manifest while retaining noindex and omitting public canonical/OG tags. One row in the existing AUTH_DB supports on-demand reads without polling or additional always-on services.

Before deployment, run `pnpm --dir apps/web schema:plugins` to apply repeatable table and additive-column statements owned by site settings and SaaS plugins. Existing columns are checked before additions and existing data is preserved. Normal `pnpm deploy` performs this after the release checks. New installations must also apply the existing authentication migrations. `pnpm acceptance:global-settings-local` uses the real built Worker, Better Auth and isolated D1 to check administrator saves, reader denial and consistent public output.

See the [SEO plugin guide](../../docs/seo-plugins.en.md) for component ownership, the mkfast source comparison, optional Google Analytics secret setup and measurement limits.

## Deployment and observability

The Worker enables both `traces` and Workers Logs (`logs.enabled: true`) under `observability`, so deployment acceptance has raw request/subrequest invocation evidence (for example, "zero outbound while the platform route is disabled"). Workers Logs is billed per event and adds a log cost that scales with traffic; set `logs.enabled` to `false` and redeploy to turn it off. This cf/config version does not accept wrangler's `invocation_logs` field (`cf deploy --dry-run` reports `Unrecognized key`); only `logs.enabled` is supported.

## Development and acceptance

The repository root owns one pnpm workspace containing this app and `packages/build/dsh-base-build-server-dependencies`. A single root `pnpm-lock.yaml` and one frozen install cover root tools and both members. Run from the repository root:

```sh
pnpm dsh:init
pnpm install --frozen-lockfile
pnpm dsh:verify
pnpm check
pnpm --dir apps/web build
pnpm acceptance:local
pnpm acceptance:parity
pnpm acceptance:browser-compat
```

- `build` must pass root checks before generating rosters and build output.
- `acceptance:local` runs built assets with isolated local D1/R2/Durable Objects and Chromium, checking authentication, actual plugin states and English/Chinese UI without deployed data or model calls. Evidence goes to the root `.artifacts/acceptance/local-ui/` directory.
- `acceptance:parity` compares rendered text, controls, layout, screenshots and interaction contracts with pinned official components. See the [comparison scope](tests/parity/README.en.md). Evidence goes to `dist/parity-evidence/`. Its controlled Host does not replace real Host acceptance.
- `acceptance:browser-compat` checks real PDF.js and Excel Workers, fonts, styles, preview errors and English/Chinese registration policy messages. Excel checks cover upstream XLSX compatibility fixtures, full reads of workbooks larger than 1 MiB from the workspace, and the notices distributed with browser assets.
- `CHROME_PATH` selects Chromium. `DSH_LOCAL_COMPATIBILITY_DATE` overrides only the local simulator date. For this machine's workerd, `acceptance:local` defaults to `2026-10-30`, records it in evidence, and accepts an explicit override. Deployment remains configured for `2026-11-06`.

```sh
DSH_LOCAL_COMPATIBILITY_DATE=2026-10-30 pnpm acceptance:local
```

See [completion status](../../docs/completion-status.md) and [runtime contracts](../../docs/runtime-parity.md) for current capabilities and remaining differences. Inventory coverage and scoped screenshot equality do not prove 100% product UI/UX or execution equivalence.

## Deployment

`cloudflare.config.ts` owns Worker, D1, R2, Durable Object, compatibility date and non-secret configuration. Cloudflare manages secrets outside the repository. Deployment requires Cloudflare API authorization, authentication and credential secrets, a configured model Gateway and the D1 migrations in `migrations/`.

```sh
cd apps/web
pnpm verify:release   # root checks, build, local browser and official component comparison
pnpm deploy           # rerun release gates, then cf deploy --prebuilt
```

Each deployment of the default Web app to Staging verifies the published Worker version. In the private review account file (`DSH_ACCEPTANCE_CONFIG` or the root `.artifacts/acceptance/review-account.json`), set `base`, the credentials and `workspaceIds` for two existing workspaces. Each workspace needs a reusable blank session. The browser switches in both directions, reloads, signs out and signs back in, checking the full address and session ownership with the Host. To repeat the check, run `DSH_EXPECTED_DEPLOYMENT_VERSION=<deployed-UUID> pnpm acceptance:cross-workspace-deployed`.

The root commands `pnpm acceptance:host` and `pnpm acceptance:browser` separately verify deployed model calls and transport recovery. They target the configured real deployment; local acceptance without a model does not replace them.

### Template configuration and first deployment

Run `pnpm template:init --worker-name my-dsh-app --auth-base-url https://your-real-domain` at the root to generate ignored `deployment.local.json` and random local development secrets. `scripts/deployment-config.mjs` validates configuration and `DSH_*` environment overrides; environment values take precedence. Unknown fields, including secrets, are rejected. The template never inherits the maintainer’s cloud resources.

1. Create D1 and R2 resources in your Cloudflare account and configure their names and D1 id. Existing deployments must keep the Worker name, resource ids, and `default-v49` identity stable.
2. Set the real HTTPS `authBaseUrl`. For a platform provider, configure your own Gateway DeepSeek provider credentials, set `aiGatewayId`, and explicitly enable `platformAiEnabled`. Otherwise leave it disabled and use owner BYOK.
3. Prepare independent production secrets with Cloudflare secret management: `AUTH_SECRET` (at least 32 characters), `CREDENTIALS_KEY` (32 random bytes encoded as Base64), `AUTH_REGISTRATION_TOKEN`, and `PLUGIN_CONTROL_TOKEN` (at least 32 random characters each). Never place them in deployment configuration, the repository, or the client.
4. In `apps/web`, run `pnpm exec cf d1 migrations apply <your-D1-id> --dir migrations`, then the release gates and `pnpm schema:plugins`. For first deployment, place production secrets in a permission-restricted, Git-ignored JSON file and run `pnpm run deploy:prebuilt --secrets-file /absolute/path/production-secrets.json`. `--prebuilt` publishes the exact verified output; the preceding gates and database preparation are required.
5. Subsequent `pnpm deploy` validates deployment configuration and reruns the gates. Manage added secrets through the Cloudflare CLI. Do not rotate `CREDENTIALS_KEY` to resolve a code deployment problem: existing BYOK data would become unreadable.

Public `GET /api/auth-policy` exposes safe capability state: registration, email provider and enabled/readiness flags, password reset, email verification and required-verification policy, plus Google sign-in, user management and API key extension availability. It never returns credentials or administrator IDs, and these flags grant no access to private data or administrator actions. When closed, administrators can provision a first/review account by adding `x-dsh-registration-token` to standard `POST /api/auth/sign-up/email`. This token belongs in operator scripts, never browser UI. Ordinary users cannot mutate global plugin composition; writes require both authentication and `PLUGIN_CONTROL_TOKEN`. Foreign-origin mutations and WebSocket upgrades are rejected. The historical shared acceptance account is disabled; its data is retained.

### Deployed acceptance

Remote scripts have no default server or shared account. Explicitly set `DSH_BASE_URL` and private credentials, or run `pnpm acceptance:provision` with the administrator token to create an isolated account. Credentials are stored in a restricted file under root `.artifacts/acceptance/`; only the path is printed.

```sh
# At the root; inject AUTH_REGISTRATION_TOKEN from local secret management.
DSH_BASE_URL=https://your-real-domain pnpm acceptance:provision
DSH_ACCEPTANCE_CONFIG=/absolute/path/from-provisioning.json DSH_EXPECTED_DEPLOYMENT_VERSION='<actual-deployment-UUID>' pnpm acceptance:all
DSH_ACCEPTANCE_CONFIG=/absolute/path/from-provisioning.json DSH_EXPECTED_DEPLOYMENT_VERSION='<actual-deployment-UUID>' pnpm acceptance:files
```

Replace the version placeholder with the UUID returned by this deployment command. Model acceptance first reads the Host's deployment version and lifecycle capability and submits model input only after an exact match, waiting at most 360 seconds for deferred Durable Object code updates. Omitting the version checks capability only; it cannot prove that this deployment has taken effect.

`acceptance:files` verifies official upload, atomic session receipt consumption and replay, cross-session rejection, file history and complete byte integrity. One real model call proves that the read tool can access content beyond the truncated preview.

Acceptance creates sessions, workspaces, and test files in the selected account; some flows call real models. Use a dedicated account. Normal runs do not register accounts automatically; in-script registration requires explicit `DSH_ACCEPTANCE_REGISTER=true` and the administrator token. Logs, screenshots, local configuration, secrets, and generated output stay out of Git.

Repository CI caches the single root lockfile, runs one root `pnpm install --frozen-lockfile` and workspace dependency audit, and initializes the pinned submodule. Regular CI builds and runs real local acceptance; PRs affecting UI, Host, composition, or dependencies also run the full `verify:release` gates, including official component comparison and browser compatibility. The full workflow can also be triggered manually. It does not read deployment secrets, deploy, or call paid models. The build stores the full license inventory at `.artifacts/distribution/web/third-party-notices.txt` outside the public assets directory. Browser assets carry their applicable notices.

Plugin category counts come from the independent `@dsh-base/client-plugin-counts` plugin; the app contains no count feature. Browser comparisons use the official `configLedgerSource` to connect real configuration slots. Its value is absent from the stable client entry, so the declared `./src/*` export is recorded for review on pin upgrades. The rest of the page continues to be compared with the pinned official UI.

Sidebar regression: `pnpm acceptance:sidebar-parity` compares the pinned official interface in Chinese/English, both themes and three widths. `pnpm acceptance:anonymous-sidebar` uses an isolated local Worker to verify the guest sign-in document in all eight locales and zero private requests. After deployment, rerun anonymous acceptance with an explicit `DSH_BASE_URL` and use a dedicated account for `pnpm acceptance:authenticated-sidebar`, confirming real directory reads without changing sessions or settings.
