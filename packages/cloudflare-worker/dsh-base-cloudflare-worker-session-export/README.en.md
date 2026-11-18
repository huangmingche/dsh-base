# Session export compatibility seam

Mounts the pinned `@deepseek-ai/dsh-session-log-export` unchanged in a request-scoped Cordis context. Serves its `GET/HEAD /api/session.markdown` and `GET/HEAD /api/session.export` routes with the original Markdown formatter and streaming ZIP writer. The official client plugin owns the UI.

When R2 confirms that an admitted file is missing, the official ZIP lists it in `attachments-missing.txt` and includes the session log. Storage errors, unadmitted references and integrity failures stop the export.

Every request authenticates before selecting the account's Session Host Durable Object. The title and complete committed transcript come from one snapshot, independent of browser pagination. Files must actually be admitted to the selected Session and pass R2 digest and length verification; callers cannot select object keys or owners. Responses cannot be cached; failures never disclose internal paths, R2 keys or credentials. Duplicate query parameters, non-read methods and cross-origin requests are rejected explicitly.

The export represents this Host's existing Think conversation-event projection, not a full native DSH execution-engine journal. Uncommitted streaming tokens and native runtime events absent from that projection are never invented. Legacy timestamps retain the existing projection semantics. Subagents are unavailable; ordinary forks include their inherited prefix once and never include source or sibling Sessions as descendants. Unavailable image processing fails explicitly. Ordinary attachments retain the 8 MiB bound and are verified individually before feeding chunks to the original ZIP writer. No new infrastructure, scheduled tasks or outbound network calls are required.

ZIP HEAD and GET validate the artifact using the official current-format codec. Legacy logs without reliable lifecycle endings explicitly refuse ZIP export instead of inventing events; Markdown remains readable. Snapshot title metadata uses the current label so inherited fork titles cannot override a later rename.

`/export` reuses the original command definition and handler. The owner Host atomically persists command lifecycle records and idempotent receipts without starting a model or fabricating an Agent; paths and attachments are rejected. As with permission commands, those records have not yet joined the canonical chat event projection. Download cancellation stops attachment reads and disposes the request-scoped plugin.

Regressions cover real Host prompt → cancel, full history, forks, current-format restoration, owner isolation, attachment integrity, HEAD, cancellation and command retries.

Regression: `node --experimental-strip-types --import ./packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs packages/cloudflare-worker/dsh-base-cloudflare-worker-session-export/tests/routes.test.ts`.
