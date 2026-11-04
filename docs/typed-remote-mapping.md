# Current Remote and transport map

Updated: 2026-11-10. This is the implemented bridge map, not a proposal to migrate
already-completed work. The previous Phase C narrative is preserved in
[history](history/2026-11-10-pre-alignment-typed-remote-mapping.md).

Official client plugins consume Host services supplied by the client seam.
Several namespaces use official-style unary RPC and logical streams; others
still use Host-specific transport or explicitly unavailable services. A namespace
name alone does not establish complete official semantic coverage.

## Carriers

| Carrier | Purpose | Source |
| --- | --- | --- |
| `POST /api/<endpoint>` | Official `client-request` / `server-response` envelopes, including typed Remote success/failure values. | `packages/cloudflare-worker/dsh-base-cloudflare-worker-wire-rpc` and Session Host `src/remote*.ts`. |
| WebSocket `/api/remote.mux` | Logical stream open/data/cancel and forwarded event delivery. | Worker wire-RPC mux plus Session Host stream registrations. |
| `POST /api/session-host` | Host-specific operations and compatibility fallback onto the same owner DO. | Session Host `worker-http.ts`, `durable-object.ts`, and `service.ts`. |
| WebSocket `/api/agent-live` | Assistant/Agent live deltas for an owner-scoped Session. | Worker Agent bridge and Think execution. |
| `POST /api/session/uploadFileBinary` | Authenticated streamed bytes through the unchanged exported official handler; returned values/failures retain the upload contract. | Session Host `upload-http.ts`, `uploads.ts`, and `@deepseek-ai/dsh-client-file-upload/src/http-route.ts`. |
| `GET /api/auth-policy` | Public, no-store registration capability (`signUpEnabled`), with no account data. | Worker auth policy and login plugin. |

Authentication and owner scoping apply before the data routes. The custom and
official carriers do not own separate copies of the Session Host data. Public
`/login` uses metadata-selected composition and starts no private carrier; real
local en/zh browser checks observe only `/api/auth-policy` and zero WebSockets.

## Implemented official unary surface

| Namespace | Registered methods | Important boundary |
| --- | --- | --- |
| `session` | `list`, `state`, `projections`, `create`, `fork`, `rename`, `selectModel`, `modelCatalog`, `cancel`, `updateQueue`, `page`, `prompt` | `fork.atSeq` preserves the exact existing wire-event prefix through the unchanged official buildForkSeed, including conservative tool closers; later SDK content/results are excluded. Queue edit/remove exist; queued-input steer is explicitly unavailable. Claim/execution reconciliation remains a Host operation, not an invented official descriptor. Model/effort selection returns only a real durable acknowledgement; each admitted input freezes the configuration. File prompt parts consume owner/session receipts atomically. |
| `workspace` | `create`, `initializeDefault`, `rename`, `delete`, `insertBefore`, `insertSessionBefore`, `archiveSession`, `unarchiveSession`, `pinSession`, `unpinSession` | Ordering and flag projections use the owner Host. Archive atomically checks turn/schedule activity; `workspace/session-active` details reach the official confirmation flow. `stopActivity: true` commits archive/unpin and deletes active targeted tasks before Think cancellation, with alarm retries and archived prompt/model/tool gates. Dynamic subagent execution is disabled; official descendant-lineage lifecycle parity is not claimed. |
| `workspaceFiles` | `list`, `stat`, `read`, `readBytes` | Reads address real R2-backed file versions. Custom Host operations still own mutation/search helpers; do not describe all file mutations as migrated official endpoints. |
| `directoryPicker` | `list`, `createDirectory`, `pick` | Reads/creates persistent logical directory records using official path/crumb contracts. Folder creation does not register a Workspace; native `pick` returns unavailable. |
| `settings` | `describe`, `mutate`, `update`, `replace`, `openSettingsDocument` | Namespace arguments are flat official args. Durable revision CAS and errors are preserved. The document endpoint explicitly returns unavailable. |
| `schedule` | `deliveryLimits`, `create`, `list`, `catalog`, `view`, `history`, `run`, `deleteInactive`, `edit` | Real durable store/alarm engine. RRULE and Cron directly reuse official `dsh-util-time`, including TZID/DST/COUNT, next occurrence, and latest-due delivery. Timing edits retain revision CAS; manual run does not consume the scheduled occurrence. Daily/weekly recurrence reuses official local-time gap/overlap resolution. |
| `fileUploads` | `upload` | Base64 ordinary-file admission to the same owner R2/receipt store as raw HTTP. Up to 8 MiB; aborted/failed writes create no usable receipt. |
| `session` attachment endpoint | `attachment` | Image normalization is unavailable; validates owner/session scope then returns `IMAGE_PROCESSOR_UNAVAILABLE`. Projections declare zero images so official intake rejects before upload. |
| `permissionPresets` | `catalog` | The unchanged official picker reads the real catalog and persists selection through the official permission command. The marked official preset fork derives per-session policy enforced at the R2 tool boundary. |
| `commands` | `list`, `execute` | The official `/permission` parser and handler run with a Host command ID and atomic policy facts/receipt. RPC replay is idempotent; conflicting reuse rejects. Failed results reach the official error surface. Command trajectory and Agent injection notices are not yet part of the unified conversation journal. |

