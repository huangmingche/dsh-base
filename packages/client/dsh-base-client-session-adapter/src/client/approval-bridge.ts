/** Host notification-to-official-approval waterfall lifecycle. No decisions are inferred. */
export type ApprovalDecision = 'allowed-once' | 'rejected';
export interface ApprovalPresentation {
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly signal: AbortSignal;
}
type JsonRecord = Record<string, unknown>;
type HostCall = (method: string, params: JsonRecord, signal: AbortSignal) => Promise<JsonRecord>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
export const APPROVAL_RETRY_DELAYS = [250, 1_000] as const;

class ApprovalHostFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, code: string, retryable: boolean) { super(message); this.code = code; this.retryable = retryable; }
}

/** Reject HTTP, Host and malformed acknowledgement failures without losing their diagnostics. */
export function createApprovalHostCall(baseUrl: string, fetcher: typeof fetch = fetch): HostCall {
  return async (method, params, signal) => {
    const response = await fetcher(new URL('/api/session-host', baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', signal,
      body: JSON.stringify({ method, params }),
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || Object.hasOwn(body, 'error')) {
      const detail = isRecord(body) && isRecord(body.error) ? body.error : body;
      throw new ApprovalHostFailure(
        isRecord(detail) && typeof detail.message === 'string' ? detail.message : `Approval Host ${method} failed (HTTP ${response.status})`,
        isRecord(detail) && typeof detail.code === 'string' ? detail.code : isRecord(body) && typeof body.error === 'string' ? body.error : 'gateway/internal',
        response.status >= 500 || [408, 425, 429].includes(response.status),
      );
    }
    if (!Object.hasOwn(body, 'result') || !isRecord(body.result)) throw new Error(`Approval Host ${method} omitted its result acknowledgement`);
    return body.result;
  };
}

function retryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Abort a pending read/presentation even if an external listener fails to settle. */
function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

interface RequestRow { key: string; params: JsonRecord; presentation: Omit<ApprovalPresentation, 'signal'> }
interface PendingRow { controller: AbortController; decision?: ApprovalDecision; running: boolean; acknowledged: boolean }
interface SessionState { references: number; controller: AbortController; requested: boolean; reading: boolean; pending: Map<string, PendingRow> }

function requests(value: JsonRecord): RequestRow[] {
  if (!Array.isArray(value.toolApprovals) || !Array.isArray(value.approvals)) throw new Error('Approval Host returned an invalid pending snapshot');
  const result: RequestRow[] = [];
  for (const item of value.toolApprovals) {
    if (!isRecord(item) || typeof item.toolCallId !== 'string' || !item.toolCallId || typeof item.toolName !== 'string') throw new Error('Approval Host returned an invalid tool request');
    result.push({ key: `tool:${item.toolCallId}`, params: { toolCallId: item.toolCallId }, presentation: {
      toolName: item.toolName, callId: item.toolCallId, ...(typeof item.summary === 'string' ? { reason: item.summary } : {}),
    } });
  }
  for (const item of value.approvals) {
    if (!isRecord(item) || typeof item.executionId !== 'string' || !item.executionId || !isRecord(item.descriptor) || typeof item.descriptor.action !== 'string') throw new Error('Approval Host returned an invalid execution request');
    result.push({ key: `execution:${item.executionId}`, params: { executionId: item.executionId }, presentation: {
      toolName: item.descriptor.action,
      ...(typeof item.descriptor.toolCallId === 'string' ? { callId: item.descriptor.toolCallId } : {}),
      ...(typeof item.descriptor.summary === 'string' ? { reason: item.descriptor.summary } : {}),
    } });
  }
  if (new Set(result.map(row => row.key)).size !== result.length) throw new Error('Approval Host returned duplicate pending identities');
  return result;
}

/** Reads coalesce per Session; only an explicit official UI decision reaches resolveApproval. */
export function createApprovalBridge(options: {
  call: HostCall;
  ready(): boolean;
  present(sessionId: string, request: ApprovalPresentation): Promise<ApprovalDecision>;
  releaseSession(sessionId: string): void | Promise<void>;
  error(error: unknown): void;
}) {
  const sessions = new Map<string, SessionState>(), tasks = new Set<Promise<void>>();
  let disposed = false;
  const report = (error: unknown) => {
    try { options.error(error); }
    catch (reportFailure) { console.error('Approval bridge diagnostic handler failed', reportFailure, { cause: error }); }
  };
  const track = (task: Promise<void>) => {
    const handled = task.then(() => {}, report);
    tasks.add(handled); void handled.then(() => { tasks.delete(handled); });
  };
  const release = (sessionId: string, state: SessionState) => {
    state.controller.abort(new Error('Approval Session scope released'));
    for (const pending of state.pending.values()) pending.controller.abort(state.controller.signal.reason);
    state.pending.clear(); sessions.delete(sessionId);
    track(Promise.resolve().then(() => options.releaseSession(sessionId)));
  };
  const settle = (sessionId: string, state: SessionState, row: RequestRow, pending: PendingRow) => {
    if (pending.running || pending.acknowledged || disposed) return;
    pending.running = true;
    const signal = AbortSignal.any([state.controller.signal, pending.controller.signal]);
    track((async () => {
      try {
        const decision = pending.decision ?? await within(options.present(sessionId, { ...row.presentation, signal }), signal);
        signal.throwIfAborted();
        if (decision !== 'allowed-once' && decision !== 'rejected') throw new Error('Official approval listener returned no decision');
        pending.decision = decision;
        for (let attempt = 0; ; attempt++) {
          try {
            const result = await within(options.call('resolveApproval', { sessionId, ...row.params, decision }, signal), signal);
            if (result.accepted !== true) throw new Error('Approval Host did not accept the decision');
            break;
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof TypeError || error instanceof ApprovalHostFailure && error.retryable) || attempt >= APPROVAL_RETRY_DELAYS.length) throw error;
            // Repeat only the exact already chosen idempotent decision. This
            // is bounded acknowledgement recovery, never pending-state polling.
            await retryDelay(APPROVAL_RETRY_DELAYS[attempt]!, signal);
          }
        }
        signal.throwIfAborted(); pending.acknowledged = true;
      } catch (error) { if (!signal.aborted) report(error); }
      finally { pending.running = false; }
    })());
  };
  const refresh = (sessionId: string, state: SessionState) => {
    if (disposed || state.controller.signal.aborted) return;
    if (!options.ready()) {
      for (const pending of state.pending.values()) pending.controller.abort(new Error('Approval listener was removed'));
      state.pending.clear(); return;
    }
    state.requested = true;
    if (state.reading) return;
    state.reading = true;
    track((async () => {
      try {
        while (state.requested && !state.controller.signal.aborted && options.ready()) {
          state.requested = false;
          const value = await within(options.call('pendingApprovals', { sessionId }, state.controller.signal), state.controller.signal);
          state.controller.signal.throwIfAborted();
          const rows = requests(value), keys = new Set(rows.map(row => row.key));
          for (const [key, pending] of state.pending) if (!keys.has(key)) {
            pending.controller.abort(new Error('Approval was withdrawn by the Host')); state.pending.delete(key);
          }
          for (const row of rows) {
            let pending = state.pending.get(row.key);
            if (pending === undefined) { pending = { controller: new AbortController(), running: false, acknowledged: false }; state.pending.set(row.key, pending); }
            settle(sessionId, state, row, pending);
          }
        }
      } catch (error) { if (!state.controller.signal.aborted) report(error); }
      finally { state.reading = false; }
    })());
  };
  return {
    retain(sessionId: string): () => void {
      if (disposed) return () => {};
      let state = sessions.get(sessionId);
      if (state === undefined) { state = { references: 0, controller: new AbortController(), requested: false, reading: false, pending: new Map() }; sessions.set(sessionId, state); }
      state.references++; refresh(sessionId, state);
      let released = false;
      return () => { if (released) return; released = true; if (--state.references === 0 && sessions.get(sessionId) === state) release(sessionId, state); };
    },
    invalidate() { for (const [sessionId, state] of sessions) refresh(sessionId, state); },
    async dispose() { disposed = true; for (const [sessionId, state] of sessions) release(sessionId, state); await Promise.all(tasks); },
  };
}
