import './runtime-hook.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createPermissionRuntime } = await import('../src/runtime.ts');
const { assertFilePermission, assertApprovalCanBeAsked } = await import('../src/executor.ts');

test('pinned permission service owns defaults, three facts, replay, no-op and session isolation', async () => {
  const runtime = await createPermissionRuntime();
  try {
    const first = runtime.initializeSession('first', null, 'workspace-write');
    assert.deepEqual(first.events.map(event => [event.type, event.data]), [
      ['permission/preset', { preset: 'workspace-write' }], ['sandbox/mode', { mode: 'workspace-write' }], ['approval/policy', { policy: 'ask' }],
    ]);
    assert.deepEqual(first.snapshot, { currentValue: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' });
    assert.equal(runtime.initializeSession('second', null, 'danger-full-access').snapshot.approval, 'never');
    assert.deepEqual(runtime.snapshot('first', first.events), first.snapshot);
    assert.deepEqual(runtime.initializeSession('first', first.events, 'danger-full-access').appended, []);
    const switched = runtime.selectPreset('first', first.events, 'danger-full-access');
    assert.deepEqual(switched.appended.filter(event => event.type !== 'session/end-seed').map(event => [event.type, event.data]), [
      ['permission/preset', { preset: 'danger-full-access' }], ['sandbox/mode', { mode: 'danger-full-access' }], ['approval/policy', { policy: 'never' }],
    ]);
    assert.deepEqual(runtime.selectPreset('first', switched.events, 'danger-full-access').appended, []);
    assert.equal(runtime.initializeSession('legacy', [], 'danger-full-access').snapshot.currentValue, 'workspace-write');
    assert.equal(runtime.initializeSession('fork', switched.events, 'read-only').snapshot.currentValue, 'danger-full-access');
    assert.throws(() => runtime.selectPreset('first', switched.events, 'auto'), /unknown preset/);
    assert.throws(() => runtime.initializeSession('new', null, 'custom'), /unknown preset/);
    const restored = await createPermissionRuntime();
    try { assert.deepEqual(restored.snapshot('first', switched.events), switched.snapshot); }
    finally { await restored.dispose(); }
    assert.deepEqual(runtime.catalog('read-only').defaultOptions.map(option => option.value), ['read-only', 'workspace-write', 'danger-full-access']);
    assert.equal(runtime.catalog('read-only').defaultPreset, 'read-only');
    assert.deepEqual(switched.events.slice(0, first.events.length), first.events, 'existing seq/time and facts never change');
  } finally { await runtime.dispose(); }
});

test('logical R2 permissions enforce account, workspace, path, read-only and consent at every operation', async () => {
  const runtime = await createPermissionRuntime();
  try {
    const readOnly = runtime.initializeSession('read', null, 'read-only').snapshot;
    const workspace = runtime.initializeSession('workspace', null, 'workspace-write').snapshot;
    const full = runtime.initializeSession('full', null, 'danger-full-access').snapshot;
    const operation = { ownerId: 'owner', targetOwnerId: 'owner', sessionWorkspaceId: 'a', targetWorkspaceId: 'a', sessionWorkspaceRoot: '/workspace/a', targetWorkspaceRoot: '/workspace/a', path: 'file.txt', write: true };
    assert.equal(assertFilePermission(workspace, operation), '/workspace/a/file.txt');
    assert.throws(() => assertFilePermission(readOnly, operation), /read-only/);
    assert.equal(assertFilePermission(readOnly, { ...operation, write: false }), '/workspace/a/file.txt');
    const other = { ...operation, targetWorkspaceId: 'b', targetWorkspaceRoot: '/workspace/b' };
    assert.throws(() => assertFilePermission(workspace, other), /outside-workspace/);
    assert.equal(assertFilePermission(full, other), '/workspace/b/file.txt');
    for (const snapshot of [readOnly, workspace, full]) {
      assert.throws(() => assertFilePermission(snapshot, { ...operation, write: false, targetOwnerId: 'other' }), /owner/);
      for (const path of ['../outside', '/workspace/ab/file', 'a/../../outside', 'a\\b', 'a\0b', 'a//b', 'a/./b']) assert.throws(() => assertFilePermission(snapshot, { ...operation, write: false, path }), /path/);
    }
    assert.doesNotThrow(() => assertApprovalCanBeAsked(workspace));
    assert.throws(() => assertApprovalCanBeAsked(full), /approval-disabled/);
  } finally { await runtime.dispose(); }
});
