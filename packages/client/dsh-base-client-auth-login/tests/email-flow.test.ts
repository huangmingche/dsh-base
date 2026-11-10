import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailCallbackURL, resetTokenFromURL, withoutEmailToken } from '../src/client/email-flow.ts';
import { emailCopy } from '../src/client/email-locales.ts';
import { LOGIN_LOCALE_IDS } from '../src/client/locales.ts';
import { readAuthPolicy } from '../src/client/registration-policy.ts';

test('email actions construct same-origin callbacks and strip credential URLs', () => {
  const url = new URL('https://app.example/login?mode=reset-password&token=private-token&error=unknown&locale=fr&next=https%3A%2F%2Fevil.example');
  const reset = new URL(emailCallbackURL(url, 'fr', 'reset'));
  assert.equal(reset.origin, url.origin); assert.equal(reset.pathname, '/login');
  assert.equal(reset.searchParams.get('mode'), 'reset-password');
  assert.equal(reset.searchParams.has('token'), false); assert.equal(reset.searchParams.has('next'), false);
  assert.equal(resetTokenFromURL(url), 'private-token');
  assert.doesNotMatch(withoutEmailToken(url, true), /token|error|reset-password/);
  assert.equal(new URL(withoutEmailToken(url), url).searchParams.get('mode'), 'reset-password');
  url.searchParams.set('error', 'invalid_token'); assert.equal(resetTokenFromURL(url), undefined);
  url.searchParams.delete('error'); url.searchParams.set('token', 'bad token'); assert.equal(resetTokenFromURL(url), undefined);
  url.searchParams.set('next', '/app/session/one?panel=files');
  assert.equal(new URL(emailCallbackURL(url, 'fr', 'verification')).searchParams.get('next'), '/app/session/one?panel=files');
});

test('email and OAuth capabilities require explicit safe policy values', async () => {
  const read = (body: unknown) => readAuthPolicy((async () => Response.json(body)) as typeof fetch);
  assert.equal((await read({ signUpEnabled: false })).passwordResetEnabled, false);
  assert.equal((await read({ signUpEnabled: true, googleEnabled: 'true' })).googleEnabled, false);
  const good = { signUpEnabled: true, email: { enabled: true, ready: true, provider: 'resend' }, passwordResetEnabled: true, emailVerificationEnabled: true, emailVerificationRequired: true, googleEnabled: true };
  const policy = await read(good);
  assert.equal(policy.registration, 'enabled'); assert.equal(policy.passwordResetEnabled, true); assert.equal(policy.googleEnabled, true);
  for (const email of [undefined, { enabled: true, ready: 'true', provider: 'resend' }, { enabled: false, ready: true, provider: 'resend' }, { enabled: true, ready: true, provider: 'unknown' }]) {
    const denied = await read({ ...good, email });
    assert.equal(denied.passwordResetEnabled, false); assert.equal(denied.emailVerificationEnabled, false);
  }
});

test('email UI explains all states in eight official languages', () => {
  for (const locale of LOGIN_LOCALE_IDS) {
    const copy = emailCopy(locale);
    assert.deepEqual(Object.keys(copy), Object.keys(emailCopy('en')));
    for (const value of Object.values(copy)) assert.ok(value.trim());
    if (locale !== 'en') assert.notEqual(copy.unavailable, emailCopy('en').unavailable);
  }
  assert.equal(emailCopy('zh-CN'), emailCopy('zh'));
});
