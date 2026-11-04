/** Genuine official PendingApproval cancellation/answer semantics, no model or network calls. */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/src/client/contract/slots.ts';
import { createApprovalBridge, createApprovalHostCall, APPROVAL_RETRY_DELAYS, type ApprovalPresentation } from '../src/client/approval-bridge.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = { toolApprovals: [{ toolCallId: 'same-call-id', toolName: 'remember_fact', summary: 'Confirm memory' }], approvals: [] };
const empty = { toolApprovals: [], approvals: [] };
const errors: unknown[] = [], decisions: Array<Record<string, unknown>> = [], views: Array<{ sessionId: string; pending: PendingApproval }> = [], releases: string[] = [];
const values = new Map<string, Record<string, unknown>>([['a', pending], ['b', pending]]);
let presentingFailure = false, rejectAck = false, readCount = 0, inFlight = 0, maximum = 0;
let holdRead: ReturnType<typeof Promise.withResolvers<Record<string, unknown>>> | undefined;
const bridge = createApprovalBridge({
  ready: () => true,
  async call(method, params, signal) {
    signal.throwIfAborted();
    if (method === 'resolveApproval') { decisions.push(params); return { accepted: !rejectAck }; }
    readCount++; maximum = Math.max(maximum, ++inFlight);
    try { return holdRead === undefined ? values.get(String(params.sessionId)) ?? empty : await holdRead.promise; }
    finally { inFlight--; }
  },
  present(sessionId: string, request: ApprovalPresentation) {
    if (presentingFailure) throw new Error('actual UI listener failed');
    const presentation = new PendingApproval(sessionId as never, request as never);
    views.push({ sessionId, pending: presentation });
    return presentation.result;
  },
  releaseSession: sessionId => { releases.push(sessionId); },
  error: error => errors.push(error),
});
const releaseA = bridge.retain('a'), releaseA2 = bridge.retain('a'), releaseB = bridge.retain('b'); await flush();
assert.deepEqual(views.map(row => row.sessionId).sort(), ['a', 'b'], 'same call id is scoped by Session');
for (let i = 0; i < 20; i++) bridge.invalidate(); await flush();
assert.equal(views.length, 2, 'notifications never overlap one pending presentation');
releaseA(); assert.equal(views[0]!.pending.answerable, true, 'another retained Session view keeps the approval alive');
await views.find(row => row.sessionId === 'a')!.pending.answer('allowed-once'); await flush();
assert.deepEqual(decisions, [{ sessionId: 'a', toolCallId: 'same-call-id', decision: 'allowed-once' }]);
bridge.invalidate(); await flush(); assert.equal(decisions.length, 1, 'acknowledged decision is not sent twice');
values.set('b', empty); bridge.invalidate(); await flush();
assert.equal(views.find(row => row.sessionId === 'b')!.pending.answerable, false, 'Host withdrawal aborts the actual official presentation');
assert.equal(decisions.length, 1, 'withdrawal must never submit rejection');
releaseB(); releaseA2(); await flush(); assert.deepEqual(releases.sort(), ['a', 'b']); assert.deepEqual(errors, []);

// UI faults leave the Host request untouched and remain explicit diagnostics.
presentingFailure = true; values.set('ui-error', pending); const releaseUI = bridge.retain('ui-error'); await flush();
assert.match(String(errors.at(-1)), /actual UI listener failed/); assert.equal(decisions.length, 1); releaseUI(); presentingFailure = false;

// Lost/invalid acknowledgement retries the exact user decision, without asking
// the UI again or turning a carrier failure into a deny decision.
rejectAck = true; values.set('ack-error', pending); const releaseAck = bridge.retain('ack-error'); await flush();
const ackView = views.at(-1)!.pending; await ackView.answer('rejected'); await flush();
assert.match(String(errors.at(-1)), /did not accept/); const viewCount = views.length;
rejectAck = false; bridge.invalidate(); await flush();
assert.equal(views.length, viewCount); assert.deepEqual(decisions.slice(-2), [
  { sessionId: 'ack-error', toolCallId: 'same-call-id', decision: 'rejected' },
  { sessionId: 'ack-error', toolCallId: 'same-call-id', decision: 'rejected' },
]); releaseAck();

// Coalesced reads are serial even under a burst of committed notifications.
holdRead = Promise.withResolvers(); const prior = readCount; maximum = 0;
const releaseHeld = bridge.retain('held');
for (let i = 0; i < 100; i++) bridge.invalidate();
assert.equal(readCount, prior + 1); assert.equal(maximum, 1);
const held = holdRead; holdRead = undefined; held.resolve(empty); await flush();
assert.equal(readCount, prior + 2, 'a single queued refresh covers writes during the held read');
releaseHeld();

