import assert from 'node:assert/strict';
import { accountUpdates, platformNotifications } from '../src/client/account-updates.ts';
import { createAccountSession } from '../src/client/account-session.ts';

let reads = 0;
let result: { id: string; username: string; email: string } | null = null;
let failure: Error | undefined;
const session = createAccountSession(async () => { reads++; if (failure !== undefined) throw failure; return result; });
assert.deepEqual(await Promise.all([session.read(), session.read(), session.read()]), [null, null, null]);
assert.equal(reads, 1, 'simultaneous account/profile/settings reads share one checked session request');
const abort = new AbortController();
const stream = session.watch(abort.signal);
assert.deepEqual(await stream.next(), { value: null, done: false });
const next = stream.next();
let privateOpens = 0;
const privateReady = session.waitForAuthentication(abort.signal).then(() => { privateOpens++; });
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(reads, 1, 'an idle anonymous account watcher never polls or retries private I/O');
assert.equal(privateOpens, 0, 'eager Workspace streams remain pending while anonymous');
result = { id: 'owner-a', username: 'owner-a', email: 'owner-a@example.test' };
await session.refresh();
await privateReady;
assert.equal(privateOpens, 1, 'a checked sign-in admits the pending real stream exactly once');
assert.deepEqual(await next, { value: result, done: false });
assert.equal(session.current()?.id, 'owner-a', 'explicit refresh observes a completed sign-in');
failure = new Error('auth service unavailable');
await assert.rejects(session.refresh(), /auth service unavailable/);
assert.equal(session.current(), undefined, 'failed reads remain unknown rather than forged signed-out');
await assert.rejects(session.read(), /auth service unavailable/);
await assert.rejects(stream.next(), /auth service unavailable/);
assert.equal(reads, 3, 'cached read failures do not create a retry loop');
failure = undefined;
result = null;
await session.refresh();
assert.equal(session.current(), null, 'a confirmed sign-out closes authenticated access');
const stopped = new AbortController();
const cancelled = session.waitForAuthentication(stopped.signal);
const watch = session.watch(stopped.signal);
await watch.next();
const end = watch.next();
stopped.abort();
await assert.rejects(cancelled, { name: 'AbortError' });
assert.deepEqual(await end, { value: undefined, done: true });
abort.abort();

// A shared HTTP read may be slow. Cancelling one consumer must release its
// RemoteStream promptly without cancelling the read needed by other views.
let resolveRead!: (value: null) => void;
const blocked = createAccountSession(() => new Promise(resolve => { resolveRead = resolve; }));
const pendingAbort = new AbortController();
const pendingWatch = blocked.watch(pendingAbort.signal);
const pendingItem = pendingWatch.next();
const pendingAuth = blocked.waitForAuthentication(pendingAbort.signal);
await Promise.resolve();
pendingAbort.abort();
await assert.rejects(pendingAuth, { name: 'AbortError' });
assert.deepEqual(await Promise.race([pendingItem, new Promise((_, reject) => setTimeout(() => reject(new Error('cancel waited on auth HTTP')), 100))]), { value: undefined, done: true });
resolveRead(null);
assert.equal(await blocked.read(), null);

// An opened stream gets an account-scoped cancellation signal as well as its
// caller's signal. Revocation and owner replacement cannot leave private I/O.
for (const change of ['logout', 'owner', 'failure'] as const) {
  let user: typeof result = { id: 'a', username: 'a', email: 'a@example.test' };
  let error: Error | undefined;
  const live = createAccountSession(async () => { if (error) throw error; return user; });
  let activeSignal: AbortSignal | undefined;
  const lifetime = new AbortController();
  const values = live.openAuthenticated(lifetime.signal, async function* (signal) {
    activeSignal = signal;
    yield 'baseline';
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve(); });
  });
  assert.equal((await values.next()).value, 'baseline');
  const ended = values.next();
  if (change === 'logout') user = null;
  if (change === 'owner') user = { id: 'b', username: 'b', email: 'b@example.test' };
  if (change === 'failure') error = new Error('auth unavailable');
  await live.refresh().catch(() => {});
  assert.equal(activeSignal?.aborted, true, `${change} aborts the account-scoped private stream`);
  assert.deepEqual(await ended, { value: undefined, done: true });
}
console.log('account session: shared checked reads, idle anonymous no polling, sign-in/logout refresh, truthful failures and cancellation passed');

// RC4 account settings and notifications consume typed AccountUpdate frames.
// Replacing one owner with another must invalidate cached account details.
const owner = { id: 'a', username: 'A', email: 'a@example.test' };
async function* owners() {
  yield null; yield owner; yield { ...owner, username: 'renamed' }; yield { ...owner, id: 'b' }; yield null;
}
const updates = [];
for await (const update of accountUpdates(owners(), user => user?.username ?? null)) updates.push(update);
assert.deepEqual(updates, [
  { type: 'snapshot', state: null }, { type: 'credentials-changed', state: 'A' },
  { type: 'snapshot', state: 'renamed' }, { type: 'credentials-changed', state: 'A' },
  { type: 'credentials-changed', state: null },
]);
assert.deepEqual(await platformNotifications.getNotifications(), { ok: true, value: null });
assert.deepEqual(await platformNotifications.getNotificationContent(), { ok: true, value: null });
assert.deepEqual(await platformNotifications.reportNotificationEvent(), { ok: true, value: false });
