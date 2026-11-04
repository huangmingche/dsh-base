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
      let handler;
      const ctx = { http: { use(value) { handler = value; return () => {}; } }, effect(fn) { fn(); }, provide() {} };
      apply(ctx);
      export default { async fetch(request, env) {
        if (request.headers.get('x-test-d1-outage') === 'true') env = { ...env, AUTH_DB: { prepare() { throw new Error('injected D1 outage'); }, batch: env.AUTH_DB.batch.bind(env.AUTH_DB), exec: env.AUTH_DB.exec.bind(env.AUTH_DB) } };
        return await handler(request, env) ?? new Response('fixture not found', { status: 404 });
      } };`, resolveDir: app, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
    nodePaths: [join(app, 'node_modules')], external: ['node:*'],
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
    await t.test('stored limits survive real signup, login, cookie sessions and pruning', async () => {
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
