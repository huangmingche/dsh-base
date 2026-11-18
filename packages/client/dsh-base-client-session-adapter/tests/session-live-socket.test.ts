import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { sessionFollowInputs } from "../src/client/session-follow.ts";
import { watchSessionLive } from "../src/client/session-live-socket.ts";

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets: TestSocket[] = [];
  class TestSocket extends EventTarget {
    closed = false;
    readonly url: string;
    constructor(url: string) { super(); this.url = url; sockets.push(this); }
    close(): void { this.closed = true; this.dispatchEvent(new Event("close")); }
    snapshot(): void { this.dispatchEvent(new MessageEvent("message", { data: '{"live":null}' })); }
  }
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  const socketDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "location", { value: new URL("https://unit.test"), configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: TestSocket, configurable: true });
  t.after(() => {
    if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
    else Reflect.deleteProperty(globalThis, "location");
    if (socketDescriptor) Object.defineProperty(globalThis, "WebSocket", socketDescriptor);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  });
  return sockets;
}

test("a follow releases both its current live socket and any pending reconnect", t => {
  const sockets = setup(t);
  const lifeline = new AbortController();
  const updates: unknown[] = [];
  const stop = watchSessionLive("a/b", lifeline.signal, live => updates.push(live));
  assert.equal(new URL(sockets[0].url).searchParams.get("sessionId"), "a/b");
  sockets[0].snapshot();
  sockets[0].close();
  t.mock.timers.tick(750);
  assert.equal(sockets.length, 2);
  sockets[1].snapshot();
  assert.deepEqual(updates, [null, undefined, null]);
  stop();
  assert.equal(sockets[1].closed, true);
  t.mock.timers.tick(1500);
  assert.equal(sockets.length, 2, "disposing a follow must not reopen its socket");
  sockets[1].snapshot();
  assert.deepEqual(updates, [null, undefined, null], "queued events must not reach a retired follow");

  const cancel = watchSessionLive("session", lifeline.signal, () => {});
  sockets[2].close();
  cancel();
  t.mock.timers.tick(1500);
  assert.equal(sockets.length, 3, "a reconnect scheduled before disposal must be cancelled");
  watchSessionLive("session", lifeline.signal, () => {});
  lifeline.abort();
  assert.equal(sockets[3].closed, true);
  t.mock.timers.tick(1500);
  assert.equal(sockets.length, 4);
  watchSessionLive("session", lifeline.signal, () => {});
  assert.equal(sockets.length, 4);
});

test("a healthy idle follow sleeps until push and propagates journal loss to its caller", async t => {
  const sockets = setup(t);
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  let journalAborted = false;
  let pendingReads = 0;
  let fallbackReads = 0;
  const updates = sessionFollowInputs("session", controller.signal, async function* (signal) {
    signal.addEventListener("abort", () => { journalAborted = true; });
    yield "baseline";
    pendingReads++;
    await new Promise<never>((_, reject) => { fail = reject; });
  }, async () => { fallbackReads++; return null; });
  assert.deepEqual((await updates.next()).value, { frame: "baseline" });
  sockets[0].snapshot();
  assert.deepEqual((await updates.next()).value, { live: null });
  const next = updates.next();
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(fallbackReads, 0, "the Agent's idle baseline is authoritative until disconnect");
  assert.equal(pendingReads, 1);
  const loss = new Error("journal disconnected");
  fail(loss);
  await assert.rejects(next, error => error === loss);
  assert.ok(journalAborted);
  assert.ok(sockets[0].closed);
  t.mock.timers.tick(1500);
  assert.equal(sockets.length, 1);
});

test("an unavailable live socket reads the Host, resumes push, and consumer return aborts the pending journal read", async t => {
  const sockets = setup(t);
  const controller = new AbortController();
  let aborted = false;
  let fallbackReads = 0;
  const updates = sessionFollowInputs("session", controller.signal, async function* (signal) {
    try {
      yield "baseline";
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally { aborted = signal.aborted; }
  }, async () => { fallbackReads++; return null; });
  assert.deepEqual((await updates.next()).value, { frame: "baseline" });
  const fallback = updates.next();
  t.mock.timers.tick(750);
  assert.deepEqual((await fallback).value, { live: null });
  assert.equal(fallbackReads, 1);
  sockets[0].snapshot();
  assert.deepEqual((await updates.next()).value, { live: null });
  await updates.return(undefined);
  assert.ok(aborted);
  assert.ok(sockets[0].closed);
  t.mock.timers.tick(3000);
  assert.equal(sockets.length, 1);
  assert.equal(fallbackReads, 1);
});
