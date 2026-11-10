import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleConfig } from '../src/config.ts';
import { createAuthExtensions } from '../../dsh-base-cloudflare-worker-auth/src/extensions.ts';
import { googleAuthExtension } from '../src/index.ts';

const env = { AUTH_GOOGLE_ENABLED: 'true', AUTH_BASE_URL: 'https://app.example.test', GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-only-google-secret' };
test('Google is explicit, validated, and preserves closed public registration', () => {
  assert.equal(googleConfig({}), undefined);
  for (const value of [{ ...env, AUTH_GOOGLE_ENABLED: 'false' }, { ...env, GOOGLE_CLIENT_ID: 'https://evil.example' }, { ...env, GOOGLE_CLIENT_SECRET: '' }, { ...env, AUTH_BASE_URL: 'http://example.test' }]) assert.equal(googleConfig(value), undefined);
  assert.equal(googleConfig(env)?.disableSignUp, true);
  assert.equal(googleConfig({ ...env, AUTH_SIGNUP_ENABLED: 'true' })?.disableSignUp, false);
  assert.equal(googleAuthExtension.policy?.(env).googleEnabled, true);
  assert.doesNotMatch(JSON.stringify(googleAuthExtension.policy?.(env)), /secret|clientId/);
  assert.notEqual(googleAuthExtension.cacheKey(env), googleAuthExtension.cacheKey({ ...env, GOOGLE_CLIENT_SECRET: 'rotated-fixture-secret' }));
});
test('auth extension registry rejects duplicates and changes its cache identity on disposal', () => {
  const registry = createAuthExtensions(), remove = registry.register(googleAuthExtension);
  const active = registry.resolve(env);
  assert.ok(active.socialProviders.google);
  assert.throws(() => registry.register(googleAuthExtension), /duplicate_auth_extension/);
  const removeCollision = registry.register({ ...googleAuthExtension, id: 'collision' });
  assert.throws(() => registry.resolve(env), /duplicate_auth_provider/);
  removeCollision(); remove();
  const empty = registry.resolve(env);
  assert.equal(empty.socialProviders.google, undefined); assert.notEqual(active.key, empty.key);
  registry.register({ id: 'bad-policy', cacheKey: () => '', options: () => ({}), policy: () => ({ signUpEnabled: true }) });
  assert.throws(() => registry.resolve(env), /invalid_auth_policy_extension/);
});
