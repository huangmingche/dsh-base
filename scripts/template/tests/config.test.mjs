import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readDeploymentConfig, requireDeployableConfig } from "../../../apps/web/scripts/deployment-config.mjs";
import { remoteAcceptanceConfig, waitForHostReadiness } from "../../../apps/web/scripts/acceptance-config.mjs";

const config = (value = {}, env = {}) => readDeploymentConfig(env, undefined, value);
test("template defaults close public signup and platform spending", () => {
  const value = config();
  assert.equal(value.signupEnabled, false);
  assert.equal(value.platformAiEnabled, false);
  assert.equal(value.authDatabaseId, "");
  assert.equal(value.aiGatewayId, "");
  assert.throws(() => requireDeployableConfig(value), /explicit/);
  assert.throws(() => config({ AUTH_SECRET: "must-not-be-here" }), /Unknown deployment key/);
  assert.throws(() => config({ constructor: "invalid" }), /Unknown deployment key/);
  assert.throws(() => config({ workerName: "invalid/name" }), /resource name/);
  assert.throws(() => config({ signupEnabled: "true" }), /Invalid deployment value/);
  assert.throws(() => config({}, { DSH_SIGNUP_ENABLED: "1" }), /true or false/);
  assert.throws(() => config({ platformAiEnabled: true }), /Gateway|AI_GATEWAY/);
  assert.throws(() => config({ authBaseUrl: "https://user:secret@example.test" }), /origin/);
});
test("explicit config/environment precedence and deployment requirements", () => {
  const value = config({ workerName: "configured", authDatabaseId: "12345678-1234-1234-1234-123456789abc", authBaseUrl: "https://example.com" }, { DSH_WORKER_NAME: "override" });
  assert.equal(value.workerName, "override");
  assert.throws(() => requireDeployableConfig(value), /real HTTPS/);
  assert.doesNotThrow(() => requireDeployableConfig({ ...value, authBaseUrl: "https://app.example.test" }));
});
test("remote acceptance never selects a deployment or public credentials implicitly", () => {
  assert.throws(() => remoteAcceptanceConfig({}), /explicitly/);
  assert.throws(() => remoteAcceptanceConfig({ DSH_BASE_URL: "https://app.example.test" }), /private/);
  assert.throws(() => remoteAcceptanceConfig({ DSH_BASE_URL: "https://app.example.test", DSH_ACCEPTANCE_USERNAME: "dshbaseacceptance", DSH_ACCEPTANCE_PASSWORD: "private-password" }), /Retired/);
});
test("readiness waits only for old Host schema/version, never submits models or masks errors", async () => {
  let time = 0; const calls = []; const notes = [];
  const options = { expectedVersion: "new-version", timeoutMs: 400_000, pollMs: 100_000, now: () => time, sleep: async ms => { time += ms; }, progress: text => notes.push(text) };
  const read = async (method, params) => {
    calls.push(method); assert.ok(method === "history" || method === "runtimeInfo");
    if (method === "history") { assert.equal(params.sessionId, "created"); return { status: 200, body: { result: { records: [], ...(time === 0 ? {} : { turns: [] }) } } }; }
    if (time === 100_000) return { status: 200, body: { error: { code: "unknown_method" } } };
    return { status: 200, body: { result: { versionId: time < 300_000 ? "old-version" : "new-version", turnLifecycle: 1 } } };
  };
  assert.deepEqual(await waitForHostReadiness(read, "created", options), { elapsedMs: 300_000, versionId: "new-version" });
  assert.ok(notes.some(note => note.includes("observed old-version")));
  assert.equal(calls.filter(method => method === "history").length, 4);
  for (const reply of [
    { status: 503, body: {} }, { status: 401, body: {} },
    { status: 200, body: { error: { code: "not_found" } } },
    { status: 200, body: { result: { records: [], turns: {} } } },
    { status: 200, body: { result: { records: [], turns: [{ status: "completed" }] } } },
  ]) await assert.rejects(waitForHostReadiness(async () => reply, "created", options), /Host readiness/);
  time = 0;
  await assert.rejects(waitForHostReadiness(async () => ({ status: 200, body: { result: { records: [] } } }), "created", { ...options, timeoutMs: 310_000 }), /timeout after 310000ms/);
});
test("template init validates before writing and never overwrites existing identities/secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-template-test-"));
  try {
    for (const file of ["scripts/template/init.mjs", "apps/web/scripts/deployment-config.mjs", "apps/web/deployment.example.json"]) {
      const target = join(root, file); mkdirSync(resolve(target, ".."), { recursive: true }); copyFileSync(file, target);
    }
    const run = (name) => spawnSync(process.execPath, [join(root, "scripts/template/init.mjs"), "--worker-name", name, "--auth-base-url", "https://app.example.test"], { cwd: root, encoding: "utf8" });
    assert.notEqual(run("bad/name").status, 0);
    const deployment = join(root, "apps/web/deployment.local.json");
    const secrets = join(root, "apps/web/.dev.vars");
    assert.equal(existsSync(deployment), false);
    assert.equal(existsSync(secrets), false);
    const initialized = run("test-app"); assert.equal(initialized.status, 0, initialized.stderr);
    const original = readFileSync(deployment, "utf8"); const credentials = readFileSync(secrets, "utf8");
    assert.equal(JSON.parse(original).workerName, "test-app");
    for (const name of ["AUTH_SECRET", "CREDENTIALS_KEY", "AUTH_REGISTRATION_TOKEN", "PLUGIN_CONTROL_TOKEN"]) assert.match(credentials, new RegExp(`${name}=.{32,}`));
    assert.notEqual(run("replacement").status, 0);
    assert.equal(readFileSync(deployment, "utf8"), original);
    assert.equal(readFileSync(secrets, "utf8"), credentials);
    assert.ok(!initialized.stdout.includes(credentials));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
