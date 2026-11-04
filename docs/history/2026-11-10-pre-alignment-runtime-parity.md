> **Historical snapshot — archived on 2026-11-10.** This preserves the previous document and its deployment evidence verbatim. It contains superseded and internally inconsistent status statements; do not use it to determine current capability or acceptance. Links inside the original body retain their original paths. See the current [document](../runtime-parity.md).

# Native Workers runtime parity (route A)

Status: in progress. This document tracks the remaining official DSH runtime
surface. The current deployment uses the official client Loader over a static
Vite composition, the custom `/api/session-host` transport for most business
calls, and the official Gateway wire for the migrated `session` unary endpoints
and `session/follow` + `session/control` logical streams (see “Phase C” below).
The four packages below require the official browser runtime rather than
another UI slot.

## Remaining packages

| Package | Requires |
| --- | --- |
| `@deepseek-ai/dsh-client-connection` | Official Host RPC + WebSocket carrier, connection generations, reconnect/stream resume |
| `@deepseek-ai/dsh-client-modules` | Cordis Loader with the client module system, Host boot manifest, bundle/asset HTTP serving |
| `@deepseek-ai/dsh-client-hmr` | `modules` service and module reload channel |
| `@deepseek-ai/dsh-client-ui-cordis` | `client-connection`, `cordis-client-runner`, `remote`/tool/sidebar services |

## Official wire facts (from the pinned submodule)

- Unary RPC: `POST /api/<endpoint>` with
  `{ type: 'client-request', rpcId, method, payload }`; reply is an envelope
  carrying the same `rpcId` and a `result`.
- Stream mux: WebSocket at `/api/remote.mux` (gateway `stream-protocol.ts`).
- Connection service is installed by `@deepseek-ai/dsh-client-connection` and
  started by the API Gateway generation source; reconnect and generation reset
  notifications are part of that loop.
- The client module system is built by the page kernel before Cordis exists;
  `client-modules` only enrolls `loader.internal` as `ctx.modules`.

## Phases

1. **Worker Wire Gateway**
   - Official RPC envelope parsing and typed failures.
   - `/api/remote.mux` WebSocket mux in a Durable Object.
   - Generation bootstrap and reconnect/resume semantics.
   - Auth/cookie enforcement at the Worker edge.
2. **Module registry + loader**
   - Serve a boot manifest and per-plugin client bundles.
   - Implement the page loader facade expected by `client-modules`.
   - Enable/disable/version state with cache invalidation.
3. **Cordis runner**
   - Sandbox for agent-defined plugins; no ambient Node/Workers capabilities.
   - Runner registration and `ui-cordis` renderer.
4. **Client migration**
   - Replace the custom `remote` seam with official api-remotes over the wire.
   - Re-verify chat streaming, claim, stats, permissions, models and history.
5. **Acceptance**
   - 62/62 official client packages active (no replacement exclusions).
   - `pnpm check`, deployment, rendered-UI comparison against official DSH.

## Current safety position

Until phases 1-4 land, `client-connection`, `client-modules`, `client-hmr` and
`ui-cordis` stay out of the static composition. No empty service or fake
transport is mounted for them, per `AGENTS.md`.


## Phase 1 status (round 5)

Implemented in the Workers-native plane:

- `POST /api/<endpoint>` official `client-request` / `server-response` envelope with auth.
- `POST /api/$events/result` forwarded-event result acknowledgement.
- `WebSocket /api/remote.mux` carrying `$events`, `session/follow` and
  `session/control` logical streams (official open/item/end/cancel grammar,
  coded error frames, per-stream cancellation).
- `@dsh-base/client-wire-bootstrap`: registers the official connection generation
  source, opens the mux, sends `$events`, and starts `connection.start()`.
  Verified in the deployed page: `state = connected`, generation present.

Still missing before `client-modules` can mount:

- The official API Gateway client / typed Remote migration (the current app
  exposes a custom `remote` service).
- A real Cordis Loader with `loader.internal.version === 'client'`; the current
  app uses `@dsh-base/plugin-loader-static`, which has no client module system.
