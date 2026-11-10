#!/usr/bin/env node
/** Update only the outer product's base gitlink and inherited dependencies. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyProject, productOutputPath } from '../composition/project-context.mjs';
import { planDependencyUpdate, writeDependencyUpdate } from './dependencies.mjs';
import { initializeSources } from './source-init.mjs';
import { readApplications } from '../composition/applications.mjs';

export function updateProduct({ root = process.cwd(), ref = 'main', prepareOnly = false } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.endsWith('/')) throw new Error('--ref must be a branch, release tag or commit');
  const context = verifyProject(root);
  if (!context.consumer) throw new Error('Run this command from an initialized product');
  const { productRoot, baseRoot, namespace, baseCommit } = context;
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(productRoot, 'status', '--porcelain', '--untracked-files=all') !== '') throw new Error('Commit or save product changes before updating the base');
  const basePath = relative(productRoot, baseRoot).split('\\').join('/');
  const touched = ['package.json', ...readApplications(productRoot).apps.map(app => `${app.path}/package.json`), 'packages/build/product-server-dependencies/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'dsh.dependencies.json'];
  const backups = new Map(touched.map(file => {
    const path = productOutputPath(productRoot, file);
    return [file, { path, contents: existsSync(path) ? readFileSync(path) : null }];
  }));
  // Fetch a candidate, never recursively follow upstream branches.
  git(baseRoot, 'fetch', '--no-recurse-submodules', '--no-tags', 'origin', ref);
  const target = git(baseRoot, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}');
  if (target === baseCommit) { console.log(`dsh-base is already at ${target.slice(0, 12)}`); return { changed: false, before: baseCommit, after: target }; }
  try {
    git(baseRoot, 'checkout', '--detach', target);
    git(baseRoot, 'submodule', 'update', '--init', '--recursive');
    git(productRoot, 'add', '--', basePath);
    initializeSources(productRoot);
    const plan = planDependencyUpdate(productRoot, baseRoot, namespace);
    writeDependencyUpdate(productRoot, plan);
    if (!prepareOnly) {
      for (const args of [['install', '--no-frozen-lockfile'], ['run', 'build', '--all']]) {
        const result = spawnSync('pnpm', args, { cwd: productRoot, env: { ...process.env, DSH_PRODUCT_ROOT: productRoot }, stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Upgrade verification failed: pnpm ${args.join(' ')}`);
      }
    }
    console.log(`Updated dsh-base ${baseCommit.slice(0, 12)} → ${target.slice(0, 12)}. ${prepareOnly ? 'Candidate prepared; install and build verification are still required.' : 'Dependency installation and product build passed.'} Review and commit the gitlink, manifests and lockfile; no deployment was performed.`);
    return { changed: true, before: baseCommit, after: target };
  } catch (error) {
    // Preflight required a clean product, so only this command's own edits are restored.
    try {
      git(baseRoot, 'checkout', '--detach', baseCommit);
      git(baseRoot, 'submodule', 'update', '--init', '--recursive');
      git(productRoot, 'add', '--', basePath);
      // Install/build scripts may have changed symlinks since preflight. Validate
      // every restore before writing any bytes, including same-product retargeting.
      const restores = [...backups].map(([file, backup]) => {
        const path = productOutputPath(productRoot, file);
        if (path !== backup.path) throw new Error(`Backup target changed during upgrade: ${file}`);
        return [path, backup.contents];
      });
      for (const [path, contents] of restores) {
        if (contents === null) { if (existsSync(path)) unlinkSync(path); }
        else writeFileSync(path, contents);
      }
    } catch (rollbackError) {
      throw new Error(`Base update failed (${error.message}); automatic rollback could not safely finish: ${rollbackError.message}. Inspect the product working tree before retrying.`, { cause: rollbackError });
    }
    throw new Error(`Base update was rolled back to ${baseCommit.slice(0, 12)}. ${error.message} If dependency installation ran, rerun pnpm install --frozen-lockfile before working.`, { cause: error });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prepare-only') options.prepareOnly = true;
    else if (args[i] === '--ref' && args[i + 1]) options.ref = args[++i];
    else throw new Error('Usage: pnpm dsh:update [--ref RELEASE_TAG_OR_COMMIT] [--prepare-only]');
  }
  updateProduct(options);
}
