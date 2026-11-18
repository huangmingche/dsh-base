/** Exercise the real workerd SQLite cursor and the commit notification used by Session Control. */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const app = join(root, 'apps/web');
const { build } = createRequire(join(app, 'package.json'))('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const code = `
import { HostChangeFeed, observeHostWrites } from './src/change-feed.ts';
export class SessionHostFixture {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch() {
    const raw = this.storage.sql;
    raw.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
    raw.exec("INSERT INTO sessions VALUES ('own', 'original')");
    raw.exec("UPDATE sessions SET title = 'ignored' WHERE id = 'absent'");
    const feed = new HostChangeFeed();
    const sql = observeHostWrites({
      exec: (query, ...args) => raw.exec(query, ...args),
      transactionSync: (fn) => this.storage.transactionSync(fn),
    }, feed);
    const readRevision = async () => {
      const stream = feed.subscribe(new AbortController().signal)[Symbol.asyncIterator]();
      try { return (await stream.next()).value.revision; }
      finally { await stream.return(); }
    };
    const abort = new AbortController();
    const active = feed.subscribe(abort.signal)[Symbol.asyncIterator]();
    await active.next();
    const next = active.next();
    const rename = (id, title) => sql.exec('UPDATE sessions SET title = ? WHERE id = ? RETURNING id, title', title, id).toArray();
    const rows = sql.transactionSync(() => rename('own', 'changed'));
    const committed = await readRevision();
    // A committed write must immediately wake the already-open subscriber.
    // Checking the revision first keeps a missed notification from hanging CI.
    const notification = committed > 0 ? (await next).value : null;
    const missingRows = sql.transactionSync(() => rename('missing', 'ignored'));
    const afterMissing = await readRevision();
    try {
      sql.transactionSync(() => { rename('own', 'reverted'); throw new Error('rollback'); });
    } catch (error) { if (error.message !== 'rollback') throw error; }
    const afterRollback = await readRevision();
    const title = raw.exec("SELECT title FROM sessions WHERE id = 'own'").one().title;
    abort.abort();
    await next;
    await active.return();
    return Response.json({ rows, committed, notification, missingRows, afterMissing, afterRollback, title });
  }
}
export default { fetch(req, env) { return env.HOST.get(env.HOST.idFromName('test-owner')).fetch(req); } };
`;

test('SQLite RETURNING notifies existing readers once after commit, and stays silent on a miss or rollback', async () => {
  const bundled = await build({
    stdin: { contents: code, resolveDir: join(root, 'packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'session-host-change-feed', modules: true, port: 0, host: '127.0.0.1', compatibilityDate: '2026-10-01',
    script: bundled.outputFiles[0].text, durableObjects: { HOST: { className: 'SessionHostFixture', useSQLite: true } },
  }));
  try {
    const response = await mf.dispatchFetch('https://localhost/');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.rows, [{ id: 'own', title: 'changed' }], 'the caller receives the committed RETURNING row');
    assert.equal(result.committed, 1, 'the returning write published at commit');
    assert.deepEqual(result.notification, { type: 'invalidate', revision: 1, topics: ['sessions'] });
    assert.deepEqual(result.missingRows, []);
    assert.equal(result.afterMissing, 1, 'a missing row does not notify');
    assert.equal(result.afterRollback, 1, 'a reverted write does not notify');
    assert.equal(result.title, 'changed');
  } finally {
    await mf.dispose();
  }
});
