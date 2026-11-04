/** Durable user-request identity across Think's separately identified continuations. */
export type InputExecutionStatus = "running" | "awaiting-approval" | "completed" | "failed" | "cancelled";
export interface InputExecution {
  readonly status: InputExecutionStatus;
  readonly sdkRequestId?: string;
  readonly continuationId?: string;
  readonly error?: string;
}
export interface ContinuationIntent { readonly phase: "prepared" | "started" | "settled"; readonly sdkRequestId?: string; }
export interface ExecutionStatistics {
  readonly sdkRequestId: string;
  readonly steps: number;
  readonly llmMs: number;
  readonly ttftMs: number;
  readonly ttftSteps: number;
  readonly decodeMs: number;
  readonly decodeTokens: number;
  readonly contextBreakdown?: { systemTokens: number; toolsTokens: number };
  readonly usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}
export interface InputExecutionConfig { readonly model: string; readonly reasoningEffort?: 'off' | 'low' | 'high' | 'max' }
export interface ModelStepEvidence {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly assistantAt?: number;
  readonly requestedModel: string;
  readonly reasoningEffort?: InputExecutionConfig['reasoningEffort'];
  readonly responseModel?: string;
  readonly toolTimings?: readonly { callId: string; startedAt: number; endedAt?: number }[];
  readonly toolCallTimes?: readonly {callId:string;time:number}[];
  readonly parts: readonly unknown[];
  readonly chunks: readonly { type: string; index: number; text: string; time: number; id?: string; name?: string }[];
}
interface Sql { exec(query: string, ...bindings: string[]): Iterable<Record<string, unknown>>; }
/** Uses the existing per-Agent settings table; every transition is synchronous and durable. */
export class InputExecutionLedger {
  private readonly sql: Sql;
  private readonly storage: { sql: Sql; transactionSync<T>(callback: () => T): T };
  constructor(storage: { sql: Sql; transactionSync<T>(callback: () => T): T }) { this.storage = storage; this.sql = storage.sql; }
  private read<T>(key: string): T | undefined {
    const row = [...this.sql.exec("SELECT value FROM dsh_agent_settings WHERE key = ?", key)][0];
    if (row === undefined) return undefined;
    if (typeof row.value !== "string") throw new Error("input_execution_storage_invalid");
    return JSON.parse(row.value) as T;
  }
  private write(key: string, value: unknown): void {
    this.sql.exec("INSERT INTO dsh_agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }
  canonicalRequestId(userMessageId: string): string { return this.read<string>(`input-user:${userMessageId}`) ?? userMessageId; }
  userMessageId(requestId: string): string { return this.read<string>(`input-message:${requestId}`) ?? requestId; }
  bindUser(requestId: string, userMessageId: string): void {
    return this.storage.transactionSync(() => {
    const canonical = this.read<string>(`input-user:${userMessageId}`);
    const message = this.read<string>(`input-message:${requestId}`);
    if ((canonical !== undefined && canonical !== requestId) || (message !== undefined && message !== userMessageId)) throw new Error("input_identity_conflict");
    this.write(`input-user:${userMessageId}`, requestId);
    this.write(`input-message:${requestId}`, userMessageId);
    const legacy = this.get(userMessageId);
    if (requestId !== userMessageId && this.get(requestId) === undefined && legacy !== undefined) this.set(requestId, legacy);
    const legacyConfig = this.configuration(userMessageId);
    if (requestId !== userMessageId && this.configuration(requestId) === undefined && legacyConfig !== undefined) this.write(`input-config:${requestId}`, legacyConfig);
    });
  }
  get(requestId: string): InputExecution | undefined { return this.read(`input-execution:${requestId}`); }
  configuration(requestId: string): InputExecutionConfig | undefined { return this.read(`input-config:${requestId}`); }
  /** Freeze one resolved route, only upgrading a legacy bare config or no-op same value. */
  freezeModel(requestId: string, model: string): InputExecutionConfig | undefined {
    const existing = this.configuration(requestId);
    if (existing === undefined) return undefined;
    if (existing.model === model) return existing;
    if (existing.model.includes('/')) throw new Error('input_provider_conflict');
    const next = { ...existing, model };
    this.write(`input-config:${requestId}`, next);
    return next;
  }
  configure(requestId: string, config: InputExecutionConfig): InputExecutionConfig {
    return this.storage.transactionSync(() => {
      const existing = this.configuration(requestId);
      if (existing !== undefined) return existing;
      this.write(`input-config:${requestId}`, config);
      return config;
    });
  }
  steps(sdkRequestId: string): readonly ModelStepEvidence[] { return this.read(`input-steps:${sdkRequestId}`) ?? []; }
  /** A retry keeps the first entered-step clock, including before the first token. */
  startStep(sdkRequestId: string, stepId: string, startedAt: number): number {
    return this.storage.transactionSync(() => {
      const key = `input-step-start:${sdkRequestId}:${stepId}`;
      const previous = this.read<number>(key);
      if (previous !== undefined) return previous;
      this.write(key, startedAt);
      return startedAt;
    });
  }
  recordStep(sdkRequestId: string, evidence: ModelStepEvidence): void {
    const steps = [...this.steps(sdkRequestId)];
    if (steps.some(step => step.id === evidence.id)) return;
    steps.push(evidence); this.write(`input-steps:${sdkRequestId}`, steps);
  }
  toolTiming(requestId: string, callId: string): {callId:string;startedAt:number;endedAt?:number} | undefined { return this.read(`input-tool-time:${requestId}:${callId}`); }
  recordToolTiming(requestId: string, callId: string, time: number, ended = false): void {
    const old = this.toolTiming(requestId,callId);
    if (ended && old === undefined) return; // no invented start after a missing hook
    if (old?.endedAt !== undefined || (!ended && old !== undefined)) return;
    this.write(`input-tool-time:${requestId}:${callId}`,{callId,startedAt:old?.startedAt ?? time,...(ended?{endedAt:time}:{})});
  }
  set(requestId: string, value: InputExecution): void { this.write(`input-execution:${requestId}`, value); }
  statistics(sdkRequestId: string): (ExecutionStatistics & { complete: boolean }) | undefined { return this.read(`input-statistics:${sdkRequestId}`); }
  recordStatistics(statistics: ExecutionStatistics, complete: boolean): void {
    // Store a cumulative snapshot, never an increment. Replayed response hooks
    // and a lost Host RPC can read the same final accounting repeatedly.
    if (this.statistics(statistics.sdkRequestId)?.complete) return;
    this.write(`input-statistics:${statistics.sdkRequestId}`, { ...statistics, complete });
  }
  userFor(sdkRequestId: string): string | undefined { return this.read(`input-sdk:${sdkRequestId}`); }
  intent(requestId: string, approvalId: string): ContinuationIntent | undefined { return this.read(`input-continuation:${requestId}:${approvalId}`); }
  begin(requestId: string, approvalId: string): InputExecution {
    return this.storage.transactionSync(() => {
    const current = this.get(requestId);
    if (this.intent(requestId, approvalId) !== undefined) return current ?? { status: "running" };
    if (current?.status === "cancelled" || current?.status === "completed" || current?.status === "failed") return current;
    this.write(`input-continuation:${requestId}:${approvalId}`, { phase: "prepared" });
    const next: InputExecution = { status: "running", continuationId: approvalId };
    this.set(requestId, next);
    return next;
    });
  }
  start(requestId: string, sdkRequestId: string): void {
    return this.storage.transactionSync(() => {
    const current = this.get(requestId);
    if (current?.status === "cancelled") throw new Error("input_cancelled");
    this.write(`input-sdk:${sdkRequestId}`, requestId);
    const next: InputExecution = { status: "running", sdkRequestId, ...(current?.continuationId === undefined ? {} : { continuationId: current.continuationId }) };
    this.set(requestId, next);
    if (next.continuationId !== undefined) this.write(`input-continuation:${requestId}:${next.continuationId}`, { phase: "started", sdkRequestId });
    });
  }
  settle(requestId: string, sdkRequestId: string | undefined, status: InputExecutionStatus, error?: string): InputExecution {
    return this.storage.transactionSync(() => {
    const current = this.get(requestId);
    // A delayed response hook from the pre-approval call must not close its
    // newer continuation. Cancellation is also sticky across hook replay.
    if (current?.status === "cancelled" || (sdkRequestId !== undefined && current?.continuationId !== undefined && this.intent(requestId, current.continuationId)?.phase === "prepared") || (sdkRequestId !== undefined && current?.sdkRequestId !== undefined && current.sdkRequestId !== sdkRequestId)) return current;
    const next: InputExecution = { ...current, status, ...(error === undefined ? {} : { error }) };
    this.set(requestId, next);
    if (next.continuationId !== undefined) this.write(`input-continuation:${requestId}:${next.continuationId}`, { phase: "settled", ...(sdkRequestId === undefined ? {} : { sdkRequestId }) });
    return next;
    });
  }
  decision(requestId: string, toolCallId: string, approved: boolean): "new" | "same" {
    return this.storage.transactionSync(() => {
    const key = `input-decision:${requestId}:${toolCallId}`;
    const previous = this.read<{ approved: boolean }>(key);
    if (previous !== undefined) {
      if (previous.approved !== approved) throw new Error("approval_decision_conflict");
      return "same";
    }
    this.write(key, { approved });
    return "new";
    });
  }
}
