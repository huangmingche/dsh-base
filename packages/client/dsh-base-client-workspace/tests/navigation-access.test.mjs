/** Exercise the real fork service and shortcuts with the pinned official Cordis/store runtimes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { registerOfficialSourceHooks } from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const appRequire = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = appRequire('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@dsh-base/client-auth-login/request') return { url: new URL('../../dsh-base-client-auth-login/src/client/request.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === '@dsh-base/client-session-adapter/navigation-access') return { url: new URL('../../dsh-base-client-session-adapter/src/client/navigation-access.ts', import.meta.url).href, shortCircuit: true };
    if (['react', 'react/jsx-runtime', 'react-dom', 'clsx'].includes(specifier)) return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => key })' };
    if ((url.includes('/dsh-base-client-workspace/src/') && url.endsWith('.ts')) || url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: url.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'esm', target: 'es2022' }).code };
    return next(url, context);
  },
});
const { Context } = await import('@deepseek-ai/cordis');
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store');
const { UiWorkspaceService } = await import('../src/client/navigation.ts');
const { apply: applyWorkspace } = await import('../src/client/index.ts');
const { navigationSource } = await import('../src/client/access.ts');
const { createWorkspaceShortcutControls, installWorkspaceShortcuts } = await import('../src/client/shortcuts.ts');
const loginRequests = [];
globalThis.window = new EventTarget();
window.addEventListener('dsh-base:request-login', event => loginRequests.push(event.detail));
const tick = () => new Promise(resolve => setImmediate(resolve));
function bench(state = 'anonymous', phase = 'pending', mountService = true) {
  const ctx = new Context(), calls = [], releases = [];
  const access = createSnapshotStore(state);
  ctx.provide('navigationAccess', access);
  ctx.provide('locale', { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {}, bind: () => key => key, register: () => () => {} });
  ctx.provide('layout', { beginNavigation: () => new AbortController().signal, selectPanel: () => calls.push('selectPanel'), panelInfo: createSnapshotStore({ activePanelId: null }) });
  const sessions = { list: createSnapshotStore({ ids: [], byId: {}, phase, projectionsBySession: {} }),
    create: async () => { calls.push('createSession'); return 'new'; },
    retain: id => { calls.push('retain'); return { sessionId: id, release: () => releases.push(id) }; },
    subagentAddress: () => undefined,
    fork: async () => { calls.push('fork'); return 'forked'; },
    refreshProjections: async () => calls.push('refresh'),
  };
  const workspaces = { list: createSnapshotStore({ items: [], archivedSessionIds: [], pinnedSessionIds: [], phase, state: 'idle', error: null }),
    initializeDefault: async () => { calls.push('initializeDefault'); },
    ...Object.fromEntries(['archiveSession', 'unarchiveSession', 'pinSession', 'unpinSession'].map(method => [method, async () => { calls.push(method); }])) };
  const directory = Object.fromEntries(['pick', 'list', 'createDirectory'].map(method => [method, async () => { calls.push(method); return { ok: true, value: null }; }]));
  ctx.provide('sessions', sessions);
  ctx.provide('workspaces', workspaces);
  const grants = createSnapshotStore(false);
  ctx.provide('remoteAccess', { whenResourceAccess(_kind, _id, _action, callback) {
    calls.push('remoteAccess');
    let cleanup;
    const sync = () => { cleanup?.(); cleanup = grants.getSnapshot() ? callback() : undefined; };
    const unsub = grants.subscribe(sync); sync();
    return () => { unsub(); cleanup?.(); };
  } });
  const service = mountService ? new UiWorkspaceService(ctx, directory, workspaces, sessions, { pinSessionOrder: () => calls.push('pinOrder') }, () => calls.push('notice')) : undefined;
  return { ctx, calls, releases, access, service, sessions, workspaces, grants, directory };
}
test('every service action and startup restoration stays closed for checking, anonymous and errors', async () => {
  for (const state of ['checking', 'anonymous', 'error']) {
    const b = bench(state, 'ready');
    try {
      b.service.startSession(); b.service.openSession('old');
      for (const invoke of [() => b.service.connectWorkspace('w'), () => b.service.openWorkspace('w'), () => b.service.forkSession('s'), () => b.service.archiveSession('s'), () => b.service.unarchiveSession('s'), () => b.service.pinSession('s'), () => b.service.unpinSession('s'), () => b.service.pickDirectory(), () => b.service.listDirectory(), () => b.service.createDirectory('/', 'new')]) await assert.rejects(async () => invoke(), /auth\/required/);
      const stop = b.service.whenAccess('w', 'workspace/rename', () => { b.calls.push('allowed'); return () => {}; });
      await tick();
      assert.deepEqual(b.calls, [], state);
      stop();
    } finally { await b.ctx.fiber.dispose(); }
  }
});
test('authenticated service preserves real RemoteAccess and immediately retracts owner navigation on sign-out', async () => {
  const b = bench('authenticated');
  try {
    const stop = b.service.whenAccess('w', 'workspace/rename', () => { b.calls.push('allowed'); return () => b.calls.push('withdraw'); });
    assert.deepEqual(b.calls, ['remoteAccess']);
    b.grants.set(true);
    assert.deepEqual(b.calls, ['remoteAccess', 'allowed']);
    b.service.openSession('s');
    assert.ok(b.calls.includes('retain'));
    b.access.set('anonymous');
    assert.deepEqual(b.releases, ['s']);
    assert.ok(b.calls.includes('withdraw'));
    const before = b.calls.length;
    b.service.startSession(); b.service.openSession('other');
    await assert.rejects(b.service.listDirectory(), /auth\/required/);
    assert.equal(b.calls.length, before);
    stop();
  } finally { await b.ctx.fiber.dispose(); }
});
test('a signed-out directory result is discarded and old owner snapshots disappear synchronously', async () => {
  const b = bench('authenticated');
  try {
    const empty = [], source = createSnapshotStore(['private']), visible = navigationSource(b.access, source, empty);
    assert.deepEqual(visible.getSnapshot(), ['private']);
    let notify = 0; const unsub = visible.subscribe(() => notify++);
    const pending = b.service.listDirectory();
    b.access.set('anonymous');
    await assert.rejects(pending, /auth\/required/);
    assert.equal(visible.getSnapshot(), empty);
    assert.equal(notify, 1);
    source.set(['stale']); assert.equal(visible.getSnapshot(), empty);
    unsub();
  } finally { await b.ctx.fiber.dispose(); }
});
test('anonymous new/search/add shortcuts request login and captured authenticated commands recheck before running', async () => {
  const b = bench('anonymous');
  try {
    const commands = new Map();
    b.ctx.provide('shortcuts', { register: command => { commands.set(command.id, command); return () => {}; } });
    b.ctx.provide('slots', { entries: () => [{}] });
    const controls = createWorkspaceShortcutControls(() => b.access.getSnapshot() === 'authenticated');
    installWorkspaceShortcuts(b.ctx, b.service, controls, () => b.calls.push('archiveShortcut'), () => b.calls.push('forkFailed'));
    const beforeRequests = loginRequests.length;
    for (const id of ['session.new', 'session.search', 'workspace.add']) {
      const resolved = commands.get(id).resolve({ modal: null });
      assert.equal(resolved.status, 'handled', id); resolved.run();
    }
    assert.equal(loginRequests.length, beforeRequests + 3);
    for (const id of ['session.rename', 'session.fork', 'session.archive']) assert.equal(commands.get(id).resolve({ modal: null }).status, 'blocked', id);
    controls.search(); controls.add(); controls.rename('private', 'title');
    assert.deepEqual(controls.state.getSnapshot(), { searchRequest: 0, addRequested: false, directoryBusy: false, renameTarget: null });
    b.access.set('authenticated');
    const captured = commands.get('session.search').resolve({ modal: null });
    assert.equal(captured.status, 'handled');
    b.access.set('anonymous'); captured.run();
    assert.equal(loginRequests.length, beforeRequests + 4);
    assert.equal(controls.state.getSnapshot().searchRequest, 0);
    assert.deepEqual(b.calls, []);
  } finally { await b.ctx.fiber.dispose(); }
});

function mountedBench() {
  const b = bench('authenticated', 'pending', false), registrations = [];
  const source = createSnapshotStore(null);
  b.ctx.provide('remote', { directoryPicker: b.directory, $host: {} });
  b.ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore([]) });
  b.ctx.provide('contextMenus', { active: source, close: () => source.set(null), register: () => () => {} });
  b.ctx.provide('slots', {
    provideRoot: () => {}, registerFactory: () => () => {}, entries: () => [], subscribe: () => () => {},
    register: (options) => { registrations.push(options); return () => {}; },
    inject: (_name, factory) => { const result = factory(); if (result?.[Symbol.iterator]) for (const _item of result) {} return () => {}; },
  });
  applyWorkspace(b.ctx);
  return { ...b, browser: () => registrations.find(item => item.name === 'sidebar.workspaces').inject(), injected: id => {
    const entry = registrations.find(item => item.id === id);
    assert.ok(entry, id); return entry.inject();
  } };
}
function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('the registered rename callback rechecks access after SessionReference.ready settles', async () => {
  for (const revoke of [false, true]) {
    const b = mountedBench(), ready = deferred(), renamed = [];
    try {
      b.sessions.using = async (_id, _source, operation) => {
        await ready.promise;
        await operation({ binding: { session: { rename: async title => { renamed.push(title); } } } });
        return { ok: true };
      };
      const result = b.injected('workspace.session-rename').renameSession('private', 'new title');
      if (revoke) b.access.set('anonymous');
      ready.resolve();
      if (revoke) await assert.rejects(result, /auth\/required/);
      else await result;
      assert.deepEqual(renamed, revoke ? [] : ['new title']);
    } finally { await b.ctx.fiber.dispose(); }
  }
});
test('a delayed active-session archive refusal cannot reopen a previous owner dialog', async () => {
  for (const revoke of [false, true]) {
    const b = mountedBench(), refusal = deferred();
    try {
      b.sessions.list.set({ ids: ['private'], byId: { private: { id: 'private', displayTitle: 'private old title', retainedBy: {} } }, phase: 'pending', projectionsBySession: {} });
      b.workspaces.archiveSession = () => refusal.promise;
      const overlay = b.injected('workspace.session-archive');
      b.injected('archive').archiveSession('private');
      if (revoke) b.access.set('anonymous');
      refusal.reject(Object.assign(new Error('active'), { name: 'WorkspaceArchiveError', rpcError: { code: 'workspace/session-active', details: { activity: [{ kind: 'job', id: 'private-job' }] } } }));
      await tick();
      const request = overlay.hooks.archiveRequest.getSnapshot();
      if (revoke) assert.equal(request, null);
      else assert.equal(request.displayTitle, 'private old title', 'authenticated official confirmation remains available');
    } finally { await b.ctx.fiber.dispose(); }
  }
});


test('anonymous browser search and add callbacks request login before private workflow state or Host calls', async () => {
  for (const state of ['anonymous', 'checking', 'error']) {
    const b = mountedBench();
    try {
      b.access.set(state);
      const beforeCalls = [...b.calls], beforeRequests = loginRequests.length;
      // Browser registration has no id; its injected action contract is unambiguous.
      const browser = b.browser();
      browser.requestSearch(); browser.requestAddWorkspace();
      assert.equal(loginRequests.length - beforeRequests, state === 'anonymous' ? 2 : 0, state);
      assert.deepEqual(browser.hooks.workspaceShortcuts.getSnapshot(), { searchRequest: 0, addRequested: false, directoryBusy: false, renameTarget: null });
      assert.deepEqual(b.calls, beforeCalls, state);
    } finally { await b.ctx.fiber.dispose(); }
  }
});
