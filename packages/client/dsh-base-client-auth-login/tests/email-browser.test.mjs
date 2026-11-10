/** Browser regression of the real plugin surface with local HTTP fixtures only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from '../../../../apps/web/scripts/acceptance-config.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const app = resolve(root, 'apps/web'), require = createRequire(resolve(app, 'package.json'));
const vite = await import(require.resolve('vite')), puppeteer = require('puppeteer-core');
const output = resolve(root, '.artifacts/acceptance/email-auth');
const report = { ok: false, checks: [], requests: [], browserErrors: [] };
let server, browser;
try {
  await mkdir(output, { recursive: true });
  const configFile = resolve(app, 'vite.parity.config.ts'), build = { outDir: resolve(output, 'bundle'), emptyOutDir: true };
  await vite.build({ configFile, logLevel: 'error', build });
  server = await vite.preview({ configFile, logLevel: 'error', build, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch(acceptanceLaunchOptions());
  const page = await browser.newPage(); page.setDefaultTimeout(20000);
  await page.setViewport({ width: 390, height: 900 });
  page.on('pageerror', error => report.browserErrors.push(error.message));
  let enabled = false;
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) { await request.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await request.continue(); return; }
    const body = request.postData() ? JSON.parse(request.postData()) : undefined;
    report.requests.push({ path: url.pathname, method: request.method(), body });
    let status = 200, result = {};
    if (url.pathname === '/api/auth-policy') result = { signUpEnabled: true, email: { enabled, ready: enabled, provider: enabled ? 'resend' : null }, passwordResetEnabled: enabled, emailVerificationEnabled: enabled, emailVerificationRequired: enabled, googleEnabled: enabled };
    else if (url.pathname === '/api/auth/sign-up/email') result = { user: { id: 'fixture-user' }, token: null };
    else if (url.pathname === '/api/auth/sign-in/email') { status = 403; result = { code: 'EMAIL_NOT_VERIFIED' }; }
    else if (url.pathname === '/api/auth/sign-in/social') result = { url: 'https://outside.example/untrusted' };
    else if (['/api/auth/request-password-reset', '/api/auth/send-verification-email', '/api/auth/reset-password'].includes(url.pathname)) result = { status: true };
    else { await request.abort(); return; }
    await request.respond({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  const goto = async (extra = {}) => {
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'auth-primitives', side: 'adapted', locale: 'en', ...extra })}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-auth-dialog]', { visible: true });
  };
  const clickText = async text => {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll('[data-auth-dialog] button')].find(button => button.textContent.trim() === text), text);
    assert.ok(button.asElement(), `missing button ${text}`); await button.asElement().click(); await button.dispose();
  };
  const fill = async (name, value) => {
    await page.$eval(`[data-auth-dialog] input[name="${name}"]`, input => { input.focus(); input.select(); });
    await page.keyboard.type(value);
  };
  const submit = () => page.click('[data-auth-dialog] button[type="submit"]');
  const step = value => page.waitForSelector(`[data-auth-step="${value}"]`);
  const last = path => report.requests.filter(request => request.path === path).at(-1);
  await goto();
  assert.deepEqual(await page.$$eval('[data-auth-email]', nodes => nodes.map(node => node.disabled)), [true, true]);
  const unavailable = 'Email verification and password recovery are unavailable on this site.';
  assert.deepEqual(await page.$$eval('[data-auth-email]', nodes => nodes.map(node => node.title)), [unavailable, unavailable]);
  assert.equal(await page.$eval('[data-auth-dialog] [role="status"]', node => node.textContent), unavailable, 'unavailable mail actions have a localized explanation');
  await page.screenshot({ path: resolve(output, 'disabled-mobile.png') });
  await fill('username', 'person@example.test'); await submit(); await step('password');
  assert.equal(await page.$eval('[data-auth-dialog] [role="status"]', node => node.textContent), unavailable, 'unavailable mail actions have a localized explanation');
  await fill('password', 'fixture-password-123'); await submit(); await step('verification');
  assert.match(await page.$eval('[data-auth-dialog]', node => node.textContent), /verification and password recovery are unavailable/);
  assert.equal(await page.$eval('button[type="submit"]', node => node.disabled), true, 'required verification stays blocked while email is unavailable');
  await goto({ mode: 'register' }); await step('register');
  assert.equal(await page.$eval('[data-auth-dialog] [role="status"]', node => node.textContent), unavailable, 'unavailable mail actions have a localized explanation');
  await goto({ locale: 'zh' }); await step('identifier');
  assert.deepEqual(await page.$$eval('[data-auth-email]', nodes => nodes.map(node => node.disabled)), [true, true]);
  const localizedHints = await page.$$eval('[data-auth-email]', nodes => nodes.map(node => node.title));
  assert.ok(localizedHints.every(title => title.length > 0 && title !== unavailable), 'disabled controls retain localized explanations');
  assert.equal(await page.$eval('[data-auth-dialog] [role="status"]', node => node.textContent), localizedHints[0], 'unavailable mail actions have a localized explanation');
  for (const mode of ['forgot-password', 'reset-password']) {
    await goto({ mode, ...(mode === 'reset-password' ? { token: 'fixture-disabled-secret' } : {}) });
    await step(mode);
    assert.equal(await page.$eval('[data-auth-dialog] [role="status"]', node => node.textContent), unavailable, 'requested email actions explain why they are blocked');
    assert.equal(await page.$eval('button[type="submit"]', node => node.disabled), true);
    const before = report.requests.length;
    await page.$eval('[data-auth-dialog] form', form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(report.requests.length, before, 'blocked email actions send no requests');
  }
  report.checks.push('unconfigured mail controls remain visible and disabled with localized button hints', 'sign-in, password and registration explain unavailable mail actions', 'requested unavailable email actions retain explanations and block requests');
  enabled = true;
  await goto(); await page.click('[data-auth-email="reset"]'); await step('forgot-password');
  await fill('email', 'person@example.test'); await submit();
  await page.waitForFunction(() => document.querySelector('[data-auth-dialog]')?.textContent.includes('If an account is eligible'));
  const resetRequest = last('/api/auth/request-password-reset');
  assert.equal(resetRequest.body.email, 'person@example.test');
  const callback = new URL(resetRequest.body.redirectTo);
  assert.equal(callback.origin, origin); assert.equal(callback.pathname, '/login'); assert.equal(callback.searchParams.get('mode'), 'reset-password');
  report.checks.push('password recovery uses a same-origin callback and generic account response');
  await clickText('Back'); await step('identifier'); await page.click('[data-auth-email="verification"]');
  await step('verification'); await fill('email', 'person@example.test'); await submit();
  await page.waitForFunction(() => document.querySelector('[data-auth-dialog]')?.textContent.includes('If the account needs verification'));
  assert.equal(new URL(last('/api/auth/send-verification-email').body.callbackURL).origin, origin);
  report.checks.push('verification resend calls the real API contract');
  await goto({ mode: 'register' }); await step('register');
  await fill('username', 'fixtureuser'); await fill('email', 'person@example.test'); await fill('password', 'fixture-password-123'); await submit();
  await step('verification');
  assert.match(await page.$eval('[data-auth-dialog]', node => node.textContent), /Check your email/);
  report.checks.push('registration requiring verification does not report signed-in success');
  await goto(); await fill('username', 'person@example.test'); await submit(); await step('password');
  await fill('password', 'fixture-password-123'); await submit(); await step('verification');
  assert.equal(await page.$eval('input[name="email"]', node => node.value), 'person@example.test');
  report.checks.push('unverified sign-in opens the resend flow without granting access');
  await goto({ mode: 'reset-password', token: 'fixture-reset-secret' }); await step('reset-password');
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  await fill('password', 'new-password-123'); await fill('confirmation', 'different-password');
  const before = report.requests.length; await submit();
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('do not match'));
  assert.equal(report.requests.length, before);
  await fill('confirmation', 'new-password-123'); await submit(); await step('identifier');
  assert.equal(last('/api/auth/reset-password').body.token, 'fixture-reset-secret');
  assert.equal(last('/api/auth/reset-password').body.newPassword, 'new-password-123');
  assert.equal(new URL(page.url()).searchParams.has('token'), false); assert.equal(new URL(page.url()).searchParams.has('mode'), false);
  assert.match(await page.$eval('[data-auth-dialog]', node => node.textContent), /Password updated/);
  await page.screenshot({ path: resolve(output, 'reset-success-mobile.png') });
  report.checks.push('reset token is removed from history, password confirmation works and success returns to sign-in');
  await goto({ mode: 'reset-password', error: 'invalid_token' }); await step('reset-password');
  assert.equal(await page.$eval('button[type="submit"]', node => node.disabled), true);
  assert.match(await page.$eval('[role="alert"]', node => node.textContent), /invalid or expired/);
  await page.keyboard.press('Escape'); await page.waitForSelector('[data-auth-dialog]', { hidden: true });
  assert.equal(new URL(page.url()).searchParams.has('mode'), false);
  report.checks.push('invalid links disable submission; cancellation removes reset state');
  await goto(); await clickText('Continue with Google');
  await page.waitForSelector('[data-auth-dialog] [role="alert"]');
  assert.equal(last('/api/auth/sign-in/social').body.provider, 'google');
  assert.equal(new URL(last('/api/auth/sign-in/social').body.callbackURL).origin, origin);
  assert.equal(new URL(page.url()).origin, origin, 'unexpected OAuth redirect origins are rejected');
  report.checks.push('Google uses a same-origin callback and rejects an unexpected authorization origin');
  assert.deepEqual(report.browserErrors, []);
  report.ok = true;
  console.log(JSON.stringify({ ok: true, checks: report.checks, output }));
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await closeAcceptanceBrowser(browser); if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
