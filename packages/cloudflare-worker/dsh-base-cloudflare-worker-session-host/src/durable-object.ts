import type { UploadStore } from "./uploads.ts";
/** Durable Object SQL binding for the Workers-native Session Host. */
import { SessionHost } from "./host.ts";
import type { SessionModelOption } from "./contract.ts";
import {
  SqliteSessionHostStorage,
  type SqlCursor,
  type SqlStorage,
} from "./sqlite-storage.ts";
import type { WorkspaceFileStore } from "./workspace-files.ts";
import type { SettingsStore } from "./settings-store.ts";
import type { CredentialStore } from "./credential-store.ts";
import type { ScheduleStore } from "./schedule-store.ts";
import type { MaintenanceJobStore } from "./maintenance-jobs.ts";
import type { HostChangeFeed } from './change-feed.ts';
import type { PermissionStore } from './permissions-store.ts';

/** Structural subset of `ctx.storage.sql` used by the Host. */
export interface DurableObjectSql {
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor;
}

/** Synchronous transaction provider from `DurableObjectStorage`. */
export type DurableObjectTransaction = <T>(operation: () => T) => T;

/**
 * Create a Session Host over a Durable Object SQL binding.
 * @param sql - Durable Object SQL executor.
 * @param catalog - model options this Host offers.
 * @param transactionSync - synchronous transaction provider, when available.
 * @param files - optional R2-backed workspace file store sharing `sql`.
 * @param settings - optional durable settings store sharing `sql`.
 * @param credentials - optional encrypted credential store sharing `sql`.
 * @param schedules - optional durable schedule store sharing `sql`.
 * @param jobs - optional durable maintenance registration store sharing `sql`.
 * @param wakeClaim - alarm wake callback used by the submission-recovery job.
 * @returns the Host serving this Durable Object instance.
 */
export function createDurableObjectSessionHost(
  sql: DurableObjectSql,
  catalog: readonly SessionModelOption[],
  transactionSync?: DurableObjectTransaction,
  files?: WorkspaceFileStore,
  settings?: SettingsStore,
  credentials?: CredentialStore,
  schedules?: ScheduleStore,
  jobs?: MaintenanceJobStore,
  wakeClaim?: () => void | Promise<void>,
  uploads?: UploadStore,
  changes?: HostChangeFeed,
  permissionStore?: () => Promise<PermissionStore>,
): SessionHost {
  const storage: SqlStorage = { exec: (query, ...bindings) => sql.exec(query, ...bindings) };
  if (transactionSync !== undefined) {
    storage.transactionSync = <T>(operation: () => T): T => transactionSync(operation);
  }
  return new SessionHost(new SqliteSessionHostStorage(storage), catalog, files, settings, credentials, schedules, jobs, wakeClaim, uploads, changes, permissionStore);
}
