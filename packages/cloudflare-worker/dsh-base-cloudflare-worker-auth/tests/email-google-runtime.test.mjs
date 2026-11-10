/** Real Better Auth, D1 and Google authorization setup; mail delivery is a local service fixture. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createSign } from 'node:crypto';

const root = fileURLToPath(new URL('../../../../', import.meta.url)), app = join(root, 'apps/web');
const { build } = createRequire(join(app, 'package.json'))('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
test('email verification, reset, revocation and OAuth use real auth with no external messages', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-auth-mail-')), bundle = join(directory, 'worker.mjs');
  const source = await build({ stdin: { contents: `
    import { apply } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/src/index.ts'))};
    import { apply as google } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-google-auth/src/index.ts'))};
    let handler;
    import { createPublicPages } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/src/index.ts'))};
    const ctx = { publicPages: createPublicPages(), inject(names, setup) { if (names.every(name => this[name])) setup(this); }, http: { use(value) { handler = value; return () => {}; } }, effect(fn) { fn(); }, provide(name, value) { this[name] = value; }, get(name) { return this[name]; },
      siteAnalytics: { async recordConversion(env, input) { await env.AUTH_DB.prepare('INSERT INTO fixture_mail (kind, input) VALUES (?, ?)').bind('analytics-signup', JSON.stringify(input)).run(); return {status:'recorded'}; } },
      email: { ready(env) { return env.EMAIL_ENABLED === 'true'; }, status(env) { return { enabled: env.EMAIL_ENABLED === 'true', ready: env.EMAIL_ENABLED === 'true', provider: 'resend' }; },
        async sendTransactional(env, input) { await env.AUTH_DB.prepare('INSERT INTO fixture_mail (kind, input) VALUES (?, ?)').bind(input.kind, JSON.stringify(input)).run(); return { status: 'accepted', provider: 'resend' }; } } };
    apply(ctx); google(ctx);
    export default { async fetch(request, env) { if (request.headers.has('x-fixture-disabled-email')) env = { ...env, EMAIL_ENABLED: 'false' };
      return await handler(request, env) ?? new Response('not found', { status: 404 }); } };`, loader: 'ts', resolveDir: app },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'], nodePaths: [join(app, 'node_modules')], external: ['node:*', 'cloudflare:workers'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  writeFileSync(bundle, source.outputFiles[0].text);
  const outbound = [];
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-google-key', use: 'sig', alg: 'RS256' };
  let vendorMode = 'deny', nonce;
  const idToken = () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'fixture.apps.googleusercontent.com', sub: 'fixture-google-subject',
      email: 'google-user@example.test', email_verified: true, name: 'Google fixture', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...(nonce ? { nonce } : {}) })).toString('base64url');
    const data = `${header}.${payload}`;
    return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey, 'base64url')}`;
  };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'auth-mail', modulesRoot: directory, modules: [{ type: 'ESModule', path: bundle }],
    compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'], stripCfConnectingIp: false, d1Databases: ['AUTH_DB'],
    outboundService: async request => {
      outbound.push(request.url);
      if (request.url === 'https://oauth2.googleapis.com/token') {
        if (vendorMode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://outside.example/steal' } });
        if (vendorMode === 'accept') {
          const fields = new URLSearchParams(await request.text());
          assert.equal(fields.get('client_id'), 'fixture.apps.googleusercontent.com');
          assert.ok(fields.get('code_verifier'));
          return Response.json({ access_token: 'fixture-google-access', token_type: 'Bearer', expires_in: 300, id_token: idToken() });
        }
      }
      if (vendorMode === 'accept' && request.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      return new Response('network disabled', { status: 503 });
    },
    bindings: { AUTH_BASE_URL: 'https://localhost', AUTH_SECRET: 'fixture-auth-secret-with-at-least-32-characters', AUTH_SIGNUP_ENABLED: 'true',
      EMAIL_ENABLED: 'true', AUTH_EMAIL_VERIFICATION_REQUIRED: 'true', AUTH_GOOGLE_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-google-secret' } }] }));
  const call = (path, body, headers = {}) => mf.dispatchFetch(`https://localhost${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { origin: 'https://localhost', 'cf-connecting-ip': '192.0.2.45', 'accept-language': 'zh', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const db = await mf.getD1Database('AUTH_DB');
    for (const file of readdirSync(join(app, 'migrations')).filter(name => /^000[12]_.*\.sql$/.test(name)).sort()) {
      for (const statement of readFileSync(join(app, 'migrations', file), 'utf8').replace(/--[^\n]*/g, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
    }
    await db.prepare('CREATE TABLE fixture_mail (id INTEGER PRIMARY KEY, kind TEXT, input TEXT)').run();
    const captured = async kind => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const row = await db.prepare('SELECT input FROM fixture_mail WHERE kind = ? ORDER BY id DESC LIMIT 1').bind(kind).first();
        if (row) return JSON.parse(row.input);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`no fixture mail ${kind}`);
    };
    const policy = await (await call('/api/auth-policy')).json();
    assert.equal(policy.googleEnabled, true); assert.equal(policy.emailVerificationRequired, true);
    const user = { username: 'emailfixture', name: 'Email fixture', email: 'mail@example.test', password: 'old-fixture-password-123', callbackURL: 'https://localhost/login?verified=1' };
    const signup = await call('/api/auth/sign-up/email', user, { 'x-dsh-analytics-consent': 'granted', 'x-dsh-analytics-campaign': 'launch' }); assert.equal(signup.status, 200, await signup.clone().text());
    const registered = await signup.json(); assert.equal(registered.token, null); assert.equal(signup.headers.get('set-cookie'), null);
    assert.deepEqual(await captured('analytics-signup'), {name:'sign_up',dedupeKey:`signup:${registered.user.id}`,consent:true,campaign:'launch'}, 'only successful server account creation emits the consented event');
    const mail = await captured('verify-email'); assert.equal(mail.locale, 'zh'); assert.equal(mail.to, user.email);
    assert.equal((await call('/api/auth/sign-in/username', { username: user.username, password: user.password })).status, 403);
    const verification = await call(new URL(mail.actionUrl).pathname + new URL(mail.actionUrl).search);
    assert.equal(verification.status, 302); assert.equal(verification.headers.get('location'), user.callbackURL);
    const login = await call('/api/auth/sign-in/username', { username: user.username, password: user.password });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie);
    const redirectTo = 'https://localhost/login?mode=reset-password';
    const existingReset = await call('/api/auth/request-password-reset', { email: user.email, redirectTo });
    assert.equal(existingReset.status, 200);
    // Consume each Miniflare response before another request gives undici's
    // response finalizer a chance to cancel the wrapped, still-unread stream.
    const existingResetBody = await existingReset.json();
    const missingReset = await call('/api/auth/request-password-reset', { email: 'absent@example.test', redirectTo });
    assert.equal(missingReset.status, 200);
    const missingResetBody = await missingReset.json();
    assert.deepEqual(existingResetBody, missingResetBody, 'anonymous response cannot reveal account existence');
    const reset = await captured('reset-password');
    const token = reset.idempotencyKey;
    const resetCallback = await call(new URL(reset.actionUrl).pathname + new URL(reset.actionUrl).search);
    assert.equal(resetCallback.status, 302); assert.equal(new URL(resetCallback.headers.get('location')).searchParams.get('token'), token);
    const changed = await call('/api/auth/reset-password', { token, newPassword: 'new-fixture-password-456' });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await call('/api/auth/reset-password', { token, newPassword: 'another-password-789' })).status, 400);
    assert.equal(await (await call('/api/auth/get-session', undefined, { cookie })).json(), null, 'reset revokes previous sessions');
    assert.equal((await call('/api/auth/sign-in/username', { username: user.username, password: user.password })).status, 401);
    assert.equal((await call('/api/auth/sign-in/username', { username: user.username, password: 'new-fixture-password-456' })).status, 200);
    const google = await call('/api/auth/sign-in/social', { provider: 'google', callbackURL: 'https://localhost/', disableRedirect: true });
    assert.equal(google.status, 200, await google.clone().text());
    const authorization = new URL((await google.json()).url);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('client_id'), 'fixture.apps.googleusercontent.com');
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://localhost/api/auth/callback/google');
    assert.ok(authorization.searchParams.get('state')); assert.ok(authorization.searchParams.get('code_challenge'));
    const forged = await call('/api/auth/callback/google?state=forged&code=forged');
    assert.ok(forged.status >= 300); assert.equal(outbound.length, 0, 'invalid OAuth state is rejected before any external token request');
    const googleCookie = google.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    vendorMode = 'redirect';
    const refused = await call(`/api/auth/callback/google?state=${encodeURIComponent(authorization.searchParams.get('state'))}&code=fixture-code`, undefined, { cookie: googleCookie });
    assert.ok(refused.status >= 300);
    assert.deepEqual(outbound, ['https://oauth2.googleapis.com/token'], 'real Worker fetch refuses the token endpoint redirect');
    vendorMode = 'accept';
    const secondGoogle = await call('/api/auth/sign-in/social', { provider: 'google', callbackURL: 'https://localhost/', disableRedirect: true });
    const secondAuthorization = new URL((await secondGoogle.json()).url);
    nonce = secondAuthorization.searchParams.get('nonce');
    const secondCookie = secondGoogle.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const signedGoogle = await call(`/api/auth/callback/google?state=${encodeURIComponent(secondAuthorization.searchParams.get('state'))}&code=fixture-code`, undefined, { cookie: secondCookie });
    assert.equal(signedGoogle.status, 302); assert.equal(signedGoogle.headers.get('location'), 'https://localhost/');
    const socialCookie = signedGoogle.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const socialSession = await (await call('/api/auth/get-session', undefined, { cookie: socialCookie })).json();
    assert.equal(socialSession.user.email, 'google-user@example.test'); assert.equal(socialSession.user.emailVerified, true);
    assert.equal(outbound.filter(url => url === 'https://oauth2.googleapis.com/token').length, 2,
      'the valid authorization code completes the real Worker token exchange and creates a session');
    assert.equal((await call('/api/auth/sign-in/social', { provider: 'google', idToken: { token: 'forged' } })).status, 400);
    assert.equal((await call('/api/auth/request-password-reset', { email: user.email, redirectTo }, { 'x-fixture-disabled-email': 'true' })).status, 503);
    assert.equal((await call('/api/auth/sign-up/email', { ...user, username: 'blockedmail', email: 'blocked@example.test' }, { 'x-fixture-disabled-email': 'true' })).status, 503);
    assert.equal((await call('/api/auth/request-password-reset', { email: user.email, redirectTo: 'https://evil.example' }, { 'cf-connecting-ip': '192.0.2.46' })).status, 403);
    assert.ok(outbound.every(url => ['https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v3/certs'].includes(url)), 'all OAuth traffic terminates in the fixture service');
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
