/** Actual pinned Gateway supervision and domain consumers over the Workers carrier. */
import assert from 'node:assert/strict';
import { RemoteStream, RemoteStreamCarrierError, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import { createSessionControlStream, SessionEventStream } from '@deepseek-ai/dsh-api-session-controller/client';
import { createWorkspaceStateStream } from '@deepseek-ai/dsh-api-workspace-controller/client';
import { createHostRemoteStream } from '../src/remote-stream.ts';
import { ProjectionValueStore } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/projection-store.ts';
import { hostProjectionBlock } from '../src/projection-block.ts';
import { openWireStream, WireStreamFailure, type WireStreamSocketLike } from '../src/wire-stream.ts';

class Socket implements WireStreamSocketLike {
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  send(data: string) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  emit(type: string, event?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  frame(type: string, value?: unknown) {
    const streamId = this.sent.find(frame => frame.type === 'open')?.streamId;
    assert.ok(streamId);
    this.emit('message', { data: JSON.stringify({ type, streamId, ...(type === 'error' ? { error: value } : { value }) }) });
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const sockets: Socket[] = [], listeners = new Set<() => void>();
  let generation: { id: number; host: { home: string } } | undefined = { id: 1, host: { home: '' } };
  const connection = { generation: {
    getSnapshot: () => generation,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } };
  const open = (endpoint: string, signal: AbortSignal) => openWireStream<unknown>({
    baseUrl: 'https://fixture.invalid', endpoint, payload: { args: {} }, signal,
    socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
  });
  const remote = {
    $stream: <T>(options: RemoteStreamOptions<T>) => createHostRemoteStream(connection, options),
    session: { control: (signal: AbortSignal) => open('session/control', signal), follow: (_request: unknown, signal: AbortSignal) => open('session/follow', signal) },
    workspace: { follow: (signal: AbortSignal) => open('workspace/follow', signal) },
  };
  return { remote, connection, sockets, listeners, online(value: boolean) {
    generation = value ? { id: 2, host: { home: '' } } : undefined;
    for (const listener of listeners) listener();
  } };
}

// Actual official control consumer accepts each replacement baseline once. Both
// 1006 and socket error use its own recovery path, not a swallowed exception.
const host = fixture(), accepted: unknown[] = [], failed: unknown[] = [], carriers: unknown[] = [];
const projections = new ProjectionValueStore();
const control = createSessionControlStream(host.remote as never, { accept: frame => { accepted.push(frame); if (frame.type === 'baseline') projections.seed(frame.value.projections.s!); }, failed: error => failed.push(error), carrierFailed: error => carriers.push(error) });
control.start(); await flush();
host.sockets[0]!.emit('open'); host.sockets[0]!.frame('item', { type: 'baseline', value: { projections: { s: hostProjectionBlock({ _dshBaseProjectionRevision: 10, modelSelection: { next: { model: 'deepseek-flash' } } }) } } }); await flush();
host.sockets[0]!.emit('close', { code: 1006 }); await flush();
assert.equal(host.sockets.length, 2);
assert.equal(accepted.length, 1, 'accepted state stays published during recovery');
assert.ok(carriers[0] instanceof RemoteStreamCarrierError);
host.sockets[1]!.emit('open'); host.sockets[1]!.frame('item', { type: 'baseline', value: { projections: { s: hostProjectionBlock({ _dshBaseProjectionRevision: 12, modelSelection: { next: { model: 'deepseek-v4-pro', reasoningEffort: 'max' } }, permissions: { currentValue: 'read-only' } }) } } }); await flush();
assert.equal(accepted.length, 2);
assert.deepEqual(projections.get('modelSelection'), { next: { model: 'deepseek-v4-pro', reasoningEffort: 'max' } });
assert.deepEqual(projections.get('permissions'), { currentValue: 'read-only' });
control.restart(); await flush();
assert.equal(host.sockets[1]!.closed, true);
assert.equal(host.sockets.length, 3, 'official restart creates a new generation');
host.sockets[2]!.emit('open'); host.sockets[2]!.frame('item', { type: 'baseline', value: { projections: { s: hostProjectionBlock({ _dshBaseProjectionRevision: 11, modelSelection: { next: { model: 'stale' } } }) } } }); await flush();
assert.equal(projections.seqOf('modelSelection'), 12, 'delayed reconnect baseline never regresses acknowledged state');
const beforeDispose = accepted.length; await control.dispose();
host.sockets[2]!.frame('item', { type: 'baseline' }); await flush();
assert.equal(accepted.length, beforeDispose); assert.deepEqual(failed, []);
assert.ok(host.sockets.every(socket => socket.closed));

// Workspace replacement uses the unmodified official state-stream consumer.
const workspaceHost = fixture(), workspaceValues: unknown[] = [], workspaceFailures: unknown[] = [];
const workspace = createWorkspaceStateStream(workspaceHost.remote as never, { accept: {
  replaceBaseline: value => workspaceValues.push(value),
  upsertView() {}, removeView() {}, replaceOrder() {}, replaceArchived() {}, replacePinned() {},
} as never, failed: error => workspaceFailures.push(error) });
workspace.start(); await flush(); workspaceHost.sockets[0]!.emit('open');
const baseline = { items: [], archivedSessionIds: [], pinnedSessionIds: [] };
workspaceHost.sockets[0]!.frame('item', { type: 'baseline', value: baseline }); await flush();
workspaceHost.sockets[0]!.emit('error'); await flush(); workspaceHost.sockets[1]!.emit('open');
workspaceHost.sockets[1]!.frame('item', { type: 'baseline', value: baseline }); await flush();
assert.deepEqual(workspaceValues, [baseline, baseline]); assert.deepEqual(workspaceFailures, []); await workspace.dispose();

// Offline Connection owns retry timing. Cancellation releases the subscription.
const offline = fixture(); offline.online(false);
const stream = offline.remote.$stream({ name: 'offline fixture', open: signal => offline.remote.session.control(signal), ended: () => new Error('unexpected end') });
assert.ok(stream instanceof RemoteStream, 'supervisor is the actual pinned exported class');
const waiting = stream[Symbol.asyncIterator]().next(); await flush();
offline.sockets[0]!.emit('error'); await flush(); assert.equal(offline.sockets.length, 1); assert.equal(offline.listeners.size, 1);
offline.online(true); await flush(); assert.equal(offline.sockets.length, 2);
offline.sockets[1]!.emit('open'); offline.sockets[1]!.frame('item', 'recovered');
const recovered = await waiting; assert.equal(recovered.done, false); assert.equal(recovered.value!.generation, 2); recovered.value!.accept();
await stream.dispose(); assert.equal(offline.listeners.size, 0);

// Two unaccepted failures are terminal while Connection remains available;
// the unchanged supervisor never creates an unbounded hot retry loop.
const repeated = fixture();
const retry = repeated.remote.$stream({ name: 'bounded fixture', open: signal => repeated.remote.session.control(signal), ended: () => new Error('unexpected end') });
const rejected = assert.rejects(retry[Symbol.asyncIterator]().next(), /socket failed/);
await flush(); repeated.sockets[0]!.emit('error'); await flush(); repeated.sockets[1]!.emit('error'); await rejected;
assert.equal(repeated.sockets.length, 2); await retry.dispose();

// Remote business envelopes, even ones with a carrier-looking code, and bad
// protocol JSON remain terminal. No silent legacy fallback or retry occurs.
for (const variant of ['business', 'carrier-code-envelope', 'bad-json']) {
  const current = fixture();
  const logical = current.remote.$stream({ name: variant, open: signal => current.remote.session.control(signal), ended: () => new Error('unexpected end') });
  const rejection = assert.rejects(logical[Symbol.asyncIterator]().next(), (error: unknown) => {
    assert.ok(error instanceof WireStreamFailure);
    assert.equal(error.code, variant === 'business' ? 'session/not-found' : 'gateway/carrier-failed');
    return true;
  });
  await flush(); current.sockets[0]!.emit('open');
  if (variant === 'bad-json') current.sockets[0]!.emit('message', { data: '{' });
  else current.sockets[0]!.frame('error', { code: variant === 'business' ? 'session/not-found' : 'gateway/carrier-failed', message: 'real Host failure', details: { sessionId: 's' } });
  await rejection; assert.equal(current.sockets.length, 1); await logical.dispose();
}

// Real SessionEventStream replaces its window at the Host cursor on reconnect,
// then ignores already applied entries. No local prompt or mutation is replayed.
const journalHost = fixture(), changes: Array<any> = [], journalFailures: unknown[] = [];
const journal = new SessionEventStream(journalHost.remote as never, { kind: 'session', sessionId: 's' } as never, { publish: change => changes.push(change), failed: error => journalFailures.push(error) });
const opening = journal.open({}); await flush(); journalHost.sockets[0]!.emit('open');
const record = (seq: number) => ({ type: 'event', event: { seq, time: 100 + seq, ...(seq === 1 ? { type: 'user/message', surfaceOp: 'append', data: { id: 'durable-user-request', content: [{ type: 'text', text: 'already submitted' }] } } : { type: seq === 0 ? 'turn/start' : 'turn/end', data: { turn: 1, ...(seq === 2 ? { reason: 'completed' } : {}) } }) } });
const snapshot = (records: unknown[], cursor: number) => ({ type: 'snapshot', records, cursor, hasMore: false, projections: {}, assistantStream: { revision: 0, attempts: [] } });
journalHost.sockets[0]!.frame('item', snapshot([record(0)], 0)); await opening;
journalHost.sockets[0]!.emit('close', { code: 1006 }); await flush(); journalHost.sockets[1]!.emit('open');
journalHost.sockets[1]!.frame('item', snapshot([record(0), record(1)], 1)); await flush();
journalHost.sockets[1]!.frame('item', record(1)); journalHost.sockets[1]!.frame('item', record(2)); await flush();
assert.deepEqual(journalFailures, []);
assert.deepEqual(changes.map(change => change.type), ['replace', 'replace', 'append']);
assert.equal(changes[2]!.entry.event.seq, 2);
const recoveredHistory = [...changes[1]!.entries, changes[2]!.entry];
assert.equal(recoveredHistory.filter(entry => entry.event.type === 'user/message').length, 1, 'resubscription never duplicates the durable user submission'); assert.deepEqual(journalFailures, []);
await journal.dispose();
console.log('wire-stream: official supervisor + session/control/workspace/journal reconnect, restart, cursor replay, offline wait, bounded retry, terminal business/protocol failures and disposal passed');
