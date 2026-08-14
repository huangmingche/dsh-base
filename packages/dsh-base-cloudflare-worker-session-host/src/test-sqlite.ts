/** Test-only SqliteLike over node:sqlite; production uses the Durable Object adapter. */
import { DatabaseSync } from "node:sqlite";
import type { SqliteLike, SqlValue } from "./sqlite.ts";

export function nodeSqlite(location = ":memory:"): SqliteLike {
  const db = new DatabaseSync(location);
  let depth = 0;
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get: (...params) => statement.get(...(params as never[])),
        all: (...params) => statement.all(...(params as never[])) as unknown[],
        run: (...params) => { statement.run(...(params as never[])); },
      };
    },
    exec(sql) {
      if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/iu.test(sql)) return;
      db.exec(sql);
    },
    transaction(body) {
      if (depth > 0) return body();
      depth += 1;
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = body();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close() { db.close(); },
  };
}
