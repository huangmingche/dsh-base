#!/usr/bin/env node
/** Initialize recorded gitlinks and the exact official release tag, never branch-follow recursively. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectContext, verifyProject } from '../composition/project-context.mjs';

export function ensureOfficialTag(baseRoot) {
  const lock = JSON.parse(readFileSync(join(baseRoot, 'dsh-source.lock.json'), 'utf8'));
  if (lock.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git' || !/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(lock.tag ?? '')) throw new Error('Invalid official release lock');
  const upstream = join(baseRoot, '.submodules/deepseek-harness');
  try {
    execFileSync('git', ['-C', upstream, 'rev-parse', '--verify', `refs/tags/${lock.tag}^{commit}`], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['-C', upstream, 'fetch', '--no-recurse-submodules', 'origin', 'tag', lock.tag], { stdio: 'inherit' });
  }
}

export function initializeSources(root) {
  const context = projectContext(root);
  if (!context.consumer) throw new Error('Source initialization requires dsh.project.json');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'inherit' });
  git(context.productRoot, 'submodule', 'update', '--init', '--recursive');
  ensureOfficialTag(context.baseRoot);
  return verifyProject(root);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) initializeSources(resolve(process.env.DSH_PRODUCT_ROOT ?? process.cwd()));
