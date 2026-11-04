/** Transport keepalive only: never a state read, domain event or revision. */
export const SSE_KEEPALIVE_MS = 15_000;

/** Pull-based SSE lifecycle shared by Host observations and live invalidations. */
export function eventStreamResponse(
  open: (signal: AbortSignal) => AsyncIterable<unknown>,
  requestSignal: AbortSignal,
  eventName = 'session',
): Response {
  const lifetime = new AbortController();
  if (requestSignal.aborted) lifetime.abort();
  const iterator = open(lifetime.signal)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let closed = false;
  let cancelled = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let reading = false;
  let ready: { item: IteratorResult<unknown> } | { error: unknown } | undefined;
  let disposed: Promise<void> | undefined;
  const clearTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  const finish = (failure?: { reason: unknown }): Promise<void> => {
    if (disposed !== undefined) return disposed;
    closed = true;
    clearTimer();
    requestSignal.removeEventListener('abort', abort);
    lifetime.abort();
    wake?.();
    disposed = (async () => {
      try { await iterator.return?.(); } catch (error) { failure ??= { reason: error }; }
      if (cancelled) { if (failure !== undefined) throw failure.reason; return; }
      if (failure !== undefined) controller.error(failure.reason);
      else controller.close();
    })();
    return disposed;
  };
  const abort = () => { void finish(); };
  requestSignal.addEventListener('abort', abort, { once: true });
  const read = () => {
    if (reading || ready !== undefined || closed) return;
    reading = true;
    // One continuation per iterator read. Repeated keepalives must not attach
    // unbounded Promise.race handlers to the same unresolved next() promise.
    Promise.resolve().then(() => closed ? { done: true as const, value: undefined } : iterator.next()).then(item => {
      reading = false; ready = { item }; wake?.();
    }, error => { reading = false; ready = { error }; wake?.(); });
  };
  return new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; if (lifetime.signal.aborted) void finish(); },
    async pull() {
      if (closed) return;
      read();
      if (ready === undefined) await new Promise<void>(resolve => {
        wake = resolve;
        timer = setTimeout(() => { timer = undefined; resolve(); }, SSE_KEEPALIVE_MS);
      });
      wake = undefined;
      clearTimer();
      if (closed) return;
      const result = ready;
      ready = undefined;
      if (result === undefined) {
        // A slow consumer can buffer at most one comment; no interval runs
        // until ReadableStream requests the next chunk again.
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      } else if ('error' in result) await finish({ reason: result.error });
      else if (result.item.done) await finish();
      else {
        try { controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(result.item.value)}\n\n`)); }
        catch (error) { await finish({ reason: error }); }
      }
    },
    async cancel() { cancelled = true; await finish(); },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' } });
}
