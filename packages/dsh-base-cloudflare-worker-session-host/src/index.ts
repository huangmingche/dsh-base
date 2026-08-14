/** Cloudflare Workers session-host: Durable Object SQL persistence (forked rc.6 backend). */
import { Context } from "@deepseek-ai/cordis";
import SessionStore from "@deepseek-ai/dsh-session";

export { SqliteSessionPersistence, type Config } from "./persistence/index.ts";
export { SCHEMA_VERSION } from "./persistence/schema.ts";
export { doSqlite, type DoSqlStorage, type SqliteLike, type SqlValue } from "./sqlite.ts";
export { nodeSqlite } from "./test-sqlite.ts";

/** Build the official session store the persistence coordinator writes through. */
export async function createSessionHostContext(): Promise<Context> {
  const ctx = new Context();
  await (ctx.plugin(SessionStore as never) as unknown as Promise<unknown>);
  return ctx;
}
export { SessionHostObject, type SessionHostEnv, type SessionHostState } from "./session-host.ts";
