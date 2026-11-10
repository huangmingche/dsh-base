#!/usr/bin/env node
/** Shared product commands. Application features remain in composed plugins. */
import { spawnSync } from 'node:child_process';
import { prepareLocalDevelopmentDatabase } from './development.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyProject } from '../composition/project-context.mjs';
import { checkBoundaries } from '../conformance/check-plugin-boundaries.mjs';
import { checkOfficialReuse } from '../conformance/check-official-reuse.mjs';
import { checkOfficialUiCoverage } from '../conformance/check-official-ui-coverage.mjs';
import { checkChatParity } from '../conformance/check-chat-parity.mjs';
import { auditPacks } from '../composition/packs.mjs';
import { readClientMetadataRows, readWorkerMetadataRows, readAgentMetadataRows } from '../composition/metadata-roster.mjs';
import { baseDependencies } from './dependencies.mjs';
import { productDeploymentPath, readProductDeployment } from './deployment.mjs';
import { deployPrebuilt, reportDeployFailure } from './deploy-prebuilt.mjs';
import { applyProductSchemas } from './schemas.mjs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applicationContext, readApplications } from '../composition/applications.mjs';

export function commandOptions(args) {
  const [command, ...flags] = args;
  if (!['prepare', 'check', 'build', 'dev', 'deploy'].includes(command)) throw new Error('Usage: run.mjs prepare|check|build|dev|deploy [--app ID | --all]');
  let app, all = false;
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === '--app' && !app && flags[index + 1] && !flags[index + 1].startsWith('--')) app = flags[++index];
    else if (flags[index] === '--all' && !all) all = true;
    else throw new Error('Expected --app ID or --all');
  }
  if (app && all) throw new Error('--app and --all cannot be combined');
  if (all && ['dev', 'deploy'].includes(command)) throw new Error(`${command} requires one selected application; --all is not supported`);
  return { command, app, all };
}

export async function runProduct(args = process.argv.slice(2), environment = process.env) {
const { command, app, all } = commandOptions(args);
const project = verifyProject(resolve(environment.DSH_PRODUCT_ROOT ?? process.cwd()));
const { productRoot, baseRoot, namespace } = project;
if (all) {
  if (Object.keys(environment).some(key => key === 'DSH_DEPLOYMENT_CONFIG' || /^DSH_(?:WORKER_NAME|D1_|R2_|AUTH_BASE_URL|SAAS_JSON|INDEXING_JSON)/u.test(key))) {
    throw new Error('--all requires per-application deployment files; shared deployment overrides could select the wrong resources');
  }
  for (const selected of readApplications(productRoot).apps) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), command, '--app', selected.id], {
      cwd: productRoot, env: { ...environment, DSH_PRODUCT_ROOT: productRoot, DSH_APP: selected.id }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${selected.id}: ${command} failed (${result.status ?? result.signal})`);
  }
  return;
}
const context = applicationContext(productRoot, { app, env: environment });
const { appRoot, appId } = context;
const env = { ...environment, DSH_PRODUCT_ROOT: productRoot, DSH_APP: appId,
  DSH_DEPLOYMENT_CONFIG: productDeploymentPath(productRoot, environment, undefined, { app: appId }) };
// Validate deployment identity before build tools or schema commands can access resources.
const deployment = readProductDeployment(productRoot, { app: appId, env, requireDeployable: command === 'deploy' });
if (command === 'dev' && !existsSync(join(appRoot, '.dev.vars'))) throw new Error(`Local development requires ${context.appPath}/.dev.vars with newly generated development secrets; see AGENTS.md`);
const run = (executable, args, cwd = productRoot) => {
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} ${args[0]} failed (${result.status ?? result.signal})`);
};
const node = path => run(process.execPath, [join(baseRoot, path)]);
const requirePass = (label, result) => {
  const failures = result.failures ?? result.errors;
  if (failures.length) throw new Error(`${label}:\n${failures.join('\n')}`);
  console.log(`${label}: passed`);
};
if (context.consumer) {
const expectedDependencies = baseDependencies(baseRoot, namespace, readApplications(productRoot), productRoot);
const savedDependencies = JSON.parse(readFileSync(join(productRoot, 'dsh.dependencies.json'), 'utf8'));
if (!isDeepStrictEqual(expectedDependencies, savedDependencies)) throw new Error('Base dependencies changed. Run pnpm dsh:update to reconcile the product manifests and lockfile before building.');
const productManifest = JSON.parse(readFileSync(join(productRoot, 'package.json'), 'utf8'));
if (productManifest.packageManager !== expectedDependencies.packageManager || readFileSync(join(productRoot, 'pnpm-workspace.yaml'), 'utf8') !== expectedDependencies.workspace) throw new Error('Product package manager and workspace policy must match the pinned dependency contract');
for (const [kind, file] of [...readApplications(productRoot).apps.map(app => ['app', `${app.path}/package.json`]), ['server', 'packages/build/product-server-dependencies/package.json']]) {
  const actual = JSON.parse(readFileSync(join(productRoot, file), 'utf8'));
  for (const [field, values] of Object.entries(expectedDependencies[kind])) for (const [name, version] of Object.entries(values)) {
    if (actual[field]?.[name] !== version) throw new Error(`${file}: inherited dependency ${name} must match the pinned base (${version})`);
  }
}
}
requirePass('runtime boundaries', checkBoundaries(productRoot));
requirePass('official reuse', checkOfficialReuse(productRoot, { app: appId }));
requirePass('official UI', checkOfficialUiCoverage(productRoot, { app: appId }));
requirePass('chat parity', checkChatParity(productRoot, { app: appId }));
requirePass('capability groups', auditPacks(productRoot, {
  client: readClientMetadataRows(productRoot, { app: appId }), worker: readWorkerMetadataRows(productRoot), agent: readAgentMetadataRows(productRoot),
}, productRoot, { app: appId }));

