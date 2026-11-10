/** Real Better Auth admin/API-key plugins, Worker HTTP composition and local D1 only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url)), app = join(root, 'apps/web');
const { build } = createRequire(join(app, 'package.json'))('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');

test('administrator authority and user-owned API keys are enforced by real D1 auth', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-admin-keys-')), bundle = join(directory, 'worker.mjs');
  const built = await build({ stdin: { contents: `
    import { apply as auth } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts'))};
    import { apply as admin } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-user-admin/src/index.ts'))};
    import { apply as keys } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-api-keys/src/index.ts'))};
    import { apply as profile } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-account-profile/src/index.ts'))};
    const handlers = [];
    import { createPublicPages } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/src/index.ts'))};
    const ctx = { publicPages: createPublicPages(), inject(names, setup) { if (names.every(name => this[name])) setup(this); }, http: { use(handler, priority) { handlers.push({ handler, priority }); return () => {}; } }, effect(fn) { fn(); }, provide(name, value) { this[name] = value; }, get(name) { return this[name]; } };
    auth(ctx); admin(ctx); keys(ctx); profile(ctx);
    export default { async fetch(request, env) {
      env = { ...env, SITE_ADMIN_USER_IDS: JSON.stringify(request.headers.has('x-fixture-admin-id') ? [request.headers.get('x-fixture-admin-id')] : []) };
      if (request.headers.has('x-fixture-disable-admin')) env.USER_ADMIN_ENABLED = 'false';
      if (request.headers.has('x-fixture-disable-keys')) env.API_KEYS_ENABLED = 'false';
      for (const entry of handlers.sort((a, b) => a.priority - b.priority)) { const result = await entry.handler(request, env); if (result) return result; }
      return new Response('not found', { status: 404 });
    } };`, resolveDir: app, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], nodePaths: [join(app, 'node_modules')], external: ['node:*', 'cloudflare:workers'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  writeFileSync(bundle, built.outputFiles[0].text);
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'admin-keys', modulesRoot: directory, modules: [{ type: 'ESModule', path: bundle }],
    compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'], stripCfConnectingIp: false, d1Databases: ['AUTH_DB'],
    outboundService: () => { throw new Error('external network forbidden'); },
    bindings: { AUTH_BASE_URL: 'https://localhost', AUTH_SECRET: 'fixture-secret-at-least-thirty-two-characters', AUTH_SIGNUP_ENABLED: 'true', USER_ADMIN_ENABLED: 'true', API_KEYS_ENABLED: 'true' } }] }));
  let ownerId = '';
  const request = (path, { method = 'GET', body, cookie, headers = {} } = {}) => mf.dispatchFetch(`https://localhost${path}`, { method, redirect: 'manual',
    headers: { origin: 'https://localhost', 'cf-connecting-ip': '192.0.2.76', ...(cookie ? { cookie } : {}), ...(ownerId ? { 'x-fixture-admin-id': ownerId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const success = async response => { assert.ok(response.ok, `${response.status} ${await response.clone().text()}`); assert.match(response.headers.get('cache-control'), /no-store/); return response.json(); };
  const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  try {
    const db = await mf.getD1Database('AUTH_DB');
    const schemas = readdirSync(join(app, 'migrations')).filter(name => /^000[12]_.*\.sql$/.test(name)).sort().map(name => join(app, 'migrations', name));
    schemas.push(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-user-admin/schema.sql'), resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-api-keys/schema.sql'));
    for (const file of schemas) for (const sql of readFileSync(file, 'utf8').replace(/--[^\n]*/g, '').split(';').filter(value => value.trim())) await db.prepare(sql).run();
    const ownerSignup = await request('/api/auth/sign-up/email', { method: 'POST', body: { username: 'ownerfixture', name: 'Owner', email: 'owner@example.test', password: 'fixture-owner-password' } });
    ownerId = (await success(ownerSignup)).user.id;
    const ownerCookie = cookieFrom(ownerSignup);
    const readerInput = { username: 'readerfixture', name: 'Reader', email: 'reader@example.test', password: 'fixture-reader-password' };
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: { ...readerInput, image: 'https://outside.example/pixel' } })).status, 400, 'new signup cannot inject a client-selected image URL');
    const formSignup = await mf.dispatchFetch('https://localhost/api/auth/sign-up/email', { method: 'POST', headers: { origin: 'https://localhost', 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.76' }, body: new URLSearchParams({ ...readerInput, image: 'https://outside.example/pixel' }).toString() });
    assert.equal(formSignup.status, 400, 'form-encoded signup cannot bypass the image policy');
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: { ...readerInput, name: 'x'.repeat(17000) } })).status, 413, 'signup policy bounds the original body stream');
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: { ...readerInput, role: 'admin' } })).status, 400, 'registration cannot set an administrator role');
    const readerSignup = await request('/api/auth/sign-up/email', { method: 'POST', body: readerInput });
    const readerId = (await success(readerSignup)).user.id;
    let readerCookie = cookieFrom(readerSignup);
    assert.equal((await db.prepare('SELECT role FROM "user" WHERE id = ?').bind(readerId).first()).role, 'user', 'registration cannot set an administrator role');
    for (const cookie of [undefined, readerCookie]) for (const path of ['/api/auth/update-user', '/api/auth/%75pdate-user', '/api/auth/UPDATE-USER', '/api/auth//update-user', '/api/auth/update-user/', '/api/auth/update-user%2f']) {
      assert.equal((await request(path, { method: 'POST', cookie, body: { image: 'https://outside.example/pixel', name: 'Bypass', role: 'admin' } })).status, 404, 'native profile updates cannot bypass product rules, anonymously or authenticated');
    }
    assert.equal((await db.prepare('SELECT role FROM "user" WHERE id = ?').bind(readerId).first()).role, 'user');
    await success(await request('/api/saas/account-profile', { method: 'PUT', cookie: readerCookie, body: { name: 'Updated reader', avatarFileId: null } }));
    const updatedProfile = await success(await request('/api/saas/account-profile', { cookie: readerCookie }));
    assert.equal(updatedProfile.user.name, 'Updated reader'); assert.equal(updatedProfile.user.avatarFileId, null);
    await db.prepare('UPDATE "user" SET image = ? WHERE id = ?').bind('https://google-avatar.example/legacy', readerId).run();
    await success(await request('/api/saas/account-profile', { method: 'PUT', cookie: readerCookie, body: { name: 'Name only' } }));
    assert.equal((await success(await request('/api/saas/account-profile', { cookie: readerCookie }))).user.image, 'https://google-avatar.example/legacy', 'name-only updates preserve existing or OAuth avatars');
    assert.equal((await request('/api/saas/account-profile', { method: 'PUT', cookie: readerCookie, body: { name: 'Bypass', image: 'https://outside.example/pixel' } })).status, 400);
    assert.equal((await request('/api/saas/account-profile', { method: 'PUT', cookie: readerCookie, body: { name: 'Bypass', role: 'admin' } })).status, 400);
    assert.equal((await request('/api/user-admin/users')).status, 401);
    assert.equal((await request('/api/user-admin/users', { cookie: readerCookie })).status, 403);
    assert.deepEqual(await success(await request('/api/user-admin/status', { cookie: ownerCookie })), { enabled: true, canManage: true });
    const listed = await success(await request('/api/user-admin/users?limit=1&offset=0', { cookie: ownerCookie }));
    assert.equal(listed.total, 2); assert.equal(listed.users.length, 1);
    assert.equal((await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, body: { action: 'set-role', userId: readerId, role: 'admin' } })).status, 200);
    assert.equal((await request('/api/user-admin/users', { cookie: readerCookie })).status, 403, 'stored roles do not replace deployment administrator authority');
    assert.equal((await request('/api/auth/admin/remove-user', { method: 'POST', cookie: ownerCookie, body: { userId: readerId } })).status, 404, 'destructive user deletion is not mounted');
    assert.equal((await request('/api/auth/admin/ban-user', { method: 'POST', cookie: ownerCookie, body: { userId: readerId } })).status, 404, 'native admin endpoints cannot bypass product guards');
    assert.equal((await request('/api/auth/api-key/create', { method: 'POST', cookie: readerCookie, body: { name: 'Bypass', userId: ownerId, expiresIn: null, permissions: { admin: ['all'] } } })).status, 404, 'native key issuance cannot bypass expiry or permission limits');
    assert.equal((await request('/api/auth/api-key/list', { cookie: readerCookie, headers: { 'x-auth-extension': 'api-keys' } })).status, 404, 'HTTP headers cannot supply the internal extension context');
    for (const path of ['/api/auth/%61dmin/ban-user', '/api/auth/admin%2fban-user', '/api/auth/ADMIN/ban-user', '/api/auth//admin/ban-user', '/api/auth/api%2dkey/create', '/api/auth/%61pi-key/create']) {
      assert.equal((await request(path, { method: 'POST', cookie: ownerCookie, body: { userId: readerId, name: 'Encoded bypass' } })).status, 404, `${path}: encoded and noncanonical namespaces cannot bypass the guard`);
    }
    assert.equal((await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, headers: { origin: 'https://outside.example' }, body: { action: 'ban', userId: readerId } })).status, 403);
    assert.equal((await request('/api/api-keys', { method: 'POST', body: { name: 'no-session' } })).status, 401);
    const created = await success(await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: 'Reader automation', expiresInDays: 30 } }));
    assert.match(created.secret, /^dsh_[a-zA-Z]{64}$/); assert.ok(created.key.id);
    const saved = await db.prepare('SELECT key, referenceId, permissions FROM apikey WHERE id = ?').bind(created.key.id).first();
    assert.notEqual(saved.key, created.secret); assert.equal(saved.referenceId, readerId); assert.deepEqual(JSON.parse(saved.permissions), { profile: ['read'] });
    const keys = await success(await request('/api/api-keys', { cookie: readerCookie }));
    assert.equal(keys.keys.length, 1); assert.doesNotMatch(JSON.stringify(keys), new RegExp(created.secret)); assert.equal(keys.keys[0].key, undefined);
    assert.equal((await request('/api/api-keys?limit=101', { cookie: readerCookie })).status, 400);
    const emptyPage = await success(await request('/api/api-keys?limit=1&offset=1', { cookie: readerCookie }));
    assert.equal(emptyPage.keys.length, 0); assert.equal(emptyPage.total, 1);
    assert.equal((await success(await request('/api/api-keys', { cookie: ownerCookie }))).keys.length, 0);
    assert.ok((await request(`/api/api-keys/${created.key.id}`, { method: 'DELETE', cookie: ownerCookie })).status >= 400, 'another account cannot revoke the key');
    const authorization = `Bearer ${created.secret}`;
    assert.deepEqual(await success(await request('/api/api-keys/whoami', { headers: { authorization } })), { id: readerId, email: 'reader@example.test' });
    await db.prepare('UPDATE apikey SET permissions = ? WHERE id = ?').bind(JSON.stringify({ profile: [] }), created.key.id).run();
    assert.equal((await request('/api/api-keys/whoami', { headers: { authorization } })).status, 401, 'verification requires the fixed profile:read permission');
    await db.prepare('UPDATE apikey SET permissions = ?, rateLimitMax = 3, requestCount = 0, lastRequest = NULL WHERE id = ?').bind(JSON.stringify({ profile: ['read'] }), created.key.id).run();
    const attempts = await Promise.all(Array.from({ length: 8 }, () => request('/api/api-keys/whoami', { headers: { authorization } })));
    assert.equal(attempts.filter(response => response.status === 200).length, 3, 'the database key limiter atomically admits the bounded concurrent budget');
    assert.equal(attempts.filter(response => response.status === 401).length, 5);
    await db.prepare('UPDATE apikey SET rateLimitMax = 60, requestCount = 0, lastRequest = NULL WHERE id = ?').bind(created.key.id).run();
    assert.equal(await (await request('/api/auth/get-session', { headers: { authorization } })).json(), null, 'API keys never become browser sessions');
    assert.equal((await request('/api/user-admin/users', { headers: { authorization } })).status, 401);
    await success(await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, body: { action: 'ban', userId: readerId, reason: 'Fixture action' } }));
    assert.equal(await (await request('/api/auth/get-session', { cookie: readerCookie })).json(), null);
    assert.equal((await request('/api/api-keys/whoami', { headers: { authorization } })).status, 401, 'banned accounts cannot use API keys');
    const bannedLogin = { method: 'POST', body: { username: 'readerfixture', password: 'fixture-reader-password' }, headers: { 'x-fixture-disable-admin': 'true' } };
    assert.equal((await request('/api/auth/sign-in/username', bannedLogin)).status, 403, 'disabling management never disables ban enforcement');
    await success(await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, body: { action: 'unban', userId: readerId } }));
    const login = await request('/api/auth/sign-in/username', { method: 'POST', body: bannedLogin.body }); await success(login); readerCookie = cookieFrom(login);
    await success(await request(`/api/api-keys/${created.key.id}`, { method: 'DELETE', cookie: readerCookie }));
    assert.equal((await request('/api/api-keys/whoami', { headers: { authorization } })).status, 401);
    const expiring = await success(await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: 'Expiry fixture', expiresInDays: 1 } }));
    await db.prepare('UPDATE apikey SET expiresAt = ? WHERE id = ?').bind(Date.now() - 1000, expiring.key.id).run();
    assert.equal((await request('/api/api-keys/whoami', { headers: { authorization: `Bearer ${expiring.secret}` } })).status, 401);
    assert.equal((await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: 'Bad scope', permissions: { admin: ['all'] } } })).status, 400);
    assert.equal((await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: 'x'.repeat(3000) } })).status, 413);
    assert.equal((await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, body: { action: 'ban', userId: readerId, reason: 'x'.repeat(5000) } })).status, 413);
    for (let index = 0; index < 3; index++) await success(await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: `Creation budget ${index}` } }));
    assert.equal((await request('/api/api-keys', { method: 'POST', cookie: readerCookie, body: { name: 'Creation budget exhausted' } })).status, 429, 'the wrapper retains the native database creation limit');
    assert.equal((await request('/api/api-keys', { cookie: readerCookie, headers: { 'x-fixture-disable-keys': 'true' } })).status, 503);
    await success(await request('/api/user-admin/actions', { method: 'POST', cookie: ownerCookie, body: { action: 'revoke-sessions', userId: readerId } }));
    assert.equal(await (await request('/api/auth/get-session', { cookie: readerCookie })).json(), null);
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