- A boot manifest and CJS factory bundles served by the Host.

`client-hmr` depends on `client-modules`; `ui-cordis` also requires the
cordis-client-runner sandbox.

## Phase C — Session namespace, stream increment

The official unary `session/*` endpoints are now served by the Worker:

- `@dsh-base/cloudflare-worker-session-host/src/remote.ts` registers
  `session/list|state|projections|create|fork|rename|selectModel|modelCatalog|cancel`
  on the generic `wireRpc` service and dispatches every call through the same
  `SessionHostObject` transport as `/api/session-host`.
- `@dsh-base/cloudflare-worker-wire-rpc` now gives endpoint handlers the
  authenticated user and Worker `env`, and lets a handler raise a coded
  `RemoteFailure` instead of collapsing every failure to one generic code.
- `@dsh-base/client-session-host/src/gateway.ts` is the official-style client
  descriptor (`createOfficialSessionGateway`); it sends the official
  `client-request` envelope through official `connection.rpc` when available and
  through same-origin `fetch` before Connection activates.
- The session seam in `dsh-base-client-session-adapter` uses the official
  gateway for `list`, `state`, `projections`, `modelCatalog`, `create`,
  `rename`, `selectModel` and `cancel`, and keeps the custom `/api/session-host`
  call as the fallback when the endpoint itself is unavailable.

### Stream increment (follow + control)

- `@dsh-base/cloudflare-worker-wire-rpc` now implements the official
  `/api/remote.mux` multiplexed stream carrier (`src/mux.ts`), including
  per-stream abort, coded error frames and the `$events` generation handshake.
- `@dsh-base/cloudflare-worker-session-host` serves `session/follow` and
  `session/control` over the mux through `src/remote-streams.ts`, and projects
  the durable journal with the shared `@dsh-base/session-wire` sequencer. Tool
  events are projected while the turn runs; assistant token deltas deliberately
  stay on the Agent-bound `/api/agent-live` WebSocket.
- `@dsh-base/client-session-host` adds the browser logical-stream carrier
  (`src/wire-stream.ts`); the seam consumes it in `wireFollow`/`wireControl`
  and falls back to the custom transport only when the stream fails before its
  opening snapshot/baseline.
- `apps/web/scripts/acceptance-official-ui.mjs` now verifies the mux streams:
  it asserts that `session/follow` and `session/control` opened on
  `/api/remote.mux`, that the official follow snapshot/events arrived, and that
  chat streaming, history reload and the DeepSeek catalog still work.

Verified on the deployed staging Worker (version
`51802794-f8f6-4f29-bb66-5701fba8ee28`, previous stable
`782efe28-60ff-43fd-b5fe-9b551c53009f`): official endpoints return `ok` for
`list`/`state`/`projections`/`create`/`fork`/`rename`/`selectModel`/
`modelCatalog`/`cancel`; a browser chat turn and the `/api/agent-live` WebSocket
stream still work; history reload and settings render. The chat run produced no
page/console errors; repeated automated sign-ins later hit Better Auth's
`/api/auth/get-session` rate limit, which is unrelated to the session bridge.

Still custom, by design in this increment:

- `session/prompt` (and the implicit `claim` and optimistic `rpcId` signals).
- `session/follow` and `session/control` — these need Session logical streams on
  the Worker `/api/remote.mux` carrier; the mux still only serves `$events`.
- `session/page` — history records are mapped to official `SessionWireEvent`
  rows and correlated with `rpcId` in the browser; that mapping must move to
  the Host bridge before switching.
- `session/fork` from the UI — the official request boundary is `atSeq`, while
  the Workers Host forks by durable `messageId`.
- `workspace`, `workspaceFiles`, `settings`, `permissions`, models and tools.

The migration remains reversible: the custom methods and their transport are
unchanged, and the official path is attempted only for the listed methods.

## Host hardening (same phase)

- Agent Durable Objects are owner-scoped (`owner:<userId>:<sessionId>`); the
  browser only supplies its Session id and `/agents/...` rejects names outside
  the authenticated owner prefix.
