import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyContractInput, validateDependencyContracts } from '../check-dependency-contracts.mjs';
const actual = dependencyContractInput();
test('dependency contracts accept the actual pinned installation', () => assert.deepEqual(validateDependencyContracts(actual), []));
const mutations = [
  ['browser React outside the official pin', value => { value.app.dependencies.react = '19.3.1'; }],
  ['installed ReactDOM outside the official pin', value => { value.installed['react-dom'] = '19.3.1'; }],
  ['incompatible browser React types', value => { value.app.devDependencies['@types/react'] = '^19.0.0'; }],
  ['server SDK leaking into the browser dependency environment', value => { value.app.dependencies.agents = '0.33.0'; }],
  ['disabled strict peer checks', value => { value.workspace.strictPeerDependencies = false; }],
  ['workspace peer leakage', value => { value.workspace.resolvePeersFromWorkspaceRoot = true; }],
  ['fabricated peer compatibility', value => { value.workspace.peerDependencyRules = { allowedVersions: { 'agents>react': '18' } }; }],
  ['missing server SDK React 19 peer', value => { value.serverReact = '18.3.1'; }],
  ['external workspace members outside the Cloudflare discovery boundary', value => { value.workspace.packages[1] = '../../packages/build/dsh-base-build-server-dependencies'; }],
  ['a nested application workspace', value => { value.nestedWorkspaceFiles.push('pnpm-workspace.yaml'); }],
  ['a second application lockfile', value => { value.nestedWorkspaceFiles.push('pnpm-lock.yaml'); }],
  ['an incomplete root dependency lock', value => { value.lockImporters = ['.']; }],
];
for (const [label, mutate] of mutations) test(`dependency contracts reject ${label}`, () => {
  const input = structuredClone(actual); mutate(input); assert.ok(validateDependencyContracts(input).length > 0, 'regressed dependency contract must fail');
});
