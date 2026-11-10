import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyPluginSchema, pluginSchemas } from '../../../apps/web/scripts/plugin-schemas.mjs';

test('base schemas precede product schemas even when the product scope sorts first', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-schema-order-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseRoot = join(root, '.submodules/dsh-base');
  const write = (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };
  write(join(root, 'dsh.project.json'), { version: 1, base: '.submodules/dsh-base', namespace: 'aaa-product' });
  const pkg = (owner, suffix, sql) => {
    const scope = owner === baseRoot ? 'dsh-base' : 'aaa-product';
    const name = `@${scope}/cloudflare-worker-${suffix}`;
    const path = join(owner, 'packages/cloudflare-worker', suffix);
    write(join(path, 'package.json'), { name, exports: { '.': './src/index.ts' }, dshBase: { worker: { id: `cloudflare:worker:${scope}:${suffix}`, module: name } } });
    write(join(path, 'schema.sql'), sql);
    return name;
  };
  // Deliberately create the package directories in reverse alphabetical order.
  const baseZ = pkg(baseRoot, 'z-table', 'CREATE TABLE IF NOT EXISTS base_feature (id TEXT PRIMARY KEY);');
  const baseA = pkg(baseRoot, 'a-table', 'CREATE TABLE IF NOT EXISTS base_auxiliary (id TEXT PRIMARY KEY);');
  const productZ = pkg(root, 'z-index', 'CREATE INDEX IF NOT EXISTS product_label ON base_feature(label);');
  const productA = pkg(root, 'a-extension', 'ALTER TABLE base_feature ADD COLUMN label TEXT;');
  const schemas = pluginSchemas(root);
  assert.deepEqual(schemas.map(schema => schema.name), [baseA, baseZ, productA, productZ]);
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const query = async sql => database.prepare(sql).all();
  for (const schema of schemas) await applyPluginSchema(schema, query);
  database.prepare('INSERT INTO base_feature (id, label) VALUES (?, ?)').run('business', 'preserve me');
  // Persistent dev restarts re-check additive declarations without losing data.
  for (const schema of pluginSchemas(root)) await applyPluginSchema(schema, query);
  assert.equal(database.prepare('SELECT label FROM base_feature WHERE id = ?').get('business').label, 'preserve me');
  assert.equal(database.prepare("SELECT count(*) AS count FROM pragma_table_info('base_feature') WHERE name = 'label'").get().count, 1);
});