- `prompt` arms a Durable Object alarm so a queued turn still runs when the
  composer tab closes; claims are idempotent when the alarm and the browser
  race. Transcript replacement is atomic via `transactionSync`.
- The auth plugin resolves a D1 session only for guarded APIs and private HTML
  navigations, and the SPA's `/get-session` budget no longer trips the default
  Better Auth limiter (the 429 retry loop was surfacing as a React render loop).
- Rate limiting runs in memory per isolate. Both Better Auth's built-in
  `database` limiter (awaits a pruning DELETE on every auth request) and a
  custom D1 `UPSERT ... RETURNING` limiter (contended with sign-in's own D1
  writes) intermittently stalled `/api/auth/*` on this deployment. A durable
  global limiter needs a separate store (e.g. a dedicated D1 database or
  secondary storage) and is tracked as a follow-up; the in-memory window/
  customRules still bound per-isolate abuse.
- Worker and wire-RPC failures return stable generic messages; diagnostics stay
  in Worker logs.

## Remaining stream work

- `session/page`, `session/prompt` (with alarm-owned claim) and `session/fork`
  (including `atSeq`) now run through the official bridge; `prompt` still
  returns a `submissionId` extension for browser projection observation.
- `workspace/*` unary endpoints and the `workspace/follow` baseline/replace
  stream now run on the same bridge; the adapter keeps the custom fallback.
- Browser logical streams treat the `pagehide` teardown as a normal end: a
  navigation-closed `/api/remote.mux` socket no longer surfaces a
  `WireStreamFailure` console error while the Session survives on the Host.
- `session/state` now projects the durable input queue, and
  `session/updateQueue` supports edit/remove (queue steering is explicitly
  unavailable). The alarm claims one queued turn and reschedules itself only
  after a successful claim, so multiple queued prompts survive a closed tab.
- Host tasks: a durable `schedule` store plus the Session Host alarm deliver due
  `after`/`at`/`every`/`daily`/`weekly` tasks into existing or newly created Sessions and record
  delivery history; the official ui-schedule surface is enabled over the
  adapter's durable-first `remote.schedule`; `daily`/`weekly` wall-clock timing
  is computed from the IANA zone, while `cron`/`rrule` remain explicitly
  unsupported (`schedule/input-invalid`).
- The system prompt is assembled by the official `@deepseek-ai/dsh-system-prompt`
  registry (Cordis context, official section orders, prompt variables, official
  `renderPrompt`) inside each Workers Think agent; the persona plugin supplies
  the official persona-prefix slot and tool plugins contribute official-order
  guidance sections. Working-directory and root workspace instruction files
  (`AGENTS.md`/`CLAUDE.md`/local overlays, 64 KiB budget) are re-read from the
  Session Workspace on each render through the internal `SESSION_HOST` binding;
  a UTC time snapshot and the official `system-prompt/assemble` presentation
  waterfall are active. Instruction/time/working-directory context is injected
  as stable-id durable user-role messages with `metadata.dshContext`, hidden
  from the Host transcript UI via the same metadata filter and re-upserted each
  turn. User-global instructions live in the durable settings document
  (`dsh-base:instructions`); per-step time snapshots carry the browser IANA
  zone (persisted through `dsh-base:client`), UTC, and elapsed time, and the
  official presentation waterfall applies product normalization.
- The client Session baseline paginates to the end of the Host cursor and the
  Host page size is 50, so recent blank placeholders never hide older
  non-blank Sessions from Workspace groups.
- Sessions and Workspaces are addressable: `/agent/:sessionId` and
  `/workspace/:workspaceId` are restored through the official
  `uiWorkspace` navigation services, the address mirrors the official
  selection, unknown ids show a localized notice and fall back home, and
  private document routes are `noindex` and excluded from robots/sitemap.
- Public sitemap/robots use a pure tested renderer with locale-prefixed
  canonical URLs, reciprocal hreflang alternates, `x-default`, noindex on the
  sitemap itself, and crawler disallow rules for login/API/agent surfaces.
