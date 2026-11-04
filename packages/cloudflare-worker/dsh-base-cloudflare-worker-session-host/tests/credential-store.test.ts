/** Encrypted credential store contract. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CredentialStore } from "../src/credential-store.ts";
import type { SqlCursor, SqlStorage } from "../src/sqlite-storage.ts";

class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
    const statement = this.db.prepare(query);
    let rows: Array<Record<string, unknown>> = [];
    try { rows = statement.all(...bindings) as Array<Record<string, unknown>>; } catch { statement.run(...bindings); }
    return { toArray: () => rows };
  }
  raw(query: string, ...bindings: readonly unknown[]): Array<Record<string, unknown>> {
    return this.db.prepare(query).all(...bindings) as Array<Record<string, unknown>>;
  }
}

const secret = Buffer.alloc(32, 7).toString("base64");
const sql = new NodeSqlStorage();
const store = new CredentialStore(sql, secret);
assert.equal(store.writable, true);
assert.deepEqual(store.describe(["DEEPSEEK_OFFICIAL_API_KEY"]), {
  DEEPSEEK_OFFICIAL_API_KEY: { configured: false, writable: true },
});
await store.set("DEEPSEEK_OFFICIAL_API_KEY", "sk-very-secret-value");
assert.deepEqual(store.describe(["DEEPSEEK_OFFICIAL_API_KEY"]), {
  DEEPSEEK_OFFICIAL_API_KEY: { configured: true, writable: true, source: "host" },
});
assert.equal(await store.get("DEEPSEEK_OFFICIAL_API_KEY"), "sk-very-secret-value");
const row = sql.raw("SELECT iv, ciphertext FROM dsh_session_host_credentials WHERE ref = ?", "DEEPSEEK_OFFICIAL_API_KEY")[0];
assert.ok(row !== undefined);
assert.ok(!String(row.ciphertext).includes("very-secret"));
// A second store with the same secret decrypts; a different secret cannot.
const reopened = new CredentialStore(sql, secret);
assert.equal(await reopened.get("DEEPSEEK_OFFICIAL_API_KEY"), "sk-very-secret-value");
const wrongKey = new CredentialStore(sql, Buffer.alloc(32, 9).toString("base64"));
await assert.rejects(() => wrongKey.get("DEEPSEEK_OFFICIAL_API_KEY"), /cannot be decrypted/);
store.unset("DEEPSEEK_OFFICIAL_API_KEY");
assert.equal(await store.get("DEEPSEEK_OFFICIAL_API_KEY"), undefined);
await assert.rejects(() => store.set("bad ref", "x"), /invalid credential reference/);
const disabled = new CredentialStore(new NodeSqlStorage(), undefined);
assert.equal(disabled.writable, false);
assert.equal(disabled.describe(["X"])["X"]?.writable, false);
await assert.rejects(() => disabled.set("X", "y"), /not configured/);
console.log("session-host: encrypted credential store passed");
