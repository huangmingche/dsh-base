import type { SessionHostSubmissionStatus, SessionMessageRecord, SessionTranscriptSnapshot, SessionTurnState } from "./storage.ts";

/** Waiting for a human is active work, but is not an alarm-runnable input. */
export function activeSubmission(status: SessionHostSubmissionStatus): boolean {
  return status === "queued" || status === "running" || status === "awaiting-approval" || status === "continuing";
}

export function pendingToolApproval(records: readonly { role: string; parts: readonly unknown[] }[]): boolean {
  return records.some(record => record.role === "assistant" && record.parts.some(part => {
    if (typeof part !== "object" || part === null) return false;
    const state = (part as { state?: unknown }).state;
    const output = (part as { output?: { status?: unknown } }).output;
    return state === "approval-requested" || state === "approval-responded" || output?.status === "paused";
  }));
}

function text(record: SessionMessageRecord): string {
  return record.parts.flatMap(part => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" ? [String((part as { text?: unknown }).text ?? "")] : []).join("");
}

/** Correlate legacy random user ids once, without letting the UI guess endings. */
export function turnStates(snapshot: SessionTranscriptSnapshot): SessionTurnState[] {
  const users = snapshot.records.filter(record => record.role === "user");
  const exactIds = new Set(snapshot.submissions.map(submission => submission.requestId));
  const assigned = new Set<string>();
  const states: SessionTurnState[] = [];
  for (const submission of snapshot.submissions) {
    const legacyUsers = users.filter(record => !assigned.has(record.id) && !exactIds.has(record.id) && text(record) === submission.text);
    const legacySubmissions = snapshot.submissions.filter(row => !users.some(user => user.id === row.requestId) && row.text === submission.text);
    // Old random ids have no durable key. Only an unambiguous one-to-one
    // match is recoverable; repeated identical prompts stay unknown.
    const user = users.find(record => record.id === submission.requestId)
      ?? (legacyUsers.length === 1 && legacySubmissions.length === 1 ? legacyUsers[0] : undefined);
    if (user === undefined) continue;
    assigned.add(user.id);
    const start = snapshot.records.findIndex(record => record.id === user.id);
    const end = snapshot.records.findIndex((record, index) => index > start && record.role === "user");
    const messages = snapshot.records.slice(start + 1, end < 0 ? undefined : end);
    let status: SessionTurnState["status"] = submission.status === "continuing" ? "running" : submission.status;
    // Old releases persisted completed when Think paused on a tool approval.
    // Preserve terminal cancellation/failure; a continuation is explicitly running.
    const authoritativeEnd = snapshot.events.some(event => event.type === "submission.completed"
      && (event.payload as { submissionId?: unknown; authoritative?: unknown } | null)?.submissionId === submission.submissionId
      && (event.payload as { authoritative?: unknown }).authoritative === true);
    if (status === "completed" && !authoritativeEnd && pendingToolApproval(messages)) status = "awaiting-approval";
    const failure = [...snapshot.events].reverse().find(event => event.type === "submission.failed"
      && typeof event.payload === "object" && event.payload !== null
      && (event.payload as { submissionId?: unknown }).submissionId === submission.submissionId);
    const error = typeof (failure?.payload as { message?: unknown } | undefined)?.message === "string" ? (failure!.payload as { message: string }).message : undefined;
    const started = snapshot.events.find(event => event.type === "submission.running" && (event.payload as { submissionId?: unknown } | null)?.submissionId === submission.submissionId);
    states.push({ requestId: submission.requestId, userMessageId: user.id, status,
      ...(snapshot.executionSteps?.[submission.requestId] === undefined ? {} : {steps:snapshot.executionSteps[submission.requestId]!.map(({id,startedAt})=>({id,startedAt}))}),
      ...(status === "queued" ? {} : { startedAt: started?.createdAt ?? submission.createdAt }),
      ...(["completed", "cancelled", "failed"].includes(status) ? { endedAt: submission.updatedAt } : {}),
      ...(status === "failed" && error !== undefined ? { error } : {}) });
  }
  // Forks/imported history intentionally has no submission ledger. The Host
  // owns this fallback: pending tool parts remain open, and an active tail is
  // never inferred complete from an assistant's text alone.
  for (const user of users) {
    if (assigned.has(user.id)) continue;
    const start = snapshot.records.findIndex(record => record.id === user.id);
    const end = snapshot.records.findIndex((record, index) => index > start && record.role === "user");
    const messages = snapshot.records.slice(start + 1, end < 0 ? undefined : end);
    const inherited = snapshot.inheritedTurns?.find(turn => turn.userMessageId === user.id);
    const status = inherited?.status ?? (pendingToolApproval(messages) ? "awaiting-approval" : end < 0 && snapshot.session.running ? "running" : "unknown");
    states.push({ ...inherited, requestId: inherited?.requestId ?? user.id, userMessageId: user.id, status });
  }
  return states.sort((a, b) => users.findIndex(user => user.id === a.userMessageId) - users.findIndex(user => user.id === b.userMessageId));
}
