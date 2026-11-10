import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeProduct } from '../init.mjs';

const workflow = readFileSync(new URL('../templates/.github__workflows__update-dsh-base.yml', import.meta.url), 'utf8');
const finalStep = workflow.slice(workflow.indexOf('      - name: Open upgrade PR and dispatch verification'));
const script = finalStep.slice(finalStep.indexOf('        run: |\n') + '        run: |\n'.length).split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const target = 'a'.repeat(40), remoteCommit = 'b'.repeat(40);

// Exercise the actual rendered workflow shell with stateful local git/gh stand-ins.
// No GitHub requests are sent, and failed create/dispatch calls retain remote state.
function fixture(t, initial = {}, basePath = '.submodules/dsh-base') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['applications.mjs', 'project-context.mjs']) {
    const destination = join(root, basePath, 'scripts/composition');
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, file), readFileSync(new URL(`../../composition/${file}`, import.meta.url)));
  }
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const statePath = join(root, 'state.json');
  writeFileSync(statePath, JSON.stringify({ target, remoteCommit, existingTarget: target, branchExists: false, prState: 'MISSING', verification: 'missing', basePath, calls: [], ...initial }));
  const common = `import {readFileSync,writeFileSync} from 'node:fs';\nconst path=process.env.WORKFLOW_STATE;const s=JSON.parse(readFileSync(path,'utf8'));const args=process.argv.slice(2);const save=()=>writeFileSync(path,JSON.stringify(s));`;
  writeFileSync(join(bin, 'git'), `#!${process.execPath}\n${common}
s.calls.push(['git',...args]);save();
if(args[0]==='-C'){if(args[1]!=='./'+s.basePath)throw new Error('Unsafe base argument');console.log(s.target);}
else if(args[0]==='ls-remote')process.exit(s.remoteFailure??(s.branchExists?0:2));
else if(args[0]==='rev-parse')console.log(s.remoteCommit);
else if(args[0]==='ls-tree')console.log('160000 commit '+s.existingTarget+'\\t'+s.basePath);
else if(args[0]==='push'){s.branchExists=true;save();}
else if(!['fetch','switch','config','add','commit'].includes(args[0]))throw new Error('Unexpected git call '+args.join(' '));
`, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${common}
s.calls.push(['gh',...args]);save();
if(args[0]==='pr'&&args[1]==='list')console.log(s.prState);
else if(args[0]==='pr'&&args[1]==='create'){if(s.failCreate){s.failCreate=false;save();process.exit(1);}s.prState='OPEN';save();}
else if(args[0]==='run'&&args[1]==='list'){if(args[args.indexOf('--event')+1]!=='workflow_dispatch')throw new Error('Skipped push runs cannot count as verification');console.log(s.verification);}
else if(args[0]==='workflow'&&args[1]==='run'){if(s.failDispatch){s.failDispatch=false;save();process.exit(1);}s.verification='active';save();}
else throw new Error('Unexpected gh call '+args.join(' '));
`, { mode: 0o755 });
  const path = join(root, 'workflow.sh');
  writeFileSync(path, script.replaceAll('__BASE_PATH__', basePath));
  const run = () => spawnSync('bash', ['-e', '-o', 'pipefail', path], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WORKFLOW_STATE: statePath, DEFAULT_BRANCH: 'main' }, encoding: 'utf8' });
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  return { root, run, state };
}
const calls = (state, command, action, subaction) => state.calls.filter(row => row[0] === command && row[1] === action && (subaction === undefined || row[2] === subaction));
const passed = result => assert.equal(result.status, 0, result.stderr || result.stdout);

test('retry repairs an orphan branch after PR creation fails without pushing it again', t => {
  const f = fixture(t, { failCreate: true });
  assert.notEqual(f.run().status, 0);
  assert(f.state().branchExists);
  passed(f.run());
  passed(f.run());
  const s = f.state();
  assert.equal(calls(s, 'git', 'push').length, 1);
  assert.equal(calls(s, 'git', 'switch').length, 1);
  assert.equal(calls(s, 'gh', 'pr', 'create').length, 2);
  assert.equal(calls(s, 'gh', 'workflow', 'run').length, 1);
  assert(s.calls.every(row => !row.includes('--force') && !row.includes('--force-with-lease')));
});

test('retry dispatches an existing open PR after dispatch failure without recreating the PR', t => {
  const f = fixture(t, { failDispatch: true });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.state().prState, 'OPEN');
  passed(f.run());
  assert.equal(calls(f.state(), 'gh', 'pr', 'create').length, 1);
  assert.equal(calls(f.state(), 'gh', 'workflow', 'run').length, 2);
  assert.equal(calls(f.state(), 'git', 'push').length, 1);
});

test('closed or merged PRs are left closed and successful head verification is reused', t => {
  for (const state of [{ prState: 'CLOSED_OR_MERGED' }, { prState: 'OPEN', verification: 'passed' }]) {
    const f = fixture(t, { branchExists: true, ...state });
    passed(f.run());
    assert.equal(calls(f.state(), 'gh', 'pr', 'create').length, 0);
    assert.equal(calls(f.state(), 'gh', 'workflow', 'run').length, 0);
    assert.equal(calls(f.state(), 'git', 'push').length, 0);
  }
});

test('an existing branch with a different base pin fails without overwriting review work', t => {
  const f = fixture(t, { branchExists: true, existingTarget: 'c'.repeat(40) });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different base pin/);
  assert.equal(calls(f.state(), 'git', 'push').length, 0);
  assert.equal(calls(f.state(), 'gh', 'pr', 'create').length, 0);
});

test('remote lookup failure does not assume a missing branch or attempt to push', t => {
  const f = fixture(t, { remoteFailure: 128 });
  const result = f.run();
  assert.equal(result.status, 128);
  assert.match(result.stderr, /Cannot determine/);
  assert.equal(calls(f.state(), 'git', 'push').length, 0);
  assert.equal(calls(f.state(), 'git', 'switch').length, 0);
});

test('upgrade workflow stages every registered application manifest', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'dsh.apps.json'), JSON.stringify({ version: 1, default: 'web', apps: [{ id: 'web', path: 'apps/web', platform: 'web' }, { id: 'admin', path: 'apps/admin', platform: 'web' }] }));
  passed(f.run());
  assert(calls(f.state(), 'git', 'add').some(row => row.includes('apps/web/package.json') && row.includes('apps/admin/package.json')));
});

test('allowed nested base names are shell arguments and injection characters are rejected by init', t => {
  for (const base of ['-vendor/dsh-base', 'Vendor.v2/dsh_base']) {
    const f = fixture(t, {}, base);
    passed(f.run());
    assert(calls(f.state(), 'git', 'add').some(row => row.includes(`./${base}`)));
  }
  const f = fixture(t);
  for (const base of ['base;touch marker', 'base$(touch marker)', 'base`touch marker`', 'base\nnext', "base'quote", 'base space', '../base']) {
    assert.throws(() => initializeProduct({ directory: f.root, namespace: 'fixture', base }), /nested relative submodule path/);
  }
});
