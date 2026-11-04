/** Wire snapshot from Think's durable, non-destructive per-SDK accounting. */
export interface ExecutionStatistics {
  sdkRequestId: string;
  steps: number;
  llmMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  contextBreakdown?: { systemTokens: number; toolsTokens: number };
}

export function countAssistantSteps(messages: readonly { role: string; parts: readonly unknown[] }[]): number {
  return messages.filter(message => message.role === "assistant").reduce((total, message) => {
    const starts = message.parts.filter(part => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "step-start").length;
    return total + Math.max(starts, message.parts.some(part => typeof part === "object" && part !== null && (part as { type?: unknown }).type !== "data-dsh-model-source") ? 1 : 0);
  }, 0);
}

/** Compact SQL/read-model evidence; message contents are not needed for counts. */
export interface AssistantStepCount { readonly messageId?: string; readonly steps: number; readonly ids: readonly string[] }

export function countExecutionSteps(previous: Record<string, unknown>, messages: readonly AssistantStepCount[]): number {
  const seed = previous._dshBaseForkSeed as { records?: readonly {event?:{type?:string;data?:{turn?:number;step?:number}}}[]; messageIds?: readonly string[] } | undefined;
  const inherited = new Set(seed?.messageIds);
  const seedSteps = new Set((seed?.records ?? []).filter(record=>record.event?.type==='step/start').map(record=>`${record.event!.data?.turn}:${record.event!.data?.step}`));
  const ids = new Set<string>();
  const entries = previous._dshBaseExecutionSteps;
  if (entries !== null && typeof entries === 'object') for (const steps of Object.values(entries)) {
    if (Array.isArray(steps)) for (const step of steps) if (typeof step?.id === 'string') ids.add(step.id);
  }
  let legacy = 0;
  for (const message of messages) {
    if (message.messageId !== undefined && inherited.has(message.messageId)) continue;
    const known = new Set(message.ids);
    for (const id of known) ids.add(id);
    legacy += Math.max(0, message.steps - known.size);
  }
  return seedSteps.size + ids.size + legacy;
}

export function assistantStepCounts(messages: readonly { id?: string; role: string; parts: readonly unknown[] }[]): AssistantStepCount[] {
  return messages.filter(message=>message.role==='assistant').map(message=>({... (message.id === undefined ? {} : {messageId:message.id}),steps:countAssistantSteps([message]),ids:message.parts.flatMap(part=>{
    const value=part as {type?:string;data?:{id?:unknown}}|null;
    return value?.type==='data-dsh-step' && typeof value.data?.id==='string' ? [value.data.id] : [];
  })}));
}

/** Marker and cumulative counters are one projection write, so replay adds zero. */
export function withExecutionStatistics(previous: Record<string, unknown>, messages: readonly { id?: string; role: string; parts: readonly unknown[] }[], execution?: ExecutionStatistics): Record<string, unknown> {
  const stats = (previous.sessionStats ?? {}) as Record<string, number>;
  const applied = Array.isArray(previous._dshBaseAppliedExecutions) ? previous._dshBaseAppliedExecutions.filter((id): id is string => typeof id === "string") : [];
  const fresh = execution !== undefined && !applied.includes(execution.sdkRequestId) ? execution : undefined;
  const sessionStats = { ...stats, turns: messages.filter(message => message.role === "user").length, steps: countExecutionSteps(previous, assistantStepCounts(messages)) };
  if (fresh) for (const key of ["llmMs", "ttftMs", "ttftSteps", "decodeMs", "decodeTokens"] as const) (sessionStats as Record<string, number>)[key] = (stats[key] ?? 0) + fresh[key];
  const usage = fresh?.usage;
  const priorUsage = (previous.tokenUsage ?? {}) as Record<string, number>;
  return { ...previous, sessionStats,
    ...(fresh === undefined ? {} : { _dshBaseAppliedExecutions: [...applied, fresh.sdkRequestId] }),
    ...(usage === undefined ? {} : { usage, tokenUsage: {
      uncachedInputTokens: (priorUsage.uncachedInputTokens ?? 0) + Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens),
      cacheReadTokens: (priorUsage.cacheReadTokens ?? 0) + usage.cacheReadTokens,
      cacheWriteTokens: (priorUsage.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
      outputTokens: (priorUsage.outputTokens ?? 0) + usage.outputTokens,
    } }),
    ...(fresh?.contextBreakdown === undefined ? {} : { contextBreakdown: { ...fresh.contextBreakdown,
      messageTokens: Math.max(0, (usage?.inputTokens ?? 0) - fresh.contextBreakdown.systemTokens - fresh.contextBreakdown.toolsTokens) } }),
  };
}
