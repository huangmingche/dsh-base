import assert from 'node:assert/strict';
import test from 'node:test';
import { publicTaskFace } from '../src/client/task-face.ts';
import { PUBLIC_COPY } from '../src/client/public-copy.ts';
import { publicConfigurationRenderer } from '../src/client/config-access.ts';
import { createPublicPluginConfigurations } from '../src/client/public-configurations.ts';

test('guest task preview is never an authoritative empty account and every private operation requests login', async () => {
  let prompts = 0;
  const face = publicTaskFace(() => { prompts++; });
  const snapshot = face.hooks.catalog.getSnapshot();
  assert.equal(snapshot.settled, false);
  assert.equal(snapshot.readRequest, 0);
  assert.deepEqual(snapshot.records, []);
  assert.equal(prompts, 0, 'opening the page must not force login');
  assert.equal(face.onBeforeCreate?.(), false);
  face.onNewTask(); await face.onRetry(); await face.onClearEnded();
  await face.onCreateTask({} as never); await face.onDelete('test' as never); face.onOpenSession('test' as never);
  await face.hostActions.edit({} as never); await face.hostActions.run('test' as never);
  await assert.rejects(face.loadHistory({} as never), /auth\/required/);
  assert.equal(prompts, 10);
  assert.equal(await face.hostActions.loadNewSessionInterval(), undefined);
  assert.equal(prompts, 10, 'a local draft does not imply a private settings request');
  assert.deepEqual(face.hooks.catalog.getSnapshot(), snapshot, 'rejected operations never fabricate saved tasks');
});

test('only explicitly registered bundle configurations mount; every row and unknown bundle stays private', () => {
  const configurations = createPublicPluginConfigurations(), calls: string[] = [];
  const render = publicConfigurationRenderer(((name: string) => { calls.push(name); return 'mounted'; }) as never, () => 'sign-in', configurations);
  const stop = configurations.registerBundle('dsh-base:public-test');
  for (const view of ['page', 'summary'] as const) {
    assert.equal(render('plugins.bundle.config', { view }, { entryKey: 'dsh-base:public-test' }), 'mounted');
    assert.equal(render('plugins.bundle.config', { view }, { entryKey: 'dsh-base:global' }), 'sign-in');
    assert.equal(render('plugins.bundle.config', { view }, { entryKey: 'unknown' }), 'sign-in');
    assert.equal(render('plugins.row.config', { view }, { entryKey: 'dsh-base:public-test' }), 'sign-in');
    assert.equal(render('plugins.bundle.config', { view }), 'sign-in');
  }
  assert.equal(calls.length, 2);
  stop();
  assert.equal(render('plugins.bundle.config', { view: 'page' }, { entryKey: 'dsh-base:public-test' }), 'sign-in');
  assert.equal(calls.length, 2);
});

test('registration disposal is reference counted and idempotent, and refreshes subscribed views', () => {
  const registry = createPublicPluginConfigurations();
  let changes = 0;
  const unsubscribe = registry.subscribe(() => { changes++; });
  const first = registry.registerBundle('test'), second = registry.registerBundle('test');
  assert.equal(registry.hasBundle('test'), true);
  first(); first();
  assert.equal(registry.hasBundle('test'), true);
  assert.equal(changes, 3);
  second();
  assert.equal(registry.hasBundle('test'), false);
  assert.equal(registry.getSnapshot(), 4);
  unsubscribe();
  registry.registerBundle('another');
  assert.equal(changes, 4);
  assert.throws(() => registry.registerBundle(''), TypeError);
  assert.throws(() => registry.registerBundle(' test'), TypeError);
});

test('all supported languages describe the public/account boundary', () => {
  assert.equal(Object.keys(PUBLIC_COPY).length, 8);
  for (const copy of Object.values(PUBLIC_COPY)) assert.ok(copy.plugins && copy.tasks && copy.signIn && copy.declared && copy.configure);
});


test('configuration views cannot invoke the private form renderer while public metadata seats stay usable', () => {
  let privateReads = 0; const prompts: string[] = [];
  const render = publicConfigurationRenderer((name => { if (name === 'plugins.bundle.config' || name === 'plugins.row.config') privateReads++; return 'metadata'; }) as never, view => { prompts.push(view); return 'sign-in'; });
  for (const name of ['plugins.bundle.config', 'plugins.row.config'] as const) {
    assert.equal(render(name, { view: 'page' }, { entryKey: 'test' }), 'sign-in');
    assert.equal(render(name, { view: 'summary' }, { entryKey: 'test' }), 'sign-in');
  }
  assert.equal(privateReads, 0);
  assert.deepEqual(prompts, ['page', 'summary', 'page', 'summary']);
  assert.equal(render('plugins.detail.section', { subject: {} as never }), 'metadata');
});
