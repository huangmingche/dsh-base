/**
 * Pure Session wire-event projection shared by the Workers Host stream bridge
 * and the browser seam.
 *
 * The official `session/follow` contract is a dense `event.seq` journal plus one
 * opening snapshot. Both sides must derive the same sequence from the durable
 * message rows, so the mapping lives here rather than in either runtime.
 */
import { FIXED_AGENT_PRESET_ID } from "../../dsh-base-agent-presets/src/index.ts";
import { providerForModelId } from "./model-routes.ts";

/** One durable transcript row as stored by the Session Host. */
export interface SessionHistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly parts?: readonly unknown[];
}

/** One official Session wire event record. */
export interface SessionWireRecord {
  readonly type: "event";
  readonly event: {
    readonly type: string;
    readonly seq: number;
    readonly time: number;
    readonly data: unknown;
    readonly surfaceOp?: "append";
  };
}

/** Provenance attached to a user message the Host accepted from the Client. */
export const USER_SOURCE = { kind: "user" } as const;

/** Provenance attached to an assistant message. */
export const MODEL_SOURCE = { kind: "model", provider: "unknown", model: "unknown" } as const;

/** Accumulated text chunks of the model currently streaming. */
export interface SessionLiveAttempt {
  readonly requestId?: string;
  readonly attemptId: string;
  readonly turn: number;
  readonly step: number;
  readonly startedAt?: number;
  readonly stepId?: string;
  readonly settledMessages?: readonly SessionHistoryMessage[];
  readonly chunks: ReadonlyArray<{ readonly type: string; readonly index: number; readonly text: string; readonly time?: number; readonly id?: string; readonly name?: string }>;
  readonly tools?: ReadonlyArray<{
    readonly callId: string;
    readonly name: string;
    readonly input?: unknown;
    readonly state: "running" | "done";
    readonly output?: unknown;
    readonly startedAt?: number;
    readonly endedAt?: number;
  }>;
}

/** Authoritative lifecycle of one admitted user request, supplied with the Host transcript. */
export type SessionTurnStatus = "queued" | "running" | "awaiting-approval" | "completed" | "cancelled" | "failed" | "forked" | "unknown";
export interface SessionTurnState {
  readonly requestId: string;
  readonly userMessageId?: string;
  readonly status: SessionTurnStatus;
  readonly error?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  /** Entered model Steps are durable even when no assistant message was produced. */
  readonly steps?: readonly { readonly id: string; readonly startedAt: number }[];
}

/** A transcript and its lifecycle are read from one Host snapshot. */
export interface SessionHistorySnapshot {
  readonly records?: readonly SessionHistoryMessage[];
  readonly turns?: readonly SessionTurnState[];
  readonly forkSeed?: SessionForkSeed;
}

export interface SessionForkSeed { readonly records: readonly SessionWireRecord[]; readonly messageIds: readonly string[] }

/** Options accepted by the wire-event projection. */
export interface SessionWireOptions {
  readonly turns?: readonly SessionTurnState[] | undefined;
  readonly forkSeed?: SessionForkSeed | undefined;
  /** Correlate a durable user message with the prompt receipt that created it. */
  readonly rpcIdOf?: (message: SessionHistoryMessage, text: string) => string | undefined;
}

/** Concatenated text parts of one message. */
export function textOf(message: { readonly parts?: readonly unknown[] }): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => (part as { type?: unknown }).type === "text")
    .map((part) => String(part.text ?? ""))
    .join("");
}

/**
 * Derive the official event journal from durable message rows.
 *
 * The same logical user Turn / model Step projection serves initial history,
 * pages and incremental follows. Finalization comes from the Host lifecycle,
 * while durable reasoning and tool parts retain their original step ownership.
 * @param messages - durable rows in append order.
 * @param rpcIdOf - optional prompt correlation for user messages.
 * @returns dense event records starting at seq 1 (or an empty list).
 */
export function buildSessionHistory(
  messages: readonly SessionHistoryMessage[],
  rpcIdOf?: SessionWireOptions["rpcIdOf"],
  turns?: readonly SessionTurnState[],
  forkSeed?: SessionForkSeed,
): SessionWireRecord[] {
  const sequencer = new SessionWireSequencer(messages, { forkSeed, ...(rpcIdOf === undefined ? {} : { rpcIdOf }), ...(turns === undefined ? {} : { turns }) });
  return sequencer.records;
}

