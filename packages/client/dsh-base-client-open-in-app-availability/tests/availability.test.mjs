/** Real official components and SlotCore; absent desktop capabilities never execute a launch. */
import '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = app('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'zod' || specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-dom')) {
      return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => String(key) })' };
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm', target: 'es2022' }).code };
    return next(url, context);
  },
});
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store');
const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots');
const { OpenInAppAction } = await import('@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx');
const { en, zh } = await import('@deepseek-ai/dsh-client-ui-open-in-app/src/client/locales.ts');
const { installOpenInAppAvailability } = await import('../src/client/index.tsx');
const { canOpenDirectory, openInAppUnavailableReason } = await import('../src/availability.ts');
const { OpenInAppController } = await import('@deepseek-ai/dsh-client-ui-open-in-app/src/client/controller.ts');
const { openInAppAvailability } = await import('../../../cloudflare-worker/dsh-base-cloudflare-worker-open-in-app-availability/src/index.ts');

test('unchanged official controller consumes the explicit Worker catalog once without private data or errors', async () => {
  const reads = [];
  const controller = new OpenInAppController(async (input, init) => {
    reads.push({ input, init });
    const response = await openInAppAvailability(new Request(new URL(input, 'https://app.example.test/'), init),
      new Proxy({}, { get() { throw new Error('no private data access'); } }));
    assert.equal(response?.status, 200, 'availability is JSON, not a swallowed 404 or SPA document');
    return response;
  });
  await Promise.all([controller.load(), controller.load()]); await controller.load();
  assert.equal(reads.length, 1);
  assert.equal(reads[0].input, 'open-in-app/apps');
  assert.equal(new Headers(reads[0].init.headers).get('accept'), 'application/json');
  assert.deepEqual(controller.apps.getSnapshot(), []);
  assert.equal(controller.currentApp(), undefined);
  assert.equal(controller.operation.getSnapshot().phase, 'idle');
  assert.equal(canOpenDirectory('/workspace', controller.apps.getSnapshot()), false);
});

test('native opening requires both an actual directory and a known Host application', () => {
  for (const cwd of [undefined, '']) {
    for (const apps of [null, [], ['vscode']]) assert.equal(canOpenDirectory(cwd, apps), false);
  }
  for (const apps of [null, [], ['unrecognized'], ['constructor'], ['__proto__'], ['toString']]) {
    assert.equal(canOpenDirectory('/work', apps), false);
  }
  assert.equal(canOpenDirectory('/work', ['vscode']), true);
  assert.equal(canOpenDirectory('/work', ['unrecognized', 'finder']), true);
});

test('eight localized unavailable explanations accept browser language tags', () => {
  const copy = ['en-US', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt_BR'].map(openInAppUnavailableReason);
  assert.equal(new Set(copy).size, 8);
  assert.ok(copy.every(value => value.length > 0));
  assert.equal(openInAppUnavailableReason('unknown'), copy[0]);
});

test('disabled Session menu entries follow the real directory slot and yield to the official contribution', async () => {
  const core = new SlotCore();
  const slot = 'sidebar.right.tab.files.actions';
  const stopRoot = core.register({ name: 'root', children: { [slot]: { kind: 'list', scope: 'session' } } }, () => null);
  const registrations = new Map();
  const locale = createSnapshotStore({ active: 'en' });
  const sessions = createSnapshotStore({ byId: { s: { cwd: '/workspace' } } });
  const context = {
    slots: core, sessions: { list: sessions },
    locale: { ...locale, bind: () => key => (locale.getSnapshot().active === 'zh-CN' ? zh : en)[key] },
    contextMenus: { register(value) {
      assert.equal(registrations.has(value.target), false);
      registrations.set(value.target, value);
      return () => registrations.delete(value.target);
    } },
  };
  const stop = installOpenInAppAvailability(context);
  assert.equal(registrations.size, 0);
  const apps = createSnapshotStore(null);
  const mount = () => core.register({ name: slot, id: 'open-in-app', locale: 'open-in-app',
    inject: () => ({ hooks: { openInAppApps: apps } }),
  }, OpenInAppAction);
  let unmount = mount();
  await Promise.resolve();
  assert.deepEqual([...registrations.keys()].sort(), ['session', 'sessionHeader']);
  const fallback = core.entries(slot).find(entry => entry.options.id === 'dsh-base.open-in-app.unavailable');
  assert.equal(fallback.inject().hooks.openInAppApps, apps, 'the Files toolbar observes the same catalog as the native opener');
  for (const [target, contribution] of registrations) {
    assert.deepEqual(contribution.observe(), [sessions, apps, context.locale]);
    const resolve = () => contribution.resolve({ sessionId: 's' });
    for (const language of ['en', 'zh-CN']) {
      locale.set({ active: language });
      const [item] = resolve();
      assert.equal(item.disabled, true);
      assert.equal(item.run, undefined, 'cannot dispatch a launch');
      assert.equal(item.separatorBefore, target === 'sessionHeader');
      assert.ok(item.label.includes(openInAppUnavailableReason(language)));
    }
    apps.set(['vscode']);
    assert.deepEqual(resolve(), [], 'the original provider renders the sole eligible launch action');
    assert.equal(contribution.resolve({ sessionId: 'missing' })[0].disabled, true);
    apps.set([]);
  }
  unmount(); await Promise.resolve();
  assert.equal(registrations.size, 0, 'unloaded provider leaves no stale action');
  assert.equal(core.entries(slot).length, 0);
  unmount = mount(); await Promise.resolve();
  assert.equal(registrations.size, 2);
  stop();
  assert.equal(registrations.size, 0);
  assert.equal(core.entries(slot).length, 1, 'teardown preserves the official Files utility');
  unmount(); stopRoot();
});
