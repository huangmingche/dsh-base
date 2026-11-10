#!/usr/bin/env node
/** Add an independently deployable Web entry without copying business plugins. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyProject, productOutputPath } from '../composition/project-context.mjs';
import { readApplications } from '../composition/applications.mjs';
import { baseDependencies } from './dependencies.mjs';
import { applicationFiles, jsonFile } from './app-template.mjs';
import { readProductDeployment } from './deployment.mjs';

export function addApplication({ root = process.cwd(), id, workerName, authBaseUrl } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id ?? '')) throw new Error('--id must be a lowercase application identifier');
  const context = verifyProject(root);
  const registry = readApplications(context.productRoot);
  if (registry.apps.some(app => app.id === id || app.path === `apps/${id}`)) throw new Error(`Application ${id} already exists`);
  const appPath = `apps/${id}`;
  if (existsSync(productOutputPath(context.productRoot, appPath))) throw new Error(`Refusing to overwrite existing ${appPath}`);
  const next = { ...registry, apps: [...registry.apps, { id, path: appPath, platform: 'web' }] };
  const contract = context.consumer ? baseDependencies(context.baseRoot, context.namespace, next, context.productRoot) : undefined;
  const baseApp = JSON.parse(readFileSync(join(context.baseRoot, 'apps/web/package.json'), 'utf8'));
  const dependencies = contract?.app ?? { dependencies: baseApp.dependencies, devDependencies: baseApp.devDependencies };
  const { files, deployment } = applicationFiles({ ...context, namespace: context.namespace, id, appPath, dependencies, workerName, authBaseUrl });
  for (const peer of registry.apps) {
    const other = readProductDeployment(context.productRoot, { env: {}, app: peer.id });
    for (const key of ['workerName', 'authDatabaseName', 'filesBucket', 'authBaseUrl']) {
      if (deployment[key] === other[key]) throw new Error(`New application shares ${key} with ${peer.id}; choose independent resources`);
    }
  }
  const workspacePath = productOutputPath(context.productRoot, 'pnpm-workspace.yaml');
  const workspace = readFileSync(workspacePath, 'utf8');
  files.set('dsh.apps.json', jsonFile(next));
  if (contract) {
    const previous = JSON.parse(readFileSync(join(context.productRoot, 'dsh.dependencies.json'), 'utf8'));
    if (!isDeepStrictEqual(previous, baseDependencies(context.baseRoot, context.namespace, registry, context.productRoot))) throw new Error('Inherited dependencies changed; reconcile the base update before adding an application');
    if (workspace !== previous.workspace) throw new Error('Workspace differs from the inherited dependency contract; reconcile it before adding an application');
    files.set('dsh.dependencies.json', jsonFile({ ...previous, workspace: contract.workspace }));
    files.set('pnpm-workspace.yaml', contract.workspace);
  } else {
    if (!/^packages:\n/mu.test(workspace)) throw new Error('Workspace packages declaration is missing');
    files.set('pnpm-workspace.yaml', workspace.replace(/^packages:\n/mu, `packages:\n  - ${appPath}\n`));
  }
  // Preflight all destinations and back up only owned metadata. Never remove or
  // overwrite an existing app, dependency source, or a symlinked output.
  const writes = [...files].map(([file, content]) => {
    const target = productOutputPath(context.productRoot, file);
    if (target !== resolve(context.productRoot, file)) throw new Error(`Application output cannot traverse symbolic links: ${file}`);
    return [file, target, content];
  });
  const backups = new Map(writes.filter(([file]) => !file.startsWith(`${appPath}/`)).map(([file, path]) => [file, existsSync(path) ? readFileSync(path) : null]));
  const created = [];
  const directories = new Set();
  try {
    for (const [file, target, content] of writes) {
      if (productOutputPath(context.productRoot, file) !== target) throw new Error(`Application output changed: ${file}`);
      for (let directory = dirname(target); !existsSync(directory); directory = dirname(directory)) directories.add(directory);
      mkdirSync(dirname(target), { recursive: true });
      const descriptor = openSync(target, file.startsWith(`${appPath}/`) ? 'wx' : 'w', file.endsWith('.dev.vars') || file.endsWith('deployment.local.json') ? 0o600 : 0o644);
      // Opening an existing metadata file truncates it immediately. Track the
      // mutation before writing so a partial write is included in rollback.
      created.push(file);
      try { writeFileSync(descriptor, content); } finally { closeSync(descriptor); }
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const file of created.reverse()) {
      try {
        const target = productOutputPath(context.productRoot, file);
        if (target !== resolve(context.productRoot, file)) throw new Error(`Rollback target changed: ${file}`);
        if (backups.has(file) && backups.get(file) !== null) writeFileSync(target, backups.get(file));
        else rmSync(target, { force: true });
      } catch (failure) { rollbackFailures.push(failure.message); }
    }
    // Remove only empty directories created by this attempt; preserve any
    // concurrent or unrelated files rather than recursively deleting the app.
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
      try { rmdirSync(directory); } catch (failure) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(failure.code)) rollbackFailures.push(failure.message);
      }
    }
    if (rollbackFailures.length) throw new Error(`Application creation failed (${error.message}); rollback needs inspection: ${rollbackFailures.join('; ')}`, { cause: error });
    throw error;
  }
  return { id, appPath, files: files.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  const flags = { '--id': 'id', '--worker-name': 'workerName', '--auth-base-url': 'authBaseUrl' };
  for (let i = 0; i < args.length; i += 2) {
    if (!flags[args[i]] || !args[i + 1] || args[i + 1].startsWith('--') || options[flags[args[i]]]) throw new Error('Usage: dsh:app --id ID [--worker-name NAME] [--auth-base-url URL]');
    options[flags[args[i]]] = args[i + 1];
  }
  const result = addApplication(options);
  console.log(`Added ${result.id} at ${result.appPath}. Run pnpm install and review the lockfile; configure independent resources and application acceptance before deployment. No cloud resources were created.`);
}
