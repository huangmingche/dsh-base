/** Storage port for the Workers-native official Session Host. */
import type { DirectoryListing } from "@deepseek-ai/dsh-host-directory-picker/types";
import type { SessionListRow, SessionModelOption } from "./contract.ts";

/** A selection frozen when a user input is durably admitted. */
export type SessionReasoningEffort = "off" | "low" | "high" | "max";
export interface SessionInputExecutionConfig {
  readonly model: string;
  readonly reasoningEffort?: SessionReasoningEffort;
}

export interface SessionModelRequest extends SessionInputExecutionConfig {
  readonly sessionId: string;
  readonly requestId: string;
  readonly sdkRequestId: string;
}

/** Durable pre-token evidence that one actual SDK step entered execution. */
export interface SessionStepStart {
  readonly sessionId: string;
  readonly requestId: string;
  readonly sdkRequestId: string;
  readonly stepId: string;
  readonly startedAt: number;
}

/** Durable metadata for one Session. */
export interface SessionRecord {
  readonly sessionId: string;
  readonly title: string;
  readonly running: boolean;
  readonly blank: boolean;
  readonly archived: boolean;
  readonly model?: string;
  readonly reasoningEffort?: SessionReasoningEffort;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One durable transcript record ordered by a monotonically increasing sequence. */
export interface SessionMessageRecord {
  readonly id: string;
  readonly seq: number;
  readonly role: string;
  readonly parts: readonly unknown[];
}

/** One ordered Session Host event consumed by control/follow transports. */
export interface SessionHostEvent {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/** One durable Host attachment. */
export interface SessionHostAttachment {
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly dataBase64: string;
  readonly size: number;
  readonly createdAt: number;
}

/** Attachment reference carried by a prompt/submission. */
export interface SessionHostAttachmentRef {
  readonly attachmentId: string;
  readonly receiptId?: string;
  readonly file?: { attachmentId: string; name: string; bytes: number };
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}

/** One prompt submission queued in the Host. */
export type SessionHostSubmissionStatus = "queued" | "running" | "awaiting-approval" | "continuing" | "cancelled" | "completed" | "failed";

export interface SessionTurnState {
  readonly requestId: string;
  readonly userMessageId: string;
  readonly status: Exclude<SessionHostSubmissionStatus, "continuing"> | "unknown" | "forked";
  readonly error?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly steps?: readonly { id: string; startedAt: number }[];
}

export interface SessionTranscriptSnapshot {
  readonly forkSeed?: import('@dsh-base/session-wire').SessionForkSeed;
  readonly session: SessionRecord;
  readonly records: readonly SessionMessageRecord[];
  readonly submissions: readonly SessionHostSubmission[];
  readonly events: readonly SessionHostEvent[];
  readonly inheritedTurns?: readonly SessionTurnState[];
  readonly executionSteps?: Readonly<Record<string, readonly { id: string; sdkRequestId: string; startedAt: number }[]>>;
}

/** Durable submission row; a Worker runtime will claim queued rows later. */
export interface SessionHostSubmission {
  readonly submissionId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly text: string;
  readonly attachments?: readonly SessionHostAttachmentRef[];
  readonly status: SessionHostSubmissionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Storage port implemented by Durable Object SQLite (or an in-memory test double). */
export interface SessionHostStorage {
  /** Read transcript and its lifecycle authority at one SQLite boundary. */
  transcriptSnapshot?(sessionId: string): Promise<SessionTranscriptSnapshot>;
  /** Lifecycle state, its recovery event and aggregate running flag commit together. */
  transitionSubmission?(submissionId: string, status: SessionHostSubmissionStatus, eventType: string, payload: unknown): Promise<SessionHostSubmission>;
  /** Insert metadata and placement atomically without resetting named Sessions. */
  createSession(record: SessionRecord, placement: SessionCreatePlacement): Promise<{ sessionId: string }>;
  /** Fork presentation history and admitted file scopes in one durable transaction. */
  forkSession?(sourceId: string, target: SessionRecord, messages: readonly SessionMessageRecord[], projections: Record<string, unknown>): Promise<void>;
  directoryList?(path?: string): Promise<DirectoryListing>;
  directoryCreate?(path: string, name: string): Promise<string>;
  /** Archive and unpin atomically with the activity admission check. */
  archiveSession?(sessionId: string, stopActivity: boolean): Promise<void>;
  /** Atomic production admission; prevents duplicate/reordered prompt writes. */
  admitSubmission?(submission: SessionHostSubmission, parts: readonly unknown[], derivedTitle: string, receiptIds?: readonly string[], defaultConfig?: SessionInputExecutionConfig): Promise<{ requestId: string; submissionId: string }>;
  /** Picker writes are independent of later transcript/status writes. */
  selectModel?(sessionId: string, selection: SessionInputExecutionConfig): Promise<SessionInputExecutionConfig>;
  /** Replace one frozen input route after legacy compatibility resolution. */
  freezeInputModel?(sessionId: string, requestId: string, model: string): void;
  getInputExecutionConfig?(sessionId: string, requestId: string): Promise<SessionInputExecutionConfig | undefined>;
  projectionSnapshot?(sessionId: string): Promise<{ session: SessionRecord; values: Record<string, unknown>; revision: number; stepCounts: readonly import('./execution-stats.ts').AssistantStepCount[]; turns: number }>;
  renameSession?(sessionId: string, title: string): Promise<{ title: string; projectionRevision: number }>;
  recordModelRequest?(request: SessionModelRequest): Promise<void>;
  recordStepStart?(step: SessionStepStart): Promise<void>;
  /** Atomic projection of admitted Agent messages plus still-queued Host inputs. */
  syncMessages?(sessionId: string, messages: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<SessionMessageRecord[]>;
  /** Repair only a completed input's stale tool parts from trusted Agent evidence. */
  repairCompletedToolResults?(sessionId: string, messages: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<number>;
  listSessions(): Promise<readonly SessionRecord[]>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  putSession(record: SessionRecord): Promise<void>;
  pageMessages(
    sessionId: string,
    beforeSeq: number | undefined,
    limit: number,
  ): Promise<{ records: readonly SessionMessageRecord[]; hasMore: boolean }>;
  getProjections(sessionId: string): Promise<Record<string, unknown>>;
  putProjections(sessionId: string, value: Record<string, unknown>): Promise<void>;
  readAllMessages(sessionId: string): Promise<readonly SessionMessageRecord[]>;
  appendMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void>;
  replaceMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void>;
  nextMessageSeq(sessionId: string): Promise<number>;
  appendEvent(sessionId: string, type: string, payload: unknown): Promise<SessionHostEvent>;
  listEvents(sessionId: string, afterSeq: number, limit: number): Promise<readonly SessionHostEvent[]>;
  putAttachment(attachment: SessionHostAttachment): Promise<void>;
  getAttachment(attachmentId: string): Promise<SessionHostAttachment | undefined>;
  putSubmission(submission: SessionHostSubmission): Promise<void>;
  listWorkspaces(): Promise<readonly SessionWorkspaceRecord[]>;
  getWorkspace(workspaceId: string): Promise<SessionWorkspaceRecord | undefined>;
  putWorkspace(workspace: SessionWorkspaceRecord): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listMemberships(): Promise<readonly SessionWorkspaceMembership[]>;
  putMembership(workspaceId: string, sessionId: string, position: number): Promise<void>;
  removeMembership(workspaceId: string, sessionId: string): Promise<void>;
  deleteWorkspaceMemberships(workspaceId: string): Promise<void>;
  listSessionFlags(): Promise<Readonly<Record<string, SessionWorkspaceFlags>>>;
  putSessionFlags(sessionId: string, flags: SessionWorkspaceFlags): Promise<void>;
  getSubmission(submissionId: string): Promise<SessionHostSubmission | undefined>;
  listSubmissions(sessionId: string): Promise<readonly SessionHostSubmission[]>;
}

/** Resolved logical placement and official blank-reuse policy for creation. */
export interface SessionCreatePlacement {
  readonly permissionPreset?: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly requireLocation: boolean;
  readonly requestedWorkspaceId?: string;
  readonly reuseBlankOnly: boolean;
}

/** One durable Workspace. */
export interface SessionWorkspaceRecord {
  readonly workspaceId: string;
  readonly title: string;
  readonly path: string;
  readonly position: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One Workspace → Session membership. */
export interface SessionWorkspaceMembership {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly position: number;
}

/** Per-Session workspace flags. */
export interface SessionWorkspaceFlags {
  readonly pinned: boolean;
  readonly archived: boolean;
}

/** Read contract the first Workers-native Host milestone implements. */
export interface SessionHostReadContract {
  list(input: { cursor?: string }): Promise<{ sessions: readonly SessionListRow[]; cursor?: string }>;
  state(input: { sessionId: string }): Promise<{
    sessionId: string;
    title: string;
    running: boolean;
    archived: boolean;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  }>;
  page(input: {
    address: { kind: "session"; sessionId: string } | { kind: "subagent"; childSessionId: string };
    before?: number;
    limit?: number;
  }): Promise<{ records: readonly SessionMessageRecord[]; turns: readonly SessionTurnState[]; hasMore: boolean; before?: number }>;
  history(input: { sessionId: string }): Promise<{ records: readonly SessionMessageRecord[]; turns: readonly SessionTurnState[] }>;
  projections(input: { sessionId: string }): Promise<Record<string, unknown>>;
  rename(input: { sessionId: string; title: string }): Promise<{ title: string }>;
  selectModel(input: { sessionId: string; model: string; reasoningEffort?: string }): Promise<SessionInputExecutionConfig>;
  models(): Promise<readonly SessionModelOption[]>;
}