- Product site configuration is a custom seam: the Worker publishes whitelisted
  public facts (environment label, brand, public links) through
  `GET /api/site-config`, the client plugin exposes the merged read-only
  `ctx.siteConfig`, and only dsh-base custom UI (shell-extras More menu)
  consumes it. Official DSH UI is untouched.
- Session Host generation `default-v49` was rolled out with R2 sidecars for
  settings and user-facing tasks; the Host exposes `appendSessionEvent` and the
  AI Gateway provider forwards real SDK retries as official `llm/retry` /
  `llm/retry-started` session events. Think compaction is configured with a
  model summarizer and `compactAfter(800_000)`; manual `compactNow` is exposed
  for operators, and both paths emit official `compaction/start|summary|end`
  events for the transcript nodes.
- The composer exposes real skills from the shared `@dsh-base/chat-skills`
  catalog (invoked as `/<name>` and injected as durable hidden context), durable
  message feedback persisted in the settings document, steer as
  interrupt-then-admit, and read-only permission enforcement that hides
  `delegate_task` from the tool set.
- Chat mentions and slash commands use real Host data: `@` file candidates are
  discovered from the Session Workspace (bounded breadth-first), `@` session
  candidates come from the real Session list with canonical mentions, and
  `/permission` lists/executes through the official command result shape while
  persisting the preset in the durable settings document.
- Background jobs mirror createbuddy's durable `scheduleEvery` scheduler:
  interval registrations + a run journal in the Session Host DO, driven by the
  alarm. `cleanupFiles` prunes superseded immutable file versions, `pruneSchedules`
  removes ended tasks/deliveries, and `recoverSubmissions` wakes a claim for
  stale queued inputs. Media/asset generation jobs are out of scope (no media
  product in this deployment).
- The Models settings page is fed by the DeepSeek provider directory and a
  `llm-deepseek` namespace whose credential reference is
  `DEEPSEEK_OFFICIAL_API_KEY`; model discovery asks the Host (real network call
  with the stored key) and refuses with `llm/model-discovery-rejected` when none
  is configured.
- Encrypted per-owner credentials (AES-GCM, `CREDENTIALS_KEY` secret) are
  decrypted only for the claim and injected into the Think execution; a stored
  key selects the direct DeepSeek provider while an unset key keeps the
  platform AI Gateway route.
- Durable per-owner settings values (revisioned compare-and-set in DO SQLite)
  back both the browser-merged views and the official
  `settings/describe|mutate|update|replace` Remote; a conflict returns
  `settings/conflict` instead of overwriting, and the unavailable native
  document editor is reported, never faked.
- Human-in-the-loop approvals: an approval-gated Think tool call parks the
  turn with an `approval-requested` transcript part; the Host exposes
  `pendingApprovals` / `resolveApproval` (tool call id + decision) and the
  resumed continuation is synced back into the durable transcript. The browser
  bridge presents these through the official ui-approval `remote.$on`
  waterfall (Agent-scoped Cordis context as `this`), polls only the currently
  open Sessions, and resolves through the same Host endpoints. The card E2E
  needs a stable staging window to verify; the Host path is covered by
  `official_approval` acceptance.
- `toolResults/watch` is a mux stream over durable `tool/result` journal events
  (JSON when parseable, text otherwise); the official Host is live-only, so
  late inspection after reload is the approximation this bridge adds.
- The Session Host handler now resolves auth only for `/api/session-host`
  requests. Before, an unauthenticated request to any later route (public
  `/api/plugin-control` GET, static assets) was answered with a 401 carrying
  `source: session-host`, hiding the real route and doing a needless auth read.
- Files/settings/permissions/tools remain blocked on Host capabilities; see
  the table below for the required service and the honest degradation.
- The mux open payload accepts any JSON; per-endpoint argument validation stays
  in the handler.
- Assistant token deltas stay on `/api/agent-live` by design; do not move them
  to SessionHost polling (see AGENTS.md constraints).

## Remaining capability gaps (blocked on Host capabilities, not transport)

