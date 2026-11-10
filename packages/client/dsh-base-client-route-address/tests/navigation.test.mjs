/** Delayed Host replies against the actual pinned official navigation services. */
import '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = app('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-dom')) {
      return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {}' };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
      source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm', target: 'es2022' }).code };
    return next(url, context);
  },
});
const { Context } = await import('@deepseek-ai/cordis');
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store');
const { LayoutController } = await import('@deepseek-ai/dsh-client-ui-layout/client');
const { UiWorkspaceService } = await import('@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts');
const { installAddressNavigation } = await import('../src/client/navigation.ts');

const disposers = [];
const originals = new Map(['window', 'location', 'history', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const row = (id, blank = false) => ({ id, blank, displayTitle: id, cwd: '/w/a', updatedAt: 1, retainedBy: {}, projectionValues: {} });
function bench({ path = '/zh-CN/app/session/target?keep=1#probe', saved = 'saved', blank = false, authenticated = true, initiallyReady = false,
  createSession = async request => request.sessionId ?? 'workspace-b' } = {}) {
  const writes = [];
  const storage = new Map([['dsh.sessions.current', JSON.stringify({ sessionId: saved })]]);
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.window = new EventTarget();
  globalThis.location = new URL(path, 'https://app.example.test');
  globalThis.history = Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _title, path) => {
    writes.push({ method, path }); globalThis.location = new URL(path, location);
  }]));
  const ctx = new Context();
  disposers.push(() => ctx.fiber.dispose());
  const panelInfo = createSnapshotStore({ activePanelId: null });
  const layout = new LayoutController({ selectPanel: activePanelId => panelInfo.set({ activePanelId }) }, () => true, panelInfo);
  ctx.provide('layout', layout);
  disposers.push(() => layout.dispose());
  const navigationAccess = createSnapshotStore(authenticated ? 'authenticated' : 'anonymous');
  ctx.provide('navigationAccess', navigationAccess);
  const summaries = [row('saved', blank), row('target'), row('chosen')];
  const list = createSnapshotStore({ phase: initiallyReady ? 'ready' : 'pending', ids: summaries.map(x => x.id), byId: Object.fromEntries(summaries.map(x => [x.id, x])), projectionsBySession: {} });
  const workspaces = { list: createSnapshotStore({ phase: initiallyReady ? 'ready' : 'pending', items: [
    { workspaceId: 'a', path: '/w/a', sessionIds: ['saved', 'target', 'chosen'], createdAt: '2026-01-01' },
    { workspaceId: 'b', path: '/w/b', sessionIds: [], createdAt: '2026-01-02' },
  ], archivedSessionIds: [], pinnedSessionIds: [] }) };
  const updateRow = (id, update = {}) => list.set({ ...list.getSnapshot(), ids: [...new Set([...list.getSnapshot().ids, id])],
    byId: { ...list.getSnapshot().byId, [id]: { ...(list.getSnapshot().byId[id] ?? row(id)), ...update } } });
  const retained = [], created = [];
  let refreshes = 0;
  const sessions = {
    list,
    refresh: async () => { refreshes++; },
    refreshProjections: async () => {},
    subagentAddress: () => undefined,
    create: async request => { created.push(request); return createSession(request); },
    retain(id) {
      retained.push(id);
      updateRow(id, { retainedBy: { mainView: (list.getSnapshot().byId[id]?.retainedBy.mainView ?? 0) + 1 } });
      let released = false;
      return { sessionId: id, release() {
        if (released) return; released = true;
        updateRow(id, { retainedBy: { mainView: list.getSnapshot().byId[id].retainedBy.mainView - 1 } });
      } };
    },
  };
  ctx.provide('sessions', sessions); ctx.provide('workspaces', workspaces);
  ctx.provide('locale', { bind: () => key => key });
  // Real official startup restoration, openSession, openWorkspace and their cancellation.
  const uiWorkspace = new UiWorkspaceService(ctx, {}, workspaces, sessions, {}, () => {});
  let notices = 0;
  const stop = installAddressNavigation(ctx, () => { notices++; });
  disposers.push(stop);
  const ready = () => {
    workspaces.list.set({ ...workspaces.list.getSnapshot(), phase: 'ready' });
    list.set({ ...list.getSnapshot(), phase: 'ready' });
  };
  const pop = path => { globalThis.location = new URL(path, location); window.dispatchEvent(new Event('popstate')); };
  return { ctx, layout, panelInfo, navigationAccess, sessions, workspaces, uiWorkspace, writes, retained, created,
    notices: () => notices, refreshes: () => refreshes, ready, updateRow, pop, stop,
    selection: () => Object.values(list.getSnapshot().byId).find(x => x.retainedBy.mainView > 0)?.id };
}