/**
 * Project derived Session values the official UI reads alongside the journal.
 * The Host stores raw usage counters; the official descriptor expects the
 * derived token/context views.
 * @param raw - raw projection values from the Session Host.
 * @param state - durable Session state carrying the selected model.
 * @returns projection values for the follow snapshot baseline.
 */
export function deriveSessionProjections(
  raw: Record<string, unknown>,
  state: { readonly model?: string; readonly title?: string; readonly reasoningEffort?: string },
): Record<string, unknown> {
  const savedSelection = raw.modelSelection as { lastUsed?: unknown; next?: unknown } | undefined;
  const selection = (value: unknown): { provider: string; model: string; reasoningEffort?: string } | null => {
    if (!isPart(value) || typeof value.provider !== "string" || typeof value.model !== "string") return null;
    return { provider: value.provider, model: value.model, ...(typeof value.reasoningEffort === 'string' && ['off','low','high','max'].includes(value.reasoningEffort) ? {reasoningEffort:value.reasoningEffort} : {}) };
  };
  const usage = raw.usage as {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  } | undefined;
  const directTokenUsage = raw.tokenUsage as Record<string, number> | undefined;
  const tokenUsage = directTokenUsage ?? (usage === undefined ? undefined : {
    uncachedInputTokens: Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)),
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });
  const inputTokens = usage?.inputTokens;
  const contextPressure = inputTokens === undefined
    ? undefined
    : { pressureTokens: inputTokens, contextWindow: 1_048_576 };
  const contextBreakdown = raw.contextBreakdown as Record<string, number> | undefined;
  return {
    ...(raw.sessionStats === undefined ? {} : { sessionStats: raw.sessionStats }),
    ...(raw.imageLimits === undefined ? {} : { imageLimits: raw.imageLimits }),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(contextPressure === undefined ? {} : { contextPressure }),
    ...(contextBreakdown === undefined ? {} : { contextBreakdown }),
    modelSelection: {
      // Official ModelSelectionProjection is a fold, not a flat selection.
      // A saved choice must survive a fresh ModelDirectory after reload.
      lastUsed: selection(savedSelection?.lastUsed),
      next: state.model === undefined ? selection(savedSelection?.next)
        : { provider: providerForModelId(state.model), model: state.model, ...(state.reasoningEffort === undefined ? {} : {reasoningEffort:state.reasoningEffort}) },
    },
    agentPreset: FIXED_AGENT_PRESET_ID,
    ...(raw.permissions === undefined ? {} : {permissions:raw.permissions}),
    ...(state.title === undefined ? {} : { title: state.title }),
  };
}

/**
 * Incrementally project newly settled messages and live tool activity onto the
 * same dense event sequence as {@link buildSessionHistory}.
 */
export class SessionWireSequencer {
  private readonly output: SessionWireRecord[] = [];
  private readonly users = new Set<string>();
  private readonly steps = new Map<string, { turn: number; step: number; parts: readonly unknown[] }>();
  private readonly toolCalls = new Map<string, { turn: number; step: number }>();
  private readonly toolResults = new Set<string>();
  private readonly liveResults = new Map<string, unknown>();
  private readonly liveToolTimes = new Map<string, {startedAt?:number;endedAt?:number}>();
  private readonly settledAttempts = new Set<string>();
  private readonly states = new Map<string, SessionTurnState>();
  private readonly startedSteps = new Set<string>();
  private sequence = 0;
  private turn = 0;
  private step = 0;
  private open = false;
  private stepOpen = false;
  private requestId: string | undefined;
  private currentStepKey: string | undefined;
  private activeAttempt: string | undefined;
  private readonly options: SessionWireOptions;
  private readonly inheritedMessageIds: Set<string>;

  constructor(messages: readonly SessionHistoryMessage[], options: SessionWireOptions = {}) {
    this.options = options;
    this.inheritedMessageIds = new Set(options.forkSeed?.messageIds);
    if (options.forkSeed !== undefined) {
      this.output.push(...options.forkSeed.records);
      this.sequence = this.output.at(-1)?.event.seq ?? 0;
      this.turn = Math.max(0, ...this.output.map(record => isPart(record.event.data) && typeof record.event.data.turn === 'number' ? record.event.data.turn : 0));
    }
    this.pushMessages(messages, options.turns);
  }

  get records(): SessionWireRecord[] { return this.output; }
  get cursor(): number { return this.sequence === 0 ? -1 : this.sequence; }

