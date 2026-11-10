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
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { SlotCore } = await import('@deepseek-ai/dsh-client-ui-slots');
const { OpenInAppAction } = await import('@deepseek-ai/dsh-client-ui-open-in-app/src/client/OpenInAppAction.tsx');
const { en, zh } = await import('@deepseek-ai/dsh-client-ui-open-in-app/src/client/locales.ts');
const { AvailabilityOpenInAppAction, installOpenInAppAvailability } = await import('../src/client/index.tsx');
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
  const face = props({ cwd: undefined, apps: controller.apps.getSnapshot() });
  assert.match(markup(AvailabilityOpenInAppAction, face), /data-open-in-app-unavailable=""/);
  assert.equal(face.launches(), 0);
});

function markup(component, face) {
  // These are markup assertions, not hydration tests. The separate real-browser
  // lane exercises the official Menu layout effects; leave all other warnings visible.
  const error = console.error;
  console.error = (message, ...args) => {
    if (typeof message === 'string' && message.startsWith('Warning: useLayoutEffect does nothing on the server')) return;
    error(message, ...args);
  };
  try { return renderToStaticMarkup(React.createElement(component, face)); }
  finally { console.error = error; }
}

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

function props({ cwd, apps, language = 'en' }) {
  const dictionary = language === 'zh' ? zh : en;
  let launches = 0;
  return {
    sessionId: 's',
    useSessions: select => select({ byId: { s: { cwd } } }),
    useOpenInAppApps: select => select(apps),
    useOpenInAppChoice: select => select(''),
    useOpenInAppLaunch: select => select({ phase: 'idle', path: null }),
    useShortcuts: select => select([]),
    t: (key, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), dictionary[key] ?? key),
    iconUrl: id => `/icon/${id}`,
    launch: async () => { launches++; return { kind: 'opened' }; },
    report: () => {}, choose: () => {},
    unavailableReason: () => openInAppUnavailableReason(language),
    launches: () => launches,
  };
}

test('unavailable native control stays visible and disabled without reporting a fake operation', () => {
  for (const language of ['en', 'zh']) {
    for (const state of [{ cwd: undefined, apps: ['vscode'] }, { cwd: '/work', apps: [] }, { cwd: '/work', apps: null }]) {
      const face = props({ ...state, language });
      const html = markup(AvailabilityOpenInAppAction, face);
      assert.match(html, /<fieldset disabled="" aria-disabled="true"/);
      assert.match(html, /data-open-in-app-unavailable=""/);
      assert.match(html, /data-open-target="directory"/);
      assert.match(html, /data-state="idle"/);
      assert.ok(html.includes(face.unavailableReason()));
      assert.doesNotMatch(html, /data-open-target-skeleton|aria-busy/);
      assert.equal(face.launches(), 0);
    }
  }
});

test('a real Host capability delegates unchanged official markup and controller callbacks', () => {
  const face = props({ cwd: '/work', apps: ['vscode'] });
  const actual = markup(AvailabilityOpenInAppAction, face);
  const expected = markup(OpenInAppAction, { ...face, absolutePath: '/work' });
  assert.equal(actual, expected);
  assert.doesNotMatch(actual, /<fieldset|data-open-in-app-unavailable/);
  assert.equal(face.launches(), 0);
});

test('real SlotCore late mount, replacement and disposal preserve original injection and one visible utility', async () => {
  const core = new SlotCore();
  const slot = 'conversation.session.header.utilities';
  const stopRoot = core.register({ name: 'root', children: { [slot]: { kind: 'list', scope: 'session' } } }, () => null);
  let language = 'en';
  const context = { slots: core, locale: { getSnapshot: () => ({ active: language }) } };
  const stop = installOpenInAppAvailability(context);
  const rows = () => core.entriesOfSlot(slot).filter(entry => entry.options.id === 'open-in-app');
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  assert.equal(rows().length, 0, 'seam cannot invent an owner slot registration');
  const Original = () => null;
  let captured;
  const firstFace = { hooks: { original: true }, launch: () => {} };
  const stopFirst = core.register({ name: slot, id: 'open-in-app', order: -10, locale: 'open-in-app',
    inject: (...args) => { captured = args; return firstFace; },
  }, Original);
  await flush();
  assert.equal(rows().length, 1);
  assert.equal(core.entries(slot).length, 2, 'official entry remains mounted behind the availability seam');
  const winner = rows()[0];
  assert.equal(winner.component, AvailabilityOpenInAppAction);
  assert.equal(winner.options.order, -10);
  assert.equal(winner.locale, 'open-in-app');
  const injected = winner.inject('captured-session');
  assert.deepEqual(captured, ['captured-session']);
  assert.equal(injected.hooks, firstFace.hooks);
  assert.equal(injected.launch, firstFace.launch);
  language = 'zh-CN';
  assert.equal(injected.unavailableReason(), openInAppUnavailableReason(language));
  stopFirst(); await flush();
  assert.equal(rows().length, 0, 'removing the official owner removes the shadow');
  const secondFace = { hooks: { reloaded: true }, launch: () => {} };
  const stopSecond = core.register({ name: slot, id: 'open-in-app', order: -10, locale: 'open-in-app', inject: () => secondFace }, Original);
  await flush();
  assert.equal(rows()[0].inject().hooks, secondFace.hooks, 'reload cannot retain a stale controller');
  stop(); await flush();
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].component, Original, 'seam disposal preserves the official contribution');
  stopSecond(); stopRoot();
});
