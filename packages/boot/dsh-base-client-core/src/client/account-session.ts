/** One checked account snapshot shared by account views and private Host startup. */
import { readLocalAccount, type LocalAccountUser } from './account-transport.ts';

type Snapshot = { readonly user: LocalAccountUser | null } | { readonly error: unknown };

export function createAccountSession(read: () => Promise<LocalAccountUser | null> = readLocalAccount) {
  let snapshot: Snapshot | undefined;
  let pending: Promise<LocalAccountUser | null> | undefined;
  let revision = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const publish = (value: Snapshot) => {
    snapshot = value; revision++;
    for (const listener of [...listeners]) listener();
  };
  const refresh = (): Promise<LocalAccountUser | null> => {
    if (pending !== undefined) return pending;
    pending = Promise.resolve().then(read).then(user => { publish({ user }); return user; }, error => { publish({ error }); throw error; })
      .finally(() => { pending = undefined; });
    return pending;
  };
  const current = (): LocalAccountUser | null | undefined => snapshot !== undefined && 'user' in snapshot ? snapshot.user : undefined;
  const status = (): 'checking' | 'anonymous' | 'authenticated' | 'error' => snapshot === undefined
    ? 'checking' : 'error' in snapshot ? 'error' : snapshot.user === null ? 'anonymous' : 'authenticated';
  const get = async (): Promise<LocalAccountUser | null> => {
    if (pending !== undefined) return pending;
    if (snapshot === undefined) return refresh();
    if ('error' in snapshot) throw snapshot.error;
    return snapshot.user;
  };
  const readUntilAborted = (signal: AbortSignal): Promise<LocalAccountUser | null> => new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    // Cancelling one consumer must not cancel the account request shared by
    // other consumers, but it must release this stream without waiting for HTTP.
    void get().then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
  const watch = async function* (signal: AbortSignal): AsyncGenerator<LocalAccountUser | null> {
    let observed = -1;
    while (!signal.aborted) {
      try { await readUntilAborted(signal); }
      catch (error) { if (signal.aborted) return; throw error; }
      if (signal.aborted) return;
      // A newer refresh can settle between promise resolution and this task.
      // Capture the value and revision together, never label an older user
      // with the latest revision and then wait forever for a missed change.
      const latest = snapshot!;
      if ('error' in latest) throw latest.error;
      observed = revision;
      yield latest.user;
      if (signal.aborted || observed !== revision) continue;
      await new Promise<void>(resolve => {
        const done = () => { unsubscribe(); signal.removeEventListener('abort', done); resolve(); };
        const unsubscribe = subscribe(done);
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted || observed !== revision) done();
      });
    }
  };
  const waitForAuthentication = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    for await (const user of watch(signal)) {
      if (user !== null) { signal.throwIfAborted(); return; }
    }
    signal.throwIfAborted();
  };
  const openAuthenticated = async function* <Item>(signal: AbortSignal, open: (signal: AbortSignal) => AsyncIterable<Item>): AsyncGenerator<Item> {
    await waitForAuthentication(signal);
    const owner = current()?.id;
    if (owner === undefined) {
      if (snapshot !== undefined && 'error' in snapshot) throw snapshot.error;
      throw Object.assign(new Error('Sign in before opening a private Host stream.'), { code: 'auth/required' });
    }
    const revoked = new AbortController();
    const inspect = () => {
      if (current()?.id !== owner) revoked.abort(new Error('Account authentication changed'));
    };
    const unsubscribe = subscribe(inspect);
    const scoped = AbortSignal.any([signal, revoked.signal]);
    try {
      inspect();
      scoped.throwIfAborted();
      yield* open(scoped);
    } finally { unsubscribe(); }
  };
  return { read: get, refresh, current, status, subscribe, watch, waitForAuthentication, openAuthenticated };
}

/** One module instance is shared by pre-Loader composition and plugin Host seams. */
export const accountSession = createAccountSession();
