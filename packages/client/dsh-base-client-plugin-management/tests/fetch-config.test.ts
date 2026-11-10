import assert from 'node:assert/strict';
import { createFetchConfigStore } from '../src/client/fetch-config.ts';

const NAME = '@dsh-base/cloudflare-think-fetch';
let selected: string | undefined = 'session-a';
const listeners = new Set<() => void>();
const current = {
  getSnapshot: () => ({ key: selected }),
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
const select = (id: string | undefined) => { selected = id; for (const listener of listeners) listener(); };
const pending: Array<{ url: string; method: string; body?: Record<string, unknown>; resolve: (response: Response) => void }> = [];
const fetchImpl: typeof fetch = async (input, init) => new Promise<Response>(resolve => {
  pending.push({ url: String(input), method: init?.method ?? 'GET', ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }), resolve });
});
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
const respond = async (index: number, revision: number, allowlist: string[], session = false) => {
  pending[index]!.resolve(Response.json({ revision, [session ? 'session' : 'overrides']: { [NAME]: { config: { allowlist } } } }));
  await settle();
};
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const location = { pathname: '/zh-CN/app/session/url-is-not-the-session' };
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });

const store = createFetchConfigStore(current, fetchImpl);
const disconnect = store.connect();
assert.equal(pending[0]!.url, '/api/plugin-manager', 'initial owner editor has no Session query');
await respond(0, 1, ['https://owner.example/**']);
assert.equal(store.getSnapshot().ready, true);
store.setScope('session');
assert.equal(pending[1]!.url, '/api/plugin-manager?sessionId=session-a', 'localized URLs never determine the target');
location.pathname = '/en/app/session/stale-url';
select('session-b');
assert.equal(pending[2]!.url, '/api/plugin-manager?sessionId=session-b', 'SPA selection subscribes to the official source');
await store.save();
assert.equal(pending.length, 3, 'new Session cannot save the previous editor while its read is pending');
await respond(2, 3, ['https://b.example/**'], true);
await respond(1, 2, ['https://a.example/**'], true);
assert.equal(store.getSnapshot().text, 'https://b.example/**', 'late A response cannot replace B editor');
assert.equal(store.getSnapshot().revision, 3);

store.setText('https://edited-b.example/**');
selected = 'session-c'; // source changed before its notification/React rerender
await store.save();
assert.equal(pending.length, 4);
assert.equal(pending[3]!.method, 'GET', 'save checks the live source and rejects a stale target');
assert.equal(pending[3]!.url, '/api/plugin-manager?sessionId=session-c');
await respond(3, 4, ['https://c.example/**'], true);
store.setText('https://edited-c.example/**');
const savingC = store.save();
assert.deepEqual(pending[4]!.body, { name: NAME, config: { allowlist: ['https://edited-c.example/**'] }, sessionId: 'session-c', expectedRevision: 4 });
select('session-d');
assert.equal(pending[5]!.url, '/api/plugin-manager?sessionId=session-d');
await respond(5, 6, ['https://d.example/**'], true);
await respond(4, 5, []);
await savingC;
assert.equal(store.getSnapshot().text, 'https://d.example/**');
assert.equal(store.getSnapshot().revision, 6, 'late successful C write cannot overwrite D revision');
assert.equal(store.getSnapshot().status, undefined, 'old write cannot show Saved on another Session');

const restoringD = store.restore();
assert.deepEqual(pending[6]!.body, { name: NAME, reset: true, sessionId: 'session-d', expectedRevision: 6 });
await respond(6, 7, []);
await restoringD;
assert.equal(store.getSnapshot().text, '');
select(undefined);
await store.save();
await store.restore();
assert.equal(pending.length, 7, 'losing a Session never falls back to an owner write or query');
assert.equal(store.getSnapshot().ready, false);

store.setScope('owner');
await respond(7, 8, ['https://owner.example/**']);
store.setText('https://owner-new.example/**');
select('session-e');
const savingOwner = store.save();
assert.deepEqual(pending[8]!.body, { name: NAME, config: { allowlist: ['https://owner-new.example/**'] }, expectedRevision: 8 }, 'owner edit remains owner across Session changes');
await respond(8, 9, []);
await savingOwner;
disconnect();
assert.equal(listeners.size, 0, 'unmount releases the official source subscription');
if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as { window?: unknown }).window;
console.log('fetch config: official Session selection, localized URLs, SPA changes and read/write races passed');