// Scope/fiber disposal aborts a held actual official card without a decision.
values.set('dispose', pending); const releaseDisposed = bridge.retain('dispose'); await flush();
const disposedView = views.at(-1)!.pending, decisionCount = decisions.length;
await bridge.dispose(); releaseDisposed(); assert.equal(releases.filter(id => id === 'dispose').length, 1); assert.equal(disposedView.answerable, false); assert.equal(decisions.length, decisionCount);
const finalReads = readCount; bridge.invalidate(); await flush(); assert.equal(readCount, finalReads);

for (const [response, expected] of [
  [Response.json({ error: { code: 'session/approval-conflict', message: 'real conflict' } }, { status: 409 }), /real conflict/],
  [Response.json({ error: 'approval_failed', message: 'real Host failure' }, { status: 503 }), /real Host failure/],
  [Response.json({}), /acknowledgement/],
  [new Response('{', { status: 200 }), /JSON/],
] as const) {
  const call = createApprovalHostCall('https://fixture.invalid', (async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal); return response;
  }) as typeof fetch);
  await assert.rejects(call('resolveApproval', { sessionId: 'a' }, new AbortController().signal), expected);
}
const stop = new AbortController();
const call = createApprovalHostCall('https://fixture.invalid', (async (_input, init) => new Promise<Response>((_resolve, reject) => {
  init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
})) as typeof fetch);
const cancelled = assert.rejects(call('pendingApprovals', { sessionId: 'a' }, stop.signal), /scope left/);
stop.abort(new Error('scope left')); await cancelled;
console.log('approval bridge: real official PendingApproval, scoped identities, single reads, user-only decisions, withdrawal/disposal, exact decision retry and HTTP/business failures passed');

// No Host invalidation is needed to recover a transient lost acknowledgement.
// Retry timers belong only to an explicit already selected idempotent decision.
mock.timers.enable({ apis: ['setTimeout'] });
try {
  for (const outcome of ['recover', 'terminal', 'cancel'] as const) {
    let attempts = 0, presentations = 0;
    const failures: unknown[] = [];
    const recovery = createApprovalBridge({
      ready: () => true,
      async call(method) {
        if (method === 'pendingApprovals') return pending;
        attempts++;
        if (outcome === 'recover' && attempts === 2) return { accepted: true };
        throw new TypeError('real network failure');
      },
      async present() { presentations++; return 'allowed-once'; },
      releaseSession() {}, error: error => failures.push(error),
    });
    recovery.retain('retry'); await flush(); assert.equal(attempts, 1);
    if (outcome === 'cancel') await recovery.dispose();
    for (const delay of APPROVAL_RETRY_DELAYS) { mock.timers.tick(delay); await flush(); }
    assert.equal(presentations, 1, 'retry never asks the UI again');
    assert.equal(attempts, outcome === 'cancel' ? 1 : outcome === 'recover' ? 2 : 3);
    assert.equal(failures.length, outcome === 'terminal' ? 1 : 0);
    await recovery.dispose(); const final = attempts;
    mock.timers.tick(100000); await flush(); assert.equal(attempts, final, 'dispose leaves no retry work');
  }
} finally { mock.timers.reset(); }
console.log('approval bridge: no-notification acknowledgement recovery, bounded exact-decision retries, final diagnostic and timer disposal passed');

mock.timers.enable({ apis: ['setTimeout'] });
try {
  const posted: unknown[] = [], failures: unknown[] = [];
  const http = createApprovalHostCall('https://fixture.invalid', (async (_url, init) => {
    posted.push(JSON.parse(String(init!.body)));
    return posted.length === 1 ? Response.json({ error: 'approval_failed', message: 'temporarily unavailable' }, { status: 503 }) : Response.json({ result: { accepted: true } });
  }) as typeof fetch);
  const bridge = createApprovalBridge({ ready: () => true,
    call: (method, params, signal) => method === 'pendingApprovals' ? Promise.resolve(pending) : http(method, params, signal),
    present: async () => 'allowed-once', releaseSession() {}, error: error => failures.push(error),
  });
  bridge.retain('http-retry'); await flush(); assert.equal(posted.length, 1);
  mock.timers.tick(APPROVAL_RETRY_DELAYS[0]); await flush();
  assert.equal(posted.length, 2); assert.deepEqual(posted[0], posted[1]); assert.deepEqual(failures, []);
  await bridge.dispose();
} finally { mock.timers.reset(); }

const never = Promise.withResolvers<Record<string, unknown>>();
let latePresentations = 0, heldSignal: AbortSignal | undefined;
const heldBridge = createApprovalBridge({ ready: () => true,
  call: (_method, _params, signal) => { heldSignal = signal; return never.promise; },
  present: async () => { latePresentations++; return 'rejected'; }, releaseSession() {}, error: error => { throw error; },
});
heldBridge.retain('held-transport'); await heldBridge.dispose(); assert.equal(heldSignal?.aborted, true);
never.resolve(pending); await flush(); assert.equal(latePresentations, 0, 'late transport completion after scope disposal cannot decide');
console.log('approval bridge: real transient HTTP acknowledgement recovery and held-fetch cancellation passed');