for (const path of [
  'scripts/composition/generate-worker-composition.mjs',
  'scripts/composition/generate-agent-composition.mjs',
  'scripts/composition/generate-manageable-composition.mjs',
  'scripts/composition/generate-official-bundle-catalog.mjs',
  'scripts/composition/generate-owned-plugin-inventory.mjs',
  'apps/web/scripts/generate-preset-declarations.mjs',
  'scripts/build/prepare-public.mjs',
]) node(path);
if (command === 'prepare') return;
node('scripts/typecheck/check.mjs');
const product = JSON.parse(readFileSync(join(productRoot, 'package.json'), 'utf8'));
if (product.scripts?.['test:plugins']) run('pnpm', ['run', 'test:plugins']);
if (command === 'check') return;
node('scripts/template/generate-notices.mjs');
if (command === 'dev') {
  await prepareLocalDevelopmentDatabase(productRoot, env, { app: appId });
  run('pnpm', ['exec', 'cf', 'dev'], appRoot);
  return;
}
run('pnpm', ['exec', 'cf', 'build'], appRoot);
run(process.execPath, [join(baseRoot, 'packages/build/dsh-base-build-browser-compat/src/check-worker-output.mjs'), join(appRoot, '.cloudflare/output/v0')]);
if (command === 'build') return;

// Deployment needs actual acceptance for this selected app. A fresh scaffold
// deliberately has no release script; another app's browser checks cannot certify it.
const selectedManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
if (!selectedManifest.scripts?.['verify:release']) throw new Error(`${context.appPath}: deployment requires an application-specific verify:release script with real UI/UX acceptance`);
run('pnpm', ['run', 'verify:release'], appRoot);

// Only the explicit deploy command accesses remote resources. No template identity is reused.
await deployPrebuilt({
  appRoot, deployment, env, baseWeb: !context.consumer && appId === 'web' && context.appPath === 'apps/web',
  beforeUpload: () => applyProductSchemas(productRoot, async sql => {
    const result = spawnSync('pnpm', ['exec', 'cf', 'd1', 'query', deployment.authDatabaseId, `--sql=${sql}`], { cwd: appRoot, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Schema application failed; deployment was not started`);
    const groups = JSON.parse(result.stdout);
    if (!Array.isArray(groups) || groups.length === 0 || groups.some(group => group.success !== true)) throw new Error('D1 did not confirm schema application');
    return groups.flatMap(group => group.results ?? []);
  }),
});

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runProduct().catch(reportDeployFailure);