test('deep link supersedes a delayed official saved-blank acquisition exactly once', async () => {
  const b = bench({ blank: true });
  const acquisition = Promise.withResolvers();
  b.sessions.create = request => { b.created.push(request); return acquisition.promise; };
  b.ready(); await flush();
  assert.equal(b.selection(), 'target');
  assert.deepEqual(b.retained, ['target']);
  assert.equal(b.created.length, 1, 'the unchanged official saved-blank acquisition actually started');
  acquisition.resolve('saved'); await flush();
  assert.equal(b.selection(), 'target');
  assert.deepEqual(b.retained, ['target'], 'no delayed replay or restore overrides the target');
  assert.equal(location.pathname + location.search + location.hash, '/zh-CN/app/session/target?keep=1#probe');
  assert.equal(b.notices(), 0);
});

for (const initiallyReady of [false, true]) test(`initial home preserves official in-flight blank restoration (catalogs ready: ${initiallyReady})`, async () => {
  const acquisition = Promise.withResolvers();
  const b = bench({ path: '/', blank: true, initiallyReady, createSession: () => acquisition.promise });
  if (!initiallyReady) b.ready();
  await flush();
  assert.equal(b.created.length, 1);
  assert.equal(b.selection(), undefined, 'acquisition is genuinely pending');
  acquisition.resolve('saved'); await flush();
  assert.equal(b.selection(), 'saved');
  assert.deepEqual(b.retained, ['saved']);
  assert.equal(location.pathname, '/app/session/saved');
  assert.equal(b.notices(), 0);
});

test('Plugins selected before catalogs are ready wins over startup deep-link restoration', async () => {
  const b = bench({ blank: true });
  const acquisition = Promise.withResolvers();
  b.sessions.create = () => acquisition.promise;
  b.layout.selectPanel('plugins');
  b.ready(); await flush(); acquisition.resolve('saved'); await flush();
  assert.equal(b.panelInfo.getSnapshot().activePanelId, 'plugins');
  assert.ok(!b.retained.includes('target'));
  assert.deepEqual(b.writes, []);
  assert.equal(b.notices(), 0);
});

test('manual Session selection during delayed catalogs also cancels startup restoration', async () => {
  const b = bench();
  b.uiWorkspace.openSession('chosen'); await flush();
  b.ready(); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.ok(!b.retained.includes('target'));
  assert.equal(location.pathname, '/zh-CN/app/session/chosen');
});

test('manual Session selection wins when catalogs become ready in the same event turn', async () => {
  const b = bench();
  b.uiWorkspace.openSession('chosen');
  b.ready(); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.ok(!b.retained.includes('target'));
  assert.equal(location.pathname, '/zh-CN/app/session/chosen');
});

test('metadata updates while catalogs refresh do not count as user navigation', async () => {
  const b = bench(); b.ready(); await flush();
  b.sessions.list.set({ ...b.sessions.list.getSnapshot(), phase: 'pending' });
  b.pop('/app/session/chosen');
  b.updateRow('target', { displayTitle: 'Changed title' });
  b.ready(); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.equal(location.pathname, '/app/session/chosen');
});

test('Workspace selection while only its catalog is ready supersedes startup immediately', async () => {
  const b = bench();
  b.workspaces.list.set({ ...b.workspaces.list.getSnapshot(), phase: 'ready' });
  const acquisition = Promise.withResolvers();
  b.sessions.create = () => acquisition.promise;
  const opening = b.uiWorkspace.openWorkspace('b');
  await flush(); b.ready(); await flush();
  acquisition.resolve('workspace-b'); await opening; await flush();
  assert.equal(b.selection(), 'workspace-b');
  assert.ok(!b.retained.includes('target'));
  assert.equal(location.pathname, '/zh-CN/app/session/workspace-b');
});

test('Workspace navigation immediately after ready cannot be cancelled by a deferred URL continuation', async () => {
  const b = bench({ blank: true });
  const acquisition = Promise.withResolvers();
  b.sessions.create = request => request.workspaceId === 'b' ? acquisition.promise : Promise.resolve('saved');
  b.ready();
  const opening = b.uiWorkspace.openWorkspace('b');
  await flush(); acquisition.resolve('workspace-b'); await opening; await flush();
  assert.equal(b.selection(), 'workspace-b');
  assert.equal(location.pathname, '/zh-CN/app/session/workspace-b');
});

