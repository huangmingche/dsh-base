import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@dsh-base/client-saas-ui/transport') return { url: new URL('../../../boot/dsh-base-saas-ui/src/transport.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { definition } = await import('../src/client/definition.ts');
const profile = { user: { id: 'owner', name: 'Owner', username: 'owner', email: 'owner@example.invalid', emailVerified: true, image: null, avatarFileId: null }, canChangePassword: true };
const file = (number, contentType = 'application/pdf') => ({ id: `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`, name: `File ${number}`, contentType });
function loader(pages, status = { enabled: true, ready: true }) {
  const calls = [];
  return { calls, run: () => definition.load({ authenticated: true, request: async path => {
    calls.push(path);
    if (path === '/api/saas/account-profile') return profile;
    if (path.endsWith('/status')) return status;
    const response = pages.shift();
    if (response instanceof Error) throw response;
    return response;
  } }) };
}
test('avatar candidates include images after the first 100 of 200 owner files', async () => {
  const first = Array.from({ length: 100 }, (_, index) => file(index + 1));
  const second = Array.from({ length: 100 }, (_, index) => file(index + 101, index === 99 ? 'image/png' : 'application/pdf'));
  const load = loader([{ items: first, nextCursor: first.at(-1).id }, { items: second, nextCursor: null }]);
  const state = await load.run();
  assert.deepEqual(state.files, [{ id: second.at(-1).id, name: 'File 200' }]);
  assert.deepEqual(load.calls.slice(2), ['/api/saas/files?limit=100', `/api/saas/files?limit=100&cursor=${first.at(-1).id}`]);
  assert.ok(definition.actions(state).find(action => action.id === 'avatar').fields[0].options.some(option => option.value === second.at(-1).id));
});
test('bounded pagination de-duplicates overlap and accepts a final empty page', async () => {
  const a = file(1, 'image/png'), b = file(2, 'image/jpeg');
  const load = loader([{ items: [a], nextCursor: a.id }, { items: [a, b], nextCursor: b.id }, { items: [], nextCursor: null }]);
  assert.deepEqual((await load.run()).files, [{ id: a.id, name: a.name }, { id: b.id, name: b.name }]);
  assert.equal(load.calls.filter(path => path.startsWith('/api/saas/files?')).length, 3);
});
test('invalid, repeated and unbounded cursors fail instead of silently omitting later avatars', async () => {
  const a = file(1, 'image/png'), b = file(2), c = file(3);
  for (const pages of [
    [{ items: [a], nextCursor: 'https://invalid.example/' }],
    [{ items: [a], nextCursor: a.id }, { items: [a], nextCursor: a.id }],
    [{ items: [a], nextCursor: a.id }, { items: [b], nextCursor: b.id }, { items: [c], nextCursor: c.id }],
    [{ items: [a], nextCursor: a.id }, new Error('Second page unavailable')],
  ]) await assert.rejects(loader(pages).run());
});
test('disabled optional storage does not query private files or prevent profile editing', async () => {
  const load = loader([], { enabled: false, ready: false });
  const state = await load.run();
  assert.equal(state.user.name, 'Owner');
  assert.deepEqual(state.files, []);
  assert.equal(load.calls.length, 2);
});