Registrations are authoritative in
`packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/src/remote.ts`,
`remote-workspace.ts`, `remote-workspace-files.ts`, `remote-settings.ts`,
`remote-schedule.ts`, `remote-directories.ts`, `remote-uploads.ts`, and
`remote-permissions.ts`. Owner access streaming is registered by `remote-access.ts`.

## Implemented official stream surface

| Endpoint | Data contract | Runtime detail |
| --- | --- | --- |
| `remoteAccess/follow` | Official authenticated owner baseline, then lifetime until cancellation. | Unchanged RemoteAccess and generated Gateway codecs consume the actual owner Host's acknowledgment. Payloads cannot supply owners/grants; shared non-owner policy is not implemented. |
| `session/follow` | Opening snapshot and dense journal events. | Host journal projection; direct-subagent addresses are rejected. |
| `session/control` | Owner Session baseline and later control updates. | Committed Host notifications and durable projection revisions govern updates; accepted mutation results use that same server revision. |
| `workspace/follow` | Baseline followed by replace frames. | Committed owner invalidations trigger authoritative reads; initial/reconnect baselines and body cancellation own subscription lifetime. |
| `workspaceFiles/changes` | File-version/change observations. | Real Host metadata, not synthetic preview output. |
| `toolResults/watch` | Result values projected from durable `tool/result` events. | Retained inspection after reload is a tracked compatibility difference from the official live-only source. |

Token deltas remain on `/api/agent-live`; these logical streams are not a token
polling substitute. Browser navigation tears down the carrier normally while
the durable Session/execution continues.

The unchanged official RemoteStream supervises physical carrier recovery, and an
isolated unchanged Gateway owns the real Connection generation. Business errors
and malformed protocol frames are terminal. Every recovered stream opens a new
baseline or resumes its durable cursor; an old projection revision cannot replace
a newer value. The former custom generation bootstrap is disabled inventory.

## Client adapters and fallback rules

`packages/client/dsh-base-client-session-host` supplies official Session,
workspace, workspace-file, and permission gateways. The Session adapter uses
those gateways for migrated reads/mutations, including prompt/page/fork/queue.
The official Connection RPC is used when active; the transport can use same-origin
fetch during boot.

A legacy fallback is allowed only for endpoint absence (`404`/`405`,
`gateway/endpoint-unavailable`, or `gateway/definition-unavailable`). Business
errors, revision conflicts, validation failures, and network failures after a
possibly admitted mutation are surfaced rather than replayed on the other
carrier.

`settings-remote.ts` and `schedule-remote.ts` preserve official argument shapes,
Host schemas/revisions, and result failures. They do not manufacture browser-only
successful settings/schedule writes. `remote-mount.ts` delegates generated
namespace installation and withdrawal to an isolated unchanged Gateway. The
unchanged official RemoteAccess plugin owns its access snapshot, iterable effects,
rollback, disposal order and caller-fiber lifetime. Service access is distinct
from agent tool permission policy.

Model projections use the official `{lastUsed, next}` structure consistently
across unary, control/follow and legacy carriers. `next` reflects the durable
Session selection and effort, including after a cold load. `lastUsed` records
the executed frozen request configuration. Returned provider model provenance
is stored separately and remains unknown when not supplied by the response.

## Host-specific or incomplete surfaces

