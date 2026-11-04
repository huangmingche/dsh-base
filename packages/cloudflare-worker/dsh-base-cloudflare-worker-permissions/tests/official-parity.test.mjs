import './runtime-hook.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { Context } = await import('@deepseek-ai/cordis');
const { default: SessionStore, Session, SessionId } = await import('@deepseek-ai/dsh-session');
const { default: Projections } = await import('@deepseek-ai/dsh-session-projection');
const { default: Approval } = await import('@deepseek-ai/dsh-user-approval');
const { default: Official } = await import('@deepseek-ai/dsh-permission-presets');
const { PermissionPresetService: Fork } = await import('../src/presets.ts');
const { LogicalR2PermissionExecutor } = await import('../src/executor.ts');
const { createPermissionRuntime } = await import('../src/runtime.ts');
const { PERMISSION_PRESETS } = await import('../src/settings.ts');

const presets = {
  'read-only': { sandbox: 'read-only', approval: 'ask' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  alias: { sandbox: 'workspace-write', approval: 'ask' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
};
async function mount(Plugin, fork, configuredPresets = presets) {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  await ctx.plugin(Projections);
  await ctx.plugin(Approval, { policy: 'ask' });
  ctx.provide('commands', { register(definition) { ctx.commandUnderTest = definition; return () => {}; } });
  if (fork) ctx.provide('permissionExecutor', new LogicalR2PermissionExecutor());
  else {
    // Test-only declared capability, like upstream's own preset tests. No shell
    // operation is exercised and this object is never shipped in the Host.
    ctx.provide('shell', { sandboxMode: 'workspace-write', run() { throw Error('Test must not execute a shell'); } });
    ctx.provide('agents', { list: () => [] });
  }
  await ctx.plugin(Plugin, { presets: configuredPresets, defaultPreset: 'read-only' });
  return ctx;
}
const facts = session => session.snapshotEvents().map(({ seq, type, data }) => ({ seq, type, data }));

test('complete fork matches unchanged pinned service for initial/default/seed/drift/shared-bundle/no-op semantics', async () => {
  const official = await mount(Official, false), fork = await mount(Fork, true);
  try {
    assert.deepEqual(fork.get('permissionPresets').catalog(), official.get('permissionPresets').catalog());
    for (const seed of [undefined, [], [{ seq: 0, time: 1, type: 'sandbox/mode', data: { mode: 'read-only' } }]]) {
      const a = seed === undefined ? Session.create(SessionId('a')) : Session.create(SessionId('a'), seed);
      const b = seed === undefined ? Session.create(SessionId('b')) : Session.create(SessionId('b'), seed);
      // Exercise the original public Agent-created contract, not its private helper.
      official.emit('agent/created', { agent: { session: a } });
      fork.emit('agent/created', { agent: { session: b } });
      assert.deepEqual(facts(b), facts(a));
      for (const selected of ['workspace-write', 'alias', 'alias', 'danger-full-access', 'read-only']) {
        official.get('permissionPresets').set(a, selected);
        fork.get('permissionPresets').set(b, selected);
        assert.deepEqual(facts(b), facts(a));
        assert.equal(fork.get('permissionPresets').current(b), official.get('permissionPresets').current(a));
      }
      a.append('approval/policy', { policy: 'never' }); b.append('approval/policy', { policy: 'never' });
      assert.equal(official.get('permissionPresets').current(a), 'custom');
      assert.equal(fork.get('permissionPresets').current(b), 'custom');
      assert.deepEqual(facts(b), facts(a));
    }
  } finally { await fork.fiber.dispose(); await official.fiber.dispose(); }
});

test('untrusted stored policy facts fail before an invalid fold can grant access', async () => {
  const runtime = await createPermissionRuntime();
  try {
    for (const event of [
      { type: 'sandbox/mode', data: { mode: 'arbitrary' } },
      { type: 'approval/policy', data: { policy: 'allow' } },
      { type: 'permission/preset', data: { preset: null } },
      { type: 'session/end-seed', data: { inherited: 'yes' } },
      { type: 'tool/result', data: {} },
      { type: 'sandbox/mode', data: null },
    ]) assert.throws(() => runtime.initializeSession('bad', [{ seq: 0, time: 1, ...event }]), /Invalid|unrelated/);
    assert.throws(() => runtime.snapshot('bad', [{ seq: 2, time: 1, type: 'sandbox/mode', data: { mode: 'danger-full-access' } }]), /seq|contiguous/);
  } finally { await runtime.dispose(); }
});

test('Host permission handler matches the actual original registered command for success, query and error', async () => {
  const original = await mount(Official, false), fork = await mount(Fork, true);
  try {
    const a = Session.create(SessionId('official-command')), b = Session.create(SessionId('host-command'));
    original.emit('agent/created', { agent: { session: a } }); fork.emit('agent/created', { agent: { session: b } });
    assert.equal(typeof original.commandUnderTest?.handler, 'function');
    for (const rawInput of ['', ' workspace-write', ' alias', ' danger-full-access', ' danger-full-access', ' invalid', ' read-only']) {
      // Only the original test Agent's policy notice injection is recorded here;
      // the product Host does not manufacture a native DSH Agent.
      const notices = [];
      const expected = await original.commandUnderTest.handler({ agent: { session: a, inject(message) { notices.push(message); } }, rawInput });
      const result = fork.get('permissionPresets').executeCommand(b, rawInput);
      assert.deepEqual(result, expected);
      assert.deepEqual(facts(b), facts(a));
    }
  } finally { await original.fiber.dispose(); await fork.fiber.dispose(); }
});

test('narrow Host policy port preserves the actual official command notice producer, initialization and no-op semantics', async () => {
  const original = await mount(Official, false, PERMISSION_PRESETS), runtime = await createPermissionRuntime();
  try {
    const session=Session.create(SessionId('original-notices'));
    original.emit('agent/created',{agent:{session}});
    let state=runtime.initializeSession('host-notices',null,'read-only');
    assert.deepEqual(state.notices,[]);
    const normalized=messages=>messages.map(({id,...message})=>message);
    for(const rawInput of ['', ' workspace-write', ' danger-full-access', ' danger-full-access', ' invalid', ' read-only']) {
      const expectedNotices=[];
      const expected=await original.commandUnderTest.handler({agent:{session,inject(message){expectedNotices.push(message);}},rawInput});
      const actual=runtime.executeCommand('host-notices',state.events,`/permission${rawInput}`,`command-${state.events.length}`,0);
      assert.deepEqual(actual.execution.result,expected);
      assert.deepEqual(normalized(actual.notices),normalized(expectedNotices));
      state=actual;
    }
    assert.equal(state.snapshot.approval,'ask');
    assert.match(await runtime.modelContext('host-notices',state.events),/Approval prompts are enabled/);
    const freshNever=runtime.initializeSession('fresh-never',null,'danger-full-access');
    assert.deepEqual(freshNever.notices,[],'new Session policy is context, never a fabricated change');
    assert.match(await runtime.modelContext('fresh-never',freshNever.events),/Approval prompts are disabled/);
  }finally{await runtime.dispose();await original.fiber.dispose();}
});