See [`docs/completion-status.md`](completion-status.md) for the consolidated
P0–P3 status matrix with commands, evidence and alternatives.

The remaining official namespaces cannot be migrated faithfully by the wire
bridge alone; each needs a Host capability this deployment does not have yet.
Until then the mounted official UI keeps its explicit unavailable/disabled
state (AGENTS rule: never fake it).

| Surface | Missing Host capability | Honest current state / alternative |
| --- | --- | --- |
| `workspaceFiles` | **Done**: R2 object bytes (`FILES` binding) + DO SQLite metadata, immutable versions, official unary + `changes` stream. The transcript file is seeded real; settings/commands/subagents/permissions remain the gaps. |
| `settings` | No Host settings store/controller (the browser seam keeps an in-memory settings view). | Migrate after adding a durable per-owner settings document (D1 or DO SQLite) + the official namespace handlers. |
| `permissions` runtime | No Host permission enforcement service; the Think agent runs without the DSH permission presets. | Catalog/preset remote can be served read-only now; enforcement requires a Host approval/policy service. |
| `tools` / `toolResults` | Official tool result remote is not exposed; Think tool events ride the session journal instead. | Keep the official tool views fed by session events; migrate `toolResults` only if a consumer needs the separate stream. |
| `subagents` | Think facet subagent exists (`DshSubagent`) but there is no official subagent registry/catalog bridge. | Mount the catalog bridge after mapping the facet registry; prompt/interrupt need the subagent controller. |
| `commands` | Only the `/permission` command is implemented in the client seam. | Add a Host command surface before migrating `commands/*`. |

## Phase D / E / product backends (not started)

- **Real HMR rebuild**: the official `client-modules`/`client-hmr` plugins are
  mounted, but the Host does not serve a boot manifest, per-plugin bundles, or
  graph revision/invalidate frames. `/plugins/events` is keepalive-only.
  Implementing this needs a module registry + Host-driven graph rebuild; until
  then plugin code updates require a page refresh (visible limitation).
- **Cordis runner sandbox**: `ui-cordis` is mounted, but
  `dynamicCordisRunner` is an unavailable seam. Executing agent-defined Cordis
  plugins requires a sandbox/isolation primitive (e.g. a dynamic-worker
  loader or container) plus a security review; no fake runner is mounted.
- **Terminal**: needs a PTY/subprocess backend; Workers has no process
  primitive. The official terminal UI stays disabled with a localized reason.
- **Schedule**: needs the `dsh-schedule` Host service plus a durable schedule
  store/alarm loop; the sidebar entry stays explicitly disabled.
- **Models / Jobs**: model selection and Agent jobs are served by the
  Workers-native Host caches/queues; the official Host model-config and jobs
  controllers are not mounted, so their settings/details surfaces stay
  unavailable rather than fabricated.

## Accepted runtime limitations (paused)

The product scope is intentionally frozen at full official client UI coverage
with the following runtime capabilities deferred. These are not hidden: the
related UI stays mounted and reports an unavailable state where applicable.

- **Typed Remote migration**: the `session` namespace serves official unary
  endpoints and the browser uses them for list/state/projections/modelCatalog
  and the create/rename/selectModel/cancel mutations; `session/follow` and
  `session/control` run on the Gateway stream mux. `session/prompt`/`claim`/
  `page`/`fork` and every other namespace (workspace, files, settings,
  permissions, tools) still use the custom `remote` seam; the complete Host
  gateway namespace handlers and official api-remotes descriptor mounting are
  not migrated.
- **Real HMR rebuild**: `/plugins/events` serves an SSE channel, but the Host
  does not emit graph rebuild/revision/invalidate frames; plugin code updates
  require a page refresh in production.
- **Cordis runner sandbox**: `ui-cordis` is mounted, but `dynamicCordisRunner`
  is an unavailable seam; agent-defined Cordis plugin code is never executed.

This boundary matches the shipped Cloudflare implementation in
`/Users/mc/Developer/projects/apps/createbuddy` (static plugin boot, custom
Cloudflare API, official runtime packages marked unavailable).
