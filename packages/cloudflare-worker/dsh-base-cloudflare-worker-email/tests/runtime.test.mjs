/** Real service and D1 in separate Workers; only the vendor transport is an in-process fixture. */
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

test('D1 serializes transactional email across isolates and survives restarts without duplicate delivery', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-email-'));
  const bundle = join(directory, 'worker.mjs');
  const built = await build({ stdin: { contents: `
    import { createEmailService } from ${JSON.stringify(resolve(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-email/src/service.ts'))};
    export default { async fetch(request, env) {
      const body = await request.json();
      const service = createEmailService(async (url, init) => {
        await env.AUTH_DB.prepare('INSERT INTO fixture_calls (id) VALUES (?)').bind(crypto.randomUUID()).run();
        if (body.mode === 'throw') throw new Error('private provider error');
        if (body.mode === 'reject') return new Response('private provider error', { status: 403 });
        return Response.json({ id: 'fixture-accepted-id' });
      });
      const runtime = body.disabled ? { ...env, EMAIL_ENABLED: 'false' } : env;
      try { return Response.json(await service.sendTransactional(runtime, body.input)); }
      catch (error) { return Response.json({ error: error.message }, { status: 503 }); }
    } };`, resolveDir: app, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', logLevel: 'silent' });
  writeFileSync(bundle, built.outputFiles[0].text);
  const options = () => convertV4MiniflareOptions({ resourcePersistencePath: join(directory, 'resources'),
    workers: ['email-a', 'email-b'].map(name => ({ name, modulesRoot: directory, modules: [{ type: 'ESModule', path: bundle }],
      compatibilityDate: '2026-10-30', d1Databases: { AUTH_DB: 'shared-email-database' },
      bindings: { AUTH_BASE_URL: 'https://app.example.test', EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'resend',
        EMAIL_FROM: 'account@example.test', RESEND_API_KEY: 'fixture-only-key' } })) });
  let mf = new Miniflare(options());
  const input = key => ({ kind: 'verify-email', to: 'person@example.test', actionUrl: `https://app.example.test/api/auth/verify-email?token=${key}`, idempotencyKey: key, locale: 'zh' });
  const send = async (worker, payload) => {
    const response = await worker.fetch(new Request('https://app.example.test/fixture', { method: 'POST', body: JSON.stringify(payload) }));
    return { status: response.status, ...await response.json() };
  };
  try {
    let db = await mf.getD1Database('AUTH_DB', 'email-a');
    for (const statement of readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
    await db.prepare('CREATE TABLE fixture_calls (id TEXT PRIMARY KEY)').run();
    let a = await mf.getWorker('email-a'), b = await mf.getWorker('email-b');
    const calls = async () => (await db.prepare('SELECT COUNT(*) AS count FROM fixture_calls').first()).count;
    assert.equal((await send(a, { input: input('disabled-secret'), disabled: true })).error, 'email_unavailable');
    assert.equal((await send(a, { input: { ...input('invalid-secret'), actionUrl: 'https://evil.example/' } })).error, 'email_invalid_intent');
    assert.equal(await calls(), 0);
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => send(i % 2 ? a : b, { input: input('same-auth-token') })));
    assert.equal(results.filter(result => result.status === 'accepted').length, 1);
    assert.ok(results.every(result => ['accepted', 'duplicate'].includes(result.status) || result.error === 'email_delivery_uncertain'));
    assert.equal(await calls(), 1);
    assert.equal((await send(b, { input: input('same-auth-token') })).status, 'duplicate');
    assert.equal((await send(a, { input: { ...input('same-auth-token'), to: 'other@example.test' } })).error, 'email_idempotency_conflict');
    assert.equal(await calls(), 1);
    for (const [mode, key, error] of [['throw', 'unknown-token', 'email_delivery_uncertain'], ['reject', 'rejected-token', 'email_send_failed']]) {
      assert.equal((await send(a, { input: input(key), mode })).error, error);
      const count = await calls();
      assert.equal((await send(b, { input: input(key) })).error, error);
      assert.equal(await calls(), count, 'an uncertain or rejected logical attempt must not trigger another vendor call');
    }
    const rows = await db.prepare('SELECT * FROM dsh_email_deliveries').all();
    assert.doesNotMatch(JSON.stringify(rows.results), /person@|same-auth-token|unknown-token|fixture-only-key|https:/);
    assert.equal(rows.results.length, 3);
    await mf.dispose(); mf = new Miniflare(options());
    db = await mf.getD1Database('AUTH_DB', 'email-a'); a = await mf.getWorker('email-a');
    assert.equal((await send(a, { input: input('same-auth-token') })).status, 'duplicate');
    assert.equal(await calls(), 3);
    await db.prepare('DROP TABLE dsh_email_deliveries').run();
    assert.equal((await send(a, { input: input('missing-schema-token') })).error, 'email_unavailable');
    assert.equal(await calls(), 3, 'missing schema fails before any provider traffic');
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
