# @dsh-base/cloudflare-worker-session-host

The raw Host `create` inserts Session metadata and Workspace membership in one SQLite transaction. A repeated ID preserves its model, title, timestamps, history, queue, state and placement. Official `session/create` reuses an unarchived blank Session in the requested Workspace and working directory; a nonblank, running or archived Session produces a real new ID without modifying the original. Directory conflicts return `session/conflict`, missing Workspaces return `workspace/not-found`, and specifying both `workspaceId` and `cwd` returns `gateway/bad-request`.

The `cwd` face supports registered logical Workspaces only. Creating an ungrouped Session in an arbitrary unregistered directory is unavailable and returns `gateway/endpoint-unavailable`; it neither ignores the path nor silently creates a Workspace. Package reuse metadata tracks this limitation. The official composer's Workspace-based blank-session reuse is supported.

Workers-native fork target for the official DSH Session Remote contract.

## Status

Composed into the Worker. It implements the Workers-native Session Host needed by
official `ui-conversation` / `ui-chat` and serves an official `session/*` RPC
bridge over the same Durable Object:

- session list / cursor
- state
- history page and the full-transcript `history` read
- projections
- rename / selectModel / models
- create / fork (optionally through one message)
- prompt queue + cancel + updateQueue
- durable event journal + follow() (internal custom transport)
- official `session/follow` and `session/control` logical streams over
  `/api/remote.mux` (`src/remote-streams.ts` + the shared
  `@dsh-base/session-wire` projection); assistant token deltas stay on the
  Agent-bound `/api/agent-live` WebSocket
- `claim` runs a queued submission through the Cloudflare Think agent
- official unary endpoints including `session/page`, `session/prompt` and `session/fork` (`atSeq` preserves an exact event prefix using official fork closers)
- Host tasks: durable schedule store + alarm delivery engine (`after`/`at`/`every`/`daily`/`weekly`/`rrule`), official `schedule/*` endpoints and delivery history
- Background maintenance jobs: durable interval registrations + run journal (`cleanupFiles` / `pruneSchedules` / `recoverSubmissions`) executed by the alarm
- encrypted credentials: AES-GCM (`CREDENTIALS_KEY` secret) describe/set/unset; the claim decrypts them into Think execution; platform AI Gateway fallback requires both unset BYOK and explicit deployment enablement, with platform calls disabled by default in the template
- durable settings document: `settingsDescribe` / `settingsMutate` with revision compare-and-set and `settings/conflict`
- approvals: `pendingApprovals` / `resolveApproval` for approval-gated tool calls and durable pauses; the approved continuation is synced back into the durable transcript
- official `session/state` queue projection + `session/updateQueue` (edit/remove; steering is explicitly unavailable); a successful alarm claim reschedules the next queued input
- real workspace files: immutable versions in the `FILES` R2 bucket with DO SQLite metadata; official `workspaceFiles/list|stat|read|readBytes|changes` bridge and a real `Conversation.md` seed on first read
- official `toolResults/watch` mux stream projecting durable `tool/result` events into the inspection value
- official `workspace/*` unary endpoints (create / initializeDefault / rename /
  delete / insertBefore / insertSessionBefore / archiveSession /
  unarchiveSession / pinSession / unpinSession) over the same Workspace
  registry, order, and archive/pin flags
- the official `workspace/follow` logical stream reads after committed owner notifications and emits one `baseline` followed by complete `replace` baselines
  (`src/remote-workspace.ts`)
- the Host's selected model is applied to the Think agent before the turn
- assistant transcript sync back into the Host page
- final assistant usage synced into Host `projections.usage`
- ordinary file uploads use the official binary/Remote entrypoints, owner-isolated R2 and atomic receipt/prompt admission; Think verifies and reads content on demand without copying whole files into Agent SQLite
- image processing is unavailable: official intake stays present and rejects under the zero-image limit with localized feedback; historical image inference probes do not establish support in this build
- session running state
- `control()` session snapshot stream

Queued submissions are claimed by the Think runtime through `POST
/api/session-host` method `claim`; `control` exposes a live session snapshot SSE
stream.

## Ownership and durability

- **Account-scoped Agents**: the Client only knows its `sessionId`; the Worker
  maps it to an Agent DO named `owner:<userId>:<sessionId>`. `/api/agent-live`
  and `/agents/...` enforce that owner prefix, so two accounts that pick the same
  Session id never share a Think history.
- **Alarm-driven claims**: `prompt` persists the submission and arms a Durable
  Object alarm, so the turn still runs if the composer tab closes before its
  fire-and-forget claim lands. Claims are idempotent when the alarm and the
  browser race.
