/** Exact public Host contract and real Worker HTTP/Cordis lifetime. No private resources. */
import '../../dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { Context } = await import('@deepseek-ai/cordis');
const { OPEN_IN_APP_APPS_PATH } = await import('@deepseek-ai/dsh-host-open-in-app/shared');
const http = await import('../../dsh-base-cloudflare-worker-http/src/index.ts');
const availability = await import('../src/index.ts');

const origin = 'https://app.example.test';
const request = (path = OPEN_IN_APP_APPS_PATH, init) => new Request(origin + path, init);
const privateEnv = new Proxy({}, { get() { throw new Error('public availability must not inspect private bindings'); } });

test('the exact official GET and HEAD catalog is truthful, non-cacheable and anonymous', async () => {
  for (const method of ['GET', 'HEAD']) for (const accept of ['application/json', 'text/html']) {
    const response = await availability.openInAppAvailability(request(undefined, { method, headers: { accept, cookie: 'private=not-read' } }), privateEnv);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(await response.text(), method === 'HEAD' ? '' : '{"apps":[]}');
  }
});

test('unrelated, private, launch and icon paths retain their own guards', async () => {
  for (const path of ['/api/session-host', '/agents/private', '/open-in-app/open', '/open-in-app/icon/vscode', '/open-in-app/apps/', '/zh-CN/open-in-app/apps', '/open-in-app/%61pps', '/unknown']) {
    assert.equal(await availability.openInAppAvailability(request(path), privateEnv), undefined);
  }
  assert.equal((await availability.openInAppAvailability(request('/open-in-app/apps?path=/private'), privateEnv)).status, 400);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await availability.openInAppAvailability(request(undefined, { method }), privateEnv);
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  for (const headers of [{ origin: 'https://foreign.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await availability.openInAppAvailability(request(undefined, { headers }), privateEnv)).status, 403);
  }
});

test('real Cordis mount order, disposal and reload preserve the exact public route only', async () => {
  for (const hostFirst of [false, true]) {
    const ctx = new Context();
    if (hostFirst) await ctx.plugin(http);
    let plugin = await ctx.plugin(availability);
    if (!hostFirst) await ctx.plugin(http);
    let guarded = 0;
    const removeGuard = ctx.http.use(() => { guarded++; return new Response('private route guarded', { status: 401 }); }, 0);
    assert.deepEqual(await (await ctx.http.dispatch(request(undefined, { headers: { accept: 'text/html' } }), privateEnv)).json(), { apps: [] });
    assert.equal(guarded, 0, 'the fixed public capability does not perform account admission');
    assert.equal((await ctx.http.dispatch(request('/api/session-host'), privateEnv)).status, 401);
    assert.equal(guarded, 1, 'private admission is not broadened');
    assert.equal((await ctx.http.dispatch(request(undefined, { method: 'POST', headers: { origin: 'https://foreign.example' } }), privateEnv)).status, 403, 'global mutation origin fence remains first');
    await plugin.dispose();
    assert.equal((await ctx.http.dispatch(request(), privateEnv)).status, 401, 'disposing the plugin removes its public handler');
    plugin = await ctx.plugin(availability);
    assert.equal((await ctx.http.dispatch(request(), privateEnv)).status, 200);
    await plugin.dispose(); removeGuard();
    assert.equal((await ctx.http.dispatch(request(), privateEnv)).status, 404);
    await ctx.fiber.dispose();
  }
});