  /** Append only new evidence. A Host terminal state, never assistant text, closes a Turn. */
  pushMessages(messages: readonly SessionHistoryMessage[], turns?: readonly SessionTurnState[]): SessionWireRecord[] {
    const start = this.output.length;
    for (const state of turns ?? []) {
      this.states.set(state.requestId, state);
      if (state.userMessageId !== undefined) this.states.set(state.userMessageId, state);
    }
    for (const message of messages) {
      if (this.inheritedMessageIds.has(message.id)) continue;
      if (message.role === "user") {
        const state = this.states.get(message.id);
        const requestId = state?.requestId ?? message.id;
        if (this.users.has(requestId)) continue;
        if (this.open) {
          this.finishTurn();
          // Queued inputs can precede the active Agent's eventual reply in the
          // Host inbox. Do not move them ahead of that reply or close its Turn.
          if (this.open && this.states.get(this.requestId!)?.status === "unknown") {
            // Legacy/truncated history has no terminal evidence. Preserve its
            // open Context and subsequent inputs; never invent an end reason.
            this.open = false;
            this.stepOpen = false;
          }
          if (this.open) break;
        }
        if (state?.status === "queued") break;
        this.users.add(requestId);
        this.requestId = requestId;
        this.turn += 1;
        this.open = true;
        this.step = 0;
        this.event("turn/start", { turn: this.turn });
        const text = textOf(message);
        const correlatedRpcId = this.options.rpcIdOf?.(message, text);
        const rpcId = state?.requestId ?? correlatedRpcId;
        const attachments = (message.parts ?? []).filter(part => isPart(part) && part.type === "file" && "attachment" in part);
        this.event("user/message", { id: message.id, role: "user",
          content: [...(text === "" ? [] : [{ type: "text", text }]), ...attachments],
          source: rpcId === undefined ? USER_SOURCE : { ...USER_SOURCE, rpcId } }, true);
        continue;
      }
      if (message.role !== "assistant") continue;
      // One AI SDK UIMessage can contain several step-start partitions. Each
      // partition is one official model Step, not a synthetic additional Turn.
      const groups = splitAssistantSteps(message.parts ?? []);
      for (let index = 0; index < groups.length; index += 1) {
        const key = `${message.id}:${index}`;
        const parts = groups[index]!;
        let location = this.steps.get(key);
        if (location === undefined) {
          if (!this.open) continue;
          if (this.currentStepKey !== undefined && this.stepOpen) {
            this.completeStepIfSettled();
            if (this.stepOpen) break;
          }
          const evidence = stepEvidence(parts);
          this.beginStep(evidence?.startedAt, evidence?.id);
          location = { turn: this.turn, step: this.step, parts };
          this.steps.set(key, location);
          this.currentStepKey = key;
          const content = assistantContent(parts);
          const text = textOf({ parts });
          this.event("assistant/message", { turn: location.turn, step: location.step,
            message: { id: assistantStepMessageId(message.id, index), role: "assistant", content, source: modelSource(message.parts ?? []) },
            stream: evidence?.chunks === undefined ? (text === "" ? [] : [{ type: "text-chunks", time0: this.states.get(this.requestId!)?.startedAt ?? 0, index: 0, dt: [0], texts: [text] }])
              : evidence.chunks.map(chunk => ({ type: 'chunk', time: chunk.time, chunk: officialChunk(chunk) })) }, true, evidence?.assistantAt ?? evidence?.endedAt);
          if (this.activeAttempt !== undefined) this.settledAttempts.add(this.activeAttempt);
        }
        // Approval changes an existing tool part in place. The original call
        // owns the result even when the Agent continuation has new counters.
        location.parts = parts;
        if (location.turn === this.turn && this.open) {
          this.projectTools(location);
          if (key === this.currentStepKey) this.completeStepIfSettled();
        }
      }
    }
    this.finishTurn();
    return this.output.slice(start);
  }

