import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@dsh-base/site-config/settings') return { url: new URL('../../../boot/dsh-base-site-config/src/settings.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { GlobalSettingsStore, readDraft } = await import('../src/client/settings-store.ts');
const { resolveDeploymentSiteSettings } = await import('../../../boot/dsh-base-site-config/src/settings.ts');
const snapshot = (canEdit = true, revision = 3) => ({ revision, canEdit, source: 'deployment', values: resolveDeploymentSiteSettings({ SITE_BRAND_NAME: 'Original' }) });
function setup(replies) {
  const requests = [], saved = [];
  const store = new GlobalSettingsStore(async (url, init = {}) => {
    requests.push({ url, ...init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply() : Response.json(reply.body ?? reply, { status: reply.status ?? 200 });
  }, values => { saved.push(values); });
  return { store, requests, saved };
}
test('ordinary readers cannot stage or submit site changes', async () => {
  const { store, requests } = setup([snapshot(false)]);
  await store.reload(); store.edit(['seo', 'site', 'name'], 'Forbidden');
  assert.equal(await store.save(), false);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(readDraft(store.getSnapshot().draft, ['seo', 'site', 'name']), 'Original');
  assert.equal(requests.length, 1);
});
test('successful explicit save sends complete values and the loaded revision, then publishes the accepted snapshot', async () => {
  const before = snapshot(), after = { ...snapshot(true, 4), source: 'saved' };
  after.values.seo.site.name = 'New site';
  const { store, requests, saved } = setup([before, after]);
  await store.reload(); store.edit(['seo', 'site', 'name'], 'New site');
  assert.equal(requests.length, 1);
  assert.equal(await store.save(), true);
  assert.deepEqual(JSON.parse(requests[1].body), { expectedRevision: 3, values: after.values });
  assert.equal(requests[1].method, 'PUT');
  assert.equal(store.getSnapshot().baseline.revision, 4);
  assert.equal(store.getSnapshot().saved, true);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(saved.length, 1);
});
test('conflict keeps draft and old revision; only successful explicit reload replaces them', async () => {
  const { store, requests, saved } = setup([snapshot(), { status: 409, body: { error: 'revision_conflict', revision: 4 } }, new Error('Offline'), snapshot(true, 4)]);
  await store.reload(); store.edit(['seo', 'site', 'name'], 'Draft');
  assert.equal(await store.save(), false);
  assert.equal(store.getSnapshot().failure, 'conflict');
  assert.equal(store.getSnapshot().baseline.revision, 3);
  assert.equal(readDraft(store.getSnapshot().draft, ['seo', 'site', 'name']), 'Draft');
  assert.equal(requests.length, 2, 'conflict does not silently reload or retry a write');
  assert.equal(await store.reload(), false);
  assert.equal(readDraft(store.getSnapshot().draft, ['seo', 'site', 'name']), 'Draft');
  assert.equal(await store.reload(), true);
  assert.equal(store.getSnapshot().baseline.revision, 4);
  assert.equal(store.getSnapshot().dirty, false);
  assert.deepEqual(saved, []);
});
test('server validation issues and network failures retain edits without false success', async () => {
  const { store, saved } = setup([snapshot(), { status: 400, body: { error: 'invalid_settings', issues: ['seo.site.name: rejected'] } }, new Error('Offline')]);
  await store.reload(); store.edit(['seo', 'site', 'name'], 'Draft');
  assert.equal(await store.save(), false);
  assert.deepEqual(store.getSnapshot().issues, ['seo.site.name: rejected']);
  assert.equal(store.getSnapshot().saved, false);
  store.edit(['seo', 'site', 'name'], 'Retry');
  assert.equal(await store.save(), false);
  assert.equal(store.getSnapshot().dirty, true);
  assert.equal(readDraft(store.getSnapshot().draft, ['seo', 'site', 'name']), 'Retry');
  assert.deepEqual(saved, []);
});
test('invalid client values never reach the write endpoint', async () => {
  const { store, requests } = setup([snapshot()]);
  await store.reload(); store.edit(['seo', 'site', 'url'], 'javascript:alert(1)');
  assert.equal(await store.save(), false);
  assert.ok(store.getSnapshot().issues.some(issue => issue.startsWith('seo.site.url:')));
  assert.equal(requests.length, 1);
});
test('in-flight save blocks duplicate writes and edits; permission loss preserves the draft read-only', async () => {
  let complete;
  const { store, requests } = setup([snapshot(), () => new Promise(resolve => { complete = resolve; })]);
  await store.reload(); store.edit(['seo', 'site', 'name'], 'Draft');
  const pending = store.save();
  store.edit(['seo', 'site', 'name'], 'Lost edit');
  assert.equal(await store.save(), false);
  assert.equal(requests.length, 2);
  complete(Response.json({ error: 'site_admin_required' }, { status: 403 }));
  assert.equal(await pending, false);
  assert.equal(readDraft(store.getSnapshot().draft, ['seo', 'site', 'name']), 'Draft');
  assert.equal(store.getSnapshot().baseline.canEdit, false);
  assert.equal(await store.save(), false);
});
test('malformed snapshots fail honestly and retry can recover', async () => {
  const { store } = setup([{ revision: 0, values: {}, canEdit: true, source: 'saved' }, snapshot()]);
  assert.equal(await store.reload(), false);
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().baseline, undefined);
  assert.equal(await store.reload(), true);
  assert.equal(store.getSnapshot().status, 'ready');
});
test('disposal prevents a pending load from publishing or a stale callback from writing', async () => {
  let complete;
  const { store, requests } = setup([() => new Promise(resolve => { complete = resolve; })]);
  let notifications = 0; store.subscribe(() => { notifications++; });
  const pending = store.reload(); store.dispose();
  complete(Response.json(snapshot())); await pending;
  assert.equal(notifications, 1);
  assert.equal(await store.save(), false);
  assert.equal(requests.length, 1);
});

test('native receiver-sensitive fetch remains bound to the browser global, including default construction', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis, 'native fetch cannot receive the settings store as its receiver');
    calls++; return Response.json(snapshot());
  };
  try {
    const defaultStore = new GlobalSettingsStore();
    const injectedStore = new GlobalSettingsStore(globalThis.fetch);
    assert.equal(await defaultStore.reload(), true);
    assert.equal(await injectedStore.reload(), true);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('editing llms settings saves the shared document without losing other capability values', async () => {
  const before = snapshot();
  before.values.seo.pages = { '/': { title: 'Home copy', priority: '0.8', changefreq: 'weekly' } };
  before.values.analytics = { google: { enabled: false, measurementId: 'G-EXAMPLE1' } };
  const after = structuredClone(before); after.revision++;
  after.values.seo.llms = { enabled: false, introduction: 'Public site overview', guidance: 'Link to the published pages.' };
  const { store, requests } = setup([before, after]);
  await store.reload();
  store.edit(['seo', 'llms', 'enabled'], false);
  store.edit(['seo', 'llms', 'introduction'], 'Public site overview');
  store.edit(['seo', 'llms', 'guidance'], 'Link to the published pages.');
  assert.deepEqual(store.getSnapshot().issues, []);
  assert.equal(await store.save(), true);
  const sent = JSON.parse(requests[1].body);
  assert.equal(sent.expectedRevision, before.revision);
  assert.deepEqual(sent.values, after.values);
  assert.deepEqual(sent.values.seo.pages, before.values.seo.pages);
  assert.deepEqual(sent.values.analytics, before.values.analytics);
});

test('a measurement ID can be configured while analytics stays off; enabling without an ID cannot write', async () => {
  const before = snapshot(), after = snapshot(true, 4);
  after.values.analytics = { google: { enabled: false, measurementId: 'G-EXAMPLE1' } };
  const { store, requests } = setup([before, after]);
  await store.reload();
  store.edit(['analytics', 'google', 'enabled'], true);
  assert.equal(await store.save(), false);
  assert.equal(requests.length, 1);
  assert.ok(store.getSnapshot().issues.some(issue => issue.startsWith('analytics.google.measurementId:')));
  store.discard();
  store.edit(['analytics', 'google', 'measurementId'], 'G-EXAMPLE1');
  assert.equal(readDraft(store.getSnapshot().draft, ['analytics', 'google', 'enabled']), false);
  assert.deepEqual(store.getSnapshot().issues, []);
  assert.equal(await store.save(), true);
  assert.deepEqual(JSON.parse(requests[1].body).values, after.values);
});

test('conversion mode is independent of pageviews, validates before save, and dynamically published pages survive edits',async()=>{
 const initial={...snapshot(),publicPagePaths:['/','/guides/release']};initial.values.seo.pages={'/guides/release':{title:'Release'}};
 const published=structuredClone(initial);published.revision=4;published.values.analytics={conversions:{mode:'aggregate',campaigns:['launch']}};
 const {store,requests}=setup([initial,published]);assert.equal(await store.reload(),true);
 store.edit(['analytics','conversions','campaigns'],['launch']);assert.equal(store.getSnapshot().draft.analytics.conversions.mode,'off');
 store.edit(['analytics','conversions','mode'],'google');assert.equal(await store.save(),false);assert.equal(requests.length,1);
 store.edit(['analytics','conversions','mode'],'aggregate');assert.equal(await store.save(),true);
 assert.deepEqual(JSON.parse(requests[1].body).values,published.values);assert.deepEqual(store.getSnapshot().baseline.publicPagePaths,['/','/guides/release']);
});

test('withdrawing a page keeps saved settings readable and permits explicit cleanup without republishing it', async () => {
  const before = { ...snapshot(), publicPagePaths: ['/'] };
  before.values.seo.pages = { '/guides/withdrawn': { title: 'Saved article title' } };
  const after = structuredClone(before); after.revision++;
  after.values.seo.site.name = 'Updated name';
  after.values.seo.pages = {};
  const { store, requests } = setup([before, after]);
  assert.equal(await store.reload(), true, 'withdrawn metadata must not break the entire settings editor');
  assert.deepEqual(readDraft(store.getSnapshot().draft, ['seo', 'pages']), before.values.seo.pages);
  assert.deepEqual(store.getSnapshot().baseline.publicPagePaths, ['/'], 'retained metadata never advertises a published page');
  store.edit(['seo', 'site', 'name'], 'Updated name');
  assert.equal(await store.save(), false, 'new writes still require registered public pages');
  assert.equal(requests.length, 1);
  store.edit(['seo', 'pages', '/guides/withdrawn'], undefined);
  assert.equal(await store.save(), true, 'explicit cleanup can be saved normally');
  assert.deepEqual(JSON.parse(requests[1].body).values, after.values);
  const reader = setup([{ ...before, canEdit: false }]);
  assert.equal(await reader.store.reload(), true);
  assert.equal(await reader.store.save(), false);
});
