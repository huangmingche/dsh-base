import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HostChangeFeed, observeHostWrites, invalidationResponse } from '../src/change-feed.ts';

const db = new DatabaseSync(':memory:');
const feed = new HostChangeFeed();
const raw = {
  exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; },
  transactionSync<T>(operation: () => T): T { db.exec('BEGIN'); try { const result = operation(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } },
};
const sql = observeHostWrites(raw, feed);
sql.exec('CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT)');
const abort = new AbortController();
const iterator = feed.subscribe(abort.signal)[Symbol.asyncIterator]();
assert.deepEqual((await iterator.next()).value, { type: 'invalidate', revision: 0, topics: [] });
assert.throws(() => sql.transactionSync!(() => { sql.exec("INSERT INTO settings VALUES ('bad','secret')"); throw new Error('rollback'); }), /rollback/);
assert.equal(raw.exec('SELECT * FROM settings').toArray().length, 0);
sql.transactionSync!(() => {
  sql.exec("INSERT INTO settings VALUES ('a','private')");
  sql.exec("INSERT INTO settings VALUES ('b','private')");
});
assert.deepEqual((await iterator.next()).value, { type: 'invalidate', revision: 1, topics: ['settings'] });
sql.exec("INSERT OR IGNORE INTO settings VALUES ('a','no change')");
for (let n = 0; n < 1000; n++) feed.publish([n % 2 ? 'schedule' : 'credentials']);
const coalesced = (await iterator.next()).value!;
assert.equal(coalesced.revision, 1001);
assert.deepEqual(new Set(coalesced.topics), new Set(['schedule', 'credentials']));
const pending = iterator.next();
abort.abort();
assert.equal((await pending).done, true);
const second = new AbortController();
const response = invalidationResponse(feed, second.signal);
const reader = response.body!.getReader();
assert.match(new TextDecoder().decode((await reader.read()).value), /event: invalidate/);
await reader.cancel();
feed.publish(['settings']); // cancellation does not retain/throw on dead streams
const reconnect = feed.subscribe(second.signal)[Symbol.asyncIterator]();
assert.equal((await reconnect.next()).value!.revision, 1002);
second.abort();
await reconnect.return?.();
console.log('session-host: committed push, rollback silence, ignored writes, bounded slow consumers, cancellation and reconnect passed');