  /** Live result evidence may settle known calls; unknown calls await their durable assistant. */
  observeLive(live: SessionLiveAttempt | null | undefined): SessionWireRecord[] {
    const start = this.output.length;
    if (!live || !this.open
      || (live.requestId !== undefined && live.requestId !== this.requestId)) return [];
    this.pushMessages(live.settledMessages ?? []);
    if (this.settledAttempts.has(live.attemptId) || (live.stepId !== undefined && (live.settledMessages ?? []).some(message=>message.id === `dsh-sdk-step:${live.stepId}`))) return this.output.slice(start);
    for (const tool of live.tools ?? []) {
      this.liveToolTimes.set(tool.callId,{startedAt:tool.startedAt,endedAt:tool.endedAt});
      if (tool.state === "done" && this.toolCalls.has(tool.callId)) this.liveResults.set(tool.callId, tool.output ?? null);
    }
    if (this.currentStepKey !== undefined) {
      this.projectTools(this.steps.get(this.currentStepKey)!);
      this.completeStepIfSettled();
    }
    // A continuation starts a new Step only after the preceding tool batch is
    // settled. Its text can never be attached to the previous approval Step.
    if (live.startedAt !== undefined || live.chunks.length > 0 || (live.tools ?? []).some(tool => !this.toolCalls.has(tool.callId))) {
      if (!this.stepOpen) this.beginStep(live.startedAt, live.stepId);
      if (this.currentStepKey === undefined) this.activeAttempt = live.attemptId;
    }
    return this.output.slice(start);
  }

  private event(type: string, data: unknown, surface = false, time?: number): void {
    const startedAt = this.requestId === undefined ? undefined : this.states.get(this.requestId)?.startedAt;
    this.output.push({ type: "event", event: { type, seq: ++this.sequence, time: time ?? startedAt ?? Date.now(), data,
      ...(surface ? { surfaceOp: "append" as const } : {}) } });
  }

  private beginStep(time?: number, id?: string): void {
    if (id !== undefined) this.startedSteps.add(id);
    if (this.stepOpen) return;
    this.step += 1;
    this.stepOpen = true;
    this.currentStepKey = undefined;
    this.activeAttempt = undefined;
    this.event("step/start", { turn: this.turn, step: this.step }, false, time);
  }

  private completeStepIfSettled(): void {
    if (!this.stepOpen || this.currentStepKey === undefined) return;
    const current = this.steps.get(this.currentStepKey)!;
    if (toolParts(current.parts).some(part => !this.toolResults.has(String(part.toolCallId)))) return;
    this.endStep();
  }

  private endStep(terminalTime?: number): void {
    if (!this.stepOpen) return;
    const evidence = this.currentStepKey === undefined ? undefined : stepEvidence(this.steps.get(this.currentStepKey)!.parts);
    const toolEnds = this.currentStepKey === undefined ? [] : toolParts(this.steps.get(this.currentStepKey)!.parts).flatMap(part=>{
      const end=this.liveToolTimes.get(String(part.toolCallId))?.endedAt; return end===undefined?[]:[end];
    });
    this.event("step/end", { turn: this.turn, step: this.step }, false, evidence?.endedAt === undefined && toolEnds.length===0 ? terminalTime : Math.max(evidence?.endedAt ?? 0,...toolEnds));
    this.stepOpen = false;
  }

  private finishTurn(): void {
    if (!this.open || this.requestId === undefined) return;
    const state = this.states.get(this.requestId);
    // A started model call can fail before producing any assistant row. Keep
    // its actual start in the same journal on live delivery and cold reload.
    // Settled assistant rows consume earlier identities before this tail runs.
    const entered = state?.steps?.find(step => !this.startedSteps.has(step.id));
    if (entered !== undefined && (!this.stepOpen || this.currentStepKey === undefined)) this.beginStep(entered.startedAt, entered.id);
    if (!state || state.status === "queued" || state.status === "running" || state.status === "awaiting-approval" || state.status === "unknown") return;
    // Completed is meaningful even for a tool-only or empty terminal response.
    // Pending approvals still block completion if a stale Host status races it.
    if (state.status === "completed" && this.currentStepKey !== undefined
      && toolParts(this.steps.get(this.currentStepKey)!.parts).some(part => !this.toolResults.has(String(part.toolCallId)))) return;
    this.endStep(state.endedAt);
    const reason = state.status === "cancelled" ? { kind: "aborted", reason: { kind: "user" } }
      : state.status === "failed" ? { kind: "error", error: { code: "UNKNOWN", message: state.error ?? "Agent execution failed" } }
      : state.status === "forked" ? { kind: "forked" } : { kind: "completed" };
    this.event("turn/end", { turn: this.turn, reason }, false, state.endedAt);
    this.open = false;
    if (this.activeAttempt !== undefined) this.settledAttempts.add(this.activeAttempt);
  }

