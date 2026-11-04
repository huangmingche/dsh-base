import assert from 'node:assert/strict';
import { ProjectionValueStore } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/projection-store.ts';
import { hostProjectionBlock, hostProjectionControl } from '../src/projection-block.ts';

const store = new ProjectionValueStore();
const snapshots = [
  { _dshBaseProjectionRevision: 4, modelSelection: { next: { model: 'deepseek-flash', reasoningEffort: 'high' } }, permissions: { currentValue: 'default' } },
  { _dshBaseProjectionRevision: 5, modelSelection: { next: { model: 'deepseek-v4-pro', reasoningEffort: 'max' } }, permissions: { currentValue: 'default' } },
  { _dshBaseProjectionRevision: 6, modelSelection: { next: { model: 'deepseek-v4-pro', reasoningEffort: 'max' } }, permissions: { currentValue: 'read-only' } },
  { _dshBaseProjectionRevision: 5, modelSelection: { next: { model: 'stale' } } },
];
let index = 0;
const frames = [];
const controller = new AbortController();
const client = {
  async *control() { for (const _ of snapshots) yield { type: 'sessions.snapshot' as const, sessions: [{ sessionId: 'a' }] }; },
  async projections() { return snapshots[index++]!; },
};
for await (const untyped of hostProjectionControl(client, controller.signal)) {
  const frame = untyped as any; frames.push(frame);
  if (frame.type === 'baseline') store.seed(frame.value.projections.a);
  else for (const change of frame.changes) store.apply(change.key, change.val, frame.seq);
}
assert.equal(frames.length, 3, 'replayed/older Host revisions cannot regress values');
assert.deepEqual(store.get('modelSelection'), { next: { model: 'deepseek-v4-pro', reasoningEffort: 'max' } });
assert.deepEqual(store.get('permissions'), { currentValue: 'read-only' });
// A later follow baseline must use the same clock, while its chat cursor may
// remain unchanged. A delayed baseline yields to the newer control frame.
store.seed(hostProjectionBlock(snapshots[0]!));
assert.equal(store.seqOf('modelSelection'), 6);
assert.equal((store.get('modelSelection') as any).next.model, 'deepseek-v4-pro');
assert.equal(store.get('_dshBaseProjectionRevision'), undefined, 'clock metadata is not a domain projection');
for (const revision of [undefined, -1, 0.5, NaN, Infinity, '6']) assert.throws(() => hostProjectionBlock({ _dshBaseProjectionRevision: revision }), /revision/);
console.log('client-session-host: actual official projection store merges Host revisions across same-chat-cursor changes, stale baseline and replay');
