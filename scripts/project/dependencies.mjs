/** Product-owned dependency declarations; updates never write into the base. */
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { productOutputPath, verifyProject } from '../composition/project-context.mjs';
import { readApplications } from '../composition/applications.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));

// Bootstrap runs before installing dependencies. The base workspace declares
// each pnpm patch under its own or its pinned upstream patches directory.
function relocatePatches(workspace, baseRoot, productRoot) {
  const base = realpathSync(baseRoot);
  const product = realpathSync(productRoot);
  const lines = workspace.split('\n');
  let inPatches = false;
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      inPatches = line.startsWith('patchedDependencies:');
      if (inPatches && line.trimEnd() !== 'patchedDependencies:') throw new Error('Expected patchedDependencies as a block of patch paths');
      continue;
    }
    if (!inPatches) continue;
    const match = /^(  [^:]+: +)(["']?)((?:\.submodules\/deepseek-harness\/)?patches\/[\w@.-]+\.patch)\2 *(#.*)?$/u.exec(line);
    if (!match) throw new Error(`Expected a patch in the pinned base or its official DSH patches directory: ${line}`);
    const [, key, , patch, comment] = match;
    const path = join(base, patch);
    if (realpathSync(path) !== path || !statSync(path).isFile()) throw new Error(`Expected a regular patch in the pinned base: ${patch}`);
    if (base === product) continue;
    const productPath = relative(product, path).split(sep).join('/');
    if (isAbsolute(productPath) || productPath.startsWith('../')) throw new Error(`Patch is outside the product: ${patch}`);
    lines[index] = key + JSON.stringify(productPath) + (comment ? ' ' + comment : '');
  }
  return lines.join('\n');
}

export function baseDependencies(baseRoot, namespace, applications = { apps: [{ path: 'apps/web' }] }, productRoot = baseRoot) {
  const app = read(join(baseRoot, 'apps/web/package.json'));
  const server = read(join(baseRoot, 'packages/build/dsh-base-build-server-dependencies/package.json'));
  const dependencies = { ...app.dependencies };
  delete dependencies['@dsh-base/build-server-dependencies'];
  dependencies[`@${namespace}/build-server-dependencies`] = 'workspace:*';
  const workspace = readFileSync(join(baseRoot, 'pnpm-workspace.yaml'), 'utf8')
    .replace(/^packages:\n(?:[ \t]+.*\n)*/m, `packages:\n${applications.apps.map(app => `  - ${app.path}\n`).join('')}  - packages/build/product-server-dependencies\n`);
  return {
    version: 1,
    packageManager: read(join(baseRoot, 'package.json')).packageManager,
    app: { dependencies, devDependencies: app.devDependencies ?? {} },
    server: { dependencies: server.dependencies ?? {} },
    workspace: relocatePatches(workspace, baseRoot, productRoot),
  };
}

/** Preserve product additions, but refuse to silently replace locally edited base constraints. */
export function planDependencyUpdate(productRoot, baseRoot, namespace) {
  const previous = read(join(productRoot, 'dsh.dependencies.json'));
  if (previous.version !== 1) throw new Error('Unsupported dsh.dependencies.json version');
  const applications = readApplications(productRoot);
  const next = baseDependencies(baseRoot, namespace, applications, productRoot);
  const files = new Map();
  for (const [kind, file] of [...applications.apps.map(app => ['app', `${app.path}/package.json`]), ['server', 'packages/build/product-server-dependencies/package.json']]) {
    const manifest = read(join(productRoot, file));
    for (const field of Object.keys(next[kind])) {
      const oldValues = previous[kind][field] ?? {}, newValues = next[kind][field];
      const actual = { ...manifest[field] };
      for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
        if (actual[key] !== oldValues[key] && actual[key] !== newValues[key]) {
          throw new Error(`${file}: product changed ${field}.${key}; reconcile the base upgrade explicitly`);
        }
        if (Object.hasOwn(newValues, key)) actual[key] = newValues[key];
        else delete actual[key];
      }
      manifest[field] = actual;
    }
    files.set(file, JSON.stringify(manifest, null, 2) + '\n');
  }
  const workspace = readFileSync(join(productRoot, 'pnpm-workspace.yaml'), 'utf8');
  if (previous.workspace !== next.workspace && workspace !== previous.workspace && workspace !== next.workspace) {
    throw new Error('Product workspace policy differs from the previous base; reconcile the upgrade explicitly');
  }
  if (previous.workspace !== next.workspace) files.set('pnpm-workspace.yaml', next.workspace);
  const root = read(join(productRoot, 'package.json'));
  if (root.packageManager !== previous.packageManager && root.packageManager !== next.packageManager) {
    throw new Error('Product packageManager differs from the base dependency contract');
  }
  root.packageManager = next.packageManager;
  files.set('package.json', JSON.stringify(root, null, 2) + '\n');
  files.set('dsh.dependencies.json', JSON.stringify(next, null, 2) + '\n');
  return { changed: !isDeepStrictEqual(previous, next), files };
}

export function writeDependencyUpdate(productRoot, plan) {
  const writes = [...plan.files].map(([file, contents]) => [productOutputPath(productRoot, file), contents]);
  for (const [path, contents] of writes) writeFileSync(path, contents);
}

// A product updating from an older base uses the updater already in memory
// before checkout. Its --prepare-only result still contains base-relative paths.
export function migratePreparedPatches(root) {
  const { productRoot, baseRoot, namespace, consumer } = verifyProject(root);
  if (!consumer) throw new Error('Run patch-path migration in the outer product');
  const applications = readApplications(productRoot);
  const legacy = baseDependencies(baseRoot, namespace, applications);
  const next = baseDependencies(baseRoot, namespace, applications, productRoot);
  const snapshot = read(join(productRoot, 'dsh.dependencies.json'));
  const actual = readFileSync(join(productRoot, 'pnpm-workspace.yaml'), 'utf8');
  if (![legacy, next].some(contract => isDeepStrictEqual(contract, snapshot))
      || ![legacy.workspace, next.workspace].includes(actual)) {
    throw new Error('Expected a prepared dependency contract from the pinned base; reconcile local edits before migrating patch paths');
  }
  // Accept either already-migrated file so an interrupted run is retryable.
  const files = new Map();
  if (actual !== next.workspace) files.set('pnpm-workspace.yaml', next.workspace);
  if (!isDeepStrictEqual(snapshot, next)) files.set('dsh.dependencies.json', JSON.stringify(next, null, 2) + '\n');
  writeDependencyUpdate(productRoot, { files });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--migrate-prepared-patches') throw new Error('Usage: dependencies.mjs --migrate-prepared-patches');
  migratePreparedPatches(process.cwd());
}
