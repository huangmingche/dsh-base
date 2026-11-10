/** Verify the published Worker with two existing workspaces belonging to the review account. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromeExecutable, remoteAcceptanceConfig, waitForHostReadiness } from './acceptance-config.mjs';
import { readDeploymentConfig } from './deployment-config.mjs';
import { verifyWorkspaceNavigation } from './cross-workspace-browser.mjs';

const artifacts = resolve(import.meta.dirname, '../../../.artifacts/acceptance');
const configPath = process.env.DSH_ACCEPTANCE_CONFIG || resolve(artifacts, 'review-account.json');
const stored = JSON.parse(readFileSync(configPath, 'utf8'));
const { base, credentials } = remoteAcceptanceConfig({ ...process.env, DSH_ACCEPTANCE_CONFIG: configPath });
const deployment = readDeploymentConfig();
assert.equal(deployment.indexing.environment, 'staging', 'Select a Staging deployment');
assert.equal(base, deployment.authBaseUrl, 'Acceptance target must match the configured Worker origin');
assert.equal(new URL(stored.base).origin, base, 'Review credentials must belong to this origin');
const ids = stored.workspaceIds;
assert.ok(Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === 'string' && id.trim() === id && id.length > 0)
  && ids[0] !== ids[1], 'Set workspaceIds to two distinct existing workspaces in the private acceptance configuration');
chromeExecutable();
if (process.argv[2] === '--preflight' && process.argv.length === 3) {
  console.log('Staging origin, review credentials, two workspace IDs and browser configured.');
} else {
  assert.equal(process.argv.length, 2, 'Expected no arguments or --preflight');
  await verify();
}

function post(path, body, cookie, signal = AbortSignal.timeout(30_000)) {
  return fetch(base + path, { method: 'POST', redirect: 'error', signal,
    headers: { origin: base, 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
}

async function inspect(read) {
  const groups = await read('workspaceState');
  const sessions = [];
  const seen = new Set();
  let cursor;
  do {
    const page = await read('list', cursor ? { cursor } : {});
    sessions.push(...page.sessions);
    cursor = page.cursor;
    if (cursor) {
      assert.ok(!seen.has(cursor), 'Session cursor repeated');
      seen.add(cursor);
    }
  } while (cursor);
  assert.equal(new Set(sessions.map(s => s.sessionId)).size, sessions.length, 'Duplicate Host Session');
  return { groups, sessions };
}

function inventory({ groups, sessions }) {
  return {
    memberships: groups.items.map(w => [w.workspaceId, [...w.sessionIds].sort()]).sort(([a], [b]) => a.localeCompare(b)),
    sessions: sessions.map(s => [s.sessionId, s.workspaceId, s.cwd, s.archived, s.blank, s.running]).sort(([a], [b]) => a.localeCompare(b)),
    archived: [...groups.archivedSessionIds].sort(),
  };
}

async function verify() {
  const version = process.env.DSH_EXPECTED_DEPLOYMENT_VERSION;
  assert.match(version ?? '', /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu, 'Supply the deployed Worker version UUID');
  const output = resolve(artifacts, 'cross-workspace-staging', version);
  mkdirSync(output, { recursive: true });
  const reportPath = resolve(mkdtempSync(resolve(output, 'run-')), 'report.json');
  const report = { base, version, startedAt: new Date().toISOString(), checks: [], success: false };
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('Cross-workspace evidence:', reportPath);
  save();
  const signed = await post('/api/auth/sign-in/username', { username: credentials.username, password: credentials.password });
  assert.equal(signed.status, 200, 'Review account login');
  const cookie = signed.headers.getSetCookie().map(c => c.split(';', 1)[0]).find(c => /^(?:__Secure-)?better-auth\.session_token=/u.test(c));
  assert.ok(cookie, 'Review session cookie');
  async function host(method, params = {}, signal) {
    const response = await post('/api/session-host', { method, params }, cookie, signal);
    return { status: response.status, body: await response.json() };
  }
  async function read(method, params) {
    const { status, body } = await host(method, params);
    assert.equal(status, 200, method);
    assert.ok(!body.error && Object.hasOwn(body, 'result'), method + ' must return a Host result');
    return body.result;
  }
  try {
    const initial = await inspect(read);
    assert.ok(initial.sessions.every(s => !s.running), 'Use an idle acceptance account');
    const workspaces = ids.map(workspaceId => {
      const w = initial.groups.items.find(w => w.workspaceId === workspaceId);
      assert.ok(w, 'Configured workspace must already exist: ' + workspaceId);
      const sessionIds = initial.sessions.filter(s => w.sessionIds.includes(s.sessionId) && s.workspaceId === workspaceId &&
        s.cwd === w.path && s.blank && !s.running && !s.archived && !initial.groups.archivedSessionIds.includes(s.sessionId)).map(s => s.sessionId);
      assert.ok(sessionIds.length, 'Each configured workspace requires an existing idle blank Session');
      return { workspaceId, path: w.path, sessionIds };
    });
    await waitForHostReadiness(host, workspaces[0].sessionIds[0], { expectedVersion: version });
    await verifyWorkspaceNavigation({ base, credentials, workspaces, async onCheck(check) {
      const data = await inspect(read);
      const expected = workspaces.find(w => w.workspaceId === check.workspaceId);
      assert.ok(expected?.sessionIds.includes(check.sessionId));
      const session = data.sessions.find(s => s.sessionId === check.sessionId);
      assert.equal(session?.workspaceId, expected.workspaceId, check.step + ' Host workspace');
      assert.equal(session.cwd, expected.path, check.step + ' Host workspace path');
      assert.deepEqual(data.groups.items.filter(w => w.sessionIds.includes(check.sessionId)).map(w => w.workspaceId),
        [expected.workspaceId], check.step + ' exclusive membership');
      report.checks.push(check);
      save();
    } });
    assert.deepEqual(inventory(await inspect(read)), inventory(initial), 'Preserve existing workspaces and sessions');
    assert.equal((await read('runtimeInfo')).versionId, version, 'Staging still runs the verified version');
    report.inventory = { workspaces: initial.groups.items.length, sessions: initial.sessions.length };
  } finally {
    const response = await post('/api/auth/sign-out', {}, cookie);
    assert.equal(response.status, 200, 'Release the independent Host login');
  }
  report.success = true;
  report.finishedAt = new Date().toISOString();
  save();
  console.log('Cross-workspace Staging acceptance passed (' + report.checks.length + ' checks).');
}