test('a panel click cancels unresolved deep links without later selection, notice or URL rewrite', async () => {
  const b = bench({ path: '/app/session/missing' }); b.ready(); await flush();
  assert.equal(b.refreshes(), 1);
  b.layout.selectPanel('plugins');
  b.updateRow('missing'); await flush();
  assert.equal(b.panelInfo.getSnapshot().activePanelId, 'plugins');
  assert.ok(!b.retained.includes('missing'));
  assert.equal(location.pathname, '/app/session/missing');
  assert.equal(b.notices(), 0);
});

test('a newer Session selection aborts unresolved addresses and mirrors the chosen Session', async () => {
  const b = bench({ path: '/zh-CN/app/session/missing?keep=1#probe' }); b.ready(); await flush();
  b.uiWorkspace.openSession('chosen'); await flush();
  b.updateRow('missing'); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.ok(!b.retained.includes('missing'));
  assert.equal(location.pathname + location.search + location.hash, '/zh-CN/app/session/chosen?keep=1#probe');
  assert.equal(b.notices(), 0);
});

test('rapid popstate requests keep only the latest target and ignore stale completion', async () => {
  const b = bench(); b.ready(); await flush();
  b.pop('/ja/app/session/missing?from=back#anchor'); await flush();
  b.pop('/ja/app/session/chosen?from=forward#anchor'); await flush();
  b.updateRow('missing'); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.equal(location.pathname + location.search + location.hash, '/ja/app/session/chosen?from=forward#anchor');
  assert.ok(!b.retained.includes('missing'));
  assert.equal(b.notices(), 0);
});

for (const target of ['panel', 'session', 'popstate']) test(`official Workspace acquisition yields to a newer ${target} action`, async () => {
  const b = bench(); b.ready(); await flush();
  const acquisition = Promise.withResolvers();
  b.sessions.create = () => acquisition.promise;
  b.pop('/app/workspace/b'); await flush();
  if (target === 'panel') b.layout.selectPanel('plugins');
  if (target === 'session') b.uiWorkspace.openSession('chosen');
  if (target === 'popstate') b.pop('/app/session/chosen');
  await flush(); acquisition.resolve('workspace-b'); await flush();
  assert.ok(!b.retained.includes('workspace-b'));
  assert.equal(b.notices(), 0);
  if (target === 'panel') assert.equal(b.panelInfo.getSnapshot().activePanelId, 'plugins');
  else { assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() })); assert.equal(location.pathname, '/app/session/chosen'); }
});

test('a winning official Workspace handoff mirrors its Session without another open or retry', async () => {
  const b = bench(); b.ready(); await flush();
  b.pop('/ja/app/workspace/b?keep=1#probe'); await flush();
  assert.equal(b.selection(), 'workspace-b');
  assert.equal(b.retained.filter(id => id === 'workspace-b').length, 1);
  assert.equal(location.pathname + location.search + location.hash, '/ja/app/session/workspace-b?keep=1#probe');
  assert.equal(b.notices(), 0);
});

test('history traversal while boot is waiting replaces the captured startup address', async () => {
  const b = bench();
  b.pop('/app/session/chosen'); b.ready(); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.ok(!b.retained.includes('target'));
  assert.equal(location.pathname, '/app/session/chosen');
});

test('anonymous deep links do not refresh private catalogs, and sign-in restores the current history entry', async () => {
  const b = bench({ authenticated: false, path: '/app/session/missing' });
  b.pop('/zh-CN/app/session/chosen?keep=1#probe'); await flush();
  assert.equal(b.refreshes(), 0); assert.deepEqual(b.retained, []);
  b.navigationAccess.set('authenticated'); b.ready(); await flush();
  assert.equal(b.selection(), 'chosen', JSON.stringify({ retained: b.retained, writes: b.writes, refreshes: b.refreshes(), notices: b.notices() }));
  assert.equal(location.pathname + location.search + location.hash, '/zh-CN/app/session/chosen?keep=1#probe');
});

for (const action of ['sign-out', 'dispose']) test(`${action} invalidates pending restoration and prevents stale side effects`, async () => {
  const b = bench({ path: '/app/session/missing' }); b.ready(); await flush();
  if (action === 'sign-out') b.navigationAccess.set('anonymous'); else b.stop();
  b.updateRow('missing'); await flush();
  assert.ok(!b.retained.includes('missing'));
  assert.equal(location.pathname, '/app/session/missing'); assert.equal(b.notices(), 0);
});

test('an actually missing address still reports once and falls back without retrying', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = bench({ path: '/zh-CN/app/session/missing?keep=1#probe' }); b.ready(); await flush();
  t.mock.timers.tick(8_001); await flush();
  assert.equal(b.notices(), 1); assert.equal(b.refreshes(), 1);
  assert.equal(location.pathname + location.search + location.hash, '/zh-CN?keep=1#probe');
  assert.ok(!b.retained.includes('missing'));
});
