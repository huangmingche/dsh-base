# Session Wire

This pure transport seam is shared by Worker Host and browser. It projects durable messages and actual execution state into the official Session journal without copying official source. The mux, legacy Host carrier and history pages use the same projection.

One user requestId owns one Turn, with model calls and tool execution forming Steps. Approval waiting does not end the Turn. Denied tools retain error results and let the model continue explaining. Completion, failure, cancellation and fork truncation use authoritative Host states. Queued input cannot overtake execution; legacy identities require an explicit Host-proven mapping.

New executions retain a stable SDK Step identity, start/settlement times and tool clocks. Host expands SDK messages into records with the same identities, so live settlement and reloaded history do not duplicate Steps. A late approved tool extends its original Step while preserving the assistant settlement timestamp. Actual tool argument deltas use the official `tool-call-delta` stream and unchanged tool definition, displaying preparing state before settlement without inventing a durable call early.

Step entry is persisted independently of assistant messages. A failure or cancellation before the first token therefore retains the same Step in live and reloaded history, beginning at its actual entry time and ending at the authoritative terminal time. Inputs that never entered a model Step do not acquire an invented Step.

Forks preserve the exact Host seed produced by official `buildForkSeed`, including truncation closers. Inherited messages do not regenerate events; new input appends after the seed. Model selection uses official `{ lastUsed, next }` and preserves reasoningEffort. Trusted execution-request evidence supplies `lastUsed`; actual provider response model identity is separate evidence. Missing response or legacy attribution is never filled from the current picker.

The durable Host projection revision and chat journal cursor are separate domains. Snapshot/control compare projection values only by their revision. Missing historical outcomes, clocks and attribution remain unknown. Think remains a different execution engine from native DSH; mapped contracts do not establish complete engine equivalence.

`pnpm check:session-wire` runs the actual pinned Conversation assembler, turn-process, tool definition and ModelDirectory. It covers tool preparation, per-Step settlement, late approval timing, duplicate frames, reload, exact fork seeds, durable Pro/effort selection and failure outcomes. Tests do not call a model; deployed browser workflows require separate acceptance.
