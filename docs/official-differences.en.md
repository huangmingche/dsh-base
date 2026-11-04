# Differences from official DSH

The reference is exclusively the clean local submodule at `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`. Updated 2026-11-10. This describes the working tree; exact build, deployment and test evidence belongs in [completion status](completion-status.md). [中文](official-differences.md)

**Whole-product UI/UX and execution equivalence is not established.** Inventory coverage, active fibers, component comparisons and full-product behavior are separate claims. A disabled control honestly exposes a gap; it does not complete the capability or approve a permanent deviation.

## Implementation gaps addressed in this change

These were not Worker limitations: real model/effort persistence and admission-time execution snapshots; canonical official model IDs with requested and returned provenance kept separate; per-session permissions using the marked official preset fork and actual R2 enforcement; committed owner notifications and cross-tab refresh; real SDK tool/step evidence; evidence-backed `lastUsed`; exact event-prefix forks using unchanged `buildForkSeed`; persistent D1 authentication limits; official Cron and DST handling; restored official preset roster and declaration reading; rejection of invalid permission defaults before any settings write/revision/notification; removal of invented context-token breakdowns. Final acceptance is recorded separately.

Steps that fail before the first token retain their actual durable start and failure trajectory on cold reload. Fresh Agent history sync retains existing Host timing and model provenance without replacing newer tool results.

Approval continuation now deduplicates repeated SDK Steps within one user Turn and merges actual tool results without letting an earlier snapshot overwrite a terminal state. Affected completed historical records are repaired transactionally from already-persisted Agent SDK messages. Recovery never reruns the model or tool and never invents a missing result.

Approval presentation follows committed notifications and real Session subscription lifetimes instead of a timer. Reads are serialized per Session, identical call IDs are isolated across Sessions, and cancellation of the official PendingApproval never submits rejection. Only an actual user choice is sent; a lost acknowledgment can retry only that same idempotent choice. HTTP, business and presentation failures remain errors.

The unchanged ApprovalService generates policy-change notices and SystemPrompt generates the current policy context. Policy and notices commit in one Host transaction; the next SDK step consumes stable message IDs without waking the Agent or adding user Turns. Initialization, no-op selections and failed transactions produce no notice; restarts do not duplicate delivery. This narrow Host port does not supply the native Agent scheduler.

The unchanged Typert registry and RemoteAccess client replace the fixed browser owner snapshot. An isolated unchanged Gateway owns generated contracts and the sole connection lifecycle. Access stays denied until the authenticated Host confirms the owner baseline, reconnects through official supervision, and withdraws namespaces/subscriptions on unmount. The former custom connection bootstrap remains disabled inventory.

Forks exclude later tool results from both UI history and model context, preserve the exact seed across restarts and continuation, and retain workspace membership. Their default boundary is the latest closed-turn prefix. Aggregate usage beyond an inherited cursor is not assigned to the branch. `approval: never` rejects operations that require approval; it does not grant consent. File sandbox policy does not claim to govern network requests.

## Actual boundaries of the current Worker-only deployment

| Capability | Concrete boundary |
| --- | --- |
| Native terminal, PTY, subprocesses and native executable tools | Worker isolates do not supply native process/PTY execution. A container or remote executor would add an execution plane. Official terminal controls remain visible and unavailable. |
| User-computer folders, persistent POSIX filesystem, native settings editor | R2 logical workspaces are not the operator's disk. The Worker VFS does not supply persistent native filesystem semantics. Browser grants or a local companion are required for native access. Logical browsing/files/preview remain available. |

Sources: [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) and [filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).

Cloudflare can retire a connection, but failing to recover from that loss is not a required platform deviation. Synchronized browser and Tail evidence on the intermediate build captured `loadShed` alongside one `session/follow` close code 1006; that does not establish a fixed timeout or a specific CPU/memory cause. Cloudflare's [WebSocket lifecycle documentation](https://developers.cloudflare.com/workers/runtime-apis/websockets/#connection-lifetime) also requires reconnection and state recovery. The seam must use the official RemoteStream recovery contract for physical carrier loss while preserving business and protocol failures. Final repair/deployment evidence is recorded separately.

