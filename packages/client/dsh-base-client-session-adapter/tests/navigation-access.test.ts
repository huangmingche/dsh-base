import assert from 'node:assert/strict';
import { createAccountSession } from '../src/client/account-session.ts';
import { createNavigationAccess, createNavigationView, navigationLoginHref } from '../src/client/navigation-access.ts';
import { createDirectoryRemote } from '../src/client/directory-remote.ts';

let user: { id: string; username: string; email: string } | null = null;
let failure: Error | undefined;
const account = createAccountSession(async () => { if (failure) throw failure; return user; });
const access = createNavigationAccess(account);
let language = 'zh-CN';
const listeners = new Set<() => void>();
const view = createNavigationView(access, {
  getSnapshot: () => ({ active: language }),
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
});
let changes = 0;
const unsubscribe = view.subscribe(() => { changes++; });
let calls = 0;
const success = { ok: true, value: { entries: [] } };
const directories = createDirectoryRemote(() => ({ call: async () => { calls++; return success; } }) as never, () => access.getSnapshot() === 'authenticated');
const expectBlocked = async (state: string) => {
  assert.equal(access.getSnapshot(), state);
  assert.equal(view.getSnapshot().allowed, false);
  assert.ok(view.getSnapshot().reason);
  const before = calls;
  for (const request of [() => directories.list(), () => directories.pick(), () => directories.createDirectory('/', 'workspace')]) {
    assert.deepEqual(await request(), { ok: false, error: { code: 'auth/required', message: 'Sign in to browse workspaces.', details: {} } });
  }
  assert.equal(calls, before, `${state} must never reach private directory transport`);
};
await expectBlocked('checking');
await account.read();
await expectBlocked('anonymous');
assert.equal(view.getSnapshot().emptyLabel, '登录后查看工作区和会话。');
assert.equal(view.getSnapshot(), view.getSnapshot(), 'unchanged external-store snapshots remain referentially stable');
user = { id: 'owner', username: 'owner', email: 'owner@example.test' };
await account.refresh();
assert.equal(access.getSnapshot(), 'authenticated');
assert.equal(view.getSnapshot().allowed, true);
assert.equal(view.getSnapshot().reason, '');
assert.equal(await directories.list(), success);
assert.equal(calls, 1);
failure = new Error('account unavailable');
await assert.rejects(account.refresh(), failure);
await expectBlocked('error');
assert.notEqual(view.getSnapshot().reason, '登录后可用。', 'an account-service failure is not a fabricated sign-out');
failure = undefined;
user = null;
await account.refresh();
await expectBlocked('anonymous');
assert.equal(changes, 4, 'login, error and logout notify existing UI consumers');
for (const locale of ['en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt-BR']) {
  language = locale;
  for (const listener of listeners) listener();
  const state = view.getSnapshot();
  assert.ok(state.reason && state.emptyLabel && state.signInLabel, `${locale} has complete availability copy`);
  assert.equal(state.state, 'anonymous');
}
unsubscribe();
assert.equal(listeners.size, 0);
const before = changes;
await account.refresh();
assert.equal(changes, before, 'disposed views do not retain account subscriptions');
const aborted = AbortSignal.abort(new Error('cancelled'));
await assert.rejects(directories.list('/', aborted), /cancelled/);
assert.equal(calls, 1);
assert.equal(navigationLoginHref({ pathname: '/zh-CN/app/session/a', search: '?q=1', hash: '#step' }, 'zh-CN'), '/login?next=%2Fzh-CN%2Fapp%2Fsession%2Fa%3Fq%3D1%23step&locale=zh-CN');
console.log('Navigation availability: checked auth, fail-closed directory transport, revocation, locales and disposal passed');
