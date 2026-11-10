import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailStatusStore, readEmailStatus } from '../src/client/status-store.ts';
test('public readiness accepts only valid configured state and projects no secrets', () => {
  assert.deepEqual(readEmailStatus({ email: { enabled: true, ready: true, provider: 'resend', secret: 'must-not-project' } }), { enabled: true, ready: true, provider: 'resend' });
  for (const email of [null, {}, { enabled: false, ready: true, provider: 'resend' }, { enabled: true, ready: true, provider: null }, { enabled: true, ready: true, provider: 'unknown' }]) assert.equal(readEmailStatus({ email }), undefined);
});
test('email status only performs the public readonly request', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const store = new EmailStatusStore(async (input, init) => { calls.push([String(input), init]); return Response.json({ email: { enabled: false, ready: false, provider: null } }); });
  await store.reload(); assert.equal(store.getSnapshot().status, 'ready'); assert.equal(calls.length, 1); assert.equal(calls[0]![0], '/api/auth-policy'); assert.equal(calls[0]![1]?.method, undefined);
});
test('malformed or failed policy is never presented as a ready configuration', async () => {
  const store = new EmailStatusStore(async () => Response.json({ email: { enabled: true, ready: true, provider: 'unknown' } }));
  await store.reload(); assert.deepEqual(store.getSnapshot(), { status: 'error' });
});