## Remaining integration work, not physical platform impossibilities

| Difference | Missing integration and current behavior |
| --- | --- |
| Images and vision | The official Sharp provider requires full decoding and EXIF/animation/alpha/color-space/pixel/byte validation. An Images/WASM replacement has not passed those contracts or atomic admission tests. Images remain explicitly unavailable; ordinary file upload works. |
| Agent PDF/Office understanding | Official browser preview works. The Agent has authorized raw-byte reads, without a validated extraction/conversion and model-context adapter. |
| Full subagents and descendant lifecycle | Think facets do not implement the official Session identities, credentials, inbox/step ownership, durable settlement and descendant cancellation protocol. Workers/DO can support this; the bridge is unfinished. No fake delegation tool is registered. Historical facet storage remains readable. |
| Executing the official presets and reading real child-root declarations | A complete marked fork of the official ui-agent-preset package preserves all official behavior; roster and declaration reading are fixed: the four official modes render as official built-ins with truthful execution gaps, and their pinned YAML declarations are readable. Execution remains the Cloudflare Think composition; the official Cordis child-root lifecycle is not mounted. PTC/Minimal stay hidden while Coding Tools is off, matching official behavior. | Declaration viewing does not claim those modes can start. Selection/creation with official ids is refused in the Remote, Host and legacy fallback; ids are never silently aliased to Think. No fabricated YAML. |
| Install/remove/switch plugins, dynamic code and production HMR | Literal composition lacks an isolated build/loader, durable profiles, dependency invalidation and rollback. Dynamic Workers is a possible implementation path. Local Vite HMR does not establish production plugin HMR. Real client inventory remains inspectable; Worker/Think runtime inventory is not fabricated. |
| General jobs/goals/runs and queue steering | Cleanup, schedules and recovery jobs are not the official Session task runtime. The complete next-step input/task protocol is missing. Supported queue edits/removal remain distinct from unavailable steer. |
| Ungrouped/unregistered working directories | Sessions currently require durable logical Workspace membership; unsupported locations are rejected rather than silently replaced. |
| Non-owner Peer sharing | The official owner access-state stream now works; shared Peer identities, dynamic grant/revoke and non-owner policy management are not implemented. The server validates ownership; requests cannot supply owners/grants. Service access and agent tool presets are separate. |
| Native execution semantics | Think remains a Session adapter, not the official agent loop. Compaction, request logs, policy history and accounting are not completely equivalent. Precise forks preserve the projected journal, not facts never recorded in it. |
| Permission command and policy-notice trajectory | Official `/permission` parsing, execution, policy effects, durable receipts and retry deduplication work. Its `command/run` and `command/done` are not merged into the conversation journal, so corresponding history cards and query output are absent. Policy notices reach the next model step but are not yet unified into the canonical UI journal. Errors are explicit; model-facing delivery does not establish the native inbox or complete historical display. |
| Auto review, one-operation escalation and historical policy forks | Auto review integration and tool-fs `sandbox_permissions`/`justification` escalation are absent. R2 checks current standing policy. Chat forks inherit current source policy rather than policy at the historical cut. Projection revisions remain separate from chat cursors. Official policy notices now reach the next step through the Host port; precise chat forks do not establish precise historical policy forks, Auto review or a unified native journal. |

