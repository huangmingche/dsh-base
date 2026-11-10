#!/usr/bin/env node
/** Scaffold an outer product around an already pinned base Git submodule. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDependencies } from './dependencies.mjs';
import { applicationFiles } from './app-template.mjs';
import { verifySource } from '../dsh-source/verify.mjs';
import { ensureOfficialTag } from './source-init.mjs';

export function initializeProduct({ directory = process.cwd(), namespace, base = '.submodules/dsh-base', workerName = namespace, authBaseUrl }) {
  const root = realpathSync(resolve(directory));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace ?? '') || ['dsh-base', 'deepseek-ai'].includes(namespace)) throw new Error('Use a distinct lowercase --namespace, for example my-product');
  if (typeof base !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(base) || base.startsWith('/') || base.split('/').some(part => ['', '.', '..'].includes(part))) throw new Error('--base must be a nested relative submodule path');
  const baseRoot = realpathSync(join(root, base));
  if (!baseRoot.startsWith(root + sep) || baseRoot !== resolve(dirname(fileURLToPath(import.meta.url)), '../..')) throw new Error('Run the initializer from this product\'s pinned dsh-base submodule');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const gitlink = git(root, 'ls-files', '--stage', '--', base);
  if (!gitlink.startsWith(`160000 ${git(baseRoot, 'rev-parse', 'HEAD')} 0\t`)) throw new Error('Initialize and pin dsh-base with git submodule add before scaffolding');
  const modules = git(root, 'config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$');
  if (!modules.split('\n').some(line => line.slice(line.indexOf(' ') + 1) === base)) throw new Error('The base path must be registered in .gitmodules');
  if (git(baseRoot, 'status', '--porcelain', '--untracked-files=all') !== '') throw new Error('The pinned base must be clean before initializing a product');
  ensureOfficialTag(baseRoot);
  const official = verifySource(baseRoot);
  if (official.failures.length) throw new Error(official.failures.join('\n'));
  const contract = baseDependencies(baseRoot, namespace, undefined, root);
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const command = action => `node ./${base}/scripts/project/run.mjs ${action}`;
  const files = new Map([
    ['dsh.project.json', json({ version: 1, base, namespace })],
    ['dsh.apps.json', json({ version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }] })],
    ...applicationFiles({ productRoot: root, baseRoot, namespace, id: 'web', dependencies: contract.app, workerName, authBaseUrl }).files,
    ['dsh.dependencies.json', json(contract)],
    ['package.json', json({ name: `@${namespace}/root`, private: true, type: 'module', version: '0.1.0', packageManager: contract.packageManager,
      scripts: { 'dsh:init': `node ./${base}/scripts/project/source-init.mjs`, 'dsh:app': `node ./${base}/scripts/project/add-app.mjs`, 'dsh:run': `node ./${base}/scripts/project/run.mjs`, 'build:all': `${command('build')} --all`, 'dsh:prepare': command('prepare'), 'dsh:check': command('check'), 'dsh:update': `node ./${base}/scripts/project/update.mjs`, build: command('build'), dev: command('dev'), deploy: command('deploy') } })],
    ['pnpm-workspace.yaml', contract.workspace],
    ['.gitignore', 'node_modules/\n.pnpm-store/\n.artifacts/\ndist/\n.cloudflare/\n.wrangler/\n.wrangler-home/\n.dev.vars\n.dev.vars.*\n.env\n.env.*\ndeployment.local.json\n*.tsbuildinfo\n*.log\n*.sqlite*\n.DS_Store\n'],
    ['packages/build/product-server-dependencies/package.json', json({ name: `@${namespace}/build-server-dependencies`, private: true, type: 'module', version: '0.0.0', ...contract.server,
      dshBase: { build: { kind: 'dependency-environment' }, reuse: { mode: 'seam', official: ['@deepseek-ai/dsh-client-web'], reason: 'Product-owned dependency installation preserves the base browser/server peer isolation without adding a runtime feature.' } } })],
    ['packs/.gitkeep', ''], ['packages/client/.gitkeep', ''], ['packages/cloudflare-worker/.gitkeep', ''], ['packages/cloudflare-think/.gitkeep', ''],
  ]);
  for (const name of ['AGENTS.md', 'README.md', 'README.en.md', '.github/workflows/verify.yml', '.github/workflows/update-dsh-base.yml']) {
    files.set(name, readFileSync(new URL(`./templates/${name.replaceAll('/', '__')}`, import.meta.url), 'utf8').replaceAll('__BASE_PATH__', base).replaceAll('__PRODUCT_NAMESPACE__', namespace));
  }
  // Validate every target before writing any output, including ancestor symlinks.
  for (const file of files.keys()) {
    const target = join(root, file);
    if (existsSync(target)) throw new Error(`Refusing to overwrite ${file}; initialize in a new product repository`);
    let parent = dirname(target);
    while (!existsSync(parent)) parent = dirname(parent);
    const actual = realpathSync(parent);
    if (actual !== root && (!actual.startsWith(root + sep) || actual === baseRoot || actual.startsWith(baseRoot + sep))) throw new Error(`Unsafe product output parent: ${file}`);
  }
  for (const [file, content] of files) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx', mode: file.endsWith('.dev.vars') || file.endsWith('deployment.local.json') ? 0o600 : 0o644 });
  }
  return { root, files: files.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const names = { '--directory': 'directory', '--namespace': 'namespace', '--base': 'base', '--worker-name': 'workerName', '--auth-base-url': 'authBaseUrl' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node <base>/scripts/project/init.mjs --namespace my-product [--directory PATH] [--base .submodules/dsh-base] [--worker-name NAME] [--auth-base-url URL]');
    options[names[args[i]]] = args[i + 1];
  }
  const result = initializeProduct(options);
  console.log(`Initialized ${result.files} product files in ${result.root}. Base source was not changed. Run pnpm install, then pnpm build; commit the product lockfile before CI.`);
}
