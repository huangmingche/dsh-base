import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyProductSchemas } from '../schemas.mjs';
import { localDevelopmentPaths } from '../development.mjs';

test('first local dev applies base auth before base and product schemas and preserves data on restart', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-schema-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const write = (path, value) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  write('dsh.project.json', { version: 1, base: '.submodules/dsh-base', namespace: 'fixture-product' });
  write('.submodules/dsh-base/apps/web/migrations/0001_auth.sql', 'CREATE TABLE "user" ("id" TEXT PRIMARY KEY);');
  write('.submodules/dsh-base/apps/web/migrations/0002_username.sql', 'ALTER TABLE "user" ADD COLUMN "username" TEXT; CREATE UNIQUE INDEX "username_idx" ON "user" ("username");');
  write('.submodules/dsh-base/packages/cloudflare-worker/settings/package.json', { name: '@dsh-base/cloudflare-worker-settings', exports: { '.': './src/index.ts' }, dshBase: { worker: { id: 'cloudflare:worker:settings' } } });
  write('.submodules/dsh-base/packages/cloudflare-worker/settings/schema.sql', 'ALTER TABLE "user" ADD COLUMN "role" TEXT; CREATE TABLE IF NOT EXISTS dsh_site_settings (id TEXT PRIMARY KEY);');
  write('packages/cloudflare-worker/notes/package.json', { name: '@fixture-product/cloudflare-worker-notes', exports: { '.': './src/index.ts' }, dshBase: { worker: { id: 'cloudflare:worker:fixture-product:notes' } } });
  write('packages/cloudflare-worker/notes/schema.sql', 'CREATE TABLE IF NOT EXISTS product_notes (id TEXT PRIMARY KEY);');
  const query = async sql => db.prepare(sql).all();
  assert.equal(await applyProductSchemas(root, query), 4);
  db.prepare('INSERT INTO "user" (id, username, role) VALUES (?, ?, ?)').run('one', 'existing-user', 'member');
  assert.equal(await applyProductSchemas(root, query), 4);
  assert.equal(db.prepare('SELECT username FROM "user" WHERE id = ?').get('one').username, 'existing-user');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='product_notes'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='dsh_site_settings'").get());
});

test('local app databases have independent persistence and cannot follow another app state symlink', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-app-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/web/.cloudflare'), { recursive: true });
  mkdirSync(join(root, 'apps/admin'), { recursive: true });
  writeFileSync(join(root, 'dsh.apps.json'), JSON.stringify({ version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] }));
  const web = localDevelopmentPaths(root, { app: 'web' }), admin = localDevelopmentPaths(root, { app: 'admin' });
  assert.notEqual(web.resourcePersistencePath, admin.resourcePersistencePath);
  assert.match(admin.resourcePersistencePath, /apps\/admin\/\.cloudflare\/state\/v3$/);
  symlinkSync(join(root, 'apps/web/.cloudflare'), join(root, 'apps/admin/.cloudflare'));
  assert.throws(() => localDevelopmentPaths(root, { app: 'admin' }), /cannot traverse symbolic links/);
});
