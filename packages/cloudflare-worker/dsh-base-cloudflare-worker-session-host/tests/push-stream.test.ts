/** Two actual SSE subscriptions, held readers, reconnect baselines and cancellation. */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { HostChangeFeed, invalidationResponse } from '../src/change-feed.ts';
import { hostChanges } from '../src/host-call.ts';
import { eventStreamResponse, SSE_KEEPALIVE_MS } from '../src/event-stream.ts';

const owner = new HostChangeFeed(), live = new HostChangeFeed();
let opened = 0;
const invocation = { user: { id: 'push-owner' }, request: new Request('https://host'), env: { SESSION_HOST: {
  idFromName(name: string) { return name; },
  get(name: string) { return { async fetch(request: Request) {
    if (request.url.endsWith('/migrate/status')) return Response.json({ migrated: true });
    assert.ok(request.url.endsWith('/changes'));
    opened++;
    return invalidationResponse(name.endsWith(':default-v49') ? owner : live, request.signal);
  } }; },
} } };
const abort = new AbortController();
const iterator = hostChanges(invocation as never, abort.signal, 'session')[Symbol.asyncIterator]();
await iterator.next();
// Baselines will still arrive after this initial local baseline. That extra
// invalidation closes the read-before-remote-subscription race.
owner.publish(['settings']); live.publish(['live']);
let observed = new Set<string>();
while (observed.size < 2) {
  const next = await iterator.next();
  for (const topic of next.value!.topics) observed.add(topic);
  // Once both streams have opened, a real write must reach the held reader.
  if (opened === 2 && observed.size === 0) { owner.publish(['settings']); live.publish(['live']); }
}
assert.deepEqual(observed, new Set(['settings', 'live']));
// Finish any coalesced initial remote baseline before asserting cancellation of
// a genuinely held read (not a next() that already has a buffered frame).
let waiting: Promise<IteratorResult<import('../src/change-feed.ts').HostInvalidation>>;
while (true) {
  let settled = false;
  waiting = iterator.next().then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  if (!settled) break;
}
abort.abort();
assert.equal((await waiting).done, true);
await iterator.return?.();

let closed = false;
const requestAbort = new AbortController();
const response = eventStreamResponse(async function* (signal) {
  try {
    yield { value: 'baseline' };
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve(); });
  } finally { closed = true; }
}, requestAbort.signal);
const reader = response.body!.getReader();
await reader.read();
const held = reader.read();
await reader.cancel();
assert.equal((await held).done, true);
assert.equal(closed, true);
console.log('Host SSE: owner/live fanout, remote baselines, pending read cancellation, iterator cleanup; no polling');

const flush = () => new Promise(resolve => setImmediate(resolve));
function heldSource() {
  let calls = 0, releases = 0, outstanding = 0, maximum = 0;
  let resolve: ((item: IteratorResult<unknown>) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const source = (signal: AbortSignal): AsyncIterable<unknown> => ({ [Symbol.asyncIterator]() {
    const stop = () => resolve?.({ done: true, value: undefined });
    signal.addEventListener('abort', stop, { once: true });
    return {
      next() {
        calls++; maximum = Math.max(maximum, ++outstanding);
        return new Promise<IteratorResult<unknown>>((yes, no) => {
          resolve = item => { resolve = undefined; reject = undefined; outstanding--; yes(item); };
          reject = error => { resolve = undefined; reject = undefined; outstanding--; no(error); };
        });
      },
      async return() { releases++; signal.removeEventListener('abort', stop); stop(); return { done: true, value: undefined }; },
    };
  } });
  return { source, counts: () => ({ calls, releases, outstanding, maximum }),
    emit: (value: unknown) => resolve?.({ done: false, value }), fail: (error: unknown) => reject?.(error) };
}

mock.timers.enable({ apis: ['setTimeout'] });
try {
  const held = heldSource();
  const stop = new AbortController();
  const comments = eventStreamResponse(held.source, stop.signal, 'invalidate').body!.getReader();
  for (let index = 0; index < 4; index++) {
    const next = comments.read(); await flush();
    mock.timers.tick(SSE_KEEPALIVE_MS); await flush();
    assert.equal(new TextDecoder().decode((await next).value), ': keepalive\n\n');
    assert.equal(held.counts().calls, 1, 'keepalive reuses one pending source read');
  }
  // Backpressure permits one queued comment, never an accumulating timer queue.
  await flush(); mock.timers.tick(SSE_KEEPALIVE_MS); await flush();
  mock.timers.tick(SSE_KEEPALIVE_MS * 100); await flush();
  assert.equal(held.counts().calls, 1);
  held.emit({ type: 'invalidate', revision: 7, topics: ['settings'] }); await flush();
  assert.equal(new TextDecoder().decode((await comments.read()).value), ': keepalive\n\n');
  const actual = new TextDecoder().decode((await comments.read()).value);
  assert.match(actual, /event: invalidate\ndata: \{"type":"invalidate","revision":7,"topics":\["settings"\]\}/);
  await flush();
  const pending = comments.read(); await flush(); stop.abort();
  assert.equal((await pending).done, true);
  assert.equal(held.counts().releases, 1);
  assert.equal(held.counts().maximum, 1);
  assert.equal(held.counts().outstanding, 0);
  const final = held.counts(); mock.timers.tick(SSE_KEEPALIVE_MS * 100); await flush();
  assert.deepEqual(held.counts(), final, 'aborted transport leaves no timer/source work');

  const failed = heldSource();
  const failedReader = eventStreamResponse(failed.source, new AbortController().signal).body!.getReader();
  const rejected = assert.rejects(failedReader.read(), /actual source failure/);
  await flush(); failed.fail(new Error('actual source failure')); await rejected;
  assert.equal(failed.counts().releases, 1, 'source errors remain visible and release resources');
  mock.timers.tick(SSE_KEEPALIVE_MS * 100); await flush();
} finally { mock.timers.reset(); }
console.log('Host SSE: 15s comment keepalive, one pending iterator, bounded backpressure, abort/error disposal and no synthetic revisions passed');
