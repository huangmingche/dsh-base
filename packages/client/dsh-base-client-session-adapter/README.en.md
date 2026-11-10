# Workers Host seam for official clients

Application scope: the default workbench loads after sign-in. Signed-out states described below are component or Host contracts exercised in isolation.

This plugin supplies Workers Host services to official DSH clients. Official plugins own UI layout and interactions; the adaptation copies no official source.

Access mounts the unchanged official `dsh-api-remote-access/client` and Typert registry. An isolated unchanged Gateway inside this seam is the sole generation owner of the real Connection, owning `$events`, reconnect and generated `$mount`; a Cordis facade preserves existing Host namespaces. The official generator emits declarations and `/remote` runtime modules from the pinned checkout into ignored `.artifacts/typecheck`, without editing or copying upstream source. Generated modules resolve third-party dependencies from the app installation with Vite browser/import conditions, without rewriting or externalizing generated code. The Host resolves the authenticated owner's real DO before sending its baseline; the client has no access before that baseline. Shared non-owner Peers/grants are not implemented or invented. The retired wire-bootstrap remains disabled inventory. This access snapshot is separate from agent tool permission policy.

Public home pages share one checked account read first. Anonymous or unknown authentication keeps the official RemoteAccess initially closed: generated namespace contributions remain pending registrations with real cancellation handles, without starting the Gateway/WebSocket, private Host RPC or owner SSE, and without blocking Loader completion. Confirmed sign-in starts the unchanged Gateway and mounts the pending contributions. Account failures remain errors rather than forged sign-outs. An idle page does not poll account state; focus, visibility and explicit authentication actions refresh it. Only a user-started sign-in attempt polls every two seconds, for at most ten minutes. Confirmed first sign-in from an anonymous page, logout, or owner change reloads the page to read that account’s plugin composition and withdraw the old owner baseline that official RemoteAccess preserves through carrier loss.

Settings and Schedule call the Host through official Connection RPC. Host descriptors, namespaces, revisions and persistent outcomes are authoritative. Network errors, refusals and missing capabilities never become in-memory success. Official ui-schedule owns its page, sidebar, detail and Session contributions.

The unchanged official permission plugin uses the enforced per-session Host catalog, durable `/permission` command receipts and authoritative projection updates. R2 tool checks and approval policy are enforced by the Worker/Think permission service; the client does not fabricate permission outcomes. Owner-scoped SSE invalidations refresh settings, schedules and credentials across tabs, with initial/reconnect baselines and revision deduplication.

Verify from the repository root:

```sh
node packages/client/dsh-base-client-session-adapter/tests/remote-access.test.mjs
node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/account-session.test.ts
node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/settings-remote.test.ts
```

The access test uses actual Cordis, Connection, Gateway, Typert, RemoteAccess and the Worker mux, covering authenticated baselines, nine effects, reverse disposal, rollback, caller unloading, real generation recovery after 1006, and remount. Run `pnpm check:types` first to generate the official `/remote` runtime modules. RPC tests cover arguments, CAS, error details, network rejection and honest permission-command failure.

Re-audit `dshBase.reuse.sourceEntries` on every pin upgrade. See [REUSE.md](REUSE.md) for the complete reuse decision.

Credential reads and writes preserve Host outcomes. An absent carrier or network failure never becomes an empty configuration or a successful mutation. The unused fake `sessions` implementation was removed; the official api-session-controller owns the real lifecycle. Runtime plugin inventory reads live composition inspection and retains disabled originals, provenance and observed fiber states. The official Settings inventory includes client, Worker and Think components. The Plugins page groups owned components by feature and lists the optional bundles from the pinned upstream catalog.

Conversation-log feedback is unavailable. All official feedback controls remain visible and disabled, and Remotes plus `/feedback` reject explicitly. Settings-sidecar helpers retain carrier/business Result and revision/CAS regressions as unmounted protocol tests; they do not establish log-feedback support.

Additional checks: `node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/chat-feedback.test.ts`, `node packages/client/dsh-base-client-session-adapter/tests/feedback-contract.test.mjs`, and `node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/plugin-inventory.test.ts`.

Directory selection mounts the unchanged official browse plugin and forwards listing/creation arguments to the Host. Folder creation and workspace registration are separate; native system picking rejects explicitly. Workspace files come only from the real Host file service, with no synthetic conversation-file fallback. The agent directory exposes the four pinned official declarations plus the canonical Cloudflare Think default; the marked official-preset fork keeps official controls, broken modes visible/disabled, and refuses official-id selection/creation. Account reads/sign-out check real HTTP outcomes. Billing returns the official absent value and the availability seam disables billing links. Run `node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/host-capabilities.test.ts` for these transport and failure contracts.

