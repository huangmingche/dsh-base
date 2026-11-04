> **Historical snapshot — archived on 2026-11-10.** This preserves the previous document and its deployment evidence verbatim. It contains superseded and internally inconsistent status statements; do not use it to determine current capability or acceptance. Links inside the original body retain their original paths. See the current [document](../typed-remote-mapping.md).

# Typed Remote migration map (Phase C)

Current transport: custom `remote` seam in
`packages/client/dsh-base-client-session-adapter/src/client/index.ts` over
`POST /api/session-host`.

Target: official `@deepseek-ai/dsh-api-remotes` clients over the official Host
gateway RPC envelope.

## Namespaces currently served by the custom remote

| Namespace | Methods in the custom seam | Official source |
| --- | --- | --- |
| `session` | create, fork, state, page, projections, list, prompt, claim, follow, live, selectModel, models, modelCatalog, cancel, queue, settings | session-controller |
| `workspace` | list, initializeDefault, create, rename, delete, setFlags, projects, directory | workspace-controller |
| `workspaceFiles` | list, read, readBytes, write, delete, search, version | api-workspace-files |
| `settings` | describe, mutate, update, openSettingsDocument | settings-controller |
| `permissionPresets` | catalog | permission presets |
| `agentPresets` | list, read, select | agent-preset-registry |
| `account` | session, signIn, signOut, features | account-controller |
| `commands` | list, run | command surface |
| `subagents` | catalog, message | subagent |
| `toolResults` | watch | tool result remote |
| `goals`, `userQuestions`, `skills`, `fileReferences`, `sessionReferenceResolver`, `schedule`, `jobs`, `pluginManager`, `pluginInventory`, `llm`, `credentials`, `messageFeedback`, `sessionFeedback`, `productAnalytics`, `dynamicCordisRunner` | compatibility stubs used by mounted official UI | various Host packages |

## Migration order

1. Keep the custom seam as fallback.
2. Add the official RPC descriptor endpoint on the Worker for `session` first.
3. Mount `api-remotes` descriptors for `session` and switch only that namespace.
4. Verify chat streaming, history, model selection, claim and follow.
5. Repeat for workspace/files, then settings/models/permissions, then tools.
6. Delete the custom namespace once no caller reads it.

## Session bridge — landed increment

The Worker now serves the official unary `session/*` endpoints through
`@dsh-base/cloudflare-worker-session-host` (`src/remote.ts`) on the official
`{ type: "client-request", payload: { args } }` envelope:

| Endpoint | Official wire args | Host dispatch |
| --- | --- | --- |
| `session/list` | `{ _request: { cursor? } }` | `list`, all pages |
| `session/state` | `{ request: { sessionId } }` | `state` |
| `session/projections` | `{ request: { sessionId } }` | `projections` |
| `session/create` | `{ request: { sessionId?, workspaceId?, cwd?, agentPreset? } }` | `create` |
| `session/fork` | `{ request: { sessionId, messageId? } }` | `fork` |
| `session/rename` | `{ request: { sessionId, title } }` | `rename` |
| `session/selectModel` | `{ request: { sessionId, provider?, model, reasoningEffort? } }` | `selectModel` |
| `session/modelCatalog` | `{}` | `models` + catalog projection |
| `session/cancel` | `{ request: { sessionId } }` | `cancel` |
| `session/page` | `{ request: { address, throughSeq?, beforeSeq?, maxMessages?, turnWindow? } }` | `history` + shared journal cut |

Every bridge call dispatches through the same
`handleSessionHostRequest()`/`SessionHostObject` path as `/api/session-host`, so
the official and custom callers share one durable Host. Bridge failures use the
Remote envelope (`gateway/arguments-invalid`, `gateway/bad-request`,
`session/not-found`, `gateway/internal`, ...).

`session/page` builds its records with `buildSessionHistory()` from
`@dsh-base/session-wire`, the same dense `event.seq` journal the `session/follow`
snapshot uses. `throughSeq` is the inclusive cut (`-1` selects the empty page),
`beforeSeq` is the exclusive upper bound of an older page, and
`maxMessages`/`turnWindow` apply the official Host's backwards cut rules. A cut
beyond the observed log end fails with `gateway/bad-request`; direct-subagent
addresses fail with `session/subagent-unavailable` until the bridge maps subagent
logs.

The client seam is `createOfficialSessionGateway()` in
`packages/client/dsh-base-client-session-host/src/gateway.ts`. It sends the
official envelope through the official Connection RPC when that plugin is
active, and through a plain same-origin `fetch` before it activates. The
`session` namespace methods migrated in this increment are:

- reads: `list`, `state`, `projections`, `modelCatalog`, `page`
- mutations: `create`, `rename`, `selectModel`, `cancel`

`fork` is exposed by the bridge but the UI method still uses the custom
transport because the official `atSeq` boundary has no Host mapping yet (the
Workers Host forks by durable message id). Every migrated method falls back to
the original custom `/api/session-host` call when the endpoint itself is
unavailable (`404`/`405`, `gateway/endpoint-unavailable`,
`gateway/definition-unavailable`); business and carrier failures are
never replayed against the legacy transport.

Migrated stream endpoints (Phase C stream increment):

| Endpoint | Transport | Notes |
| --- | --- | --- |
| `session/follow` | `/api/remote.mux` logical stream | Opening snapshot + dense journal events projected by the Host from durable rows (`@dsh-base/session-wire`). Assistant token deltas stay on `/api/agent-live`. |
| `session/control` | `/api/remote.mux` logical stream | Host-wide baseline; client-local projection changes are interleaved by the seam. |

Still on the custom transport:

| Method | Why it is not switched yet |
| --- | --- |
| `prompt` + implicit `claim` | The custom path owns the prompt/claim pair and the optimistic `rpcId`/live-process signals; moving it needs an official claim carrier first. |
| `fork` | Official boundary is `atSeq`; Host fork currently takes a durable `messageId`. |
| `models` | Custom model options helper; the official descriptor exposes `modelCatalog` instead. |
| `models`, `updateQueue`, `search`, `wait`, `observeEvent`, `observeProjections`, `observeState`, `events`, `attachment`, desktop-open methods | Not called by the custom session surface yet; add them when their consumers are mounted. |

`session/page` is official-first in the client seam; only direct-subagent
addresses keep the custom read. The follow snapshot still opens from the newest
100 durable messages, so the page's full-log seq space matches that window only
while a Session stays within it; widening the follow opening is a later
increment.

## Acceptance per namespace

The Phase C stream increment is verified by
`apps/web/scripts/acceptance-official-ui.mjs`: it asserts that both logical
streams open on `/api/remote.mux`, the official follow snapshot/events arrive,
chat streaming still uses `/api/agent-live`, history survives a reload, and the
browser reports no console/page/request errors.

- Same method names and result envelopes as the official descriptor.
- Same error codes (`ok/failed` remote envelope) and stream frames.
- Chat, stream, history and settings regression-free after switching.
- Custom fallback remains until the whole namespace is migrated.
