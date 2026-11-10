/** Real D1 CAS and production handlers in two isolates; authentication is a fixture-owned trusted service. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const app = join(root, 'apps/web');
const { build } = createRequire(join(app, 'package.json'))('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const origin = 'https://localhost';

// Test cookies are interpreted only by this fixture's injected auth face; no
// production handler trusts cookies, usernames, roles or headers as authority.
const request = (path = '/api/site-settings', { user = 'admin', method = 'GET', values, revision, headers = {}, raw } = {}) => new Request(origin + path, {
  method,
  headers: { ...(user === null ? {} : { cookie: `fixture-session=${user}` }), origin, accept: 'text/html',
    ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}), ...headers },
  ...(method === 'PUT' ? { body: raw ?? JSON.stringify({ expectedRevision: revision, values }) } : {}),
});

const checkedJson = async response => {
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('cache-control'), /no-store/);
  return response.json();
};

test('site settings are admin-only, atomic, shared across accounts and durable across isolates', { timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-site-settings-'));
  const bundle = join(directory, 'worker.mjs');
  const built = await build({
    stdin: { contents: `
      import { apply as site } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-site-config/src/index.ts'))};
      import { apply as seo } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-seo/src/index.ts'))};
      import { apply as sitemap } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-sitemap/src/index.ts'))};
      import { apply as robots } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-robots/src/index.ts'))};
      import { apply as manifest } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-manifest/src/index.ts'))};
      import { apply as llms } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-llms/src/index.ts'))};
      import { apply as analytics } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-google-analytics/src/index.ts'))};
      import { createPublicPages } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/src/index.ts'))};
      const handlers = [];
      const ctx = {
        publicPages: createPublicPages(),
        inject(names, setup) { if (names.every(name => this[name])) setup(this); },
        http: { use(handler) { handlers.push(handler); return () => {}; } },
        auth: { async session(request) {
          const cookie = request.headers.get('cookie');
          if (cookie === 'fixture-session=admin') return { id: 'site-admin-id', username: 'admin' };
          if (cookie === 'fixture-session=reader') return { id: 'reader-id', username: 'admin' };
        } },
        provide(name, value) { this[name] = value; }, get(name) { return this[name]; }, effect(effect) { effect(); },
      };
      site(ctx); sitemap(ctx); robots(ctx); manifest(ctx); llms(ctx); analytics(ctx); seo(ctx);
      export default { async fetch(request, env) {
        // Miniflare proxy requires localhost Origin; translate the fixture transport
        // to the same production origin before exercising real request boundaries.
        const target = new URL(request.url); target.protocol = 'https:'; target.host = 'published.example.test';
        const translated = new Headers(request.headers);
        if (translated.get('origin') === 'https://localhost') translated.set('origin', target.origin);
        request = new Request(target, new Request(request, {headers: translated}));
        if (request.headers.has('x-fixture-no-content-length') || request.headers.has('x-fixture-origin')) {
          const headers = new Headers(request.headers);
          if (headers.has('x-fixture-no-content-length')) headers.delete('content-length');
          if (headers.has('x-fixture-origin')) headers.set('origin', headers.get('x-fixture-origin'));
          request = new Request(request, { headers });
        }
        env = { ...env, SITE_ANALYTICS_LIMITER: { async limit() { return { success: true }; } }, ASSETS: { async fetch() { return new Response('<!doctype html><html><head><title>shell</title></head><body></body></html>', { headers: { 'content-type': 'text/html' } }); } } };
        if (request.headers.has('x-fixture-admin-list')) env.SITE_ADMIN_USER_IDS = request.headers.get('x-fixture-admin-list') === '__empty__' ? '' : request.headers.get('x-fixture-admin-list');
        if (request.headers.has('x-fixture-d1-outage')) env.AUTH_DB = { withSession() { throw new Error('injected outage'); } };
        for (const handler of handlers) { const response = await handler(request, env); if (response) return response; }
        return new Response('fixture fallback', { status: 404 });
      } };`, resolveDir: app, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], nodePaths: [join(app, 'node_modules')],
    external: ['node:*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  writeFileSync(bundle, built.outputFiles[0].text);
  const options = () => convertV4MiniflareOptions({ resourcePersistencePath: join(directory, 'resources'),
    workers: ['site-a', 'site-b'].map(name => ({ name, modulesRoot: directory, modules: [{ type: 'ESModule', path: bundle }],
      compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'], d1Databases: { AUTH_DB: 'shared-site-database' },
      bindings: { SITE_INDEXING_ENABLED: 'true', SITE_DEPLOYMENT_ENVIRONMENT: 'production', AUTH_BASE_URL: 'https://published.example.test', GOOGLE_ANALYTICS_API_SECRET: 'fixture-only-secret', SITE_ADMIN_USER_IDS: '["site-admin-id"]', SITE_BRAND_NAME: 'Deployment brand', SITE_ENVIRONMENT_LABEL: 'Test',
        SITE_DOCS_URL: 'https://docs.example.test', SITE_SEO_JSON: JSON.stringify({ locales: { en: { title: 'Deployment title' } } }) },
    })),
  });
  let mf = new Miniflare(options());
  try {
    let database = await mf.getD1Database('AUTH_DB', 'site-a');
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';').filter(value => value.trim())) await database.prepare(statement).run();
    let a = await mf.getWorker('site-a'), b = await mf.getWorker('site-b');
    const initial = await checkedJson(await a.fetch(request()));
    assert.equal(initial.revision, 0); assert.equal(initial.source, 'deployment'); assert.equal(initial.canEdit, true);
    assert.equal(initial.values.seo.locales.en.title, 'Deployment title');
    const changed = structuredClone(initial.values);
    changed.seo.site.name = 'Published site'; changed.seo.site.url = 'https://published.example.test';
    changed.seo.locales.en = { title: 'Saved title', description: 'Saved description', keywords: ['saved', 'shared'] };
    changed.seo.icons.svg = '/saved-icon.svg'; changed.seo.icons.icon192 = '/saved-192.png'; changed.seo.manifest.themeColor = '#123456';
    changed.seo.pages = { '/': { lastmod: '2026-11-14', priority: '0.8', changefreq: 'monthly' } };
    changed.seo.robots = { disallow: ['/internal'], extraLines: ['# saved site rules'] };
    changed.seo.llms = { enabled: true, introduction: 'Public reading guide', guidance: 'Use the listed public pages.' };
    changed.analytics = { google: { enabled: true, measurementId: 'G-TEST1234' } };
    changed.links = { docs: 'https://published.example.test/docs', supportEmail: 'help@example.test' };

    await t.test('logged-in reads do not imply edit rights; client identities cannot grant them', async () => {
      assert.equal((await a.fetch(request(undefined, { user: null }))).status, 401);
      assert.equal((await a.fetch(request(undefined, { user: null, method: 'PUT', values: changed, revision: 0 }))).status, 401);
      const reader = await checkedJson(await b.fetch(request(undefined, { user: 'reader' })));
      assert.equal(reader.canEdit, false); assert.deepEqual(reader.values, initial.values);
      assert.equal((await b.fetch(request(undefined, { user: 'reader', method: 'PUT', values: changed, revision: 0,
        headers: { 'x-admin': 'true', 'x-user-id': 'site-admin-id', 'x-user-role': 'admin' } }))).status, 403);
      for (const ids of ['', 'not-json', '[]', '["site-admin-id",42]', '[" site-admin-id "]', '{}']) {
        assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0, headers: { 'x-fixture-admin-list': ids === '' ? '__empty__' : ids } }))).status, 403);
      }
      assert.equal((await checkedJson(await a.fetch(request()))).revision, 0);
    });

    await t.test('origin, media type, body size, revisions and unknown fields fail before storage', async () => {
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0, headers: { 'x-fixture-origin': 'https://elsewhere.test' } }))).status, 403);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0, headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
      const noOrigin = request(undefined, { method: 'PUT', values: changed, revision: 0 }); noOrigin.headers.delete('origin');
      assert.equal((await a.fetch(noOrigin)).status, 403);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0, headers: { 'content-type': 'text/plain' } }))).status, 415);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', raw: '{' }))).status, 400);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', raw: JSON.stringify({ expectedRevision: 0, values: changed, canEdit: true }) }))).status, 400);
      for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER, '0']) {
        assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision }))).status, 400);
      }
      const unknown = structuredClone(changed); unknown.seo.unknownSetting = true;
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: unknown, revision: 0 }))).status, 400);
      const invalid = structuredClone(changed); invalid.seo.icons.svg = 'javascript:alert(1)';
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: invalid, revision: 0 }))).status, 400);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', raw: ' '.repeat(400 * 1024) }))).status, 413);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', raw: ' '.repeat(400 * 1024), headers: { 'x-fixture-no-content-length': 'true' } }))).status, 413);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 3 }))).status, 409);
      assert.equal((await checkedJson(await a.fetch(request()))).revision, 0);
    });

    await t.test('concurrent first writes in separate isolates accept exactly one revision', async () => {
      const responses = await Promise.all([a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0 })), b.fetch(request(undefined, { method: 'PUT', values: changed, revision: 0 }))]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      const admin = await checkedJson(await a.fetch(request()));
      const reader = await checkedJson(await b.fetch(request(undefined, { user: 'reader' })));
      assert.equal(admin.revision, 1); assert.equal(admin.source, 'saved'); assert.deepEqual(admin.values, changed);
      assert.equal(reader.canEdit, false); assert.equal(reader.revision, 1); assert.deepEqual(reader.values, changed);
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: initial.values, revision: 0 }))).status, 409);
    });

    await t.test('the same saved document drives public config, SEO, icons, sitemap and manifest for all accounts', async () => {
      const publicConfig = await checkedJson(await a.fetch(request('/api/site-config', { user: null })));
      assert.deepEqual(publicConfig, { environmentLabel: 'Test', brand: { name: 'Published site' }, links: changed.links, analytics: { google: { ...changed.analytics.google, ready: true } }, documentTitles: Object.fromEntries(Object.entries(changed.seo.locales).map(([locale, copy]) => [locale, copy.title])) });
      for (const user of [null, 'reader', 'admin']) {
        const response = await b.fetch(request('/', { user })); assert.equal(response.status, 200);
        const html = await response.text();
        for (const text of ['<title>Saved title</title>', 'content="Saved description"', 'content="saved, shared"', 'https://published.example.test/saved-icon.svg']) assert.ok(html.includes(text), text);
        assert.ok(!html.includes('site-admin-id'));
      }
      for (const path of ['/login', '/zh-CN/login', '/app/session/private', '/ja/app/workspace/private']) {
        const response = await b.fetch(request(path)); assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes('https://published.example.test/saved-icon.svg'), `${path}: saved icon`);
        assert.ok(html.includes('rel="manifest"'), `${path}: saved manifest`);
        assert.ok(html.includes('name="theme-color" content="#123456"'), `${path}: saved theme`);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
        for (const forbidden of ['rel="canonical"', 'hreflang=', 'property="og:', 'name="twitter:', 'application/ld+json']) assert.ok(!html.includes(forbidden), `${path}: excludes ${forbidden}`);
      }
      const sitemap = await b.fetch(request('/sitemap.xml', { user: null })); assert.equal(sitemap.status, 200);
      assert.match(sitemap.headers.get('cache-control'), /no-store/); assert.match(await sitemap.text(), /<lastmod>2026-11-14<\/lastmod>/);
      const robots = await a.fetch(request('/robots.txt', { user: null })); assert.match(robots.headers.get('cache-control'), /no-store/);
      assert.match(await robots.text(), /Disallow: \/internal/);
      const manifest = await checkedJson(await b.fetch(request('/manifest.webmanifest', { user: null })));
      assert.equal(manifest.name, 'Published site'); assert.ok(manifest.icons.some(icon => icon.src.endsWith('/saved-192.png')));
      const guide = await b.fetch(request('/llms.txt', { user: null })); assert.equal(guide.status, 200);
      assert.match(await guide.text(), /Public reading guide/);
      for (const path of ['/api/site-config', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/llms.txt']) {
        const response = await a.fetch(request(path, { user: null, method: 'HEAD' })); assert.equal(response.status, 200); assert.equal(await response.text(), '');
      }
    });

    await t.test('later CAS writes survive a complete runtime restart without stale isolate reads', async () => {
      const newer = structuredClone(changed); newer.seo.locales.en.title = 'Published second title';
      const saved = await checkedJson(await b.fetch(request(undefined, { method: 'PUT', values: newer, revision: 1 })));
      assert.equal(saved.revision, 2);
      assert.equal((await checkedJson(await a.fetch(request()))).values.seo.locales.en.title, 'Published second title');
      await mf.dispose(); mf = new Miniflare(options());
      database = await mf.getD1Database('AUTH_DB', 'site-a'); a = await mf.getWorker('site-a'); b = await mf.getWorker('site-b');
      const restored = await checkedJson(await b.fetch(request(undefined, { user: 'reader' })));
      assert.equal(restored.revision, 2); assert.equal(restored.source, 'saved'); assert.deepEqual(restored.values, newer);
      assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM dsh_site_settings').first()).total, 1);
    });

    await t.test('D1 errors never fall back to deployment data; unrelated routes do not read the table', async () => {
      for (const path of ['/api/site-settings', '/api/site-config', '/', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/llms.txt']) {
        const response = await a.fetch(request(path, { headers: { 'x-fixture-d1-outage': 'true' } }));
        assert.equal(response.status, 503, path); assert.equal((await response.json()).error, 'site_settings_unavailable');
      }
      assert.equal((await a.fetch(request(undefined, { method: 'PUT', values: changed, revision: 2, headers: { 'x-fixture-d1-outage': 'true' } }))).status, 503);
      for (const path of ['/assets/app.js', '/favicon.svg', '/api/chat', '/agents/think']) {
        assert.equal((await a.fetch(request(path, { headers: { 'x-fixture-d1-outage': 'true' } }))).status, 404, path);
      }
      assert.equal((await checkedJson(await a.fetch(request()))).revision, 2);
      await database.prepare("UPDATE dsh_site_settings SET values_json = '{}' WHERE singleton = 1").run();
      assert.equal((await b.fetch(request())).status, 503, 'invalid stored data is not silently replaced by defaults');
      await database.prepare('DROP TABLE dsh_site_settings').run();
      assert.equal((await b.fetch(request('/api/site-config', { user: null }))).status, 503, 'missing migration is explicit');
    });
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