File-reference traversal preserves Host failures and cancellation instead of inventing empty or partial success. Uploads retain official FileUploadRuntime, background Worker and progress behavior. Encoded file and historical attachment RPCs reach the real Host; the official Session client decodes historical image base64. Without an image-processing binding, the zero-image limit makes the original picker/drop reject images with localized feedback; the Host also refuses with `IMAGE_PROCESSOR_UNAVAILABLE`. The shared entry remains usable for ordinary files and does not claim vision support. Verify with `node --experimental-strip-types packages/client/dsh-base-client-session-adapter/tests/attachment-remote.test.ts` and `node apps/web/tests/parity/run-upload.mjs`. The latter exercises real official browser contracts over controlled HTTP; real R2 receipt consumption requires independent Host acceptance.

Owner-scoped SSE change notifications now refresh official settings, schedule and credential consumers across tabs. Initial and reconnect baselines close the eager-read/subscription race; duplicate revisions do not cause reload loops, and events carry no private values. Model and effort selections are sent intact to the durable Host; only acknowledged values project. Older Hosts that ignore a requested effort fail explicitly. See `tests/owner-invalidations.test.ts` and `tests/model-selection-remote.test.ts`.


Projection versions come from Host SQLite transactions and are independent of chat event cursors. Baselines, control frames, rename acknowledgements and the legacy SSE seam use the same server version. The client never creates Date.now() sequence numbers or recomputes an older snapshot against a separately read newer state. Older Hosts without a genuine version fail explicitly. This separate version domain is a recorded compatibility gap, not the official unified event-log consistent cut.

`$stream` directly uses the stable official `RemoteStream` export. Only physical carrier failures become recoverable CarrierErrors; business/protocol failures remain terminal, and legacy fallback requires genuine endpoint-unavailable. Approval uses the official `PendingApproval` UI waterfall, with retained Session scopes, AbortSignal and a single active read. Only explicit user decisions reach the Host; exceptions never auto-reject, and invalidation-driven retries preserve the same decision. Only an already selected decision gets at most two idempotent retries at 250ms and 1s after transient network/HTTP failure; Connection recovery and owner baselines also trigger recovery. Pending reads use no polling interval. UI exceptions, withdrawal and cancellation never become rejected decisions.

## Anonymous local settings document

While anonymous (the public `GET /api/auth/get-session` explicitly answers `null`), the settings `describe` / `mutate` / `update` / `replace` calls are answered by this seam's local document and never issue a `/api/settings/*` request:

- The namespace whitelist is `ui-theme`, `locale`, and the client-preference namespaces the anonymous panel can really change: `ui-chat`, `ui-conversation`, `ui-settings` (validated against the official schemas/defaults). Writes to any other namespace return `settings/namespace-unavailable` and are never faked locally. Keyboard shortcuts do not use this whitelist; official `ui-shortcuts` persists them in localStorage `dsh.keybindings.v1`.
- Validation uses only the official exported `ThemeSettingsSchema` / `LocaleSettingsSchema`; invalid values return `settings/invalid`, and version-mismatched or corrupt stored documents are discarded fail-closed instead of being projected.
- Writes go to the localStorage key `dsh-base.anonymous-settings.v1` only: no secrets, no cookies, no Host writes, no new public endpoint and no `remoteAccess` change.
- When localStorage is unavailable (private mode/quota), the document degrades to memory so the UI keeps working; those preferences are lost on reload, which is a recorded boundary.
- The signed-in path is unchanged: any visible session keeps the original Host RPC path and the local document is neither read nor written (it is constructed lazily and never built on a signed-in page; acceptance counts `reads=0 / writes=0`).
- Language/theme/font preferences reuse the official `ThemeRuntime` / `LocaleRuntime` reads and writes; the boot-time `locale.setLocale` `settings/mutate` also lands in the local document.
- Unit tests (official schema validation, whitelist, conflicts, storage degradation, corrupt documents): `node --experimental-strip-types --import ./packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs packages/client/dsh-base-client-session-adapter/tests/local-settings-document.test.ts`

`sessionModelCatalog` supplies Session-scoped Host data to the recorded model-selection fork, forwarding the exact `sessionId` and retaining read failures and disabled model rows. The official zero-argument `session/modelCatalog` remains account scoped. Anonymous eager catalog reads first check the shared account result and return an authentication error without private HTTP. Disabled Session providers use the current eight-language locale, preferring a specific Host reason when supplied.

The credentials Remote checks the shared account snapshot before private Host describe/set/unset calls. Anonymous access returns an authentication error; failed account reads preserve the original error, never a successful empty credential directory. `tests/chat-feedback.test.ts` covers zero anonymous private calls, one shared account read, truthful errors, and authenticated recovery.

## Official optional bundle catalog

At build time, the stable pinned `@deepseek-ai/dsh-official-bundles` exports supply
the `OPTIONAL_BUNDLES` and `ON_DEMAND_BUNDLES` lists. Optional metadata comes from
exported `package.json` and `locale/*.json` resources. The manifest icon is read
as a package-owned image under the official `PluginLocalizedMeta.icon` /
`readPluginMeta` resource contract and embedded as a data URL, not imported as an
unexported image module. On-demand metadata reuses `OFFICIAL_ON_DEMAND_CATALOG`
unchanged. Generated provenance retains the pin, resource sources and original
`listedByDefault`. No bundle JavaScript, Node Host, tool or process is loaded;
there is no install target.

