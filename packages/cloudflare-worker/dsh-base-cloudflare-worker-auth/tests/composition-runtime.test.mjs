/** Actual pinned Cordis fibers and static loader, with real auth extension plugins. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url)), app = join(root, 'apps/web');
const { build } = createRequire(join(app, 'package.json'))('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
test('actual Cordis composition activates optional email and disposes auth extensions', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-auth-composition-')), bundle = join(directory, 'worker.mjs');
  const plugin = name => JSON.stringify(resolve(root, `packages/cloudflare-worker/dsh-base-cloudflare-worker-${name}/src/index.ts`));
  const result = await build({ stdin: { contents: `
    import { Context } from '@deepseek-ai/cordis';
    import { bootStaticPlugins } from ${JSON.stringify(resolve(root, 'packages/boot/plugin-loader-static/src/index.ts'))};
    import * as auth from ${plugin('auth')};
    import * as publicPages from ${plugin('public-pages')};
    import * as google from ${plugin('google-auth')};
    import * as admin from ${plugin('user-admin')};
    import * as keys from ${plugin('api-keys')};
    export default { async fetch(request, env) {
      const ctx = new Context(), handlers = new Set();
      const http = { name: '@dsh-base/fixture-http', apply(ctx) { ctx.provide('http', { use(fn) { handlers.add(fn); return () => handlers.delete(fn); }, useResponse() { return () => {}; } }); } };
      const email = { name: '@dsh-base/fixture-email', apply(ctx) { ctx.provide('email', { ready() { return true; }, status() { return { enabled: true, ready: true, provider: 'resend' }; }, async sendTransactional() { throw new Error('external mail forbidden'); } }); } };
      const modules = [http, publicPages, ...(new URL(request.url).searchParams.has('email') ? [email] : []), auth, google, admin, keys];
      try {
        const loader = await bootStaticPlugins(ctx, { entries: modules.map(module => ({ id: module.name, name: module.name, disabled: false, origin: 'custom' })),
          modules: Object.fromEntries(modules.map(module => [module.name, { load: async () => module }])) });
        const policy = async () => (await ctx.auth.handle(new Request('https://localhost/api/auth-policy'), env)).json();
        const initial = { entries: loader.entries(), policy: await policy(), handlers: handlers.size, apiKeys: Boolean(ctx.get('apiKeys')) };
        await loader.update(google.name, { disabled: true });
        const withoutGoogle = await policy();
        await loader.update(google.name, { disabled: false });
        const restoredGoogle = await policy();
        let mailCycle;
        if (modules.includes(email)) {
          await loader.update(email.name, { disabled: true });
          const removedMail = await policy();
          await loader.update(email.name, { disabled: false });
          mailCycle = { removed: removedMail.email.ready, restored: (await policy()).email.ready };
        }
        await loader.update(admin.name, { disabled: true });
        await loader.update(keys.name, { disabled: true });
        const removed = { policy: await policy(), handlers: handlers.size, apiKeys: Boolean(ctx.get('apiKeys')) };
        await ctx.fiber.dispose();
        return Response.json({ initial, withoutGoogle, restoredGoogle, mailCycle, removed, disposedHandlers: handlers.size });
      } finally { await ctx.fiber.dispose(); }
    } };`, loader: 'ts', resolveDir: app }, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], nodePaths: [join(app, 'node_modules')],
    // Match the production export-to-pinned-source mapping; neither checkout is copied or edited.
    alias: { '@deepseek-ai/cordis': resolve(root, '.submodules/deepseek-harness/vendor/cordis/src/index.ts'), '@deepseek-ai/cosmokit': resolve(root, '.submodules/deepseek-harness/vendor/cosmokit/src/index.ts') },
    external: ['node:*', 'cloudflare:workers'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  writeFileSync(bundle, result.outputFiles[0].text);
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'composition', modulesRoot: directory, modules: [{ type: 'ESModule', path: bundle }],
    compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'], outboundService: () => { throw new Error('external network forbidden'); },
    bindings: { AUTH_BASE_URL: 'https://localhost', AUTH_GOOGLE_ENABLED: 'true', GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-secret', USER_ADMIN_ENABLED: 'true', API_KEYS_ENABLED: 'true' } }] }));
  try {
    for (const withEmail of [false, true]) {
      const response = await mf.dispatchFetch(`https://localhost/${withEmail ? '?email' : ''}`);
      assert.equal(response.status, 200, await response.clone().text());
      const value = await response.json();
      assert.ok(value.initial.entries.every(entry => entry.fiberPhase === 'active' && entry.origin === 'custom'));
      assert.equal(value.initial.entries.length, withEmail ? 7 : 6);
      assert.equal(value.initial.policy.email.ready, withEmail);
      assert.equal(value.initial.policy.googleEnabled, true); assert.equal(value.initial.policy.userAdminEnabled, true); assert.equal(value.initial.policy.apiKeysEnabled, true);
      assert.equal(value.initial.handlers, 4); assert.equal(value.initial.apiKeys, true);
      assert.equal(value.withoutGoogle.googleEnabled, false); assert.equal(value.restoredGoogle.googleEnabled, true);
      if (withEmail) assert.deepEqual(value.mailCycle, { removed: false, restored: true });
      assert.equal(value.removed.policy.userAdminEnabled, undefined); assert.equal(value.removed.policy.apiKeysEnabled, undefined);
      assert.equal(value.removed.handlers, 2); assert.equal(value.removed.apiKeys, false); assert.equal(value.disposedHandlers, 0);
    }
  } finally { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