- **Atomic replacement**: whole-transcript replacement runs inside
  `DurableObjectStorage.transactionSync`, so follow/page never observe the
  DELETE/INSERT boundary.
- **Stable data identity**: retain the deployed `owner:<userId>:default-v49`.
  Code upgrades never rename the DO. `SESSION_HOST_STORAGE_ID` identifies durable
  data, and the application binding remains `default-v49`. Legacy recovery reads
  and validates the snapshot and R2 sidecar, then imports, verifies row counts
  and writes the completion marker in one SQLite transaction. A failed stage
  returns a retryable 503 before any empty default state can be created. Existing
  owner data is preserved; retries never overwrite current data.

## Provenance

- Package: `@deepseek-ai/dsh-api-session-controller`
- Path: `packages/api/session-controller`
- Commit: `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- License: MIT
- Official source lives only in `.submodules/deepseek-harness`; this package is a
  Workers-native adaptation.

## Verify

```bash
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/contract.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/agent-name.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-workspace.test.ts
```

## Worker API

Worker route:

```text
POST /api/session-host
GET  /api/session-host/follow?sessionId=...&after=...
GET  /api/session-host/control
```

`follow` 返回 SSE：

```text
event: session
data: {"seq":1,"type":"submission.queued",...}
```

Request:

```json
{ "method": "list", "params": {} }
```

Supports:

```text
create / list / state / page / history / projections / rename / fork
selectModel / models
```

Persistence: `SessionHostObject` Durable Object + SQLite.

## Verify

```bash
pnpm check:session-host
node apps/web/scripts/acceptance-session-host.mjs
```

## Official session RPC bridge

`src/remote.ts` registers the official unary endpoints on the generic `wireRpc`
service:

```text
session/list      session/state       session/projections
session/create    session/fork        session/rename
session/selectModel                   session/modelCatalog
session/cancel    session/page
```

Every endpoint accepts the official `{ args }` payload and dispatches through
`handleSessionHostRequest()` to the same `SessionHostObject` as
`POST /api/session-host`, so official and custom callers share one durable Host.
Failures cross the Remote envelope (`gateway/arguments-invalid`,
`gateway/bad-request`, `session/not-found`, `gateway/internal`).

`session/page` projects the complete durable transcript through the shared
`@dsh-base/session-wire` journal, so its `event.seq` values are the same dense
space as the `session/follow` snapshot. `throughSeq` is the inclusive cut (`-1`
selects the empty page), `beforeSeq` is the exclusive upper bound of an older
page, and `maxMessages`/`turnWindow` apply the official backwards cut rules.
Direct-subagent addresses return `session/subagent-unavailable`; a cut beyond the
observed log end returns `gateway/bad-request`.

`session/fork` accepts native or projected `messageId` and the official `atSeq`.
Projected assistant IDs identify a stable step within one durable SDK message;
forking preserves the exact existing event prefix with the unchanged official
`buildForkSeed` closers. Later tool results are excluded from UI and model context;
restart and continuation retain the stored prefix. `prompt` stays
on the custom transport by design.

### Official workspace RPC bridge

`src/remote-workspace.ts` registers the official unary endpoints on the same
`wireRpc` service:

```text
workspace/create                 workspace/initializeDefault
workspace/rename                 workspace/delete
workspace/insertBefore           workspace/insertSessionBefore
workspace/archiveSession         workspace/unarchiveSession
workspace/pinSession             workspace/unpinSession
```

- `create` idempotently resolves by path and returns `{ workspace, created }`;
  `initializeDefault` returns `{ workspace }` (`{}` when no default Workspace
  exists)
- `insertBefore` returns the complete `{ workspaceIds }` order and
  `insertSessionBefore` the updated `{ workspace }`; both renumber Host
  positions and report `workspace/not-found` / `workspace/move-invalid`
- `archiveSession` checks queued/running/awaiting-approval/continuing turns and active targeted schedules in one SQLite transaction. Without `stopActivity`, it rejects active work with official `workspace/session-active` details. With `true`, it persists archive/unpin and removes active targeted schedules before cancelling Think requests. Failures keep the archive durable and alarm retries finish cancellation. Atomic prompt admission and Think model/tool steps check the archive gate. The result contains the complete `{ archivedSessionIds }`. Dynamic subagent execution is explicitly disabled and no `delegate_task` is registered. Historical facets retain storage and reads but reject model/turn/step/tool execution. The official descendant-lineage activity/stop lifecycle remains unimplemented; equivalence is not claimed.
- `pinSession`/`unpinSession` return the complete `{ pinnedSessionIds }`. The
  Host adds no order column: flag rows record write order by `rowid`, and
  `INSERT OR REPLACE` makes a new pin the newest row; pinning an already pinned
  Session writes nothing, so its position is preserved (matching the official
  registry). Unpin-then-repin fronts the Session; other flag writes do not
  disturb the relative order of Sessions that stay pinned
- `workspace/follow` is a mux logical stream: one `baseline` first, then a
  complete `replace` baseline on every change. Reads follow committed owner notifications; identical states are deduplicated and read failures explicitly end the stream. Cancellation releases the subscription. Internal SSE sends at most one pure comment every 15 seconds, subject to consumer backpressure, with one pending iterator read and cancellation clearing the timer. It creates no state polling, domain event or projection revision and does not suppress real WebSocket disconnects

Every failure crosses the Remote envelope (`gateway/arguments-invalid`,
`gateway/bad-request`, `workspace/not-found`, `workspace/move-invalid`,
`session/not-found`, `gateway/result-invalid`).

## Execution authority and recovery

Think owns admitted messages and execution results; the Host owns the unadmitted queue,
session directory, settings and schedules. An empty new/forked Agent is seeded only from
completed Host history; existing Agent history is never overwritten. Admission uses the
same durable `requestId` on retry. After a lost RPC response, the alarm reconnects to that
Think execution; reading state never fails a turn merely because two minutes elapsed.
SQLite atomically admits the user message, queue row and event. Transcript synchronization
atomically retains inputs still queued in the Host. Cancellation reaches Think before
success is reported, and a durable tombstone also blocks a late admission.

`page` and `history` read messages plus their input lifecycle in one SQLite snapshot.
One durable request owns every assistant step before and after tool approval. Waiting
for approval remains active; later queued inputs cannot overtake it. A decision and its
continuation state commit atomically, and alarm recovery resumes that exact decision
without resubmitting the original prompt. Parallel tool approvals wait until all are
answered; a rejected tool can still end in a normally completed model response. Only
the actual Think terminal result publishes completed, failed or cancelled. Archived
waiting inputs remain eligible for cancellation recovery after transport failure.

Approval input accepts only `approved`, `rejected`, and the official Allow once seam's
explicit `allowed-once` alias (normalized to `approved` before persistence), and validates
the mutually exclusive tool/execution identity.
Pending cards require a nonterminal, owner-scoped input; cancelled, failed, archived and
forked history cannot authorize an action. Legacy random user ids are passed explicitly
to Think only when a unique one-to-one prompt correlation exists. Ambiguous legacy or
imported history has an unknown outcome instead of invented completion or timing.
Forks preserve proven terminal outcomes; a cut turn uses the official `forked` outcome.
Assistant model provenance comes from the model actually resolved for that step, not
the Session's current selection; it is retained in Host history and excluded from model
seed content. Historical rows without that evidence remain unknown.

Initial and approval-continuation steps count actual `step-start` partitions, not
assistant database rows. Continuation metrics read Think's durable SDK requestId
snapshot; cumulative values and the deduplication marker share one projection write.
Recovery after a terminal write failure adds neither duplicate metrics nor extra logical
turns. Read-only `runtimeInfo` returns this Host's own `WORKER_VERSION.id` for exact
post-deployment readiness checks.

Repeated Step evidence carried by a continuation is deduplicated by stable identity. Tool results are joined from actual SDK call identities within the same user Turn, so an old input snapshot cannot overwrite a recorded result. Reading damaged completed history from an older release only reads the Agent's durable messages. An atomic repair rechecks request, row and call identities before restoring proven terminal tool results; it does not invoke tools/models or change message order, execution state or cumulative accounting. Missing evidence remains unknown; transport or transaction failures return an explicit retryable error.

Per-session permissions use the fully marked official permission-presets fork, with
durable policy checked on each R2 operation. Defaults apply only to new Sessions;
`never` rejects approval-dependent operations. This does not provide native process
sandboxing or network policy. Settings `update` deep-merges objects and replaces
arrays/scalars with revision conflict detection. The native settings document is
unavailable (`hasDocument: false`). Theme, locale and developer-tools defaults follow the
pinned official contracts.

Official approval-policy notices commit atomically with policy facts. `approvalModelContext` returns official current-policy text and the notice outbox from one snapshot, without invoking an Agent. Think persists non-human context at the next actual step, preserving original message IDs/source and deduplicating restart and SDK step delivery without changing human history, queues, turns or cumulative metrics. Initialization, no-op selections and failed transactions create no notices; new forks do not inherit the parent's pending notices. A unified chat journal for commands/notices and full native inbox scheduling/cancellation remain differences.

Fault-window checks:

```bash
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/migration.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/execution-recovery.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/contract.test.ts
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/sqlite.test.ts
node --import ./tests/official-runtime-hook.mjs tests/turn-lifecycle.test.ts
```

The official Schedule form's DTSTART/RRULE is parsed and evaluated directly by the stable `RRule` export from `@deepseek-ai/dsh-util-time`: TZID, DST, COUNT, once/daily/weekly and the other rules accepted upstream. Timing edits recompute the next occurrence. Manual runs do not consume or move the scheduled occurrence; late timed delivery uses the official latest-due occurrence semantics.

Credential reads fail closed: a stored BYOK read or decryption failure interrupts the claim for retry; it never silently changes to the platform provider. Platform fallback applies only when BYOK is actually unset and the deployment explicitly enables platform consumption; the template default is disabled.


## Directory browsing

Official `directoryPicker/list` and `directoryPicker/createDirectory` use a logical directory table in the same owner SQLite database and the official `DirectoryListing` type. The Host owns absolute-path normalization, breadcrumbs, hidden flags and child paths. Listings return at most 1000 children and accurately mark `truncated`. Existing Workspace paths and ancestors are browsable without a backfill. Creating a directory does not register a sidebar Workspace; selection uses official `workspace/create`. Concurrent duplicate creation returns `directory-picker/exists`; missing parents and invalid paths fail explicitly. `directoryPicker/pick` reports `directory-picker/unavailable` because this runtime has no native OS chooser. These are logical workspace directories, not the host machine filesystem; reuse metadata records the difference.

The fixed Agent composition accepts only `standard`; `session/create` rejects other presets before any write instead of echoing false success.

```sh
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-directories.test.ts
```

## Ordinary file uploads

`POST /api/session/uploadFileBinary` directly reuses the pinned official `file-upload/src/http-route.ts`; `fileUploads/upload` accepts the equivalent base64 contract. Authentication routes every request to the existing owner Host. Ordinary files are limited to 8 MiB and stored by SHA-256 in owner-isolated R2. A Session-scoped receipt is created only after the complete object is written. Aborted uploads and R2 failures create no usable receipt. Unconsumed receipts expire after 24 hours. The existing `cleanupFiles` maintenance task processes at most 50 entries per run, continues backlogs after 5 seconds, and retries deletion failures after 60 seconds. A durable object-cleanup intent precedes R2 writes, covering successful writes followed by SQL failure or process interruption; a failed immediate deletion retains its retry record. Metadata is removed only after R2 deletion succeeds. Bytes referenced by admitted history, forks or another upload are retained. Each upload uses an independent physical object key while retaining its SHA-256 content identifier, so deleting an old upload cannot race a new upload of equal bytes.

The official `session/prompt` file part resolves its receipt. Receipt binding, user message, queue row and event commit in one SQLite transaction. Failure rolls back; retrying the same requestId returns the original submission, while another request cannot reuse its receipt. Think reads admitted R2 content with length/hash verification without copying whole files into Agent SQLite. Text previews and the read-only `read_uploaded_file` tool read up to 64 KiB at a time. Binary content is exact base64; no PDF or Office parser is configured.

Official history retains FileAttachmentRef rather than model-expanded context. Forking atomically copies presentation history and independent Session read authorization while sharing immutable R2 bytes. Execution reseeding translates file display references into readable text context. A failed fork leaves no half-created Session and never overwrites an existing target.

No image normalization processor is configured. Actual Host projections and follow streams declare `maxImagesPerMessage: 0` and retain the official image MIME list, so the unchanged picker/drop controls reject images with localized feedback. Server image upload, read and legacy image admission also explicitly return `IMAGE_PROCESSOR_UNAVAILABLE`. Existing durable data is preserved; image capability parity is not claimed.

```sh
node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/uploads.test.ts
```

## Current protocol boundary

Model and effort are frozen atomically at admission, and approval continuation retains them. Requested model and returned provider provenance are distinct. Committed owner notifications replace observation polling and cancellation releases readers. Projections use persisted revisions separate from chat cursors; a unified native journal remains a gap. Forks retain the source current permission policy, not parent transport receipts or unproven prefix usage. The full marked official permission fork enforces the actual R2 file boundary; never rejects approval-dependent actions. Permission command runs/results/retry receipts commit atomically and failures are explicit, but their separate command trajectory is not yet merged into the official conversation journal. Native process sandbox and networking are separate capabilities.

Access control: `remoteAccess/follow` emits the official owner baseline only after resolving the actual Host selected by the authenticated mux identity, then remains open until cancellation. Requests cannot specify owners/grants; non-owner Peer sharing policy is not implemented. Service access and agent tool presets remain separate. Regression: `node --import ./tests/official-runtime-hook.mjs --experimental-strip-types tests/remote-access.test.ts`.
