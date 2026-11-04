#!/usr/bin/env node
/** Keep the official browser runtime and Cloudflare server peer environments distinct. */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, repoRoot, printResult } from './lib.mjs';
import { serverManifestPath, serverPackageNames } from '../../packages/build/dsh-base-build-server-dependencies/src/resolution.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
export function dependencyContractInput(root = repoRoot) {
  const app = join(root, 'apps/web'), require = createRequire(join(app, 'package.json'));
  const yaml = require('yaml');
  const upstreamLock = yaml.parse(readFileSync(join(root, '.submodules/deepseek-harness/pnpm-lock.yaml'), 'utf8'));
  const officialClient = upstreamLock.importers['packages/client/ui-conversation'].devDependencies;
  const officialTypes = upstreamLock.importers['.'].devDependencies;
  const version = row => row.version.split('(')[0];
  return {
    expected: { react: version(officialClient.react), 'react-dom': version(officialClient['react-dom']), '@types/react': version(officialTypes['@types/react']), '@types/react-dom': version(officialTypes['@types/react-dom']) },
    app: read(join(app, 'package.json')),
    installed: Object.fromEntries(['react', 'react-dom', '@types/react', '@types/react-dom'].map(name => [name, read(join(app, 'node_modules', name, 'package.json')).version])),
    workspace: yaml.parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')),
    nestedWorkspaceFiles: ['pnpm-workspace.yaml', 'pnpm-lock.yaml'].filter(name => existsSync(join(app, name))),
    lockImporters: Object.keys(yaml.parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).at(-1).toJSON().importers),
    server: read(serverManifestPath),
    serverReact: read(new URL('../../packages/build/dsh-base-build-server-dependencies/node_modules/react/package.json', import.meta.url)).version,
  };
}
export function validateDependencyContracts(input) {
  const failures = [];
  const members = ['apps/web', 'packages/build/dsh-base-build-server-dependencies'];
  if (JSON.stringify([...(input.workspace.packages ?? [])].sort()) !== JSON.stringify(members)) failures.push('workspace members must be the two in-repository application and server dependency directories; external members break Cloudflare ancestor-bounded config discovery');
  if (input.nestedWorkspaceFiles.length > 0) failures.push('apps/web must use the repository-root workspace and lockfile, without a nested workspace or lockfile');
  if (JSON.stringify([...input.lockImporters].sort()) !== JSON.stringify(['.', ...members])) failures.push('the root dependency lock must include exactly the root and both workspace importers');
  for (const [name, expected] of Object.entries(input.expected)) {
    const declared = input.app.dependencies?.[name] ?? input.app.devDependencies?.[name];
    if (declared !== expected || input.installed[name] !== expected) failures.push(`browser ${name} must match pinned official lock ${expected}; declared ${declared}, installed ${input.installed[name]}`);
  }
  for (const name of serverPackageNames) {
    if (input.app.dependencies?.[name] !== undefined || input.app.devDependencies?.[name] !== undefined) failures.push(`${name} must resolve only from the isolated server dependency package`);
    if (input.server.dependencies?.[name] === undefined) failures.push(`isolated server package must own ${name}`);
  }
  if (input.workspace.strictPeerDependencies !== true || input.workspace.resolvePeersFromWorkspaceRoot !== false) failures.push('workspace must enforce strict peers without leaking browser peers into server dependencies');
  if (input.workspace.peerDependencyRules?.allowedVersions !== undefined || input.workspace.peerDependencyRules?.ignoreMissing !== undefined) failures.push('peer compatibility must not be fabricated or ignored');
  if (!/^19\./.test(input.serverReact) || input.server.dependencies.react !== input.serverReact) failures.push('the server SDK React 19 peer must be explicit and installed separately');
  if (Object.keys(input.workspace.overrides ?? {}).some(name => /(?:^|[>/])react(?:-dom)?(?:@|$)/.test(name))) failures.push('React peer isolation cannot be replaced by an override');
  return failures;
}
export function checkDependencyContracts() {
  const input = dependencyContractInput();
  return { failures: validateDependencyContracts(input), summary: `one root workspace and lock; browser React ${input.installed.react} and types match the pinned official lock; server React ${input.serverReact} peers remain isolated and strict` };
}
if (isMain(import.meta.url)) printResult('dependency contracts', checkDependencyContracts());
