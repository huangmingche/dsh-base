# Current implementation and acceptance status

[简体中文](completion-status.md) | English

This page describes the pinned source and the limits of its plugins. Deployment and acceptance records were added after the checks took place. Each result applies to the dated build it identifies. All times are Beijing time.

The working tree pins `dsh-v0.2.2-rc.5`. The source review covers seven changed upstream packages, all 16 fork sources and the declared source entries. The primary change is model-aware search provider selection. Workers exposes the official settings UI and its localized unavailable state. Offline providers covered eight routing cases, checking both readiness and dispatch without calling a model or search API. [RC5 upgrade comparison](official-differences.en.md#rc5-upgrade)

This reconstructed revision includes subsequent fixes. Its commit date identifies the upstream adaptation. Later Staging deployments and their acceptance results are archived separately under their actual execution dates.

## Historical rc.4 Staging deployments

On November 18, 2026 at 14:20 Beijing time, Staging deployed official `dsh-v0.2.2-rc.4`. Cloudflare Worker version `3d28bfe0-9318-440a-9384-238302b59d85` received 100% of traffic at rollout. The complete `verify:release` command exited with status 0. The browser entry matched the local build's SHA-256, and the isolated acceptance account reported the same Worker version. [Release comparison](official-differences.en.md#rc4-upgrade)

The live catalog for that version listed 141 client entries. The official Team and account notifications clients were active. Chat import appeared as an unavailable optional plugin. Guests could browse plugins and automation tasks, with sign-in requested when creating a session. Guest and isolated-account checks covered 23 owned bundles, 90 components and 12 public documents. All 83 public page and SEO assertions and all eight pricing browser cases passed. Staging served `noindex` with an empty sitemap. The payment provider was unconfigured. The checks created no orders or paid inference requests.

At 15:53:54 Beijing time that day, Staging deployed the plugin toolbar zoom fix in Worker version `3996c150-35ba-4e47-9456-a1a8c28a08bf` and routed 100% of traffic to it. The browser entry and navigation script matched the local build’s SHA-256 hashes. In the Chinese interface at a 993 CSS pixel viewport width, 2× display density and 110% browser zoom, all 108 pointer hit tests passed before and after scrolling. A guest could refresh the page’s plugin list, open the sign-in dialog with Add plugin, and use the arrow to see both installation methods.

At 19:25:35 Beijing time that day, Cloudflare routed 100% of Staging traffic to `7cbd01e9-91a1-4615-90ba-b402e3d29f7b`. The full release checks passed, and the isolated account’s Host reported the same version. In a real browser, the account saved a test DeepSeek API key and saw only a fixed mask after reloading. After pressing Delete and saving, both a second reload and a Host query confirmed the key was gone. The test issued zero model requests. Workspace search found an existing file and omitted it when its path was excluded. Guest requests for credential status and workspace search both returned HTTP 401. Local workerd tests covered 2,000 excluded files and nested ignore rules.

The first public HTML response after the traffic switch still referenced the previous release’s entry script, and the live toolbar check failed. At 19:27, direct requests to `/`, `/zh-CN` and `/zh-CN/` all returned the new entry, its SHA-256 matched the local build, and all 108 toolbar hit tests and 83 public page and SEO assertions passed.

At 20:47:52 Beijing time that day, Staging deployed the authentication fix as `daf68fbf-83ea-4e3f-9e11-0e109db1a70a`. The 6,766 requests observed through 20:51:30 included zero 5xx responses from authentication endpoints.

Local RC4 sidebar acceptance covered English and Chinese, light and dark themes, and expanded, collapsed and mobile layouts. All 24 screenshot pairs of the main sidebar and More menu matched the official UI pixel for pixel. In expanded and mobile layouts, keyboard interaction also moved Automation tasks into More and pinned it back. All 13 sidebar and workspace regressions passed, including anonymous sign-in requests from both workspace pickers. `pnpm acceptance:sidebar-parity` writes the browser report to `apps/web/dist/parity-evidence/sidebar-navigation/report.json`.

The local Workers build passed acceptance for the sign-in dialog, account launcher, global settings, SaaS and SEO. The account launcher covered eight locales with 85 screenshots. Saved site settings persisted after reload, and a regular account received `403` on write. SaaS acceptance covered 112 UI cases, 14 plugin bundles, cross-account file isolation and email confirmation using mock providers. SEO acceptance covered eight locales, ten icon assets and 20 route checks.

## Plugins and provenance

The base provides the workbench and its localized homepage. Plans and checkout are available in the Waffo Pancake workbench panel. Deployment observations below describe the builds tested at the time.

The only official source is `.submodules/deepseek-harness`, pinned to `dsh-v0.2.2-rc.5`, commit `9c2670d3bce5275e0d1610272958121af87787bb`. App entries only boot and dispatch generated compositions; product capabilities live in plugins.

| Current declaration scope | Count and meaning |
| --- | --- |
| Owned runtime components | 87: Client 48, Worker 32, Think 7. This includes enabled, disabled and explicitly unavailable declarations, not 87 available features. |
| Owned reuse decisions | 16 forks (Client 13, Worker 3), 12 compatibility seams and 59 custom plugins, counted by `dshBase.reuse.mode`. Seams are not forks. |
| Owned origin classification | 16 `origin: fork` and 71 `origin: custom`; the latter comprises 12 seams and 59 custom plugins. Origin and reuse mode are distinct dimensions. |
| Official Client declarations | 92: 58 declared enabled and 34 declared disabled. These include API, service and UI plugins, not 58 UI pages. Disabled rows remain inventory without runtime module resolvers. |
| Official Client replacements | 13 enabled owned forks replace official originals through `replaces`; originals remain disabled. These forks are separate from the 58 enabled official rows. |
| Display groups | 21 logical bundles cover all 87 owned components. Grouping neither selects production members nor implies dynamic installation support. |
| Browser support libraries | `client-core`, `client-session-host`, `client-saas-ui` and `client-browser-compat` live under `packages/boot` with `browser-support` metadata. They provide startup, transport, shared UI components and browser compatibility support; they do not independently deliver product features and are not part of the 87 runtime plugins. |

Counts come from `readClientMetadataRows` and `loadOwnedPluginInventory`, projecting current metadata, profile and packs. `forkOf` records the source package, path, pinned commit and license; a fork's composition `origin` must agree with its provenance. Re-audit forks and recorded `./src/*` exports whenever the official pin changes.

Schedule now uses the complete marked `@dsh-base/client-schedule` fork, rather than mounting the original package directly. Its sole Host extension is `onBeforeCreate` before manual creation: the anonymous page requests sign-in, while the authenticated path omits the callback and retains official behavior. Plugins likewise uses the marked `client-plugin-manager` fork for the real component inventory, approved unavailable states and separate operation permissions.

## Implemented scope and limits

| Area | Implemented | Remaining boundary |
| --- | --- | --- |
| Authentication and sidebar | Better Auth + D1; clickable entries in both states. Plugins and automation can be browsed first; session, workspace and account actions request sign-in. The anonymous workspace list is empty. | Public declarations contain no private tasks, configuration or account activation state. Server authorization remains independent. Signup follows deployment policy; external login and mail features must not be described as configured. |
| UI and login | Official layout, components, icons and interaction are retained with Host adaptations in forks. The shared login dialog retains the local account flow and directly composes official Modal, Button and Input, removing the former ChatGPT visual overrides (verification versions and scope are recorded below). | The local account flow differs from official Platform authorization and is recorded in package metadata. Passing scoped comparisons does not establish whole-product 100% UI/UX equivalence. Other gaps are recorded in [official differences](official-differences.en.md). |
| Plugin management | 87 components in 21 groups, with visibility, runtime status and operation permissions kept separate. Required and deployment-managed components are read-only; optional controls follow management scope. | Dynamic installation, upgrades, physical removal and production plugin HMR remain unavailable. An active plugin may only expose an unavailable capability. |
| Site and SEO | Dsh-base Global uses one site document with administrator editing, saving and conflict handling. Page SEO, sitemap, robots, manifest, llms.txt and Google Analytics are separate plugins. | GA is off by default; actual report ingestion requires operator configuration and verification. Measurement includes public page views and first-party daily conversion totals; optional Google conversions require explicit consent. Crawl directives do not replace authorization. See the [SEO plugin guide](seo-plugins.en.md). |
| Sessions, models and permissions | Official conversation UI connects to Workers/Think; model and effort persist; Gateway and BYOK routes are separate; server checks enforce permissions, approvals and storage isolation. | Think is not the complete official Agent executor. Inference, billing, recovery and historical evidence require their own test and deployment scope; sidebar acceptance does not establish them. |
| Session header actions | Unchanged official Markdown copy, ZIP download and feedback menu; a Worker seam adapts owner-scoped saved events and admitted attachments. Native-open entry remains visible. | RC4 places Open in app in the Session header and row context menus. Local application launch and feedback submission remain unavailable. ZIP requires a valid official lifecycle snapshot; unsupported legacy logs fail explicitly. No native events or descendants are invented. |
| Workspaces and files | Persistent logical directories, workspace isolation, ordinary uploads and official browser preview. | No native process filesystem. Image processing, Agent PDF/Office understanding and PTY/terminal execution retain explicit gaps. |
| Automation and presets | Durable scheduling and the official task UI; four official preset declarations are readable, with Cloudflare Think as the actual default composition. | Official Standard/PTC/Minimal/Cordis execution is not integrated. Readable declarations do not imply executable presets. Anonymous task browsing does not read private tasks. |
| Subagents | `cloudflare:think:subagent` remains a declaration and compatibility export with `availability: unavailable`. | No `delegate_task` is registered and execution refuses. Neither the component count nor the compatibility export establishes subagent support. |

The 14 SaaS capabilities added 28 runtime components included in the 00:49 Staging deployment on 2026-11-18 (Beijing time). External vendors default off. [SaaS plugin guide](saas-plugins.en.md)

## Multi-application changes and follow-up review on 2026-11-18

The repository declares independently deployed Workers Web applications in `dsh.apps.json`, isolating profiles, generated outputs, dependencies, configuration, local state and cloud resources by application. Shared plugins remain in `packages/`; applications only provide entries and composition. Only `web` is registered by default. A second application is verified in a temporary source snapshot, rather than added as a product example. This does not implement native mobile clients, desktop installers or cross-application accounts. The shared contract remains in [AGENTS.md](../AGENTS.md#multi-application).

Pre-commit review fixes rollback after application creation fails: opened or truncated files are tracked, composition metadata is restored, and only empty directories created by the attempt are removed. A failed creation can then be retried. All 61 engineering, downstream-update and build regressions pass. Payment-plugin reuse metadata and both READMEs now record the approved public pricing page and actual verification limits.

Insufficient disk space interrupted some report and screenshot writes. User-authorized cleanup removed rebuildable caches and confirmed obsolete temporary files, preserving source, databases, personal files, sign-in state and acceptance evidence. Acceptance finalizers now release remaining resources even if report writing or browser shutdown fails; seven syntax checks and ten injected-failure cases pass. Original failure logs and complete retries are retained separately; environment failures are not counted as passes.

The complete `pnpm --dir apps/web build` passes source verification, reuse, runtime boundaries, pack coverage, strict types and regressions. Strict checking covers 471 Client and 141 Worker/Think source files; 17 Worker JavaScript modules parse. Real local workbench, authentication, eight-language account launchers, global settings, browser compatibility, SaaS, public content and SEO acceptance pass. A fresh `pnpm acceptance:multiapp` verifies the independent second application's build, actual browser composition and anonymous private API `401` responses. The temporary application is removed afterward and dependency source is unchanged. These results do not establish fresh dependency installation, live external-provider behavior, GitHub Actions execution or remote deployment acceptance.

All 23 original visual and interaction comparison scripts ultimately exit 0, retaining every scenario and assertion. Scripts interrupted by insufficient disk space are rerun in full after cleanup. The plugin-manager retry covers 84 cases and 100 scrolling viewport comparisons. Scripts run with isolated build and evidence directories; grouped execution is not reported as one successful `verify:release` invocation or as complete product equivalence.

Evidence for that review is in `.artifacts/precommit-20261118-final/validation-summary.json`, with second-application browser evidence under `.artifacts/multiapp-acceptance/`. The high-severity picomatch advisory blocked the commit at the time. The subsequent fix covered the shared dependency and the copy embedded in the Cloudflare CLI. The full dependency audit passed. See [Dependency security checks](security-dependencies.en.md).

## Earlier pre-commit review on 2026-11-18

That review used the local worktree. App entries booted the generated composition, and the pinned official submodule stayed clean. Reuse provenance, runtime boundaries, pack coverage, dependency contracts and official UI coverage passed. Known product differences are recorded in this document.

- The public-content package now declares the valid `./server-render` export. Build tooling resolves the SSR entry through that declaration; actual content builds and export-boundary regressions pass.
- Address restoration joins the official navigation cancellation contract. Old restoration cannot override a later panel, Session, Workspace or history selection. Metadata updates no longer appear as navigation, and the official startup still owns home restoration. All 21 regressions using the real official services and an independent review pass. In a real browser, a blank-Session restore is held until after opening Plugins; releasing the real response leaves the panel intact throughout a 12-second observation. Deep links, reloads, history and invalid addresses also pass. Evidence is under `.artifacts/precommit-route-address-final-20261118/`.
- Authorization reads a session once per request and rechecks on the next request. Database read failures return `503 auth_unavailable`; genuine guests and revoked sessions remain denied. Internal checks do not renew cookies that they cannot return, and HTTP dispatch preserves typed failures without falling through. Actual workerd/D1 fault, revocation and response regressions pass.
- Historical SEO overrides for withdrawn pages can be read and explicitly removed. Writes still validate published paths, administrator authority and revisions; they cannot republish withdrawn pages.
- Purchase conversion uses signed payment events' actual `chargedAmount`, matched against the queried payment. Missing or mismatched information produces no reported revenue. Late client cancellation responses cannot overwrite a new account's checkout intent. Payment, analytics and entitlement regressions pass.
- Deployed-acceptance canonical locale addresses now use the shared path utility. Deliberate legacy redirect cases retain their explanation; the locale-path guard passes.

The complete `pnpm --dir apps/web build` and final strict typecheck pass: 471 Client and 141 Worker/Think files, with 17 Worker JavaScript modules. Local full-workbench, authentication, eight-language account launcher (85 screenshots), global settings, browser compatibility, public content, eight pricing cases and SEO acceptance pass. SaaS additionally passes 112 visual cases and real local Worker flows for 14 plugins. Anonymous private-data access remains denied. Real external provider and model calls are outside this review. Evidence is under `.artifacts/precommit-20261118/`; these are local results, not GitHub Actions execution or a Staging update.

Official visual and interaction comparison covers all 23 scripts in `acceptance:parity`, with every original scenario and assertion passing. After the first seven completed, the sequential scheduling shell was deliberately stopped. The remaining sixteen ran in three groups with independent build and evidence directories, all exiting 0 on their first execution. The interrupted original command is not reported as exiting 0. Coverage and results are recorded in `.artifacts/precommit-20261118/parity-summary.json`. Runners missing directory overrides gained the same environment interface without changing defaults; subsequent 131-case conformance, locale-path and diff checks pass. Stale inventory counts and whale dimensions in the acceptance README were corrected in both languages.

That review paused the commit after the audit found one high-severity vulnerability in `picomatch@4.0.7`. See the subsequent [fix and verification](security-dependencies.en.md).

## November 17, 2026 local acceptance of public content and commerce on an earlier rc.1 build

On 2026-11-17, the purchased `mkfast-template` informed plugin adaptations for content collections, actual translations, pricing and checkout restoration, server-side entitlements and conversion summaries. Public content and blog groups are added; the original workbench and pinned official source remain unchanged. The Staging deployment record for 00:49 on 2026-11-18 (Beijing time) gives the live acceptance scope and limitations for these changes.

- `pnpm --dir apps/web build` passes all repository checks and production compilation, strictly checking 470 Client and 141 Worker/Think source files and parsing all 17 deployable Worker JavaScript modules. `pnpm acceptance:local` verifies authentication, Sessions, plugin management, exports and settings using real local D1, R2, Durable Objects and a browser. Anonymous browsing issues no private requests or WebSockets, with zero external model calls. A dedicated compatibility plugin supplies the truthful empty native-application catalog while retaining the official disabled entry.
- A public page registry supplies routing, SEO, sitemap, llms and measurement. Production indexing requires explicit opt-in; Staging stays unindexed and legal drafts remain unpublished. Real 404s cover unknown pages, missing translations and missing assets; canonical redirects cannot escape to another origin.
- New public pages directly use official Markdown, Button, FishLogo and themes, with browser checks for languages, themes, widths and actual plugin activation. Pricing passes eight browser cases. Disabling the analytics plugin in the composition prevents its code and requests from starting.
- Four language/theme/width settings cases pass 56 section visits and 24 exact pixel comparisons, including explicit saving, scoped reset and read-only access. Additional regressions cover disabled publishers, downstream output-path escapes, authoritative payment deduplication and rejecting protected calls after refunds or expiry.
- Local SEO acceptance verifies eight existing locale entries, ten site assets and twenty route guards, and checks actual public documents for server-rendered body content and real translations.

Evidence: `.artifacts/final-build.log`, `.artifacts/final-local-ui.log`, `.artifacts/final-public-content.log`, `.artifacts/final-seo.log`, `.artifacts/settings-parity-audit.log` and `.artifacts/public-content-evidence/`. Live Waffo Pancake merchant transactions, Google report ingestion and search-engine indexing still require configured external acceptance; local tests do not establish that these services are enabled. The new document layout is a user-approved extension, not an existing upstream page.

## RC1 local acceptance of the Session menu change

The Session header repair passed local verification on 2026-11-17 and was included in the 00:49 Staging deployment on 2026-11-18 (Beijing time). It enables the unchanged official `dsh-session-log-export`, with compatibility plugins for Worker exports and Client/Worker native-application availability. The pinned official source remains untouched.

- `pnpm --dir apps/web build` passed, including all repository checks, strict types, reuse provenance, runtime boundaries, group coverage, security and export regressions. All 17 deployable Worker JavaScript modules parsed successfully.
- `pnpm acceptance:session-menu` passed: eight English/Chinese, light/dark, desktop/narrow cases with 32 exact official pixel comparisons, plus keyboard, copy, download, error, feedback and native-application availability checks.
- `pnpm acceptance:local` passed against the real local Worker, D1, R2, Durable Object and Chromium. It verifies official plugin activation, the command catalog, complete Markdown written to the clipboard, an actual downloaded and decoded ZIP, and disabled feedback submission. Existing two-language sidebar, rightbar, settings and Session regressions also passed without external model requests.
- Server regressions cover anonymous/cross-account isolation, same-Session attachment admission and integrity, HEAD, cancellation, official-format restoration of ordinary and forked Sessions, tool events, command idempotency and real Cordis optional-injection lifecycles. ZIP export rejects legacy Sessions without reliable lifecycle evidence while Markdown remains readable; this does not establish complete native Agent journal equivalence.

Evidence: `.artifacts/session-menu-build.log`, `.artifacts/session-menu-parity.log`, `apps/web/dist/parity-evidence/session-menu/report.json`, `.artifacts/session-menu-local.log` and `.artifacts/acceptance/local-ui/report.json`. This live acceptance did not export Sessions; the download and interaction conclusions above remain based on real local acceptance.

## Historical Staging verification on November 18, 2026 at 00:49

Version `cc4a884b-aebc-4750-bbea-0c87f0225e52` was deployed to <https://dsh-base-staging.jacksonai.workers.dev> at 00:49 on 2026-11-18 Beijing time. Cloudflare reported 100% traffic for that deployment. The authenticated Host returned the same version, and the public asset SHA256 values matched the local build. Additive schemas succeeded without resetting the database. No commit or push was made.

**The 00:49 deployment succeeded. Some acceptance checks failed.**

| Scope | Observed result |
| --- | --- |
| Pre-deployment gates | Full build, repository rules and strict types, real local account/storage/Session tests, official UI comparisons, browser compatibility, SaaS, public content and SEO checks passed. Stale sitemap expectations, hard-coded inventory totals and initialization waits were corrected, then failed steps and remaining gates were completed; original failure logs remain. |
| New plugins | Anonymous English desktop, anonymous Chinese mobile and authenticated Chinese desktop each traverse 23 bundles and 90 components. New plugin origins and active fibers match. The final strict script retains `ok: false` because a subsequent authorization audit failed. |
| Public pages | The home entry and six public documents are registered. All 12 English/Chinese document variants have real first-response content and hydrate; 13 public JS/CSS assets match the build. Legal drafts, unknown routes and missing translations return real 404s. |
| SEO | 73 anonymous GET/HEAD requests and 83 checks passed: canonical, actual-language hreflang, blog structured data, robots, llms.txt, manifest and icons. Staging remains noindex with an empty sitemap. Private navigation requires login and private APIs return 401 anonymously. |
| Pricing and login entry | The final isolated run passes eight language/theme/width cases. Waffo Pancake is disabled with zero plans; the page reports unavailability without invented prices, orders or purchase buttons. Real checkout and purchase restoration were not exercised. |
| Data and access | Only one exact existing blank-Session restore was allowed and it returned the same ID. Session, list, workspace, history and permission fingerprints were unchanged. No new Session, business configuration change, payment or model call was performed. |

The 00:49 deployment had the following acceptance findings.

- In this version, `client-route-address` could override a Plugins panel the user had just opened. The local fix and regression tests recorded above followed this deployment.
- At 00:51:12.770 Beijing time, `GET /api/auth/get-session` returned one 503 confirmed by platform logs; the complete pricing recheck did not reproduce it. Between 01:03:33.758 and 01:03:52.183, an authenticated `permissionSnapshot` returned one 401; a later audit using the same cookie succeeded. The cause remains unknown. These failures are not reported as fixed, and the final strict script was not repeatedly rerun until passing.

Release evidence: `.artifacts/staging-publication-release.json`, `staging-deployment-after.json`, `staging-schema-plugins.log` and `staging-release-*.log` (all under `.artifacts/`). Live evidence: `.artifacts/acceptance/publication-staging/cc4a884b-aebc-4750-bbea-0c87f0225e52/report.json`, `.artifacts/acceptance/pricing-staging/summary.json` and `.artifacts/acceptance/plugins-staging-new/summary.json`. Failed attempts remain in the corresponding `attempt-*` directories. Google report ingestion and search-engine indexing were not externally verified.

### Historical verification of the previous whale size correction

The verified version on 2026-11-17 is `ec6286dc-6606-463d-a7f7-4639606bca17` at <https://dsh-base-staging.jacksonai.workers.dev>. The user-approved optical correction renders Dsh-base whales at 24px width in plugin cards, bundle details and component details, and 20px in component rows. The official 36/30px artwork slots and 48/40px frames remain, with the original silhouette centered at its native aspect ratio. Cloudflare and original official artwork, page CSS and permissions are unchanged.

Full repository checks, production build and final strict typechecking passed. Four English/Chinese light/dark cases traverse 21 bundles and 83 components, checking silhouette dimensions, aspect ratio, both levels of centering and exact official `FishLogo` pixels across four surfaces; dynamic themes and artwork normalization/restoration also pass. Read-only Staging checks on Chinese dark desktop and English light mobile traverse every bundle and component, confirming the corrected dimensions for 16 Dsh-base bundles and 56 Dsh-base components with no page errors, failed requests or business writes. The deployed entry matches the local build and the exact version serves 100% traffic.

Evidence: `.artifacts/whale-size-build.log`, `.artifacts/whale-size-types.log`, `.artifacts/whale-size-ui.log` and `.artifacts/acceptance/whale-size-staging/`. This corrects applying padded plugin-canvas dimensions directly to the whale's tightly bounded viewBox. It is a user-approved brand adaptation, not a claim that upstream defines a whale-plugin size.

### Historical verification of the previous login-hint simplification

The verified version on 2026-11-17 is `d8adb385-db7d-4b0f-b9a0-0f71db09a6e1` at <https://dsh-base-staging.jacksonai.workers.dev>. At the user's request, the login dialog removes the repeated provider-unavailability paragraph and its description reference. Buttons retain official disabled styling and localized hints; Google availability remains server-controlled. The change stays in the existing login plugin and is recorded as a user-approved flow deviation.

Full checks and production build passed, along with eight dialog cases, 56 official-primitive pixel comparisons and eight email/Google flow checks. Four read-only Staging cases across English/Chinese and desktop/mobile verified the removed paragraph, three disabled buttons, normal divider spacing and Escape dismissal, with no page errors, failed requests or business writes. Deployed assets match the local build and the exact version serves 100% traffic. Evidence: `.artifacts/auth-provider-hint-build.log`, `.artifacts/auth-provider-hint-parity.log`, `.artifacts/auth-provider-hint-email.log` and `.artifacts/acceptance/auth-provider-hint-staging/`.

### Historical verification of the previous Waffo Pancake naming release

The verified version on 2026-11-17 is `f97490a9-0c0f-4e1c-bb23-269c7be257b2` at <https://dsh-base-staging.jacksonai.workers.dev>. The payment plugin now consistently uses **Dsh-base Waffo Pancake payments** (**Dsh-base Waffo Pancake 支付** in Chinese). Bundle and Client/Worker component names, plus payment copy in all eight languages, use the full product name. Technical identifiers, payment behavior and permissions are unchanged; the official plugin manager layout and site whale remain in use.

Full repository checks, 86 SaaS regression tests and the production build passed, along with four English/Chinese light/dark plugin-artwork comparisons. Four read-only Staging cases across both languages and desktop/mobile verified the full name in the list, detail and both components, and matched the deployed entry to the local build. Eight private endpoints still reject anonymous reads, registration remains closed and payments retain their unconfigured state. Cloudflare confirmed 100% traffic on this exact version.

Evidence: `.artifacts/waffo-pancake-build.log`, `.artifacts/waffo-pancake-ui.log`, `.artifacts/acceptance/waffo-pancake-staging/report.json` and its adjacent `version.json`. This naming correction does not expand payment-provider verification.

### Historical verification of the previous plugin artwork release

The version verified on 2026-11-17 is `78f25ed3-e9d6-4bfa-83ab-84920b328aa7` at <https://dsh-base-staging.jacksonai.workers.dev>. All 16 Dsh-base bundles and 56 Dsh-base components use the same official whale source as the website. Five Cloudflare bundles, 27 Cloudflare components and original official artwork stay unchanged. The inventory remains 21 bundles and 83 owned components; no capability or permission changes are introduced.

- Full repository checks and production build pass, with a clean pinned upstream checkout and the complete plugin-manager fork source guard passing. Artwork metadata is generated from pinned stable exports. Only the exact owned image maps to the official component; other SVG retains official image isolation.
- Four en/zh light/dark cases cover every bundle and component. List, bundle detail, component row and component detail directly match official `FishLogo` pixels. Opposite system/manual themes, live theme switching and legacy parity normalization/restoration pass. The focused test is part of the continuing parity gate.
- Staging Chinese dark desktop and English light mobile cases traverse every bundle and component. Whale shape and ink match the sidebar, while Cloudflare images remain unchanged. There are no page errors, failed requests or business writes. Entry assets match the local build and Cloudflare confirms the exact version receives 100% traffic.

Evidence is in `.artifacts/whale-icons-build.log`, `apps/web/dist/parity-evidence/owned-plugin-artwork/report.json`, `.artifacts/acceptance/plugin-artwork-staging/report.json` and its adjacent `version.json`. This verification covers the user-approved branding change only and does not extend live SaaS vendor verification.

### Historical verification of the previous SaaS plugin release

The version verified on 2026-11-17 is `22e18ce1-5cbe-49be-8bc2-6e54cd74192e` at <https://dsh-base-staging.jacksonai.workers.dev>. This release implements the 14 selected SaaS capabilities (1–8, 14–18 and 28) as 14 Client and 14 Worker plugins. The current inventory contains 21 logical bundles and 83 owned runtime components. New panels fill official configuration slots and reuse official components; the pinned upstream checkout remains clean and the app remains a composition entry.

| Verification | Result and scope |
| --- | --- |
| Source and build | Full repository checks and production build pass. Final strict checks cover 449 Client and 123 Worker/Think source files; all 86 SaaS regressions and 1,209 official export checks pass, and 17 Worker JavaScript modules parse. |
| UI and interaction | All 112 new SaaS browser cases and all 21 original official UI comparison scripts pass. Parallel continuations use separate build directories with the original assertions and complete script coverage preserved. |
| Real local composition | Temporary D1, R2, KV and Better Auth verify profile saving, owner-isolated files, API-key creation/use/revocation, administrator permissions and configured contact/newsletter flows. All 29 Worker fibers and 14 new Client fibers are active with correct origins. Plugin schemas are repeatable. |
| Existing release gates | Full local UI, ten real-auth groups, eight-locale account launchers, global settings persistence and browser compatibility pass. Expected member 403 responses on two administrator endpoints are explicitly checked, not counted as successful data reads. |
| Staging | Four en/zh desktop/mobile cases open all 14 new panels and find 21 bundles; eight screenshots and the entry asset match the verified build. No page errors, failed browsing requests or business writes occur. Eight private endpoints return 401 anonymously, signup remains closed and unconfigured payments remain unavailable. Cloudflare confirms the exact version above receives 100% traffic. |

Evidence is in `.artifacts/saas-parity-complete.json`, `.artifacts/saas-ui-browser/report.json`, `.artifacts/acceptance/saas-local/report.json` and `.artifacts/acceptance/saas-staging/`, consolidated in `.artifacts/saas-release-report.json`. Deployed acceptance is anonymous and read-only; account writes and vendor failures are verified in the real local runtime with controlled provider fixtures. External vendors default off. Live Waffo merchant sandbox, Google OAuth, email delivery, notifications and Crisp still require operator configuration and acceptance. This is not a claim of complete official execution equivalence.

### Historical verification of the previous anonymous Models page

The version verified on 2026-11-17 is `ae511dc9-f3d7-43ba-ba38-e8cf1ea90cda` at <https://dsh-base-staging.jacksonai.workers.dev>. Anonymous Models replaces the custom read-only list with the existing marked official Models fork: provider cards, read-only API key forms, customized settings, close/edit and Add provider interactions. Public schema/defaults share one source with the Host; credential and Gateway state remain unknown, and management requests local sign-in. No runtime plugin or private permission is added.

- Full checks and production build pass, including 1135 official exported imports and three fork source/resource guards. The final credential-presentation adjustment also passes strict Client typechecking.
- 28 default Models whole-section cases directly match the pinned original. Eight anonymous read-only editor cases each compare three stages, for 52 direct DOM, style and pixel comparisons. Two compact-row credential guards and two final editor-unknown-state checks pass. The whole anonymous presentation is a user-approved extension, not upstream's original signed-out page.
- Local integration passes eight locales, 85 screenshots and six anonymous model/credential API 401 checks. All 30 anonymous browsing cases pass with zero private requests, WebSockets or page errors. Existing BYOK save regressions and eight Gateway style/state cases pass.
- Four Staging en/zh desktop/mobile cases and eight screenshots pass, with the entry asset matching the verified build. Nested login closes and restores focus, with no private requests or business writes. All 13 Client forks have correct origins and active fibers with originals disabled; the exact version matches, eight private endpoints return 401 anonymously and registration remains closed.

Evidence is consolidated in `.artifacts/acceptance/anonymous-models-parity/report.json`; see [ADR-0005 section 22](dsh-base-ADR-0005-anonymous-more-menu.en.md) for the presentation contract. Public model declarations do not prove configuration or availability. No live inference was executed, and this is not a whole-product UI/UX equivalence claim.

### Historical verification of the previous full account layout

The version verified on 2026-11-17 is `f629c32f-0fd3-4e5a-9d84-2aa788c9be57` at <https://dsh-base-staging.jacksonai.workers.dev>. Account content retains the complete official identity, account information, balance, bonus, usage and top-up layout. Genuine anonymous state uses official signed-out copy; only Platform operations are dimmed and have no navigation. The separate lower Dsh-base sign-in still uses the official Button. A complete marked account-plugin fork preserves default behavior, official CSS and dictionaries without editing the pinned submodule.

- All checks and production build passed; 1123 official exported imports reviewed, with three complete source/resource drift checks.
- 36 default-presentation cases directly match the pinned original in DOM, styles and pixels; four existing menu/billing-guard cases passed.
- Eight en/zh, light/dark, desktop/mobile full-anonymous-layout comparisons passed against an independent shared-official-style specification. This is a user-approved extension, not the original upstream anonymous renderer.
- Local integration passed eight locales, 85 screenshots, real-account and nested-login checks; 30 anonymous cases recorded zero private requests, WebSockets or errors.
- Four Staging en/zh desktop/mobile cases and eight screenshots passed. All 13 Client forks have correct origins and active fibers with originals disabled. The exact version matches; five private endpoints still return 401 anonymously, registration remains closed, and no business writes occurred.

Evidence is consolidated in `.artifacts/acceptance/account-full-layout/report.json`. The presentation difference is recorded in [ADR-0005 section 21](dsh-base-ADR-0005-anonymous-more-menu.en.md); this does not imply connected DeepSeek Platform authentication/billing or whole-product UI/UX equivalence.

### Historical verification of the previous centered account placeholder

The version verified on 2026-11-17 is `6a3f26d0-41f5-4c63-a4a0-131ae062afbb` at <https://dsh-base-staging.jacksonai.workers.dev>. Anonymous account settings restore the original centered layout, copy and controls of official `AccountSection`, removing the four synthetic billing rows. A distinct Dsh-base sign-in section is appended below; only its new button opens local authentication. The unintegrated DeepSeek Platform entry remains visible, disabled and explained in the active language.

| Verification | Result and scope |
| --- | --- |
| Build and reuse | Full build and checks pass. The reuse guard verifies 1069 official imports use declared exports; the upstream submodule is unchanged. |
| Official UI comparison | 8 English/Chinese, light/dark, desktop/mobile anonymous account cases have exact DOM, text, geometry, computed-style and pixel matches. The existing 4 signed-in billing/menu regressions also pass. |
| Complete account acceptance | 8 locales and 85 screenshots cover distinct account identities, settings navigation, real login, nested dialogs and return focus. |
| Anonymous boundaries | 30 local anonymous browsing cases pass with zero private requests, WebSockets or browser errors. |
| Staging | 4 English/Chinese desktop/mobile cases and 8 screenshots pass; deployed entry assets match the local build and the runtime version matches exactly. Signup remains closed, 5 anonymous private API classes still return 401, and no business writes occur online. |

Evidence is under `.artifacts/acceptance/anonymous-account-parity/`: `build.log`, `reuse.log`, `parity/report.json`, `account-billing-parity-report.json`, `account-launcher/report.json`, `anonymous-local/report.json`, `staging/report.json` and `staging-version.json`. The new comparison is included in `acceptance:parity`, and account integration acceptance in `verify:release`. This verifies account UI and authorization boundaries, not whole-product equivalence or integrated DeepSeek Platform authentication/billing.

### Previous login-dialog verification baseline

The version verified on 2026-11-17 is `8c1423a8-c748-4d51-8c14-cb8dcc6e00bc` at <https://dsh-base-staging.jacksonai.workers.dev>. The shared login plugin retains the local account flow and directly reuses Modal, Button and Input from the pinned official release. Custom modal chrome, pill styling and colors have been removed. The official submodule and anonymous authorization scope are unchanged.

| Verification | Result and scope |
| --- | --- |
| Full build and checks | `.artifacts/acceptance/auth-official-style/build.log`: full build, typing, source reuse, plugin boundaries and relevant regressions pass. |
| Official primitive comparison | `primitives/report.json`: 8 English/Chinese, light/dark, desktop/mobile cases with 56 exact geometry, computed-style and pixel comparisons. This verifies those controls, not equivalence between local accounts and official Platform authorization. |
| Real local authentication | `real-auth/report.json`: 10 check groups pass using temporary D1 and real Better Auth, including username/email login, invalid passwords, signup policy, safe returns, focus/dismissal and reachable actions with scrolling at 390×360. |
| Anonymous browsing and gates | `anonymous-local/report.json`: 30 cases pass with zero browser private requests, WebSockets or errors. |
| Staging UI | `anonymous-staging/report.json`: 4 English/Chinese desktop/mobile cases and 8 screenshots. New-session and add-plugin actions open the official-styled dialog; dismissal and return focus pass, with zero private requests, WebSockets or browser errors. Deployed entry assets match the local build. |
| Version and authorization | `staging-version.json`: exact runtime version matches; signup remains closed, anonymous requests to 5 private API classes still return 401, and no business writes occur online. |

These reports are under `.artifacts/acceptance/auth-official-style/`. Primitive comparison is included in `acceptance:parity`, and real authentication regression in `verify:release`. This release did not exercise model inference or establish whole-product UI/UX equivalence.

### Previous provenance verification baseline

The version verified on 2026-11-17 is `51ec0e7f-d96c-4a85-8b2f-5138b7408aed` at <https://dsh-base-staging.jacksonai.workers.dev>. This release corrects 11 mislabeled fork origins and adds provenance consistency guards for manifests, profiles and generated inventory. Business authorization is unchanged.

| Verification | Result and scope |
| --- | --- |
| Full build and checks | `.artifacts/acceptance/plugin-provenance/build.log` records the passing full build and required checks. Conformance has 116 cases, including 4 new provenance regressions. |
| Client provenance and actual activation | Authenticated online acceptance confirms all 12 Client forks have `origin: fork` and active fibers. Their 12 official originals are disabled with null fibers. |
| Worker provenance and actual activation | The same acceptance reads the real Worker inventory: all 15 Workers are active, and the 3 Worker forks have correct origins. |
| State and authorization | Sessions, settings and plugin controls remain unchanged, with no browser errors, failed requests or business writes. An independent version probe matches the version above, signup is closed, and anonymous probes of five private APIs still return 401. |

Online provenance evidence is `.artifacts/acceptance/plugin-provenance/authenticated-staging/report.json`; exact-version and anonymous-denial evidence is `staging-version.json` in the same directory. This acceptance does not exercise model inference or establish full UI pixel parity through provenance tests.

### Previous sidebar verification baseline

Version `21bf1c45-8a5c-4ff5-a1b2-32741124a172`, verified on 2026-11-17, is the previous anonymous workspace empty-state fix. Its tests were not rerun as part of this provenance release.

| Historical verification | Result and scope |
| --- | --- |
| Build and sidebar regressions | 12 sidebar unit tests, 30 local anonymous matrix cases, 12 official sidebar comparisons and 4 Staging UI cases. |
| Real anonymous interaction | en/zh on desktop/mobile: an empty workspace list and Add workspace opening login; 0 private requests, 0 WebSockets, 0 business writes, and no page or request errors. |
| Official UI comparison | 12 cases cover en/zh, light/dark and expanded/collapsed/mobile layouts using actual official slot registration and the workspace store for SidebarRoot, More and the empty workspace list. This is not full-product pixel coverage. |

Historical evidence is under `.artifacts/acceptance/workspace-empty-state/report.json`, `staging-version.json`, `staging-ui.json`, `parity-report.json` and `anonymous-local/report.json`. Artifacts are always scoped to their version and coverage; they do not automatically verify later builds.

## Historical evidence and release rules

The former status page and its deployment, inference and migration records are preserved in a [historical snapshot](history/2026-11-17-pre-audit-completion-status.en.md). Its old counts and “current” wording refer only to the original records, not the present working tree. Earlier evidence remains in the [2026-11-10 history](history/2026-11-10-pre-alignment-completion-status.md).

Before release, run required source, type, security, reuse, boundary and regression checks on the same tree, then build and deploy that artifact. Verify the exact Worker/Host version online. Compare changed UI and interaction against the applicable official components and real composition, retaining explicit coverage limits. Keep owner storage identity stable instead of creating an empty namespace for each release. See [runtime parity](runtime-parity.md) and the [Remote mapping](typed-remote-mapping.md) for detailed boundaries.
