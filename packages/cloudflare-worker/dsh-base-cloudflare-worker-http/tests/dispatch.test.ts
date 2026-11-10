import assert from 'node:assert/strict';
import test from 'node:test';
import { apply as http, type WorkerHttp } from '../src/index.ts';
import { apply as assets } from '../../dsh-base-cloudflare-worker-assets/src/index.ts';
import { apply as seo } from '../../dsh-base-cloudflare-worker-seo/src/index.ts';
import { apply as sitemapPlugin } from '../../dsh-base-cloudflare-worker-sitemap/src/index.ts';
import { apply as robotsPlugin } from '../../dsh-base-cloudflare-worker-robots/src/index.ts';
import { apply as manifestPlugin } from '../../dsh-base-cloudflare-worker-manifest/src/index.ts';
import { apply as llmsPlugin } from '../../dsh-base-cloudflare-worker-llms/src/index.ts';
import { apply as publicPagesPlugin } from '../../dsh-base-cloudflare-worker-public-pages/src/index.ts';
import { resolveDeploymentSiteSettings } from '../../../boot/dsh-base-site-config/src/settings.ts';
import { HttpError } from '../src/request.ts';

const origin = 'https://app.example.test';
const request = (path = '/') => new Request(origin + path, { headers: { accept: 'text/html' } });
function context() {
  const services = new Map<string, unknown>();
  const ctx = {
    http: undefined as unknown as WorkerHttp,
    provide(name: string, value: unknown) { services.set(name, value); Object.assign(this, { [name]: value }); },
    get(name: string) { return services.get(name); },
    effect(effect: () => unknown) { return effect(); },
  };
  http(ctx as never);
  return ctx;
}

test('priority controls request precedence independently of registration order, with stable ties', async () => {
  const { http } = context();
  const calls: string[] = [];
  http.use(() => { calls.push('fallback'); return new Response('fallback'); }, 1000);
  http.use(() => { calls.push('first ordinary API'); });
  http.use(() => { calls.push('second ordinary API'); }, 100);
  http.use(() => { calls.push('SEO'); }, 20);
  http.use(() => { calls.push('site settings'); }, 10);
  http.use(() => { calls.push('authentication'); }, 0);
  assert.equal(await (await http.dispatch(request(), {})).text(), 'fallback');
  assert.deepEqual(calls, ['authentication', 'site settings', 'SEO', 'first ordinary API', 'second ordinary API', 'fallback']);
});

test('disposal removes only its registration even when the same handler has different priorities', async () => {
  const { http } = context();
  const calls: string[] = [];
  const repeated = () => { calls.push('repeated'); };
  const removeLater = http.use(repeated, 30);
  http.use(() => { calls.push('middle'); }, 20);
  const removeEarlier = http.use(repeated, 10);
  removeLater(); removeLater();
  assert.equal((await http.dispatch(request(), {})).status, 404);
  assert.deepEqual(calls, ['repeated', 'middle']);
  calls.length = 0; removeEarlier();
  await http.dispatch(request(), {});
  assert.deepEqual(calls, ['middle']);
  for (const priority of [NaN, Infinity, -Infinity]) assert.throws(() => http.use(repeated, priority), /priority must be finite/);
});

test('in-flight dispatch retains its snapshot, while request-origin checks precede every priority', async () => {
  const { http } = context();
  const calls: string[] = [];
  let changed = false;
  let remove = () => {};
  http.use(async () => {
    calls.push('first');
    if (!changed) {
      changed = true; remove();
      http.use(() => { calls.push('new'); }, 10);
      await Promise.resolve();
    }
  }, 0);
  remove = http.use(() => { calls.push('old'); }, 10);
  await http.dispatch(request(), {});
  assert.deepEqual(calls, ['first', 'old']);
  calls.length = 0;
  await http.dispatch(request(), {});
  assert.deepEqual(calls, ['first', 'new']);
  calls.length = 0;
  const denied = await http.dispatch(new Request(origin + '/api/site-settings', { method: 'PUT', headers: { origin: 'https://elsewhere.test' } }), {});
  assert.equal(denied.status, 403);
  assert.deepEqual(calls, [], 'no priority can precede the origin guard');
});