| Surface | Current source of truth or limitation |
| --- | --- |
| Credentials/BYOK | Encrypted per-owner Host credential methods. Values are never returned by describe; runtime credentials are injected at claim. A stored credential read/decryption failure blocks execution instead of silently selecting the platform provider. Unset BYOK permits fallback only when deployment platform consumption is explicitly enabled; the template defaults to disabled. |
| Tool approvals | `pendingApprovals` / `resolveApproval` bind Think tool-call and paused-execution identities. Committed owner notifications and retained Session lifetimes drive the official UI waterfall; only user choices become decisions. Cancellation and failures never submit rejection; transient failures may retry only the same idempotent chosen decision with a bounded delay. |
| Policy context | `approvalModelContext` returns official SystemPrompt context and ApprovalService notices from the policy transaction. The next SDK step persists stable non-human notice identities without waking inference. Canonical UI command/notice history and the complete native Agent inbox remain separate gaps. |
| Account | Better Auth/D1 is mapped to the official Account UI. It is not DeepSeek OAuth/billing. Billing is visibly disabled; balance returns the official nullable absence, not a fabricated amount. Sign-out preserves HTTP/network failures. |
| Models and effort | Host-backed model directory/discovery and real model selection. Platform routing requires unset BYOK plus explicit deployment enablement. Effort is durable and passed to the provider; an old Host that ignores requested effort is rejected. |
| Uploaded files | Session-bound receipts commit with prompt admission in one transaction. Think reads admitted bytes with length/hash checks and bounded text/base64 access; no model-side document parser. Unconsumed uploads expire after 24 hours, with durable bounded GC/retry and admitted/fork references preserved. Browser PDF/Excel preview is a distinct real implementation. |
| File mutations | Custom Host file APIs backed by R2/DO metadata; official read/change contracts coexist with them. |
| Skills/references | Real catalog/workspace/session data is adapted for the official composer. This is not a general official command registry. |
| Feedback | Conversation-log feedback is unavailable. Official message/session feedback controls remain visible and disabled; Remote submission and `/feedback` explicitly reject. Sidecar contract helpers are tested but not mounted as fake log submission. |
| Plugin inventory | `pluginInventory.list()` returns a read-only projection of real client Loader entries plus the pinned preset declaration groups; manager `listBundles` is empty because no owner-manageable package exists. Every install/update/physical-uninstall/registry call returns an explicit unavailable error. | No synthetic installed inventory and no owner-level switch; the seam is adaptation-only. |
| Agent presets | The marked ui-agent-preset fork exposes the four official ids with their real pinned declarations and a canonical `dsh-base-think` default in Settings and the composer. Creation with official ids is rejected; the Host accepts only the canonical fixed composition. Read/select never fake success. |
| Plugin inventory | Actual client composition entries, origins and fiber states; disabled originals remain. No installed bundle is invented, and dynamic management methods reject. |
| `/permission` | Official preset selection changes that Session only; the settings default applies to new Sessions. Actual R2 file operations enforce policy and never-policy refuses approval-dependent operations. |
| Think delegation | Unavailable for both BYOK and platform modes: the retained plugin advertises the limitation and registers no `delegate_task`. Historical facet export/storage/reads remain compatible, while model/turn/step/tool execution rejects before provider access. Official subagent registry/history/controller mapping remains absent. |
| Terminal, dynamic Cordis, native settings editor, real HMR rebuild | Required Host capabilities are absent and must remain visible as unavailable. |
| General jobs/goals and other optional namespaces | Inspect each adapter and its reuse gaps; a compatibility object or empty read is not proof that the full official Host capability exists. |

## Generated type contracts

`pnpm check:types` invokes the pinned official `WorkspaceAnalyzer` and
`FaceModelEmitter` to generate real Remote declarations under ignored artifacts.
It consumes official dependencies as compiler-emitted declarations and strictly
checks all owned Client/Worker/Think sources plus the app entries/configurations.
The exact file counts are recorded in `.artifacts/typecheck/report.json` and the
current acceptance ledger. Dependency extraction uses `noCheck`; owned checking
never does or filters diagnostics.
This validates bridge consumers against generated contracts, not the entire
upstream repository's semantics or every Remote behavior.

## History and sequence contract

`@dsh-base/session-wire` builds official-style history/follow records from the
shared dense journal. `throughSeq` is an inclusive cut (`-1` is empty),
`beforeSeq` is an exclusive older-page bound, and message/turn windows use the
registered bridge validation. Out-of-range cuts fail; unsupported direct-subagent
addresses fail explicitly. Think remains authoritative for admitted execution
history and the Host preserves queued inputs while synchronizing that history.

Turns follow admitted user requests, not individual assistant rows. Tool approval
and its continuation are multiple Steps in the same Turn. Page, follow and the
legacy carrier use the same lifecycle snapshot and sequencer; tool results retain
their original call Context, and transient tokens wait for its journal start.
Lifecycle records carry the canonical request identity separately from a legacy
user-message identity. Pending approval never creates a completion disclosure.
Unknown imported outcomes are not silently labeled completed.

Assistant Step identities remain unique and stable as more SDK groups arrive.
Host statistics use actual SDK Step evidence with durable per-execution
deduplication; approval continuation does not create another logical Turn.
The protected Host-specific `runtimeInfo` reports its own deployment version,
allowing remote acceptance to wait for the selected Durable Object code before
testing provider behavior.

## Acceptance

Use the tests named in the root scripts for wire envelopes, mapping, paging,
queue/cancellation, revision conflicts, stream cancellation, and replay safety.
Then verify origin/fibers and rendered interaction through local/deployed browser
acceptance. Full official parity requires comparing the same states and actions
against the pinned official UI; successful HTTP status codes or a complete
package roster are insufficient. The current local result is 108 checked inventory rows, 76 scoped
reference/integration browser cases and 7 document-worker/login-policy cases,
with a separate no-private-traffic public-login assertion. Deployment/remote
results are recorded separately in [completion-status.md](completion-status.md).

## Projection revision versus conversation cursor

`session/projections`, follow projection baselines, command acknowledgements and control changes share an atomic persisted projection revision. The chat journal keeps its own dense cursor. This is an explicit Host compatibility gap from the official single event-derived watermark; no browser Date.now() sequence is fabricated. Exact forks preserve the chat prefix and official conservative closers, while current permission facts remain separately inherited. See [differences](official-differences.en.md).
