import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
registerHooks({ resolve(specifier, context, next) {
  const paths = { '@dsh-base/site-config': 'dsh-base-site-config', '@dsh-base/locale-path': 'dsh-base-locale-path', '@dsh-base/public-pages': 'dsh-base-public-pages' };
  if (paths[specifier]) return { url: new URL(`../../../boot/${paths[specifier]}/src/index.ts`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { publicAnalyticsPath, startPublicPageViews } = await import('../src/client/pageviews.ts');
const { LOCALE_IDS, localizePath } = await import('../../../boot/dsh-base-locale-path/src/index.ts');
const valid = { enabled: true, ready: true, measurementId: 'G-TEST123456' };
function bench(google = valid, pathname = '/') {
  let config = { analytics: { google } };
  const listeners = new Set();
  const source = { getSnapshot: () => ({ config }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const events = new EventTarget();
  const calls = [];
  const target = { location: new URL(`https://app.test${pathname}`), history: {
    pushState(data, title, path) { assert.equal(this, target.history); if (path === 'throws') throw new Error('native failure'); target.location = new URL(path, target.location); return 'push-result'; },
    replaceState(data, title, path) { assert.equal(this, target.history); target.location = new URL(path, target.location); return 'replace-result'; },
  }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const original = { ...target.history };
  const update = google => { config = { analytics: { google } }; for (const fn of listeners) fn(); };
  return { source, target, calls, original, update, events, fetcher: async (...args) => { calls.push(args); return new Response(null, { status: 204 }); } };
}

test('only registered localized public documents produce a canonical path', () => {
  for (const locale of LOCALE_IDS) {
    const root = localizePath('/', locale);
    assert.equal(publicAnalyticsPath(root), root);
    for (const privatePath of ['/app/session/secret', '/app/workspace/id', '/login', '/api/site-settings', '/missing', '/app/sessioning', '//evil.test']) {
      assert.equal(publicAnalyticsPath(localizePath(privatePath, locale)), undefined);
    }
  }
  for (const path of ['/app%2Fsession%2Fsecret', '/%61pp/session/secret', '/?token=secret', '/#private', '/\\evil.test', 'https://app.test/']) assert.equal(publicAnalyticsPath(path), undefined);
});

test('disabled, missing, invalid and server-unready configuration causes zero requests', () => {
  for (const google of [undefined, {}, { ...valid, enabled: false }, { ...valid, ready: false }, { ...valid, ready: undefined }, { ...valid, measurementId: 'G-X<script>' }]) {
    const b = bench(); b.update(google); const stop = startPublicPageViews(b.source, b.target, b.fetcher);
    b.target.history.pushState({}, '', '/?token=secret'); b.events.dispatchEvent(new Event('popstate'));
    assert.deepEqual(b.calls, []); stop();
  }
});

test('native push/replace, state refresh and fragment changes count a public view only once', () => {
  const b = bench(); const stop = startPublicPageViews(b.source, b.target, b.fetcher);
  assert.equal(b.calls.length, 1);
  assert.equal(b.target.history.pushState({ opaque: 'same native state' }, 'PRIVATE TITLE', '/?token=PRIVATE#secret'), 'push-result');
  assert.equal(b.target.history.replaceState({}, '', '/#other'), 'replace-result');
  b.events.dispatchEvent(new Event('hashchange')); b.events.dispatchEvent(new Event('popstate')); b.update({ ...valid });
  assert.equal(b.calls.length, 1);
  assert.throws(() => b.target.history.pushState({}, '', 'throws'), /native failure/);
  const [url, init] = b.calls[0];
  assert.equal(url, '/api/site-analytics/google'); assert.deepEqual(JSON.parse(init.body), { path: '/' });
  assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, { 'content-type': 'application/json' }); stop();
});

test('private transitions emit nothing; returning to a public document counts the new visit', () => {
  const b = bench(); const stop = startPublicPageViews(b.source, b.target, b.fetcher);
  b.target.history.pushState({}, '', '/app/session/PRIVATE_SESSION?token=SECRET');
  b.target.history.replaceState({}, '', localizePath('/app/workspace/PRIVATE_WORKSPACE', 'zh'));
  b.update({ ...valid }); assert.equal(b.calls.length, 1);
  b.target.history.pushState({}, '', localizePath('/', 'zh'));
  assert.deepEqual(b.calls.map(([,init]) => JSON.parse(init.body)), [{ path: '/' }, { path: localizePath('/', 'zh') }]);
  b.target.location = new URL('https://app.test/'); b.events.dispatchEvent(new Event('popstate'));
  assert.equal(b.calls.length, 3); stop();
});

test('in-flight collection is cancelled on private routes, disablement and disposal', async () => {
  const b = bench(); const pending = [];
  const stop = startPublicPageViews(b.source, b.target, async (url, init) => { pending.push(init.signal); return new Promise(() => {}); });
  b.target.history.pushState({}, '', '/app/session/id'); assert.equal(pending[0].aborted, true);
  b.target.history.pushState({}, '', '/'); b.update({ ...valid, enabled: false }); assert.equal(pending[1].aborted, true);
  b.update(valid); stop(); assert.equal(pending[2].aborted, true);
  assert.equal(b.target.history.pushState, b.original.pushState); assert.equal(b.target.history.replaceState, b.original.replaceState);
  b.update(valid); b.events.dispatchEvent(new Event('popstate')); assert.equal(pending.length, 3);
});

test('network and HTTP failures do not retry, leak error text or interrupt navigation', async () => {
  for (const failure of ['network', 'http']) {
    const b = bench(); let attempts = 0;
    const stop = startPublicPageViews(b.source, b.target, async () => { attempts++; if (failure === 'network') throw new Error('PRIVATE FAILURE'); return new Response(null, { status: 503 }); });
    await new Promise(resolve => setImmediate(resolve));
    b.update(valid); b.events.dispatchEvent(new Event('popstate')); b.target.history.replaceState({}, '', '/?retry=never');
    assert.equal(attempts, 1); stop();
  }
});

test('disposal does not overwrite another navigation observer installed later', () => {
  const b = bench(); const stop = startPublicPageViews(b.source, b.target, b.fetcher);
  const ours = b.target.history.pushState;
  const later = function(...args) { return ours.apply(this, args); };
  b.target.history.pushState = later; stop(); assert.equal(b.target.history.pushState, later);
  b.target.history.pushState({}, '', localizePath('/', 'ja')); assert.equal(b.calls.length, 1);
});

test('production observer loads actual published paths and languages, and registry failure never falls back', async()=>{
 const {startPublishedPageViews}=await import('../src/client/pageviews.ts');const b=bench(valid,'/guides/release');
 const calls=[];const stop=startPublishedPageViews(b.source,b.target,async(url,init)=>{calls.push([url,init]);return url==='/api/public-pages'?Response.json({pages:[{path:'/guides/release',availableLocales:['zh'],indexable:false}]}):new Response(null,{status:204});});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1,'unavailable English variant is not counted');
 b.target.history.pushState({},'',localizePath('/guides/release','zh'));assert.deepEqual(JSON.parse(calls[1][1].body),{path:localizePath('/guides/release','zh')});
 assert.equal(calls[0][1].credentials,'omit');assert.equal(calls[0][1].referrerPolicy,'no-referrer');stop();
 const f=bench();let requests=0;const failed=startPublishedPageViews(f.source,f.target,async()=>{requests++;return new Response(null,{status:503});});await new Promise(resolve=>setImmediate(resolve));f.target.history.pushState({},'','/');assert.equal(requests,1);failed();
});