test('late real document and resource plugin registrations precede the real asset fallback', async () => {
  const ctx = context();
  const values = structuredClone(resolveDeploymentSiteSettings());
  values.seo.locales.en.title = 'Published site title';
  values.seo.robots = { disallow: ['/restricted'] };
  values.seo.pages = { '/': { lastmod: '2026-11-14' } };
  const assetReads: string[] = [];
  const env = { SITE_INDEXING_ENABLED: 'true', SITE_DEPLOYMENT_ENVIRONMENT: 'production', AUTH_BASE_URL: origin, ASSETS: { async fetch(input: Request) {
    const path = new URL(input.url).pathname;
    assetReads.push(path);
    return path === '/assets/app.js'
      ? new Response('export {};', { headers: { 'content-type': 'application/javascript' } })
      : new Response('<!doctype html><html><head><title>Unprocessed shell</title></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
  } } };
  // Reproduce asynchronous activation: assets is ready before the shared
  // settings dependency and independent metadata producers arrive.
  assets(ctx as never);
  await Promise.resolve();
  ctx.provide('siteSettings', { read: async () => ({ revision: 1, source: 'saved', values }) });
  publicPagesPlugin(ctx as never);
  seo(ctx as never);
  robotsPlugin(ctx as never);
  sitemapPlugin(ctx as never);
  manifestPlugin(ctx as never);
  llmsPlugin(ctx as never);
  // A later authentication registration must still protect private documents.
  ctx.http.use(req => new URL(req.url).pathname === '/app/session/private' ? Response.redirect(origin + '/login', 302) : undefined, 0);

  const document = await ctx.http.dispatch(request(), env);
  assert.equal(document.status, 200);
  assert.match(await document.text(), /<title>Published site title<\/title>/);
  const robots = await ctx.http.dispatch(request('/robots.txt'), env);
  assert.equal(robots.status, 200); assert.match(await robots.text(), /Disallow: \/restricted/);
  const sitemap = await ctx.http.dispatch(request('/sitemap.xml'), env);
  assert.equal(sitemap.status, 200); assert.match(await sitemap.text(), /<lastmod>2026-11-14<\/lastmod>/);
  const manifest = await ctx.http.dispatch(request('/manifest.webmanifest'), env);
  assert.equal(manifest.status, 200); assert.equal((await manifest.json() as { name: string }).name, values.seo.site.name);
  const llms = await ctx.http.dispatch(request('/llms.txt'), env);
  assert.equal(llms.status, 200); assert.equal(llms.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(await llms.text(), /Published site title/);
  assert.deepEqual(assetReads, ['/'], 'metadata endpoints never reach the static fallback');
  const protectedDocument = await ctx.http.dispatch(request('/app/session/private'), env);
  assert.equal(protectedDocument.status, 302); assert.equal(protectedDocument.headers.get('location'), origin + '/login');
  assert.deepEqual(assetReads, ['/'], 'authentication rejects before either document renderer reads assets');
  assert.equal(await (await ctx.http.dispatch(request('/assets/app.js'), env)).text(), 'export {};');
  assert.equal((await ctx.http.dispatch(request('/missing.svg'), env)).status, 404, 'real missing assets keep their guarded 404');
});

test('typed service failures retain their status without reaching a later handler or exposing error details', async () => {
  for (const [status, code] of [[503, 'auth_unavailable'], [401, 'unauthenticated'], [403, 'forbidden']] as const) {
    const { http } = context();
    let laterCalls = 0, responseCalls = 0;
    http.use(async () => { throw new HttpError(status, code); }, 0);
    http.use(() => { laterCalls++; return new Response('private response'); });
    http.useResponse((_request, _env, response) => { responseCalls++; return response; });
    const result = await http.dispatch(request('/api/session-host'), {});
    assert.equal(result.status, status);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { error: code });
    assert.equal(laterCalls, 0);
    assert.equal(responseCalls, 1);
  }
  const { http } = context();
  const unexpected = Object.assign(new Error('internal failure'), { status: 401, code: 'not_a_trusted_error' });
  http.use(() => { throw unexpected; });
  await assert.rejects(http.dispatch(request(), {}), error => error === unexpected, 'unexpected errors retain existing runtime error handling');
});
