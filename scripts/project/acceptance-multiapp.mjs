#!/usr/bin/env node
/** Build a second real Web application in a disposable source snapshot. No remote resources. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { constants, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../apps/web/scripts/acceptance-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = join(root, '.artifacts/multiapp-acceptance');
const fixture = join(evidence, 'fixture');
const report = { ok: false, scope: 'Local second-app scaffold, independent profile, strict types and deployable Workers build; existing dependency installation reused read-only. No fresh install or remote deployment.' };
mkdirSync(evidence, { recursive: true });
if (existsSync(fixture)) throw new Error(`Remove the previous disposable fixture before retrying: ${fixture}`);
mkdirSync(fixture);
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const fingerprint = () => createHash('sha256').update(tracked.filter(file => existsSync(join(root, file)) && lstatSync(join(root, file)).isFile()).map(file => file + ':' + createHash('sha256').update(readFileSync(join(root, file))).digest('hex')).join('\n')).digest('hex');
const before = fingerprint();
function prepareSnapshot() {
for (const file of tracked) {
  const source = join(root, file);
  if (!existsSync(source) || !lstatSync(source).isFile()) continue;
  mkdirSync(dirname(join(fixture, file)), { recursive: true });
  copyFileSync(source, join(fixture, file), constants.COPYFILE_FICLONE);
}
for (const path of ['.submodules/deepseek-harness', 'node_modules', 'apps/web/node_modules', 'packages/build/dsh-base-build-server-dependencies/node_modules']) {
  if (!existsSync(join(root, path))) continue;
  mkdirSync(dirname(join(fixture, path)), { recursive: true });
  symlinkSync(join(root, path), join(fixture, path));
}
}
async function run(args, name) {
  const log = createWriteStream(join(evidence, name));
  const env = { ...process.env, DSH_PRODUCT_ROOT: fixture };
  for (const key of Object.keys(env)) if (key === 'DSH_APP' || key === 'DSH_DEPLOYMENT_CONFIG' || /^DSH_(?:WORKER_NAME|D1_|R2_|AUTH_BASE_URL|SAAS_JSON|INDEXING_JSON)/u.test(key)) delete env[key];
  const child = spawn(process.execPath, args, { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await new Promise(resolve => log.end(resolve));
  assert.equal(code, 0, `${name}: inspect the acceptance log`);
}
async function inspectApplication(appRoot) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const registrationToken = randomBytes(32).toString('base64url');
  const log = createWriteStream(join(evidence, 'second-app-server.log'));
  const server = spawn(process.execPath, [join(root, 'apps/web/scripts/serve-local.mjs')], {
    cwd: appRoot, env: { ...process.env, DSH_PRODUCT_ROOT: fixture, DSH_APP: 'multiapp-check', DSH_LOCAL_PORT: String(port), DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_COMPATIBILITY_DATE: '2026-10-30', DSH_LOCAL_FORBID_OUTBOUND: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false, browser;
  server.stdout.on('data', data => { if (data.toString().includes('Local Worker ready:')) ready = true; });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  try {
    const deadline = Date.now() + 30_000;
    while (!ready) {
      if (server.exitCode !== null || Date.now() > deadline) throw new Error('Second application local Worker failed to start; inspect server log');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const puppeteer = createRequire(join(root, 'apps/web/package.json'))('puppeteer-core');
    browser = await puppeteer.launch(acceptanceLaunchOptions());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    // Session transports may stay open; readiness is the actual plugin runtime,
    // not a network-idle condition that never holds for a connected application.
    await page.goto(`${origin}/zh-CN`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-auth-dialog]', { visible: true });
    assert.equal(await page.$('[data-signed-out], [contenteditable]'), null);
    const id = randomBytes(8).toString('hex');
    const signup = await fetch(origin + '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-dsh-registration-token': registrationToken },
      body: JSON.stringify({ username: 'multi' + id, email: id + '@example.test', name: 'Multi-app acceptance', password: randomBytes(24).toString('base64url') }),
    });
    assert.equal(signup.status, 200);
    const cookie = signup.headers.getSetCookie().join('; ').match(/(better-auth\.session_token)=([^;]+)/u);
    assert.ok(cookie, 'local signup returns a signed credential');
    await page.setCookie({ name: cookie[1], value: cookie[2], url: origin, httpOnly: true, sameSite: 'Lax' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\/app\/session\/[^/]+$/u.test(location.pathname) && document.querySelector('[contenteditable="true"]'), { timeout: 30_000 });
    await page.waitForFunction(() => window.__DSH_BASE_PLUGINS__?.filter(row => row.enabled).every(row => row.fiberPhase === 'active'), { timeout: 30_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '插件'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '插件').click());
    await page.waitForFunction(() => document.body.textContent.includes('已安装插件'));
    assert.equal(await page.evaluate(() => /\d+\s*个插件包/.test(document.body.textContent)), false, 'selected application disables the count plugin');
    await page.screenshot({ path: join(evidence, 'second-app-plugins.png'), captureBeyondViewport: false });
    const denied = await fetch(`${origin}/api/session-host`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'workspaceList', params: {} }) });
    assert.equal(denied.status, 401, 'browsing plugins must not grant private access');
    assert.deepEqual(errors, []);
    return { rendered: true, optionalCountPluginDisabled: true, privateApiStatus: denied.status, pageErrors: errors };
  } finally {
    if (browser) await closeAcceptanceBrowser(browser);
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => { const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 10_000); server.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await new Promise(resolve => log.end(resolve));
  }
}
try {
  prepareSnapshot();
  await run(['scripts/project/add-app.mjs', '--id', 'multiapp-check'], 'scaffold.log');
  const app = join(fixture, 'apps/multiapp-check');
  symlinkSync(join(root, 'apps/web/node_modules'), join(app, 'node_modules'));
  writeFileSync(join(app, 'composition.profile.json'), JSON.stringify({ client: [{ name: '@dsh-base/client-plugin-counts', disabled: true }] }));
  // A default-app sentinel must survive every second-app generator and compiler.
  const sentinel = join(fixture, 'packages/client/dsh-base-client-session-adapter/src/client/owned-plugin-inventory.generated.ts');
  writeFileSync(sentinel, '// default-app sentinel\n');
  await run(['scripts/project/run.mjs', 'build', '--app', 'multiapp-check'], 'second-app-build.log');
  assert.equal(readFileSync(sentinel, 'utf8'), '// default-app sentinel\n');
  const generated = join(fixture, '.artifacts/dsh/applications/multiapp-check');
  assert.ok(existsSync(join(generated, '.artifacts/typecheck/report.json')));
  assert.ok(existsSync(join(generated, 'apps/multiapp-check/src/worker/generated-composition.ts')));
  assert.ok(existsSync(join(app, '.cloudflare/output/v0')));
  report.browser = await inspectApplication(app);
  assert.equal(fingerprint(), before, 'acceptance must not modify repository sources');
  report.ok = true;
  report.generatedRoot = generated;
  report.appRoot = app;
  report.sourceUnchanged = true;
  console.log('Second application scaffold, strict types, isolated generation and Workers build passed.');
} finally {
  try {
    writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  } finally {
    // A failed report write (for example a full disk) must not leave the
    // disposable source snapshot behind and prevent the next acceptance run.
    if (process.env.DSH_KEEP_ACCEPTANCE_FIXTURE !== 'true') rmSync(fixture, { recursive: true, force: true });
  }
}
