/**
 * Carrier behavior tests for the Workers-native Remote stream mux.
 *
 * Run with `node --experimental-strip-types tests/mux.test.ts`. Node's assert
 * is the only framework: each block exercises one carrier contract through a
 * fake socket that records outbound text frames and dispatches inbound events.
 */
import assert from "node:assert/strict";
import { RemoteStreamMux } from "../src/mux.ts";
import type { MuxSocketLike, WireStreamInvocation } from "../src/mux.ts";

type Listener = (event: any) => void;

interface DownlinkFrame {
  readonly type: string;
  readonly streamId: string;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly details: Record<string, unknown> };
}

/** Records every outbound frame and lets the test push inbound carrier events. */
class FakeSocket implements MuxSocketLike {
  readonly sent: string[] = [];
  readonly closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
  sendAfterClose = 0;
  closed = false;
  private readonly listeners = new Map<"message" | "close", Listener[]>();

  send(text: string): void {
    if (this.closed) {
      this.sendAfterClose += 1;
      throw new Error("fake socket: send after close");
    }
    this.sent.push(text);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closes.push({ code, reason });
    this.dispatch("close", { code, reason });
  }

  addEventListener(type: "message" | "close", listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  message(frame: unknown): void {
    this.dispatch("message", { data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  frames(): DownlinkFrame[] {
    return this.sent.map(text => JSON.parse(text) as DownlinkFrame);
  }

  private dispatch(type: "message" | "close", event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function invocation(): WireStreamInvocation {
  return {
    request: new Request("https://worker.test/api/remote.mux"),
    env: { BINDING: "test" },
    user: { id: "user-1" },
    method: "",
    rpcId: "",
  };
}

/** Coded failure mirroring `WireRpcError`'s wire fields without importing the Worker root. */
class CodedError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "CodedError";
    this.code = code;
    this.details = details;
  }
}

function open(streamId: string, endpoint: string, payload?: unknown): Record<string, unknown> {
  return { type: "open", streamId, endpoint, ...(payload === undefined ? {} : { payload }) };
}

const delay = (milliseconds = 1): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`mux test: timed out waiting for ${label}`);
    await delay();
  }
}

// 1. A handler iterable becomes item frames in yield order followed by one end.
{
  const socket = new FakeSocket();
  let seen: WireStreamInvocation | undefined;
  let seenEndpoint = "";
  let seenPayload: unknown;
  const mux = new RemoteStreamMux(async (endpoint, payload, streamInvocation) => {
    seenEndpoint = endpoint;
    seenPayload = payload;
    seen = streamInvocation;
    return (async function* () {
      yield { n: 1 };
      yield { n: 2 };
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("s1", "demo/items", { args: { limit: 2 } }));
  await until(() => socket.frames().some(frame => frame.type === "end"), "stream end");

  assert.deepEqual(socket.frames().map(frame => [frame.type, frame.streamId, frame.value]), [
    ["item", "s1", { n: 1 }],
    ["item", "s1", { n: 2 }],
    ["end", "s1", undefined],
  ]);
  assert.equal(seenEndpoint, "demo/items");
  assert.deepEqual(seenPayload, { args: { limit: 2 } });
  assert.equal(seen?.method, "demo/items");
  assert.equal(seen?.rpcId, "s1");
  assert.equal(seen?.user.id, "user-1");
  assert.deepEqual(seen?.env, { BINDING: "test" });
  assert.equal(seen?.request.signal.aborted, false);
  assert.equal(socket.sendAfterClose, 0);
  socket.close(1000, "test done");
}

// 2. A coded throw sends its error frame then end; an uncoded failure is gateway/internal.
{
  const socket = new FakeSocket();
  const mux = new RemoteStreamMux(async (endpoint) => {
    if (endpoint === "demo/refuse") {
      return (async function* () {
        yield "accepted";
        throw new CodedError("demo/refused", "handler refused the stream", { reason: "policy" });
      })();
    }
    return (async function* () {
      yield 1n;
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("s1", "demo/refuse"));
  socket.message(open("s2", "demo/bad-item"));
  await until(() => socket.frames().filter(frame => frame.type === "end").length === 2, "both stream ends");

  assert.deepEqual(socket.frames().map(frame => frame.type).sort(), ["end", "end", "error", "error", "item"]);
  const frames = socket.frames();
  const refused = frames.find(frame => frame.streamId === "s1" && frame.type === "error");
  const internal = frames.find(frame => frame.streamId === "s2" && frame.type === "error");
  assert.equal(refused?.error?.code, "demo/refused");
  assert.equal(refused?.error?.message, "handler refused the stream");
  assert.deepEqual(refused?.error?.details, { reason: "policy" });
  assert.equal(internal?.error?.code, "gateway/internal");
  assert.deepEqual(internal?.error?.details, {});
  for (const streamId of ["s1", "s2"]) {
    const errorIndex = frames.findIndex(frame => frame.streamId === streamId && frame.type === "error");
    const endIndex = frames.findIndex(frame => frame.streamId === streamId && frame.type === "end");
    assert.ok(errorIndex !== -1 && endIndex > errorIndex, `${streamId}: end follows error`);
  }
  assert.equal(socket.sendAfterClose, 0);
  socket.close(1000, "test done");
}

// 3. An unavailable endpoint maps to gateway/endpoint-unavailable and ends the stream.
{
  const socket = new FakeSocket();
  const mux = new RemoteStreamMux(async (endpoint) => {
    throw new CodedError("gateway/endpoint-unavailable", `no Worker stream handler for ${endpoint}`, { endpoint });
  });
  mux.handle(socket, invocation());
  socket.message(open("missing", "session/follow"));
  await until(() => socket.frames().some(frame => frame.type === "end"), "unavailable stream end");

  const [errorFrame, endFrame] = socket.frames();
  assert.equal(errorFrame?.type, "error");
  assert.equal(errorFrame?.error?.code, "gateway/endpoint-unavailable");
  assert.deepEqual(errorFrame?.error?.details, { endpoint: "session/follow" });
  assert.deepEqual([endFrame?.type, endFrame?.streamId], ["end", "missing"]);
  socket.close(1000, "test done");
}

// 4. Cancel aborts the handler and sends no further frames for that stream.
{
  const socket = new FakeSocket();
  let aborted = false;
  let observedAbort = false;
  const mux = new RemoteStreamMux(async (_endpoint, _payload, _invocation, signal) => {
    assert.equal(signal.aborted, false);
    return (async function* () {
      yield { n: 1 };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
      aborted = true;
      yield { n: 2 };
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("s1", "demo/slow"));
  await until(() => socket.frames().length === 1, "first item");
  socket.message({ type: "cancel", streamId: "s1" });
  await until(() => observedAbort && aborted, "handler abort");
  await delay(5);

  assert.deepEqual(socket.frames(), [{ type: "item", streamId: "s1", value: { n: 1 } }]);
  assert.equal(socket.closed, false);
  assert.equal(socket.sendAfterClose, 0);
  socket.close(1000, "test done");
}

// 5. A duplicate open for a live stream id closes the carrier with 1008 and aborts the first stream.
{
  const socket = new FakeSocket();
  let aborted = false;
  const mux = new RemoteStreamMux(async (_endpoint, _payload, _invocation, signal) => {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    return (async function* () {
      yield "never";
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("s1", "demo/hold"));
  socket.message(open("s1", "demo/hold"));
  await until(() => aborted, "first stream abort");

  assert.equal(socket.closed, true);
  assert.deepEqual(socket.closes, [{ code: 1008, reason: "duplicate stream id" }]);
  assert.deepEqual(socket.frames(), []);
  assert.equal(socket.sendAfterClose, 0);
}

// 6. Invalid JSON and invalid frame grammar close the carrier with 1003.
{
  const socket = new FakeSocket();
  const mux = new RemoteStreamMux(async () => (async function* () {
    yield 1;
  })());
  mux.handle(socket, invocation());
  socket.message("{not json");
  assert.equal(socket.closed, true);
  assert.deepEqual(socket.closes, [{ code: 1003, reason: "invalid stream frame" }]);
  assert.deepEqual(socket.frames(), []);

  const malformed = new FakeSocket();
  const malformedMux = new RemoteStreamMux(async () => (async function* () {
    yield 1;
  })());
  malformedMux.handle(malformed, invocation());
  malformed.message({ type: "open", endpoint: "demo/items" });
  assert.equal(malformed.closed, true);
  assert.deepEqual(malformed.closes, [{ code: 1003, reason: "invalid stream frame" }]);
  assert.deepEqual(malformed.frames(), []);
}

// 7. Two concurrent streams interleave without routing a frame to the wrong stream.
{
  const socket = new FakeSocket();
  let releaseA!: () => void;
  let releaseB!: () => void;
  const aYielded = new Promise<void>((resolve) => { releaseA = resolve; });
  const bYielded = new Promise<void>((resolve) => { releaseB = resolve; });
  const mux = new RemoteStreamMux(async (endpoint) => {
    if (endpoint === "demo/a") {
      return (async function* () {
        yield "a1";
        releaseA();
        await bYielded;
        yield "a2";
      })();
    }
    return (async function* () {
      yield "b1";
      releaseB();
      await aYielded;
      yield "b2";
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("stream-a", "demo/a"));
  socket.message(open("stream-b", "demo/b"));
  await until(() => socket.frames().filter(frame => frame.type === "end").length === 2, "both stream ends");

  const frames = socket.frames();
  assert.deepEqual(
    frames.filter(frame => frame.streamId === "stream-a" && frame.type === "item").map(frame => frame.value),
    ["a1", "a2"],
  );
  assert.deepEqual(
    frames.filter(frame => frame.streamId === "stream-b" && frame.type === "item").map(frame => frame.value),
    ["b1", "b2"],
  );
  assert.deepEqual(
    frames.filter(frame => frame.type === "end").map(frame => frame.streamId).sort(),
    ["stream-a", "stream-b"],
  );
  const a2Index = frames.findIndex(frame => frame.streamId === "stream-a" && frame.value === "a2");
  const b1Index = frames.findIndex(frame => frame.streamId === "stream-b" && frame.value === "b1");
  assert.ok(a2Index > b1Index, "stream-a resumed after stream-b produced its first item");
  assert.equal(socket.sendAfterClose, 0);
  socket.close(1000, "test done");
}

// 8. `$events` answers the official ready item, stays open, and needs no registered handler.
{
  const socket = new FakeSocket();
  let opened = 0;
  const mux = new RemoteStreamMux(async () => {
    opened += 1;
    throw new Error("$events must not resolve a registered endpoint");
  });
  mux.handle(socket, invocation());
  socket.message(open("generation", "$events", { args: {} }));
  await until(() => socket.frames().length === 1, "$events ready item");

  const readyFrame = socket.frames()[0];
  assert.equal(readyFrame?.type, "item");
  assert.equal(readyFrame?.streamId, "generation");
  const ready = readyFrame?.value as { type?: unknown; clientId?: unknown; host?: unknown };
  assert.equal(ready.type, "ready");
  assert.equal(typeof ready.clientId, "string");
  assert.match(ready.clientId as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(ready.host, { home: "" });

  socket.message(open("generation-2", "$events"));
  await until(() => socket.frames().length === 2, "$events without payload");
  assert.equal(socket.frames()[1]?.type, "item");
  await delay(5);
  assert.equal(socket.frames().some(frame => frame.type === "end"), false);
  assert.equal(opened, 0);

  socket.message({ type: "cancel", streamId: "generation" });
  socket.message({ type: "cancel", streamId: "generation-2" });
  await delay(5);
  assert.deepEqual(socket.frames().map(frame => frame.type), ["item", "item"]);
  assert.equal(socket.closed, false);
  assert.equal(socket.sendAfterClose, 0);
  socket.close(1000, "test done");
}

// 9. A carrier close aborts every active stream and sends no terminal frame.
{
  const socket = new FakeSocket();
  let aborted = 0;
  const mux = new RemoteStreamMux(async (_endpoint, _payload, _invocation, signal) => {
    signal.addEventListener("abort", () => { aborted += 1; }, { once: true });
    return (async function* () {
      yield "never";
    })();
  });
  mux.handle(socket, invocation());
  socket.message(open("s1", "demo/hold"));
  socket.message(open("s2", "demo/hold"));
  socket.close(1000, "carrier gone");
  await until(() => aborted === 2, "both streams aborted");
  await delay(5);
  assert.deepEqual(socket.frames(), []);
  assert.equal(socket.sendAfterClose, 0);
}

console.log("wire-rpc mux: official stream grammar, cancellation, concurrency, and $events passed");