Unadapted candidates report missing, uninstalled, disabled and an
independent `deploymentAvailability: "not-adapted"` marker, without runtime rows,
invented fibers or a fabricated error. The marked official manager fork shows
neutral Unavailable labels, without repeated red text or Not installed on list
cards. Details retain installation facts and the Workers limitation. Real
failures retain official error states. Switches remain disabled, and direct
toggles reject before any persistence request. The adapter sets `listedByDefault` so the official manager can show unavailable candidates. The pinned manager applies its own hidden and More filters and display order. Owned bundles carry `official: false` and use localized names.

Generate with `node scripts/composition/generate-official-bundle-catalog.mjs`;
append `--check` for drift detection. Regressions run through
`node --test scripts/conformance/tests/official-bundle-catalog.test.mjs` and
`tests/plugin-inventory.test.ts`.

Cloudflare-branded owned components share the unmodified cloudmark from the pinned [official Cloudflare create-cloudflare template](https://github.com/cloudflare/workers-sdk/blob/4335eacef350c98722418fbb58b012a6964e26d7/packages/create-cloudflare/templates/react/workers/ts/src/assets/cloudflare.svg). `cloudflare-plugin-icon.ts` preserves the original SVG bytes, proportions and two colors through the official `PluginLocalizedMeta.icon` base64 image contract. The same metadata covers lists, details and component rows, without Page/CSS changes, external image requests or claiming official plugin provenance. Package metadata records the source commit, SHA-256 and MIT license. The browser assets include the icon’s license notice.

Cloudflare AI Gateway uses official `BundleInfo.rows` for one management entry, preserving both client and Think components and the full runtime inventory. Its account switch writes both members with one CAS; legacy member names remain whole-bundle aliases. Inconsistent legacy state follows the Think selection and Session overrides remain unchanged. Only the client uses Loader updates; Think changes invalidate the model catalog. Runtime application failures CAS-roll back both members; a conflicting rollback explicitly requests a reload without overwriting a newer tab selection.


## Complete visibility and independent management policy

`scripts/composition/generate-owned-plugin-inventory.mjs` reads the owned client, Worker and Think components from package metadata and the selected application profile. Each component, including a disabled entry, appears in exactly one group defined under `packs/`. Boot, build and unregistered engine support packages stay outside this inventory. Gateway exposes a shared switch for its client and Think components. Web fetch and memory each have a separate switch.

The Global pack groups site branding, public configuration, SEO, discovery resources, public-page measurement and their settings interface. Its component list is recorded in [the pack declaration](../../../packs/global/pack.json). Agent presets, model provider settings, attachments, and the unavailable subagent belong to AI chat. Navigation, language, permissions, static assets, and the disabled sidebar extras remain in core features. Administrator permission to edit site settings is separate from plugin enablement; the global bundle and its components remain required.

Visibility does not read the L1 allowlist; L1 controls mutations only. Required components use `managementPolicy:required`, while Worker components use `deployment`. The existing marked fork shows these through its disabled switches and neutral explanations, with the server authorization boundary unchanged. Client and Worker states come from observations. Think rows declare composition and account intent, with null fibers. Subagent remains explicitly unavailable; read-only, disabled and unsupported are distinct states. Authenticated snapshots missing a declared client or Worker fail rather than silently dropping rows or fabricating state.

In Settings, signed-in users see the observed client and Worker entries in the global group. The session group lists the declared Think components, including the DeepSeek provider. Official originals and presets remain unchanged. Owned metadata adds short bilingual names and purposes plus the existing Cloudflare artwork. Generator tests enforce coverage and drift; regression tests independently enumerate source declarations and verify exactly-once reachability, metadata coverage, disabled states, zero HTTP mutations for readonly operations and honest inventory failures.

Owned plugin display names use a consistent brand prefix: `Dsh-base` for platform-neutral owned implementations and official forks, and `Cloudflare` for integrations (Gateway, R2, KV and Cloudflare infrastructure components). The prefix identifies the integration family, not publication by Cloudflare. English and Chinese lists, details and Settings inventory share this metadata. Original official names, package identities, composition IDs, provenance and persisted control state remain unchanged.

`navigationAccess` exposes checked sidebar availability: checking, anonymous, authenticated and failed states remain distinct, without modifying official RemoteAccess. Directory browsing, picking and creation refuse locally before confirmed sign-in; the server continues enforcing ownership.

Dsh-base-branded bundles and components use the official whale from the same source as the website through the existing metadata and artwork contract. The explicit `meta()` brand determines the icon, not a Worker package prefix or a translated title. Cloudflare artwork stays unchanged. Inventory generation and `--check` also generate or validate this artwork.
