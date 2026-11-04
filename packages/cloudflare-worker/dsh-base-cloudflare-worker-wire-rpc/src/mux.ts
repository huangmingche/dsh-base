/**
 * Workers-native owner of the official multiplexed Remote stream carrier.
 *
 * The module has no Worker-runtime imports so the carrier can be exercised
 * directly; `src/index.ts` re-exports its public API and wires it to the
 * Worker's authenticated `/api/remote.mux` upgrade.
 */

/** One official multiplexed-stream endpoint handler. */
export type WireStreamHandler = (
  payload: unknown,
  invocation: WireStreamInvocation,
) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;

/** Per-stream facts supplied to one stream endpoint handler. */
export interface WireStreamInvocation {
  /** The authenticated upgrade request, recreated with the stream's abort signal. */
  readonly request: Request;
  /** Worker bindings of the request being served. */
  readonly env: unknown;
  /** Authenticated user that opened this stream. */
  readonly user: { readonly id: string };
  /** Endpoint name from the `open` frame, for example `session/follow`. */
  readonly method: string;
  /** Logical stream id from the `open` frame. */
  readonly rpcId: string;
}

/** Registry of official Gateway stream endpoints. */
export interface WireStreamRegistry {
  /**
   * @param endpoint - Remote stream endpoint name carried by `open`.
   * @param handler - item source for that endpoint.
   * @returns disposer withdrawing this endpoint registration.
   */
  register(endpoint: string, handler: WireStreamHandler): () => void;
}

