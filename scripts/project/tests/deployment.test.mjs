import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { productDeploymentPath, readProductDeployment } from '../deployment.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-product-deployment-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  const config = { workerName: 'fixture-product', authDatabaseName: 'fixture-product-auth', filesBucket: 'fixture-product-files', authBaseUrl: 'https://fixture-product.example.com' };
  const write = (file, contents) => writeFileSync(join(root, file), JSON.stringify(contents));
  write('apps/web/deployment.example.json', config);
  return { root, config, write };
}

test('fresh clone and CI retain the product identity without ignored local configuration', t => {
  const { root } = fixture(t);
  assert.equal(productDeploymentPath(root, {}), join(root, 'apps/web/deployment.example.json'));
  const deployment = readProductDeployment(root, { env: {} });
  assert.equal(deployment.workerName, 'fixture-product');
  assert.equal(deployment.authDatabaseName, 'fixture-product-auth');
  assert.equal(deployment.filesBucket, 'fixture-product-files');
  assert.throws(() => readProductDeployment(root, { env: {}, requireDeployable: true }), /explicit.*database id|D1/);
});

test('operator configuration takes precedence and an explicit missing path never falls back', t => {
  const { root, config, write } = fixture(t);
  write('apps/web/deployment.local.json', { ...config, workerName: 'local-product' });
  write('operator.json', { ...config, workerName: 'operator-product' });
  assert.equal(readProductDeployment(root, { env: {} }).workerName, 'local-product');
  assert.equal(readProductDeployment(root, { env: { DSH_DEPLOYMENT_CONFIG: 'operator.json' } }).workerName, 'operator-product');
  assert.throws(() => readProductDeployment(root, { env: { DSH_DEPLOYMENT_CONFIG: 'missing.json' } }), /configuration is missing/);
  rmSync(join(root, 'apps/web/deployment.local.json'));
  rmSync(join(root, 'apps/web/deployment.example.json'));
  assert.throws(() => readProductDeployment(root, { env: {} }), /configuration is missing/);
});

test('deployment accepts explicit product environment values and rejects template resource reuse', t => {
  const { root, config, write } = fixture(t);
  const env = { DSH_AUTH_BASE_URL: 'https://product.invalid', DSH_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111' };
  assert.equal(readProductDeployment(root, { env, requireDeployable: true }).authBaseUrl, env.DSH_AUTH_BASE_URL);
  assert.throws(() => readProductDeployment(root, { env: { ...env, DSH_WORKER_NAME: 'dsh-base' }, requireDeployable: true }), /independent resource/);
  write('apps/web/deployment.example.json', { ...config, filesBucket: 'dsh-base-files' });
  assert.throws(() => readProductDeployment(root, { env }), /independent resource/);
});

test('selection reads its own deployment and rejects resource reuse across applications', t => {
  const { root, config, write } = fixture(t);
  mkdirSync(join(root, 'apps/admin'));
  write('dsh.apps.json', { version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] });
  const admin = { workerName: 'fixture-admin', authDatabaseName: 'fixture-admin-auth', filesBucket: 'fixture-admin-files', authBaseUrl: 'https://fixture-admin.example.com' };
  write('apps/admin/deployment.example.json', admin);
  assert.equal(readProductDeployment(root, { env: {}, app: 'admin' }).workerName, admin.workerName);
  assert.equal(productDeploymentPath(root, { DSH_APP: 'admin' }), join(root, 'apps/admin/deployment.example.json'));
  for (const key of ['workerName', 'authDatabaseName', 'filesBucket', 'authBaseUrl']) {
    write('apps/admin/deployment.example.json', { ...admin, [key]: config[key] });
    assert.throws(() => readProductDeployment(root, { env: {}, app: 'admin' }), new RegExp(`shares ${key} with web`));
  }
  write('apps/admin/deployment.example.json', admin);
  const databaseId = 'abcdefab-1111-4111-8111-111111111111';
  write('apps/web/deployment.example.json', { ...config, authDatabaseId: databaseId });
  assert.throws(() => readProductDeployment(root, { app: 'admin', env: { DSH_D1_DATABASE_ID: databaseId.toUpperCase() } }), /shares authDatabaseId/);
  assert.equal(readProductDeployment(root, { app: 'admin', env: { DSH_WORKER_NAME: 'selected-override' } }).workerName, 'selected-override');
});
