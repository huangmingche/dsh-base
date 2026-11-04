/**
 * Browser carrier for one logical Gateway Remote stream on `/api/remote.mux`.
 *
 * The carrier keeps the official open/item/end/cancel frame grammar; it is the
 * migration transport for Session streams while the official Connection carrier
 * remains the unary RPC path. A failure before the first item lets the caller
 * fall back to the custom transport, while a failure after an item is surfaced
 * so a stream is never silently replayed.
 */

/** Structural socket face used by the carrier (the browser WebSocket fits). */
export interface WireStreamSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
}

/** One logical stream failure delivered by the Host or the carrier. */
export class WireStreamFailure extends Error {
  /** Official structural Remote failure marker; decoded business codes survive supervision. */
  readonly isDSHRemoteError = true as const;
  /** Stable Remote failure code. */
  readonly code: string;
  /** JSON-safe failure details. */
  readonly details: Record<string, unknown>;

  /**
   * @param code - stable `<namespace>/<reason>` code.
   * @param message - diagnostic for the caller.
   * @param details - JSON-safe failure context.
   */
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WireStreamFailure";
    this.code = code;
    this.details = details;
  }
}

/** Physical carrier loss only; malformed frames and Host error envelopes are terminal. */
export class WireStreamCarrierFailure extends WireStreamFailure {}

/** Options for one logical stream opened on the shared carrier. */
export interface WireStreamOptions {
  /** Deployment origin, for example `https://dsh-base-staging.example.workers.dev`. */
  readonly baseUrl: string;
  /** Gateway endpoint, for example `session/follow`. */
  readonly endpoint: string;
  /** Endpoint payload, normally `{ args: {...} }`. */
  readonly payload: unknown;
  /** Cancels the logical stream and sends a `cancel` frame. */
  readonly signal: AbortSignal;
  /** Stream identity override for tests; a UUID is generated otherwise. */
  readonly streamId?: string;
  /** Carrier override for tests. */
  readonly socketFactory?: (url: string) => WireStreamSocketLike;
}

/** Build the WebSocket URL for the configured deployment origin. */
function muxUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/remote.mux";
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Generate one protocol-safe opaque stream id. */
function newStreamId(): string {
  const cryptoFace = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoFace?.randomUUID === "function") return cryptoFace.randomUUID();
  return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Extract the text payload of one socket message event. */
function messageText(event: unknown): string | undefined {
  if (typeof event === "string") return event;
  if (typeof event === "object" && event !== null && typeof (event as { data?: unknown }).data === "string") {
    return (event as { data: string }).data;
  }
  return undefined;
}

/**
 * Open one logical stream and yield every Host item until completion.
 *
 * The `open` frame is sent on socket open; `cancel` is sent when the caller
 * aborts or the iterator is closed early. Host `error` frames are rethrown as
 * {@link WireStreamFailure}; an unexpected close after the stream admitted is
 * also a carrier failure.
 * @param options - deployment origin, endpoint, payload, cancellation and overrides.
 * @returns Host items in wire order.
 */
export async function* openWireStream<T>(options: WireStreamOptions): AsyncIterable<T> {
  const streamId = options.streamId ?? newStreamId();
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as WireStreamSocketLike);
  const socket = socketFactory(muxUrl(options.baseUrl));
  const values: T[] = [];
  let failure: WireStreamFailure | undefined;
  let ended = false;
  let notify: (() => void) | undefined;
  const wake = (): void => {
    const resolve = notify;
    notify = undefined;
    resolve?.();
  };
  const stop = (error?: WireStreamFailure): void => {
    if (ended) return;
    if (error !== undefined) failure = error;
    ended = true;
    wake();
  };
  const send = (frame: unknown): void => {
    let data: string;
    try { data = JSON.stringify(frame); }
    catch {
      stop(new WireStreamFailure("gateway/arguments-invalid", "logical stream payload is not JSON serializable"));
      return;
    }
    try {
      socket.send(data);
    } catch {
      stop(new WireStreamCarrierFailure("gateway/carrier-failed", "logical stream socket is not writable"));
    }
  };

  socket.addEventListener("open", () => {
    send({ type: "open", streamId, endpoint: options.endpoint, payload: options.payload });
  });
  socket.addEventListener("message", (event) => {
    const text = messageText(event);
    if (text === undefined) return;
    let frame: unknown;
    try {
      frame = JSON.parse(text) as unknown;
    } catch {
      stop(new WireStreamFailure("gateway/carrier-failed", "logical stream frame is not JSON"));
      return;
    }
    if (typeof frame !== "object" || frame === null) return;
    const record = frame as {
      readonly type?: unknown;
      readonly streamId?: unknown;
      readonly value?: unknown;
      readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown };
    };
    if (record.streamId !== streamId) return;
    if (record.type === "item") {
      values.push(record.value as T);
      wake();
      return;
    }
    if (record.type === "end") {
      stop();
      return;
    }
    if (record.type === "error") {
      const error = record.error ?? {};
      stop(new WireStreamFailure(
        typeof error.code === "string" ? error.code : "gateway/internal",
        typeof error.message === "string" ? error.message : "logical stream failed",
        typeof error.details === "object" && error.details !== null ? error.details as Record<string, unknown> : {},
      ));
    }
  });
  socket.addEventListener("error", () => {
    stop(new WireStreamCarrierFailure("gateway/carrier-failed", "logical stream socket failed"));
  });
  // A page navigation closes every carrier socket before the Host can send an
  // end frame; that is a normal teardown, not a carrier failure the UI should
  // surface. Live use still reports an unexpected close.
  let unloading = false;
  const onPageHide = (): void => { unloading = true; };
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  socket.addEventListener("close", (event: unknown) => {
    if (unloading) {
      stop();
      return;
    }
    const close = typeof event === "object" && event !== null ? event as { readonly code?: unknown; readonly reason?: unknown } : {};
    const code = typeof close.code === "number" ? close.code : undefined;
    const reason = typeof close.reason === "string" && close.reason !== "" ? `, ${close.reason}` : "";
    stop(new WireStreamCarrierFailure(
      "gateway/carrier-closed",
      `logical stream socket closed before its end frame (${options.endpoint}${code === undefined ? "" : `, code ${String(code)}`}${reason})`,
    ));
  });
  const onAbort = (): void => {
    send({ type: "cancel", streamId });
    try {
      socket.close(1000, "cancelled");
    } catch {}
    stop();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();

  try {
    while (true) {
      if (values.length > 0) {
        yield values.shift() as T;
        continue;
      }
      if (failure !== undefined) throw failure;
      if (ended) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
        if (values.length > 0 || failure !== undefined || ended || options.signal.aborted) wake();
      });
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    if (!ended) {
      send({ type: "cancel", streamId });
      ended = true;
    }
    try {
      socket.close(1000, "stream closed");
    } catch {}
  }
}