/** Gateway-internal logical stream carrying the client event generation. */
const EVENTS_ENDPOINT = "$events";
/** Close status for a text frame that is not JSON or not a valid stream frame. */
const CLOSE_INVALID_FRAME = 1003;
/** Close status for a duplicate `open` on a live stream id, matching the official mux. */
const CLOSE_DUPLICATE_STREAM = 1008;
/** Fallback Remote failure code for an uncoded stream handler failure. */
const INTERNAL_CODE = "gateway/internal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one lossless JSON value produced by `JSON.parse` or a stream handler. */
function isJsonValue(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every(item => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every(item => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

/** One validated browser-to-Host logical-stream frame. */
type RemoteStreamClientFrame =
  | { readonly type: "open"; readonly streamId: string; readonly endpoint: string; readonly payload: unknown }
  | { readonly type: "item"; readonly streamId: string; readonly value: unknown }
  | { readonly type: "end"; readonly streamId: string }
  | { readonly type: "cancel"; readonly streamId: string };

/** Carrier-safe stream failure mirroring the official `RemoteStreamFailure`. */
interface RemoteStreamFailure {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/** One Host-to-browser logical-stream frame. */
type RemoteStreamServerFrame =
  | { readonly type: "item"; readonly streamId: string; readonly value: unknown }
  | { readonly type: "error"; readonly streamId: string; readonly error: RemoteStreamFailure }
  | { readonly type: "end"; readonly streamId: string };

/**
 * Parse one text frame with the official discriminator and required fields.
 *
 * Frame keys beyond the required fields are ignored, and the `payload` is
 * opaque: any JSON value is accepted and the registered handler validates its
 * own arguments. A frame without `payload` opens with `undefined` so the
 * `$events` bootstrap stays valid with or without its `{ args: {} }` payload.
 * @param text - complete WebSocket text message.
 * @returns the validated logical-stream frame.
 */
function parseClientFrame(text: string): RemoteStreamClientFrame {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error("api worker: Remote stream message is not JSON", { cause });
  }
  if (!isRecord(decoded) || typeof decoded.streamId !== "string" || decoded.streamId.length === 0) {
    throw new Error("api worker: Remote stream message has no stream id");
  }
  switch (decoded.type) {
    case "open": {
      if (typeof decoded.endpoint !== "string" || decoded.endpoint.length === 0) {
        throw new Error("api worker: Remote stream open has no endpoint");
      }
      if (decoded.payload !== undefined && !isJsonValue(decoded.payload)) {
        throw new Error("api worker: Remote stream open payload is not JSON data");
      }
      return { type: "open", streamId: decoded.streamId, endpoint: decoded.endpoint, payload: decoded.payload };
    }
    case "item": {
      if (decoded.value !== undefined && !isJsonValue(decoded.value)) {
        throw new Error("api worker: Remote stream item is not JSON data");
      }
      return { type: "item", streamId: decoded.streamId, value: decoded.value };
    }
    case "end":
      return { type: "end", streamId: decoded.streamId };
    case "cancel":
      return { type: "cancel", streamId: decoded.streamId };
    default:
      throw new Error("api worker: unknown Remote stream message type");
  }
}

/** Project any thrown value to the official three-field stream failure. */
function failureOf(error: unknown): RemoteStreamFailure {
  const record = typeof error === "object" && error !== null
    ? error as { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }
    : undefined;
  const code = typeof record?.code === "string" && record.code.length > 0 ? record.code : INTERNAL_CODE;
  const message = typeof record?.message === "string" ? record.message : String(error);
  const candidate = record?.details;
  const details = isRecord(candidate) && isJsonValue(candidate) ? candidate : {};
  return { code, message, details };
}

/** Release a handler iterator without awaiting a generator blocked in `next()`. */
function releaseIterator(iterator: AsyncIterator<unknown>): void {
  void Promise.resolve(iterator.return?.()).catch(() => undefined);
}

/**
 * Carrier operations the mux needs from a server-side WebSocket.
 *
 * A `WebSocketPair` server socket satisfies this structurally. The caller
 * accepts the socket before {@link RemoteStreamMux.handle}; the mux never sends
 * before that point.
 */
export interface MuxSocketLike {
  /** Send one complete text frame. */
  send(text: string): void;
  /** Close the carrier with a WebSocket status code. */
  close(code?: number, reason?: string): void;
  /** Register a carrier listener; message events carry the frame in `event.data`. */
  addEventListener(type: "message" | "close", listener: (event: any) => void): void;
  /** Accept the server side of a `WebSocketPair`; already called before `handle`. */
  accept?(): void;
}

/** One live logical stream owned by a mux. */
interface ActiveStream {
  readonly controller: AbortController;
  /** The event generation never pumps a handler and is removed on cancel. */
  readonly events: boolean;
  aborted: boolean;
  iterator?: AsyncIterator<unknown>;
}

/**
 * Serve every logical Remote stream multiplexed over one accepted WebSocket.
 *
 * The class owns exactly one carrier: `apply` creates one instance per accepted
 * `/api/remote.mux` upgrade. Browser frames are validated with the official
 * grammar; `open` resolves registered endpoints, `$events` answers the official
 * generation bootstrap, `cancel` aborts one stream, and a carrier close aborts
 * every remaining stream. A duplicate `open` for a live id closes the carrier
 * with code 1008 (the official policy); malformed JSON or a malformed frame
 * closes it with code 1003. Uplink `item`/`end` frames are accepted for grammar
 * compatibility and dropped because {@link WireStreamInvocation} exposes no
 * uplink consumer yet.
 */
export class RemoteStreamMux {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly open: (
    endpoint: string,
    payload: unknown,
    invocation: WireStreamInvocation,
    signal: AbortSignal,
  ) => Promise<AsyncIterable<unknown>>;
  private socket: MuxSocketLike | undefined;
  private closed = false;

  /**
   * @param open - resolves one validated endpoint to its item source; `signal`
   * aborts when the client cancels that stream or the carrier closes.
   */
  constructor(
    open: (
      endpoint: string,
      payload: unknown,
      invocation: WireStreamInvocation,
      signal: AbortSignal,
    ) => Promise<AsyncIterable<unknown>>,
  ) {
    this.open = open;
  }

  /**
   * Attach this mux to an accepted carrier and serve it until it closes.
   *
   * Each `open` frame replaces `invocation.method` and `invocation.rpcId`; the
   * request is recreated with that stream's abort signal so handlers observe
   * cancellation through `invocation.request.signal`. One instance serves one
   * socket; calling `handle` twice throws.
   * @param socket - accepted server-side WebSocket.
   * @param invocation - authenticated upgrade facts shared by every stream.
   */
  handle(socket: MuxSocketLike, invocation: WireStreamInvocation): void {
    if (this.socket !== undefined) throw new Error("RemoteStreamMux: one instance serves one socket");
    this.socket = socket;
    socket.addEventListener("message", (event) => { this.receive(invocation, event); });
    socket.addEventListener("close", () => { this.shutdown(); });
  }

  /** Dispatch one carrier text frame; malformed input fails the physical carrier. */
  private receive(invocation: WireStreamInvocation, event: any): void {
    if (this.closed) return;
    const data: unknown = event?.data;
    if (typeof data !== "string") {
      this.fail(CLOSE_INVALID_FRAME, "text frames required");
      return;
    }
    let frame: RemoteStreamClientFrame;
    try {
      frame = parseClientFrame(data);
    } catch {
      this.fail(CLOSE_INVALID_FRAME, "invalid stream frame");
      return;
    }
    switch (frame.type) {
      case "open":
        this.openStream(invocation, frame);
        return;
      case "cancel":
        this.cancel(frame.streamId);
        return;
      case "item":
      case "end":
        // This carrier has no uplink reader; the official grammar still allows
        // both frames and unknown or finished stream ids are dropped.
        return;
    }
  }

  /** Start one logical stream, or answer the internal `$events` generation. */
  private openStream(invocation: WireStreamInvocation, frame: Extract<RemoteStreamClientFrame, { readonly type: "open" }>): void {
    if (this.streams.has(frame.streamId)) {
      this.fail(CLOSE_DUPLICATE_STREAM, "duplicate stream id");
      return;
    }
    const controller = new AbortController();
    const stream: ActiveStream = {
      controller,
      events: frame.endpoint === EVENTS_ENDPOINT,
      aborted: false,
    };
    this.streams.set(frame.streamId, stream);
    if (stream.events) {
      const sent = this.emit({
        type: "item",
        streamId: frame.streamId,
        value: { type: "ready", clientId: crypto.randomUUID(), host: { home: "" } },
      });
      if (!sent) {
        this.streams.delete(frame.streamId);
        controller.abort(new Error("Remote stream socket closed"));
      }
      return;
    }
    void this.pump(invocation, frame, stream).catch(() => undefined);
  }

  /** Drive one handler iterable into item frames, then a terminal end or error. */
  private async pump(
    base: WireStreamInvocation,
    frame: Extract<RemoteStreamClientFrame, { readonly type: "open" }>,
    stream: ActiveStream,
  ): Promise<void> {
    let iterator: AsyncIterator<unknown> | undefined;
    let completed = false;
    let failed: unknown;
    try {
      const invocation: WireStreamInvocation = {
        ...base,
        method: frame.endpoint,
        rpcId: frame.streamId,
        request: new Request(base.request, { signal: stream.controller.signal }),
      };
      const source = await this.open(frame.endpoint, frame.payload, invocation, stream.controller.signal);
      iterator = source[Symbol.asyncIterator]();
      stream.iterator = iterator;
      while (!this.stopped(stream)) {
        const next = await iterator.next();
        if (next.done === true) {
          completed = true;
          break;
        }
        if (this.stopped(stream)) break;
        if (next.value !== undefined && !isJsonValue(next.value)) {
          throw new Error("api worker: Remote stream item is not JSON serializable");
        }
        if (!this.emit({ type: "item", streamId: frame.streamId, value: next.value })) break;
      }
    } catch (error) {
      failed = error;
    } finally {
      if (stream.iterator === iterator) {
        stream.iterator = undefined;
        if (iterator !== undefined && !completed) releaseIterator(iterator);
      }
      if (this.streams.get(frame.streamId) === stream) this.streams.delete(frame.streamId);
    }
    // A cancel or carrier close suppresses every later frame for this stream.
    if (this.stopped(stream)) return;
    if (failed !== undefined) {
      if (this.emit({ type: "error", streamId: frame.streamId, error: failureOf(failed) })) {
        this.emit({ type: "end", streamId: frame.streamId });
      }
      return;
    }
    this.emit({ type: "end", streamId: frame.streamId });
  }

  /** Cancel one logical stream, abort its handler, and release its iterator. */
  private cancel(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (stream === undefined || stream.aborted) return;
    stream.aborted = true;
    stream.controller.abort(new Error("Remote stream cancelled"));
    this.release(stream);
    if (stream.events) this.streams.delete(streamId);
  }

  /** Abort every active stream after the carrier closed; no further frames are sent. */
  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    const active = [...this.streams.values()];
    this.streams.clear();
    for (const stream of active) {
      stream.aborted = true;
      stream.controller.abort(new Error("Remote stream socket closed"));
      this.release(stream);
    }
  }

  /** Close the carrier for a protocol violation after aborting its streams. */
  private fail(code: number, reason: string): void {
    if (this.closed) return;
    this.shutdown();
    try {
      this.socket?.close(code, reason);
    } catch {
      // The carrier is already gone; aborting its streams is the observable effect.
    }
  }

  /** Release one stream's iterator without awaiting a blocked generator. */
  private release(stream: ActiveStream): void {
    const iterator = stream.iterator;
    if (iterator === undefined) return;
    stream.iterator = undefined;
    releaseIterator(iterator);
  }

  /** Whether a stream must stop producing frames. */
  private stopped(stream: ActiveStream): boolean {
    return this.closed || stream.aborted;
  }

  /**
   * Serialize one frame and write it synchronously, so concurrent stream pumps
   * never interleave inside a frame and no frame follows a carrier close.
   * @param frame - complete server frame.
   * @returns whether the frame reached the carrier.
   */
  private emit(frame: RemoteStreamServerFrame): boolean {
    if (this.closed) return false;
    let text: string;
    try {
      text = JSON.stringify(frame);
    } catch {
      return false;
    }
    const socket = this.socket;
    if (socket === undefined) return false;
    try {
      socket.send(text);
      return true;
    } catch {
      this.shutdown();
      return false;
    }
  }
}
