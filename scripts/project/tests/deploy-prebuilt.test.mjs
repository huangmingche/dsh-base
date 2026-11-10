import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deployPrebuilt } from '../deploy-prebuilt.mjs';

const version = '12345678-1234-4321-9876-0123456789ab';
function fixture(t, environment = 'staging') {
  const appRoot = mkdtempSync(join(tmpdir(), 'dsh-release-test-'));
  t.after(() => rmSync(appRoot, { recursive: true, force: true }));
  const worker = 'test-staging', origin = 'https://test-staging.example.org';
  const deployment = { workerName: worker, authBaseUrl: origin, indexing: { environment } };
  const directory = join(appRoot, '.cloudflare/output/v0/workers/default');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'worker.config.json'), JSON.stringify({
    name: worker, env: { AUTH_BASE_URL: { value: origin }, SITE_DEPLOYMENT_ENVIRONMENT: { value: environment } },
  }));
  const record = { type: 'deploy', version: 1, worker_name: worker, version_id: version };
  return { appRoot, deployment, baseWeb: true, record, env: { DSH_EXPECTED_DEPLOYMENT_VERSION: 'old' } };
}

test('Staging checks its fixtures before schema changes and reports the exact version from this publish', async t => {
  const config = fixture(t), calls = [];
  const callerOutput = join(config.appRoot, 'operator.jsonl');
  config.env.WRANGLER_OUTPUT_FILE_PATH = callerOutput;
  writeFileSync(callerOutput, 'previous line\n');
  const args = ['--tag', 'test-tag', '--message', 'test message', '--secrets-file', '/test/secret-file'];
  let receipt;
  await deployPrebuilt({ ...config, args, beforeUpload: () => calls.push('schema'),
    execute(exe, options, { cwd, env }) {
      assert.equal(cwd, config.appRoot);
      if (exe === 'pnpm') {
        calls.push('upload');
        assert.deepEqual(options, ['exec', 'cf', 'deploy', '--prebuilt', ...args]);
        receipt = env.WRANGLER_OUTPUT_FILE_PATH;
        assert.notEqual(receipt, callerOutput);
        writeFileSync(receipt, `{"type":"other"}\n${JSON.stringify(config.record)}\n`);
      } else {
        assert.equal(options[0], join(cwd, 'scripts/acceptance-cross-workspace-deployed.mjs'));
        assert.equal(env.DSH_BASE_URL, config.deployment.authBaseUrl);
        if (options.includes('--preflight')) calls.push('preflight');
        else { assert.equal(env.DSH_EXPECTED_DEPLOYMENT_VERSION, version); calls.push('browser'); }
      }
    },
  });
  assert.deepEqual(calls, ['preflight', 'schema', 'upload', 'browser']);
  assert.equal(existsSync(receipt), false);
  assert.equal(readFileSync(callerOutput, 'utf8'), `previous line\n{"type":"other"}\n${JSON.stringify(config.record)}\n`);
});

test('downstream, other applications, and production publish directly without using base Staging credentials', async t => {
  for (const [baseWeb, environment] of [[false, 'staging'], [true, 'production']]) {
    const config = fixture(t, environment);
    const calls = [];
    await deployPrebuilt({ ...config, baseWeb, beforeUpload: () => calls.push('schema'),
      execute(executable, args, { env }) {
        assert.equal(env, config.env); assert.deepEqual(args, ['exec', 'cf', 'deploy', '--prebuilt']); calls.push(executable);
      },
    });
    assert.deepEqual(calls, ['schema', 'pnpm']);
  }
});

test('a refused preflight, failed upload, or failing post-deploy regression fails the command at that stage', async t => {
  for (const stop of ['preflight', 'upload', 'browser']) {
    const config = fixture(t), calls = [];
    const phases = ['preflight', 'upload', 'browser'];
    await assert.rejects(deployPrebuilt({ ...config, execute(exe, args, { env }) {
      const stage = exe === 'pnpm' ? 'upload' : args.includes('--preflight') ? 'preflight' : 'browser';
      calls.push(stage);
      if (stage === stop) throw new Error(stop);
      if (stage === 'upload') writeFileSync(env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify(config.record));
    } }), new RegExp(stop));
    assert.deepEqual(calls, phases.slice(0, phases.indexOf(stop) + 1));
  }
});

test('mismatched prebuilt identity fails before upload, and malformed or ambiguous deploy receipts cannot certify an older version', async t => {
  const config = fixture(t);
  await assert.rejects(deployPrebuilt({ ...config, deployment: { ...config.deployment, workerName: 'wrong' },
    execute: () => assert.fail('unexpected call') }), /Prebuilt Worker/);
  await assert.rejects(deployPrebuilt({ ...config, deployment: { ...config.deployment, indexing: { environment: 'production' } },
    execute: () => assert.fail('unexpected call') }), /Prebuilt Worker/);
  for (const records of [[], [{ ...config.record, version_id: null }], [{ ...config.record, worker_name: 'wrong' }], [config.record, config.record]]) {
    await assert.rejects(deployPrebuilt({ ...config, execute(exe, args, { env }) {
      if (exe === 'pnpm') writeFileSync(env.WRANGLER_OUTPUT_FILE_PATH, records.map(record => JSON.stringify(record)).join('\n'));
      else assert.ok(args.includes('--preflight'));
    } }), /one Cloudflare deployment receipt/);
  }
});

test('cf --dry-run with its null version receipt does not run live browser acceptance', async t => {
  const config = fixture(t);
  await deployPrebuilt({ ...config, args: ['--dry-run'], beforeUpload: () => assert.fail('unexpected schema write'), execute(exe, args, { env }) {
    assert.equal(exe, 'pnpm'); assert.ok(args.includes('--dry-run'));
    writeFileSync(env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ ...config.record, version_id: null }));
  } });
});

test('a help or version request never applies schemas or publishes', async t => {
  const config = fixture(t);
  for (const flag of ['--help', '--version']) {
    await deployPrebuilt({ ...config, args: ['--tag', 'example', flag], beforeUpload: () => assert.fail('unexpected schema write'),
      execute(exe, args) { assert.equal(exe, 'pnpm'); assert.deepEqual(args, ['exec', 'cf', 'deploy', flag]); },
    });
  }
});