  private projectTools(location: { turn: number; step: number; parts: readonly unknown[] }): void {
    const parts = toolParts(location.parts);
    // Calls precede results, including parallel calls. This same order is used
    // by cold reconstruction and by an approval's incremental settlement.
    for (const part of parts) {
      const callId = String(part.toolCallId);
      if (this.toolCalls.has(callId)) continue;
      const name = typeof part.toolName === "string" ? part.toolName : String(part.type).slice(5);
      this.toolCalls.set(callId, { turn: location.turn, step: location.step });
      const evidence = stepEvidence(location.parts);
      this.event("tool/call", { turn: location.turn, step: location.step, callId, name, arguments: JSON.stringify(part.input ?? {}) }, false,
        evidence?.toolCallTimes?.find(timing=>timing.callId===callId)?.time ?? evidence?.assistantAt ?? evidence?.endedAt);
    }
    for (const part of parts) {
      const callId = String(part.toolCallId);
      if (this.toolResults.has(callId)) continue;
      const available = part.state === "output-available" || part.state === "output-error" || part.state === "output-denied";
      if (!available && !this.liveResults.has(callId)) break;
      const output = available ? part.state === "output-error" ? { error: part.errorText ?? "Tool execution failed" }
        : part.state === "output-denied" ? { error: "Tool approval denied" } : part.output : this.liveResults.get(callId);
      this.toolResults.add(callId);
      this.event("tool/result", { ...this.toolCalls.get(callId)!, message: { id: `tool-result-${callId}`, role: "tool",
        source: { kind: "tool", callId }, toolCallId: callId,
        ...(part.state === "output-error" || part.state === "output-denied" ? { isError: true } : {}),
        content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output ?? null) }] } }, true,
        this.liveToolTimes.get(callId)?.endedAt ?? stepEvidence(location.parts)?.toolTimings?.find(timing => timing.callId === callId)?.endedAt ?? stepEvidence(location.parts)?.endedAt);
    }
  }
}

