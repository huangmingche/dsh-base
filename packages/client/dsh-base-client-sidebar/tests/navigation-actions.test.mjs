/** The real fork callbacks keep public navigation separate from private action authorization. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { registerOfficialSourceHooks } from '../../../../scripts/build/official-source-hook.mjs';
registerOfficialSourceHooks();
const appPackage = new URL('../../../../apps/web/package.json', import.meta.url);
const { transformSync } = createRequire(appPackage)('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@dsh-base/client-auth-login/request') return { url: new URL('../../dsh-base-client-auth-login/src/client/request.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === '@dsh-base/client-session-adapter/navigation-access') return { url: new URL('../../dsh-base-client-session-adapter/src/client/navigation-access.ts', import.meta.url).href, shortCircuit: true };
    if (['react', 'react/jsx-runtime', 'react-dom', 'clsx'].includes(specifier)) return next(specifier, { ...context, parentURL: appPackage.href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => key })' };
    if (url.endsWith('.tsx') || (/dsh-base-client-(sidebar|entry-customization)\/src\//.test(url) && url.endsWith('.ts'))) return {
      format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: url.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'esm', target: 'es2022' }).code,
    };
    return next(url, context);
  },
});
const { Context } = await import('@deepseek-ai/cordis');
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store');
const { apply: sidebar } = await import('../src/client/index.ts');
const { EntryMenuContent } = await import('../../dsh-base-client-entry-customization/src/client/EntryMenuContent.tsx');
const { apply: more } = await import('../../dsh-base-client-entry-customization/src/client/index.ts');
globalThis.window = new EventTarget();
const login = [];
window.addEventListener('dsh-base:request-login', event => login.push(event.detail));
function bench(state = 'anonymous') {
  const ctx = new Context(), access = createSnapshotStore(state), calls = [], registrations = [];
  const panels = ['plugins', 'schedules'].map((id, order) => ({ options: { id, order, label: id, priority: 0 }, component() {} }));
  ctx.provide('navigationAccess', access);
  ctx.provide('locale', { register: () => () => {}, bind: () => key => key, getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} });
  ctx.provide('shortcuts', { catalog: createSnapshotStore([]) });
  ctx.provide('layout', { selectPanel: id => calls.push(['panel', id]), toggleSidebar: () => {} });
  ctx.provide('uiWorkspace', { startSession: (...args) => calls.push(['session', ...args]) });
  ctx.provide('pluginNavigation', { openList: () => calls.push(['browse']) });
  ctx.provide('slots', {
    subscribe: () => () => {}, entriesOfSlot: name => name === 'sidebar.panellist' ? panels : [],
    register: options => { registrations.push(options); return () => {}; },
    inject: (_name, factory) => { const value = factory(); if (value?.[Symbol.iterator]) for (const _entry of value) {} return () => {}; },
  });
  return { ctx, access, calls, panels, injected: name => registrations.find(item => item.name === name).inject() };
}
test('anonymous sidebar opens mounted public pages while New Session only requests login', async () => {
  const b = bench();
  try {
    sidebar(b.ctx);
    const actions = b.injected('sidebar'), before = login.length;
    actions.selectPanel('plugins'); actions.selectPanel('schedules'); actions.selectPanel('unregistered');
    actions.startSession();
    assert.deepEqual(b.calls, [['panel', 'plugins'], ['panel', 'schedules']]);
    assert.equal(login.length, before + 1);
    b.access.set('error'); actions.startSession(); assert.equal(login.length, before + 1);
    b.access.set('authenticated'); actions.startSession();
    assert.deepEqual(b.calls.at(-1), ['session', undefined]);
  } finally { await b.ctx.fiber.dispose(); }
});
test('anonymous More browses the real public plugin service but gates Creator drafts at execution', async () => {
  const b = bench();
  try {
    more(b.ctx);
    const actions = b.injected('sidebar.panellist.actions'), before = login.length;
    actions.browsePlugins(); actions.createPlugin();
    assert.deepEqual(b.calls, [['browse']]); assert.equal(login.length, before + 1);
    b.access.set('authenticated'); actions.createPlugin(); assert.equal(b.calls.at(-1)[0], 'session');
    const calls = b.calls.length;
    b.access.set('anonymous'); actions.createPlugin();
    assert.equal(b.calls.length, calls); assert.equal(login.length, before + 2);
  } finally { await b.ctx.fiber.dispose(); }
});


test('anonymous Creator waits for official menu focus restoration before requesting login', () => {
  const frames = [], calls = [];
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  try {
    const menu = EntryMenuContent({ entries: [], region: 'sidebar', onDismiss: () => calls.push('dismiss'),
      usePluginNavigation: select => select(true), useNavigationAccess: select => select({ state: 'anonymous', allowed: false }),
      createPlugin: () => calls.push('create'), browsePlugins() {}, onOpen() {}, t: key => key,
    });
    const create = menu.props.children.find(child => child?.props?.children === 'create');
    create.props.onSelect();
    assert.deepEqual(calls, ['dismiss'], 'private action cannot race the unmounting menu row');
    assert.equal(frames.length, 1);
    // The official Menu restores focus in its selection microtask before this frame.
    calls.push('menu-restored-focus'); frames[0]();
    assert.deepEqual(calls, ['dismiss', 'menu-restored-focus', 'create']);
  } finally { if (previous === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previous; }
});