Cloudflare supports [raw-byte Images transformations](https://developers.cloudflare.com/images/optimization/binding/) and [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/). These rows remain integration work, not claims that Workers cannot implement them. They are not marked completed or approved permanent deviations.

## External-service and historical-evidence dependencies

DeepSeek balances, top-ups and platform account pages need official identity/billing contracts; local Better Auth does not provide them. Official conversation-log feedback uses DeepSeek Messages log extensions, which are not established by the public Chat Completions Gateway. These official controls remain visibly unavailable; sidecar feedback is not substituted for log submission.

Mail verification, password reset and Google sign-in need the operator's service credentials. Old records with missing time/model/result evidence remain unknown. Old approval continuations without the original execution configuration fail closed while preserving data; they can be cancelled and resubmitted. New admissions preserve their real configuration.

Only two visual changes are approved (confirmed by the user on 2026-11-13): the sidebar shows the code name `dsh-base` in every locale, and there is no version line in the name slot (the official name fallback's version line disappears with the slot). The product display name `DeepSeek Harness Base` is used in README and documentation. Settings retains the version. The GitHub template flag belongs to publication after user review; this change deploys only the Worker, with no Git commit/push or GitHub publication.


## Current deployed verification (`ef8fb5d4`, 2026-11-10)

staging Worker `c2cb26b1-af74-4bbe-811b-2172c5070e11` (deployment
`c3fec801-0106-474b-935c-273c87f81251`, 100% traffic) restored the official
Agent preset catalog and read-only declarations through a complete marked fork
of `@deepseek-ai/dsh-client-ui-agent-preset`, and separates a platform
limitation from a real load failure. English and Chinese zero-model acceptance
verified four official rows in a neutral gray unavailable state plus canonical
`dsh-base-think`, all four pinned declarations, Coding Tools 5↔3, pointer/
keyboard guards and reload default, with the fork active and the official
original disabled inventory, and the fixed composition is displayed as `Cloudflare Think` / `Cloudflare Think 模式` (canonical id unchanged). Real declaration-load failures still render the
official red broken card/alert.
Models settings keeps the official DeepSeek provider and editor and adds a separate operator-managed Cloudflare AI Gateway provider card through the official provider-card slot. Host catalogs/selections carry explicit provider identities; Gateway and DeepSeek execute independently, owner-key breakage only disables DeepSeek, and bare legacy ids retain a marked compatibility route. General Settings shows the app version and the pinned upstream DeepSeek Harness name/tag on one localized line, with native links to the pinned repository and release URL. Settings → Built-in plugins also restores the official **Session plugins** group: Cloudflare Think is the six-row default composition from the shared `dshBase.agent` reader, the four pinned official declaration compositions are read-only through the official `definitionComposition` projection, and the global group remains the real client Loader inventory. Declared rows keep `fiberPhase: null`; no execution is claimed. This changes **catalog/read availability only**: official Standard/PTC/Minimal/
Cordis execution remains unavailable on this Workers-native Host, and
selection/creation with official ids continues to be refused rather than
aliased.

- The Language setting uses the unchanged official `@deepseek-ai/dsh-client-locale` behavior: built-in `zh` is shown as “中文” while its internal id stays unchanged. The former `client-locale-label` display-name fork was removed in Commit 1, so no display-name deviation remains.

- Sidebar branding uses the user-approved (2026-11-13) display-text seam `@dsh-base/client-brand`: it occupies only the public `sidebar.brand.name` slot and the sidebar shows the code name `dsh-base` in every locale; the product display name `DeepSeek Harness Base` is used in README and documentation, not in the sidebar. The official brand plugin already registers nothing outside the official build profile (kept enabled as the official no-op), while the mark keeps the SidebarRoot fallback (`FishLogo` with click-to-copy version); layout, typography and interaction stay official, with no CSS, fork or copied source. The one unavoidable difference: the official name fallback renders the version line and click-to-copy version inside that slot, so occupying it removes them; the Settings version row is unaffected.

- The Plugins page is mounted unchanged with the official list/detail/empty states and styling; the inventory is a read-only projection (adaptation seam, no owner-level switch, no write path) and unmanageable entries keep real read-only reasons. Add plugin and install/upgrade/registry/physical-uninstall report an explicit unavailable reason (a deployed Worker has no package-manager/process runtime) and never fake success.

- R1 (removed in Commit 1): the Cloudflare AI Gateway managed provider was removed entirely; the deployment is BYOK-only. Settings → Models keeps only the official DeepSeek provider — no Gateway row, green dot or platform-authentication state.
