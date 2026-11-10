/** Real exported Cards/controllers and SlotCore; no fabricated Host configuration or network. */
import '../../../cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { transformSync } = app('esbuild');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('react-dom')) return next(specifier, { ...context, parentURL: new URL('../../../../apps/web/package.json', import.meta.url).href });
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
const { createUnavailableBuiltinFaces, installUnavailableBuiltins, ...cards } = await import('../src/client/builtin-availability.tsx');
const { BUILTIN_ITEMS, builtinAvailability } = await import('../src/client/builtin-copy.ts');
const { panelKey } = await import('../src/client/panel-copy.ts');

test('all four official Cards preserve descriptions and render honest unavailable forms with no operations', async () => {
  const previousFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw new Error('No network is allowed for an absent capability'); };
  const faces = createUnavailableBuiltinFaces();
  try {
    const components = { shell: cards.UnavailableShellCard, 'agent-loop': cards.UnavailableAgentLoopCard, 'web-search': cards.UnavailableWebSearchCard, subagent: cards.UnavailableSubagentCard };
    for (const { id } of BUILTIN_ITEMS) {
      const { face } = faces[id];
      const hooks = Object.fromEntries(Object.entries(face.hooks).map(([key, source]) => [`use${key[0].toUpperCase()}${key.slice(1)}`, select => select(source.getSnapshot())]));
      const base = { ...face, ...hooks, t: key => `official:${key}`, availability: () => builtinAvailability(id, 'en') };
      const summary = renderToStaticMarkup(React.createElement(components[id], { ...base, view: 'summary' }));
      assert.match(summary, id === 'subagent' ? /official:subagentDescription/ : /official:description/);
      assert.match(summary, /data-builtin-unavailable/);
      assert.match(summary, /Unavailable/);
      const page = renderToStaticMarkup(React.createElement(components[id], { ...base, view: 'page' }));
      assert.match(page, /official:unavailable/);
      assert.match(page, /role="status"/);
      assert.ok(page.includes(builtinAvailability(id, 'en').reason));
      assert.doesNotMatch(page, /<(?:input|button|select|textarea)\b/, 'absent form has no operable settings controls');
      for (const source of Object.values(face.hooks)) assert.equal(source.getSnapshot().available, false);
      face.save();
      face.discard();
    }
    await Promise.resolve();
    assert.equal(network, 0, 'controllers never issue credential, settings or model requests for unavailable capabilities');
  } finally {
    for (const entry of Object.values(faces)) entry.dispose();
    globalThis.fetch = previousFetch;
  }
});

test('real slot priority hands every missing item to its official owner without duplicate IDs or leaked fallbacks', () => {
  const core = new SlotCore();
  const stopRoot = core.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } }, () => null);
  let snapshot = { status: 'loading', view: undefined, error: null };
  const listeners = new Set();
  const originals = new Map();
  // Match production: the unchanged official whileServed observers subscribe
  // before the seam, including the same-publication takeover case.
  listeners.add(() => {
    const served = new Set(snapshot.view?.namespaces.map(view => view.ns) ?? []);
    for (const item of BUILTIN_ITEMS) {
      if (item.namespaces.some(ns => served.has(ns))) {
        if (!originals.has(item.id)) originals.set(item.id, core.register({ name: 'plugins.item', id: item.id, order: item.order }, () => null));
      } else { originals.get(item.id)?.(); originals.delete(item.id); }
    }
  });
  const ctx = {
    slots: { inject: (_, setup) => setup(), register: (options, component) => core.register(options, component) },
    configForms: { describe: () => ({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, ensure: async () => {} }) },
    locale: { getSnapshot: () => ({ active: 'en' }), bind: namespace => key => `${namespace}:${key}` },
  };
  const stop = installUnavailableBuiltins(ctx);
  const rows = () => core.entriesOfSlot('plugins.item');
  const publish = namespaces => { snapshot = { status: 'ready', error: null, view: { namespaces: namespaces.map(ns => ({ ns })), writable: true, hasDocument: false } }; for (const listener of listeners) listener(); };
  assert.equal(rows().length, 0, 'a pending or failed first read is not evidence of absent namespaces');
  publish([]);
  assert.deepEqual(rows().map(row => row.options.id), BUILTIN_ITEMS.map(item => item.id));
  assert.ok(rows().every(row => row.options.priority === 100));
  for (const item of BUILTIN_ITEMS) {
    publish([item.namespaces[0]]);
    assert.equal(rows().length, 4);
    assert.equal(rows().find(row => row.options.id === item.id).options.priority, undefined, 'original registration wins immediately');
    publish([]);
    assert.equal(rows().find(row => row.options.id === item.id).options.priority, 100, 'removing the real namespace restores its unavailable entry');
  }
  publish(BUILTIN_ITEMS.flatMap(item => [...item.namespaces]));
  assert.equal(rows().length, 4);
  stop();
  assert.equal(rows().length, 4, 'seam teardown cannot withdraw real official entries');
  for (const dispose of originals.values()) dispose();
  stopRoot();
});

test('eight-language reasons and catalog-only official bundle explanations remain distinct from running plugins', () => {
  for (const item of BUILTIN_ITEMS) {
    const reasons = ['en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt_BR'].map(locale => builtinAvailability(item.id, locale).reason);
    assert.equal(new Set(reasons).size, 8);
    assert.ok(reasons.every(Boolean));
  }
  const subject = { kind: 'bundle', pkg: { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', official: true, availability: 'missing', enabled: false } };
  assert.deepEqual(panelKey(subject, () => false, () => false), { title: 'officialUnavailableTitle', body: 'officialUnavailableBody' });
  assert.notDeepEqual(panelKey({ ...subject, pkg: { ...subject.pkg, enabled: true } }, () => false, () => false), { title: 'officialUnavailableTitle', body: 'officialUnavailableBody' });
});
