/**
 * SQLite boundary for the forked rc.6 persistence backend.
 *
 * The upstream backend opens a `node:sqlite` DatabaseSync. On Workers the only
 * SQLite is the Durable Object's SQL storage, so the fork talks to this narrow
 * interface instead; the DO adapter below is the only mapping.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqliteStatement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): void;
}

export interface SqliteLike {
  prepare(sql: string): SqliteStatement;
  /** Execute DDL or PRAGMA statements; manual BEGIN/COMMIT are no-ops by design. */
  exec(sql: string): void;
  /** Run a body atomically through the platform's transaction primitive. */
  transaction<T>(body: () => T): T;
  close(): void;
}

/** The subset of the Durable Object storage face this adapter needs. */
export interface DoSqlStorage {
  readonly sql: { exec(query: string, ...bindings: SqlValue[]): { one(): unknown; toArray(): unknown[] } };
  transactionSync<T>(body: () => T): T;
}

/** Map Durable Object SQL onto the backend's DatabaseSync-shaped boundary. */
export function doSqlite(storage: DoSqlStorage): SqliteLike {
  return {
    prepare(sql) {
      return {
        get: (...params) => storage.sql.exec(sql, ...params).one(),
        all: (...params) => storage.sql.exec(sql, ...params).toArray(),
        run: (...params) => { storage.sql.exec(sql, ...params); },
      };
    },
    exec(sql) {
      // Transactions belong to transactionSync; the fork never issues these
      // through exec after adaptation, and a nested BEGIN would throw.
      if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/iu.test(sql)) return;
      storage.sql.exec(sql);
    },
    transaction: (body) => storage.transactionSync(body),
    close() { /* the platform owns the DO database lifetime */ },
  };
}
