/** Actual Better Auth HTTP handlers in two workerd isolates sharing persistent local D1. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const app = join(root, 'apps/web');
const appRequire = createRequire(join(app, 'package.json'));
const { build } = appRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');

test('database auth limits are atomic, persistent, trusted-IP scoped and fail closed', { timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-auth-limit-'));
  const bundle = join(directory, 'worker.mjs');
  const secret = randomBytes(32).toString('hex');
  const registration = randomBytes(32).toString('base64url');
  const origin = 'https://localhost';
  // Exercise the real plugin handler and its real Better Auth options. The only
  // fixture-specific endpoint injects a D1 outage; it never exists in product code.
  const built = await build({
    stdin: { contents: `import { apply } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts'))};
      import { apply as applyHttp } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-http/src/index.ts'))};
    import { createPublicPages } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/src/index.ts'))};
      const reads = new WeakMap();
      const ctx = { publicPages: createPublicPages(), inject(names, setup) { if (names.every(name => this[name])) setup(this); }, effect(fn) { fn(); }, provide(name, value) { this[name] = value; }, get(name) { return this[name]; } };
      applyHttp(ctx);
      apply(ctx);
      ctx.http.use(async (request, env) => {
        if (!['/api/session-host', '/api/test/session-reader'].includes(new URL(request.url).pathname)) return;
        const [first, second] = await Promise.all([ctx.auth.session(request, env), ctx.auth.session(request, env)]);
        if (!first) return Response.json({ error: 'unauthenticated' }, { status: 401 });
        return Response.json({ id: first.id, sameIdentity: first.id === second?.id, sessionReads: reads.get(request) });
      });
      export default { async fetch(request, env) {
        let sessionReads = 0;
        reads.set(request, 0);
        const db = env.AUTH_DB;
        if (['/api/session-host', '/api/test/session-reader'].includes(new URL(request.url).pathname) || request.headers.get('x-test-d1-outage') === 'true') env = { ...env, AUTH_DB: { prepare(sql) {
          if (/from "session"/i.test(sql)) reads.set(request, ++sessionReads);
          if (request.headers.get('x-test-d1-outage') === 'true' || request.headers.get('x-test-single-session-read') === 'true' && sessionReads > 1) throw new Error('injected D1 outage');
          return db.prepare(sql);
        }, batch: db.batch.bind(db), exec: db.exec.bind(db) } };
        return ctx.http.dispatch(request, env);
      } };`, resolveDir: app, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
    nodePaths: [join(app, 'node_modules')], external: ['node:*', 'cloudflare:workers'],
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  writeFileSync(bundle, built.outputFiles[0].text);
  const options = () => convertV4MiniflareOptions({
    resourcePersistencePath: join(directory, 'resources'),
    workers: ['auth-a', 'auth-b'].map(name => ({ name, modulesRoot: directory,
      modules: [{ type: 'ESModule', path: bundle }],
      compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'],
      // Model the Cloudflare edge's trusted address; Miniflare otherwise strips
      // caller-supplied IP headers before the real handler can normalize them.
      stripCfConnectingIp: false,
      d1Databases: { AUTH_DB: 'shared-auth-database' },
      bindings: { AUTH_BASE_URL: origin, AUTH_SECRET: secret, AUTH_SIGNUP_ENABLED: 'false', AUTH_REGISTRATION_TOKEN: registration },
    })),
  });
  let mf = new Miniflare(options());
  const workers = async () => [await mf.getWorker('auth-a'), await mf.getWorker('auth-b')];
  const request = (path, body, ip, headers = {}) => new Request(origin + '/api/auth' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'cf-connecting-ip': ip, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const badLogin = (ip, headers) => request('/sign-in/username', { username: 'nonexistent', password: 'long-private-test-password' }, ip, headers);
  try {
    let database = await mf.getD1Database('AUTH_DB', 'auth-a');
    for (const file of readdirSync(join(app, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(app, 'migrations', file), 'utf8').replace(/--[^\n]*/g, '');
      for (const statement of sql.split(';').filter(value => value.trim())) await database.prepare(statement).run();
    }
    let [a, b] = await workers();
    await t.test('simultaneous requests in separate isolates admit exactly one shared budget', async () => {
      const responses = await Promise.all(Array.from({ length: 32 }, (_, i) => (i % 2 ? a : b).fetch(badLogin('192.0.2.41'))));
      assert.equal(responses.filter(response => response.status === 401).length, 20);
      assert.equal(responses.filter(response => response.status === 429).length, 12);
      for (const response of responses.filter(response => response.status === 429)) assert.ok(Number(response.headers.get('x-retry-after')) > 0);
      const rows = await database.prepare('SELECT "count", "lastRequest" FROM "rateLimit"').all();
      assert.equal(rows.results.length, 1); assert.equal(rows.results[0].count, 20);
    });
    await t.test('a runtime restart preserves throttling without rotating account identity', async () => {
      await mf.dispose(); mf = new Miniflare(options());
      database = await mf.getD1Database('AUTH_DB', 'auth-a'); [a, b] = await workers();
      assert.equal((await a.fetch(badLogin('192.0.2.41'))).status, 429);
      assert.equal((await b.fetch(badLogin('192.0.2.41', { 'x-forwarded-for': '203.0.113.99' }))).status, 429);
      assert.equal((await a.fetch(badLogin('192.0.2.42'))).status, 401);
    });
    await t.test('the real database window resets once, including concurrent expiry', async () => {
      await database.prepare('UPDATE "rateLimit" SET "lastRequest" = ?').bind(Date.now() - 61_000).run();
      const responses = await Promise.all(Array.from({ length: 28 }, (_, i) => (i % 2 ? a : b).fetch(badLogin('192.0.2.41'))));
      assert.equal(responses.filter(response => response.status === 401).length, 20);
      assert.equal(responses.filter(response => response.status === 429).length, 8);
      assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM "rateLimit"').first()).total, 1, 'expired unrelated rows are pruned by the real Better Auth adapter');
    });
    await t.test('IP normalization cannot bypass the shared budget', async () => {
      const variants = ['2001:db8:1:2::1', '2001:0db8:0001:0002:0000:0000:0000:0001', '2001:db8:1:2::ffff'];
      const responses = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).fetch(badLogin(variants[i % variants.length]))));
      assert.equal(responses.filter(response => response.status === 401).length, 20);
      assert.equal(responses.filter(response => response.status === 429).length, 4);
    });
    await t.test('stored limits survive real signup, login, cookie sessions and pruning', async t => {
      const user = { username: 'persisteduser', email: 'persisted@example.test', name: 'Persisted', password: randomBytes(24).toString('base64url') };
      assert.equal((await a.fetch(request('/sign-up/email', user, '192.0.2.51'))).status, 403);
      const registered = await a.fetch(request('/sign-up/email', user, '192.0.2.51', { 'x-dsh-registration-token': registration }));
      assert.equal(registered.status, 200, await registered.clone().text());
      const identity = (await registered.json()).user.id;
      const signedIn = await b.fetch(request('/sign-in/username', { username: user.username, password: user.password }, '192.0.2.51'));
      assert.equal(signedIn.status, 200, await signedIn.clone().text());
      const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      assert.ok(cookie);
      const session = await a.fetch(request('/get-session', undefined, '192.0.2.51', { cookie }));
      assert.equal(session.status, 200); assert.equal((await session.json()).user.id, identity);
      await mf.dispose(); mf = new Miniflare(options());
      database = await mf.getD1Database('AUTH_DB', 'auth-a'); [a, b] = await workers();
      const restored = await b.fetch(request('/get-session', undefined, '192.0.2.51', { cookie }));
      assert.equal(restored.status, 200); assert.equal((await restored.json()).user.id, identity);
      await t.test('same-request authorization uses one read, leaves renewal to HTTP, and distinguishes outages from anonymous sessions', async () => {
        const protectedRequest = (headers = {}) => new Request(origin + '/api/session-host', {
          method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ method: 'permissionSnapshot', params: {} }),
        });
        const older = new Date(Date.now() - 2 * 86400_000).toISOString();
        const expires = new Date(Date.now() + 5 * 86400_000).toISOString();
        await database.prepare('UPDATE "session" SET "updatedAt"=?,"expiresAt"=? WHERE "userId"=?').bind(older, expires, identity).run();
        const before = await database.prepare('SELECT "updatedAt","expiresAt" FROM "session" WHERE "userId"=?').bind(identity).first();
        const checked = await a.fetch(protectedRequest({ 'x-test-single-session-read': 'true' }));
        assert.equal(checked.status, 200, await checked.clone().text());
        assert.deepEqual(await checked.json(), { id: identity, sameIdentity: true, sessionReads: 1 });
        assert.equal(checked.headers.get('set-cookie'), null);
        assert.deepEqual(await database.prepare('SELECT "updatedAt","expiresAt" FROM "session" WHERE "userId"=?').bind(identity).first(), before,
          'server authorization must not refresh a session without returning its cookie');
        const failed = await a.fetch(protectedRequest({ 'x-test-d1-outage': 'true' }));
        assert.equal(failed.status, 503);
        assert.deepEqual(await failed.json(), { error: 'auth_unavailable' });
        assert.equal(failed.headers.get('set-cookie'), null);
        const unguarded = await a.fetch(new Request(origin + '/api/test/session-reader', {
          headers: { cookie, 'x-test-d1-outage': 'true' },
        }));
        assert.equal(unguarded.status, 503, 'the real HTTP dispatcher preserves typed auth failures outside the protected gate');
        assert.deepEqual(await unguarded.json(), { error: 'auth_unavailable' });
        const publicFailure = await a.fetch(request('/get-session', undefined, '192.0.2.51', { cookie, 'x-test-d1-outage': 'true' }));
        assert.equal(publicFailure.status, 503, 'auth transport failures are service failures, not rate-limit 429 or invalid credentials');
        assert.deepEqual(await publicFailure.json(), { error: 'auth_unavailable' });
        assert.equal(publicFailure.headers.get('retry-after'), null, 'no unproven retry advice is invented for a backend outage');
        const recovered = await a.fetch(protectedRequest());
        assert.equal(recovered.status, 200, 'a new request rereads the database after failure');
        assert.equal((await recovered.json()).id, identity);
        const renewed = await a.fetch(request('/get-session', undefined, '192.0.2.51', { cookie }));
        assert.equal(renewed.status, 200);
        assert.ok(renewed.headers.get('set-cookie'), 'the real auth HTTP endpoint still refreshes due cookies');
        await database.prepare('DELETE FROM "session" WHERE "userId"=?').bind(identity).run();
        assert.equal((await a.fetch(protectedRequest())).status, 401, 'revocation is authoritative on the next request');
        assert.equal((await a.fetch(protectedRequest({ cookie: '' }))).status, 401, 'actual anonymous calls remain unauthorized');
      });
    });
    await t.test('D1 outage and missing schema never bypass credential admission', async () => {
      const outage = await a.fetch(badLogin('192.0.2.61', { 'x-test-d1-outage': 'true' }));
      assert.ok(outage.status >= 500, `outage must fail closed, received ${outage.status}`);
      assert.equal(outage.headers.get('set-cookie'), null);
      await database.prepare('DROP TABLE "rateLimit"').run();
      const missing = await b.fetch(badLogin('192.0.2.62'));
      assert.ok(missing.status >= 500, `missing schema must fail closed, received ${missing.status}`);
      assert.equal(missing.headers.get('set-cookie'), null);
      assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM "user"').first()).total, 1);
    });
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
