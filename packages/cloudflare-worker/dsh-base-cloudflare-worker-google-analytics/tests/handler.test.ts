/** Real handler, stubbed transport only: no Google or other network request is permitted. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, createAnalyticsHandler } from '../src/index.ts';
import { resolveDeploymentSiteSettings } from '../../../boot/dsh-base-site-config/src/settings.ts';
import { PUBLIC_PAGES } from '../../../boot/dsh-base-public-pages/src/index.ts';
import { LOCALE_IDS, localizePath } from '../../../boot/dsh-base-locale-path/src/index.ts';

const ENDPOINT = 'https://app.example.test/api/site-analytics/google';
const SECRET = 'test-only-secret+with&reserved=characters';
const privateValue = 'private-account-session-marker';
type Outbound = { url: URL; init: RequestInit; payload: Record<string, unknown> };

function fixture() {
  let values = { ...resolveDeploymentSiteSettings({ SITE_SEO_JSON: JSON.stringify({ site: { name: 'Saved Site', url: 'https://public.example.test' } }) }), analytics: { google: { enabled: true, measurementId: 'G-TEST1234' } } };
  let reads = 0;
  let failRead = false;
  let allow = true;
  let failLimit = false;
  let upstreamStatus = 204;
  let upstreamError: Error | undefined;
  let canceled = 0;
  const keys: string[] = [];
  const sent: Outbound[] = [];
  const settings = { async read() {
    reads++;
    if (failRead) throw new Error(`${SECRET} stored document unavailable`);
    return { revision: 1, values, source: 'saved' as const };
  } };
  const env = {
    GOOGLE_ANALYTICS_API_SECRET: SECRET,
    SITE_ANALYTICS_LIMITER: { async limit({ key }: { key: string }) {
      keys.push(key);
      if (failLimit) throw new Error(`${SECRET} limiter unavailable`);
      return { success: allow };
    } },
  };
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://www.google-analytics.com');
    assert.equal(url.pathname, '/mp/collect');
    assert.ok(init);
    init.signal?.throwIfAborted();
    sent.push({ url, init, payload: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (upstreamError) throw upstreamError;
    if (upstreamStatus === 204) return new Response(null, { status: 204 });
    return new Response(new ReadableStream({ cancel() { canceled++; } }), { status: upstreamStatus, headers: { 'x-private-upstream': SECRET } });
  };
  return {
    env, sent, keys, settings, send,
    handler: createAnalyticsHandler(settings, send),
    get reads() { return reads; }, get canceled() { return canceled; },
    set values(next: typeof values) { values = next; }, get values() { return values; },
    set failRead(value: boolean) { failRead = value; },
    set allow(value: boolean) { allow = value; },
    set failLimit(value: boolean) { failLimit = value; },
    set upstreamStatus(value: number) { upstreamStatus = value; },
    set upstreamError(value: Error | undefined) { upstreamError = value; },
  };
}

function request(body: unknown = { path: '/' }, options: { method?: string; headers?: HeadersInit; url?: string; rawBody?: BodyInit | null } = {}): Request {
  const method = options.method ?? 'POST';
  const headers = new Headers({ origin: 'https://app.example.test', 'content-type': 'application/json', ...Object.fromEntries(new Headers(options.headers)) });
  return new Request(options.url ?? ENDPOINT, {
    method, headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody === undefined ? JSON.stringify(body) : options.rawBody }),
    ...({ duplex: 'half' } as object),
  });
}

async function emptyResponse(response: Response | undefined, status: number): Promise<void> {
  assert.equal(response?.status, status);
  assert.equal(await response!.text(), '');
  assert.equal(response!.headers.get('cache-control'), 'no-store');
  assert.equal(response!.headers.get('set-cookie'), null);
  assert.ok(!JSON.stringify([...response!.headers]).includes(SECRET));
}

test('anonymous public event: server metadata, fixed destination, secret only in server transport', async () => {
  const f = fixture();
  const response = await f.handler(request({ path: '/' }, { url: `${ENDPOINT}?private=${privateValue}` }), f.env);
  await emptyResponse(response, 204);
  assert.equal(f.reads, 1);
  assert.deepEqual(f.keys, ['unknown']);
  assert.equal(f.sent.length, 1);
  const { url, init, payload } = f.sent[0]!;
  assert.equal(url.searchParams.get('api_secret'), SECRET);
  assert.equal(url.searchParams.get('measurement_id'), 'G-TEST1234');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['api_secret', 'measurement_id']);
  assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
  assert.deepEqual([...new Headers(init.headers)], [['content-type', 'application/json']]);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(payload).sort(), ['client_id', 'consent', 'events']);
  assert.match(String(payload.client_id), /^[1-9]\d*\.[1-9]\d*$/u);
  for (const part of String(payload.client_id).split('.')) assert.ok(Number(part) >= 1 && Number(part) <= 2 ** 32);
  assert.deepEqual(payload.consent, { ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  assert.deepEqual(payload.events, [{ name: 'page_view', params: { page_location: 'https://public.example.test/', page_title: f.values.seo.locales.en.title } }]);
  for (const value of [SECRET, privateValue, 'api_secret', 'user_id', 'session_id', 'user_properties', 'ip_override', 'page_referrer']) assert.ok(!String(init.body).includes(value));
});

test('all canonical public locales derive titles and locations from saved configuration', async () => {
  const f = fixture();
  for (const locale of LOCALE_IDS) {
    await emptyResponse(await f.handler(request({ path: localizePath('/', locale) }), f.env), 204);
    const event = (f.sent.at(-1)!.payload.events as { params: { page_location: string; page_title: string } }[])[0]!;
    assert.equal(event.params.page_location, `https://public.example.test${localizePath('/', locale)}`);
    assert.equal(event.params.page_title, f.values.seo.locales[locale].title);
  }
  assert.equal(new Set(f.sent.map(call => call.payload.client_id)).size, LOCALE_IDS.length, 'each event has a fresh identity, not a persistent visitor');
  f.values = { ...f.values, seo: { ...f.values.seo, site: { name: 'Updated Site' }, pages: { '/': { title: 'Updated public page' } } }, analytics: { google: { enabled: true, measurementId: 'G-NEXT1234' } } };
  await emptyResponse(await f.handler(request(), f.env), 204);
  assert.equal(f.sent.at(-1)!.url.searchParams.get('measurement_id'), 'G-NEXT1234');
  assert.deepEqual(f.sent.at(-1)!.payload.events, [{ name: 'page_view', params: { page_location: 'https://app.example.test/', page_title: 'Updated public page' } }]);
});

test('incoming cookie, authorization, referrer, IP, user agent and query are not forwarded', async () => {
  const f = fixture();
  await emptyResponse(await f.handler(request({ path: '/' }, { headers: {
    cookie: `session=${privateValue}`, authorization: `Bearer ${privateValue}`,
    referer: `https://app.example.test/app/session/${privateValue}?token=${privateValue}`,
    'user-agent': privateValue, 'cf-connecting-ip': '192.0.2.44', 'x-forwarded-for': '198.51.100.21',
  } }), f.env), 204);
  assert.deepEqual(f.keys, ['192.0.2.44'], 'client IP is used only as the Cloudflare limiter key');
  const outgoing = JSON.stringify({ url: f.sent[0]!.url.href, init: f.sent[0]!.init });
  for (const value of [privateValue, '192.0.2.44', '198.51.100.21', 'cookie', 'authorization', 'referrer']) assert.ok(!outgoing.includes(value));
});

test('unowned paths, unsupported methods, cross-origin and non-JSON requests have no side effects', async () => {
  const f = fixture();
  assert.equal(await f.handler(request({}, { url: 'https://app.example.test/api/site-analytics/google/other' }), f.env), undefined);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await f.handler(request({}, { method }), f.env);
    await emptyResponse(response, 405); assert.equal(response!.headers.get('allow'), 'POST');
  }
  for (const headers of [{ origin: 'https://other.example.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) await emptyResponse(await f.handler(request({}, { headers }), f.env), 403);
  const noOrigin = request(); noOrigin.headers.delete('origin');
  await emptyResponse(await f.handler(noOrigin, f.env), 403);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) await emptyResponse(await f.handler(request({}, { headers: { 'content-type': type } }), f.env), 415);
  assert.equal(f.sent.length, 0); assert.equal(f.reads, 0); assert.equal(f.keys.length, 0);
});

test('valid media types are case-insensitive and allow charset parameters', async () => {
  const f = fixture();
  await emptyResponse(await f.handler(request({ path: '/' }, { headers: { 'content-type': 'Application/JSON; charset=UTF-8' } }), f.env), 204);
  assert.equal(f.sent.length, 1);
});

test('private, unregistered, encoded, query, fragment and non-canonical paths are rejected', async () => {
  const f = fixture();
  for (const path of ['/login', '/app/session/private', '/app/workspace/private', '/zh-CN/app/session/private', '/api/site-config', '/pricing', '//other.example.test', '/%2f', '/%61pp/session/private', '/?token=secret', '/#secret', '/zh', '/ZH-CN', '/en', '/en/', '/zh-CN/', '/ja/', '/ja/..', '/ja\\private', '/ ', 'https://public.example.test/']) {
    await emptyResponse(await f.handler(request({ path }), f.env), 400);
  }
  for (const body of [null, [], {}, { path: 1 }, { path: '/', title: privateValue }, { path: '/', user_id: privateValue }, { path: '/', client_id: privateValue }, { path: '/', api_secret: SECRET }]) await emptyResponse(await f.handler(request(body), f.env), 400);
  for (const rawBody of ['{broken', 'true', '"/"', '']) await emptyResponse(await f.handler(request(undefined, { rawBody }), f.env), 400);
  assert.equal(f.sent.length, 0); assert.equal(f.reads, 0); assert.equal(f.keys.length, 0);
});

test('streaming body limit uses actual bytes without Content-Length and cancels overflow', async () => {
  const f = fixture();
  let canceled = false;
  const chunks = [new TextEncoder().encode('{"path":"/"}' + ' '.repeat(490)), new TextEncoder().encode(' '.repeat(30))];
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); }, cancel() { canceled = true; } });
  const oversized = request(undefined, { rawBody: stream });
  assert.equal(oversized.headers.has('content-length'), false);
  await emptyResponse(await f.handler(oversized, f.env), 400);
  assert.equal(canceled, true);
  await emptyResponse(await f.handler(request(undefined, { rawBody: '{"path":"/"}' + ' '.repeat(600), headers: { 'content-length': '1' } }), f.env), 400);
  await emptyResponse(await f.handler(request({ path: '/' }, { headers: { 'content-length': '513' } }), f.env), 400);
  await emptyResponse(await f.handler(request(undefined, { rawBody: new Uint8Array([0xff, 0xfe]) }), f.env), 400);
  assert.equal(f.sent.length, 0); assert.equal(f.reads, 0); assert.equal(f.keys.length, 0);
  const validStream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"pa')); controller.enqueue(new TextEncoder().encode('th":"/"}')); controller.close(); } });
  await emptyResponse(await f.handler(request(undefined, { rawBody: validStream }), f.env), 204);
  assert.equal(f.sent.length, 1);
});

test('missing transport bindings do not read D1, limit, or send', async () => {
  const f = fixture();
  for (const env of [{}, { GOOGLE_ANALYTICS_API_SECRET: SECRET }, { SITE_ANALYTICS_LIMITER: f.env.SITE_ANALYTICS_LIMITER }, { ...f.env, GOOGLE_ANALYTICS_API_SECRET: '   ' }]) await emptyResponse(await f.handler(request(), env), 204);
  assert.equal(f.sent.length, 0); assert.equal(f.reads, 0); assert.equal(f.keys.length, 0);
});

test('disabled or missing/invalid measurement configuration never sends', async () => {
  const f = fixture();
  for (const google of [undefined, { enabled: false, measurementId: 'G-TEST1234' }, { enabled: true }, { enabled: true, measurementId: 'https://attacker.example.test' }, { enabled: true, measurementId: 'G-ID?api_secret=other' }]) {
    f.values = { ...f.values, analytics: { google } } as typeof f.values;
    await emptyResponse(await f.handler(request(), f.env), 204);
  }
  assert.equal(f.sent.length, 0);
});

test('native limiter rejects before reading D1; limiter and D1 failures do not send', async () => {
  const f = fixture();
  f.allow = false;
  await emptyResponse(await f.handler(request(), f.env), 429);
  assert.equal(f.reads, 0); assert.equal(f.sent.length, 0);
  f.allow = true; f.failLimit = true;
  await emptyResponse(await f.handler(request(), f.env), 503);
  assert.equal(f.reads, 0); assert.equal(f.sent.length, 0);
  f.failLimit = false; f.failRead = true;
  await emptyResponse(await f.handler(request(), f.env), 503);
  assert.equal(f.reads, 1); assert.equal(f.sent.length, 0);
});

test('upstream failures and error bodies never leak through; no retry or redirect forwarding', async () => {
  const f = fixture();
  for (const status of [301, 400, 429, 500]) {
    f.upstreamStatus = status;
    await emptyResponse(await f.handler(request(), f.env), 502);
  }
  assert.equal(f.sent.length, 4); assert.equal(f.canceled, 4);
  f.upstreamError = new Error(`Fetch failed https://www.google-analytics.com/mp/collect?api_secret=${SECRET}`);
  await emptyResponse(await f.handler(request(), f.env), 503);
  assert.equal(f.sent.length, 5, 'one attempt, no implicit application retry');
});

test('timeout is bounded at 3000 ms and returns only an empty failure', async () => {
  const f = fixture();
  const original = AbortSignal.timeout;
  const timeouts: number[] = [];
  try {
    AbortSignal.timeout = (milliseconds: number) => {
      timeouts.push(milliseconds);
      return AbortSignal.abort(new DOMException(`timeout ${SECRET}`, 'TimeoutError'));
    };
    await emptyResponse(await f.handler(request(), f.env), 503);
    assert.deepEqual(timeouts, [3000]);
    assert.equal(f.sent.length, 0);
  } finally { AbortSignal.timeout = original; }
});

test('composition registers the actual handler at priority 30 without authentication dependency', async () => {
  const f = fixture();
  const registrations: { handler: ReturnType<typeof createAnalyticsHandler>; priority: number }[] = [];
  let readiness: { ready(env: unknown): boolean } | undefined;
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { assert.fail('real transport must never be used in unit tests'); };
    apply({ publicPages: { async resolve(_env: unknown, path: string) { return PUBLIC_PAGES.find(page => page.path === path); } }, inject() {}, siteSettings: f.settings, provide(name: string, value: { ready(env: unknown): boolean }) { assert.equal(name, 'siteAnalytics'); readiness = value; }, effect(fn: () => unknown) { return fn(); }, http: { use(handler: ReturnType<typeof createAnalyticsHandler>, priority: number) { registrations.push({ handler, priority }); return () => {}; } } } as never);
    assert.equal(registrations.length, 1); assert.equal(registrations[0]!.priority, 30);
    assert.ok(readiness);
    assert.equal(readiness.ready(f.env), true);
    for (const env of [{}, { GOOGLE_ANALYTICS_API_SECRET: SECRET }, { SITE_ANALYTICS_LIMITER: f.env.SITE_ANALYTICS_LIMITER }, { ...f.env, GOOGLE_ANALYTICS_API_SECRET: ' ' }]) assert.equal(readiness.ready(env), false);
    await emptyResponse(await registrations[0]!.handler(request(), {}), 204);
    assert.equal(f.reads, 0);
  } finally { globalThis.fetch = previous; }
});

test('production registry permits only published available language variants, independent of indexability', async () => {
  const f=fixture();const calls:string[]=[];
  const pages={async resolve(_env:unknown,path:string,locale:string){calls.push(`${locale}:${path}`);return path==='/guides/release'&&locale==='zh'?{path,indexable:false,copy:{zh:{title:'Published release',description:'Public release'}}}:undefined;}};
  const handler=createAnalyticsHandler(f.settings,f.send,pages as never);
  await emptyResponse(await handler(request({path:'/zh-CN/guides/release'}),f.env),204);
  assert.equal(f.sent.length,1);assert.equal((f.sent[0]!.payload.events as any[])[0].params.page_title,'Published release');
  for(const path of ['/guides/release','/zh-CN/guides/draft','/zh-CN/app/session/private'])await emptyResponse(await handler(request({path}),f.env),400);
  assert.equal(f.sent.length,1);assert.equal(calls.length,4);
  const failed=createAnalyticsHandler(f.settings,f.send,{async resolve(){throw new Error('unavailable');}});
  await emptyResponse(await failed(request(),f.env),503);assert.equal(f.sent.length,1);
});