function isPart(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function toolParts(parts: readonly unknown[]): Array<Record<string, unknown>> {
  return parts.filter((part): part is Record<string, unknown> => isPart(part) && typeof part.type === "string" && (part.type.startsWith("tool-") || part.type === 'dynamic-tool') && typeof part.toolCallId === "string");
}
/** Stable even when one SDK message later grows additional step partitions. */
export function assistantStepMessageId(messageId: string, stepIndex: number): string {
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error("invalid_assistant_step");
  return `dsh-assistant-step:${stepIndex}:${encodeURIComponent(messageId)}`;
}
/** Decode only identities emitted by the shared projection. */
export function assistantStepMessageSource(id: string): { messageId: string; assistantStep: number } | undefined {
  const match = /^dsh-assistant-step:(0|[1-9][0-9]*):(.+)$/.exec(id);
  if (!match) return undefined;
  const assistantStep = Number(match[1]);
  if (!Number.isSafeInteger(assistantStep)) return undefined;
  try { return { messageId: decodeURIComponent(match[2]!), assistantStep }; } catch { return undefined; }
}
/** Copy only steps through the boundary; provenance is non-behavioral and survives a cut. */
export function assistantPartsThroughStep(parts: readonly unknown[], stepIndex: number): { parts: readonly unknown[]; truncated: boolean } {
  const groups = splitAssistantSteps(parts);
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= groups.length) throw new Error("invalid_assistant_step");
  if (stepIndex === groups.length - 1) return { parts, truncated: false };
  const source = parts.filter(part => isPart(part) && part.type === "data-dsh-model-source");
  return { parts: [...groups.slice(0, stepIndex + 1).flatMap(group => [{ type: "step-start" }, ...group.filter(part => !isPart(part) || part.type !== "data-dsh-model-source")]), ...source], truncated: true };
}
function splitAssistantSteps(parts: readonly unknown[]): unknown[][] {
  const groups: unknown[][] = [];
  let current: unknown[] = [];
  for (const part of parts) {
    if (isPart(part) && part.type === "step-start") {
      if (current.length > 0) groups.push(current);
      current = [];
    } else current.push(part);
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups;
}
function modelSource(parts: readonly unknown[]): { kind: "model"; provider: string; model: string } {
  const part = parts.find(part => isPart(part) && part.type === "data-dsh-model-source");
  if (isPart(part) && isPart(part.data) && typeof part.data.provider === "string" && typeof part.data.model === "string") {
    return { kind: "model", provider: part.data.provider, model: part.data.model };
  }
  return MODEL_SOURCE;
}
function assistantContent(parts: readonly unknown[]): unknown[] {
  return parts.flatMap<unknown>(part => {
    if (!isPart(part)) return [];
    if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") return [{ type: part.type, text: part.text }];
    if (typeof part.type === "string" && (part.type.startsWith("tool-") || part.type === 'dynamic-tool') && typeof part.toolCallId === "string") {
      return [{ type: "tool-call", id: part.toolCallId, name: typeof part.toolName === "string" ? part.toolName : part.type.slice(5), arguments: JSON.stringify(part.input ?? {}) }];
    }
    return [];
  });
}

/** Cursorless token frames may update only Contexts already started by the journal. */
export class SessionLiveFrameSequencer {
  private requestId: string | undefined;
  private cursor = -1;
  private location: { turn: number; step: number } | undefined;
  private active: { id: string; turn: number; step: number; emitted: number } | undefined;
  private revision = 0;
  private readonly settled = new Set<string>();

  /** Fold each durable record once, after the snapshot or before its emitted suffix. */
  accept(record: SessionWireRecord): unknown[] {
    this.cursor = Math.max(this.cursor, record.event.seq);
    const data = record.event.data as { turn?: number; step?: number; id?: string; source?: { rpcId?: string } };
    if (record.event.type === "user/message") this.requestId = data.source?.rpcId ?? data.id;
    if (record.event.type === "step/start" && typeof data.turn === "number" && typeof data.step === "number") {
      this.location = { turn: data.turn, step: data.step };
    }
    const frames: unknown[] = [];
    if (record.event.type === "assistant/message" && this.active !== undefined
      && data.turn === this.active.turn && data.step === this.active.step) {
      frames.push(this.end({ kind: "committed", eventType: "assistant/message", seq: record.event.seq }));
    }
    if (record.event.type === "assistant/message" && data.turn === this.location?.turn && data.step === this.location?.step) this.location = undefined;
    if ((record.event.type === "step/end" || record.event.type === "turn/end") && data.turn === this.location?.turn) {
      if (this.active !== undefined) frames.push(this.end({ kind: "abandoned" }));
      this.location = undefined;
    }
    return frames;
  }

  /** Buffer an early Agent snapshot until its journal Context exists; ignore settled replays. */
  observe(live: SessionLiveAttempt | null | undefined): unknown[] {
    if (!live || this.location === undefined || this.settled.has(live.attemptId) || live.chunks.length === 0
      || (live.requestId !== undefined && live.requestId !== this.requestId)) return [];
    const frames: unknown[] = [];
    if (this.active?.id !== live.attemptId) {
      if (this.active !== undefined) frames.push(this.end({ kind: "abandoned" }));
      this.active = { id: live.attemptId, ...this.location, emitted: 0 };
      frames.push({ type: "assistant-stream", frame: { type: "start", attemptId: live.attemptId,
        revision: ++this.revision, startedAfterSeq: this.cursor, ...this.location } });
    }
    while (this.active!.emitted < live.chunks.length) {
      const index = this.active!.emitted++;
      const chunk = live.chunks[index]!;
      frames.push({ type: "assistant-stream", frame: { type: "chunk", attemptId: live.attemptId,
        revision: ++this.revision, index, time: chunk.time ?? live.startedAt ?? 0,
        chunk: officialChunk(chunk) } });
    }
    return frames;
  }

  private end(outcome: { kind: "abandoned" } | { kind: "committed"; eventType: "assistant/message"; seq: number }): unknown {
    const active = this.active!;
    this.settled.add(active.id);
    this.active = undefined;
    return { type: "assistant-stream", frame: { type: "end", attemptId: active.id,
      revision: ++this.revision, index: active.emitted, outcome } };
  }
}

function officialChunk(chunk: SessionLiveAttempt['chunks'][number]): Record<string, unknown> {
  return chunk.type === 'tool-call-delta' ? { type: 'tool-call-delta', index: chunk.index, id: chunk.id, ...(chunk.name === undefined ? {} : { name: chunk.name }), argumentsDelta: chunk.text }
    : { type: chunk.type === 'text-delta' ? 'text-delta' : 'reasoning-delta', index: chunk.index, text: chunk.text };
}
function stepEvidence(parts: readonly unknown[]): { id?: string; startedAt?: number; endedAt?: number; assistantAt?:number; toolCallTimes?:readonly{callId:string;time:number}[]; toolTimings?:readonly {callId:string;startedAt:number;endedAt?:number}[]; chunks?: readonly (SessionLiveAttempt['chunks'][number] & {time:number})[] } | undefined {
  const value = parts.find(part => isPart(part) && part.type === 'data-dsh-step');
  return isPart(value) && isPart(value.data) ? value.data : undefined;
}
export * from './model-routes.ts'
