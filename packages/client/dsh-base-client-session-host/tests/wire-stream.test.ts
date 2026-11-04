/** Contract tests for the browser logical-stream carrier. */
import assert from "node:assert/strict";
import { openWireStream, WireStreamFailure, WireStreamCarrierFailure, type WireStreamSocketLike } from "../src/wire-stream.ts";

class FakeSocket implements WireStreamSocketLike {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const base = "https://dsh-base.example.workers.dev";
const payload = { args: { request: { address: { kind: "session", sessionId: "s1" } } } };

const socket = new FakeSocket();
const events: unknown[] = [
  { type: "item", streamId: "stream-1", value: { type: "snapshot" } },
  { type: "item", streamId: "stream-1", value: { type: "event" } },
  { type: "end", streamId: "stream-1" },
];
const iterator = openWireStream<unknown>({
  baseUrl: base, endpoint: "session/follow", payload,
  signal: new AbortController().signal, streamId: "stream-1",
  socketFactory: () => socket,
})[Symbol.asyncIterator]();
const first = iterator.next();
socket.emit("open");
assert.deepEqual(socket.sent[0], { type: "open", streamId: "stream-1", endpoint: "session/follow", payload });
for (const event of events) socket.emit("message", { data: JSON.stringify(event) });
assert.deepEqual(await first, { value: { type: "snapshot" }, done: false });
assert.deepEqual(await iterator.next(), { value: { type: "event" }, done: false });
assert.deepEqual(await iterator.next(), { value: undefined, done: true });
assert.equal(socket.closed, true);

const failingSocket = new FakeSocket();
const failing = openWireStream<unknown>({
  baseUrl: base, endpoint: "session/follow", payload,
  signal: new AbortController().signal, streamId: "stream-2",
  socketFactory: () => failingSocket,
})[Symbol.asyncIterator]();
const failingFirst = failing.next();
failingSocket.emit("open");
failingSocket.emit("message", {
  data: JSON.stringify({ type: "error", streamId: "stream-2", error: { code: "session/not-found", message: "missing", details: { sessionId: "s1" } } }),
});
await assert.rejects(() => failingFirst, (error: unknown) => {
  assert.ok(error instanceof WireStreamFailure);
  assert.equal(error.code, "session/not-found");
  assert.deepEqual(error.details, { sessionId: "s1" });
  return true;
});

const abortController = new AbortController();
const abortSocket = new FakeSocket();
const aborting = openWireStream<unknown>({
  baseUrl: base, endpoint: "session/follow", payload,
  signal: abortController.signal, streamId: "stream-3",
  socketFactory: () => abortSocket,
})[Symbol.asyncIterator]();
const abortFirst = aborting.next();
abortSocket.emit("open");
abortController.abort();
assert.deepEqual(abortSocket.sent.at(-1), { type: "cancel", streamId: "stream-3" });
assert.equal(abortSocket.closed, true);
assert.deepEqual(await abortFirst, { value: undefined, done: true });

const ignored = new FakeSocket();
const other = openWireStream<unknown>({
  baseUrl: base, endpoint: "session/control", payload: { args: {} },
  signal: new AbortController().signal, streamId: "stream-4",
  socketFactory: () => ignored,
})[Symbol.asyncIterator]();
const otherFirst = other.next();
ignored.emit("open");
ignored.emit("message", { data: JSON.stringify({ type: "item", streamId: "other-stream", value: 1 }) });
ignored.emit("message", { data: JSON.stringify({ type: "end", streamId: "stream-4" }) });
assert.deepEqual(await otherFirst, { value: undefined, done: true });

// Page navigation: the browser closes the socket before an end frame; that is
// a normal teardown, not a carrier failure the UI should surface.
const pageListeners = new Map<string, Set<() => void>>();
(globalThis as { window?: unknown }).window = {
  addEventListener(type: string, listener: () => void) {
    const set = pageListeners.get(type) ?? new Set();
    set.add(listener);
    pageListeners.set(type, set);
  },
  removeEventListener(type: string, listener: () => void) {
    pageListeners.get(type)?.delete(listener);
  },
};
const unloadSocket = new FakeSocket();
const unloading = openWireStream<unknown>({
  baseUrl: base, endpoint: "session/follow", payload,
  signal: new AbortController().signal, streamId: "stream-5",
  socketFactory: () => unloadSocket,
})[Symbol.asyncIterator]();
const unloadFirst = unloading.next();
unloadSocket.emit("open");
for (const listener of pageListeners.get("pagehide") ?? []) listener();
unloadSocket.emit("close");
assert.deepEqual(await unloadFirst, { value: undefined, done: true });
delete (globalThis as { window?: unknown }).window;

const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
const invalidSocket = new FakeSocket();
const invalid = openWireStream({ baseUrl: base, endpoint: "session/control", payload: cyclic,
  signal: new AbortController().signal, socketFactory: () => invalidSocket })[Symbol.asyncIterator]();
const invalidRead = assert.rejects(invalid.next(), error => {
  assert.ok(error instanceof WireStreamFailure && !(error instanceof WireStreamCarrierFailure));
  assert.equal(error.code, "gateway/arguments-invalid"); return true;
});
invalidSocket.emit("open"); await invalidRead;
assert.equal(invalidSocket.sent.length, 0, "invalid arguments must never become a retryable physical failure");

console.log("wire-stream: open/item/end/error/abort/multiplex/pagehide routing passed");
