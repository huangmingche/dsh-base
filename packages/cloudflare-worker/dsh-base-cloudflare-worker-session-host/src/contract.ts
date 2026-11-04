import type { SessionInputExecutionConfig, SessionReasoningEffort } from "./storage.ts";
/**
 * Workers-native Session Host contract for the official DSH chat UI.
 *
 * This package starts as a contract-only fork of the official Session Remote
 * surface. The implementation will be added incrementally; it is deliberately
 * not composed into the Worker until the contract is implemented and tested.
 */

/** One durable Session address used by the official client. */
export type SessionAddress =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "subagent"; readonly childSessionId: string };

/** Session list row projected to the official client. */
export interface SessionListRow {
  readonly sessionId: string;
  readonly title: string;
  readonly displayTitle: string;
  readonly running: boolean;
  readonly blank: boolean;
  readonly updatedAt: number;
  readonly cwd?: string;
  readonly workspaceId?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

/** One page of durable Session history. */
export interface SessionHistoryPage {
  readonly records: readonly unknown[];
  readonly hasMore: boolean;
}

/** Official session state snapshot. */
export interface SessionStateSnapshot {
  readonly sessionId: string;
  readonly title: string;
  readonly running: boolean;
  readonly archived: boolean;
  readonly model?: string;
  readonly reasoningEffort?: SessionReasoningEffort;
}

/** Model option exposed to the official session UI. */
export interface SessionModelOption {
  readonly id: string;
  readonly label: string;
  readonly contextWindow: number;
}

/** One queue operation requested by the official composer. */
export interface SessionQueueUpdate {
  readonly itemId: string;
  readonly action: "remove" | "retry" | "clear";
}

/** Prompt attachment reference accepted by the official session contract. */
export interface SessionAttachmentRef {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}

/** The official client's Session Remote namespace. */
export interface SessionHostContract {
  list(input: { cursor?: string }): Promise<{ sessions: readonly SessionListRow[]; cursor?: string }>;
  state(input: { sessionId: string }): Promise<SessionStateSnapshot>;
  page(input: { address: SessionAddress; before?: number; limit?: number }): Promise<SessionHistoryPage>;
  projections(input: { sessionId: string }): Promise<Record<string, unknown>>;
  prompt(input: {
    sessionId: string;
    text: string;
    attachments?: readonly SessionAttachmentRef[];
    requestId?: string;
  }): Promise<{ requestId: string; submissionId: string }>;
  cancel(input: { sessionId: string }): Promise<void>;
  rename(input: { sessionId: string; title: string }): Promise<{ title: string }>;
  create(input: { title?: string }): Promise<{ sessionId: string }>;
  fork(input: { sessionId: string; messageId?: string }): Promise<{ sessionId: string }>;
  attachment(input: { sessionId: string; file: SessionAttachmentRef }): Promise<{ id: string }>;
  updateQueue(input: { sessionId: string } & SessionQueueUpdate): Promise<void>;
  control(signal: AbortSignal): AsyncIterable<unknown>;
  follow(input: { address: SessionAddress; signal: AbortSignal }): AsyncIterable<unknown>;
  selectModel(input: { sessionId: string; model: string; reasoningEffort?: string }): Promise<SessionInputExecutionConfig>;
  models(): Promise<readonly SessionModelOption[]>;
}
