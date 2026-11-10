/** Publish the selected prebuilt Worker and verify that exact version on base Web Staging. */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeploymentConfig, requireDeployableConfig } from '../../apps/web/scripts/deployment-config.mjs';

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

function run(executable, args, options) {
  const child = spawnSync(executable, args, { ...options, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    const error = new Error(`${executable} ${args[0]} failed (${child.status ?? child.signal})`);
    error.exitCode = child.status ?? 1;
    throw error;
  }
}

export function reportDeployFailure(error) {
  if (!Number.isInteger(error.exitCode)) throw error;
  console.error(error.message);
  process.exitCode = error.exitCode;
}

function publishedVersion(receipt, workerName, dryRun) {
  const records = receipt.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const deployments = records.filter(record => record.type === 'deploy');
  const [record] = deployments;
  if (deployments.length !== 1 || record.worker_name !== workerName || record.version !== 1 ||
      !(uuid.test(record.version_id) || (dryRun && record.version_id === null))) {
    throw new Error(`Expected one Cloudflare deployment receipt with the version ID for ${workerName}`);
  }
  return record.version_id;
}

export async function deployPrebuilt({ appRoot, deployment, baseWeb, env = process.env, args = [], beforeUpload, execute = run }) {
  const publishArgs = ['exec', 'cf', 'deploy', '--prebuilt', ...args];
  const staging = baseWeb && deployment.indexing.environment === 'staging';
  const flags = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  const info = flags.find(arg => ['--help', '-h', '--version', '-v'].includes(arg));
  if (info) {
    execute('pnpm', ['exec', 'cf', 'deploy', info], { cwd: appRoot, env });
    return;
  }
  const dryRunFlag = flags.findLast(arg => ['--dry-run', '--dry-run=true', '--dry-run=false', '--no-dry-run'].includes(arg));
  const dryRun = ['--dry-run', '--dry-run=true'].includes(dryRunFlag);
  if (baseWeb) {
    const worker = JSON.parse(readFileSync(join(appRoot, '.cloudflare/output/v0/workers/default/worker.config.json'), 'utf8'));
    const builtEnvironment = worker.env?.SITE_DEPLOYMENT_ENVIRONMENT?.value;
    if ((staging || builtEnvironment === 'staging') && (worker.name !== deployment.workerName ||
        worker.env?.AUTH_BASE_URL?.value !== deployment.authBaseUrl || builtEnvironment !== deployment.indexing.environment)) {
      throw new Error('Prebuilt Worker name, origin or environment does not match the selected Staging deployment');
    }
  }
  if (!staging) {
    if (!dryRun) await beforeUpload?.();
    execute('pnpm', publishArgs, { cwd: appRoot, env });
    return;
  }

  const acceptance = join(appRoot, 'scripts/acceptance-cross-workspace-deployed.mjs');
  const acceptanceEnv = { ...env, DSH_BASE_URL: deployment.authBaseUrl };
  if (!dryRun) execute(process.execPath, [acceptance, '--preflight'], { cwd: appRoot, env: acceptanceEnv });
  if (!dryRun) await beforeUpload?.();

  // The pinned cf CLI writes one newline-delimited Wrangler "deploy" record after publishing.
  // A private file ties it to this invocation even when two deploys run concurrently.
  const folder = mkdtempSync(join(tmpdir(), 'dsh-deploy-'));
  const receipt = join(folder, 'deploy.jsonl');
  let version;
  try {
    execute('pnpm', publishArgs, { cwd: appRoot, env: { ...env, WRANGLER_OUTPUT_FILE_PATH: receipt } });
    version = publishedVersion(readFileSync(receipt, 'utf8'), deployment.workerName, dryRun);
  } finally {
    try {
      // Keep the CLI output contract for operators already collecting Wrangler's deploy receipts.
      const destination = env.WRANGLER_OUTPUT_FILE_PATH || (env.WRANGLER_OUTPUT_FILE_DIRECTORY &&
        join(env.WRANGLER_OUTPUT_FILE_DIRECTORY, `${basename(folder)}.jsonl`));
      if (destination && existsSync(receipt)) {
        const path = resolve(appRoot, destination);
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, readFileSync(receipt));
      }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
  if (version === null) return;
  console.log(`Verifying deployed Staging Worker ${deployment.workerName} at version ${version}`);
  execute(process.execPath, [acceptance], { cwd: appRoot, env: { ...acceptanceEnv, DSH_EXPECTED_DEPLOYMENT_VERSION: version } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
  const deployment = requireDeployableConfig(readDeploymentConfig());
  const args = process.argv.slice(2);
  const includeSchema = args[0] === '--apply-web-schema';
  await deployPrebuilt({
    appRoot, deployment, baseWeb: true, args: includeSchema ? args.slice(1) : args,
    beforeUpload: includeSchema ? () => run('pnpm', ['run', 'schema:plugins'], { cwd: appRoot }) : undefined,
  }).catch(reportDeployFailure);
}
