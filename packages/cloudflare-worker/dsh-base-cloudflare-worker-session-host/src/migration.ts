/**
 * Legacy owner-generation migration helpers.
 *
 * The current owner name is a stable storage identity. Older deployments used
 * generation-suffixed names; recovery is only for those existing identities.
 * Updating Worker code must not create a new owner database.
 */
import type { SqlStorage } from "./sqlite-storage.ts";

/** Preserve the already deployed identity; never bump this for code releases. */
export const SESSION_HOST_STORAGE_ID = "default-v49";
export const MIGRATION_KEY = "legacy-recovery-v2";

export const MIGRATION_TABLES = [
  "dsh_session_host_sessions", "dsh_session_host_messages", "dsh_session_host_projections",
  "dsh_session_host_events", "dsh_session_host_attachments", "dsh_session_host_submissions",
  "dsh_session_host_uploads", "dsh_session_host_upload_gc", "dsh_session_host_directories", "dsh_session_host_workspaces", "dsh_session_host_workspace_sessions", "dsh_session_host_session_flags",
  "dsh_session_host_file_nodes", "dsh_session_host_file_versions", "dsh_session_host_settings",
  "dsh_session_host_credentials", "dsh_session_host_schedules", "dsh_session_host_schedule_deliveries",
  "dsh_session_host_job_schedules", "dsh_session_host_job_runs",
] as const;

export interface MigrationSnapshot {
  readonly tables: Readonly<Record<string, {
    readonly columns: readonly string[];
    readonly rows: readonly Record<string, string | number | null>[];
  }>>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject malformed exports before they can delete or replace any data. */
export function validateMigrationSnapshot(value: unknown): MigrationSnapshot {
  if (!record(value) || !record(value.tables)) throw new Error("invalid migration snapshot");
  for (const [table, entry] of Object.entries(value.tables)) {
    if (!(MIGRATION_TABLES as readonly string[]).includes(table) || !record(entry)
      || !Array.isArray(entry.columns) || !Array.isArray(entry.rows)
      || entry.columns.some((column) => typeof column !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))
      || new Set(entry.columns).size !== entry.columns.length
      || (entry.columns.length === 0 && entry.rows.length !== 0)) throw new Error(`invalid migration table: ${table}`);
    for (const row of entry.rows) {
      if (!record(row) || entry.columns.some((column) => !Object.hasOwn(row, column)
        || !(row[column] === null || typeof row[column] === "string" || (typeof row[column] === "number" && Number.isFinite(row[column]))))) {
        throw new Error(`invalid migration row: ${table}`);
      }
    }
  }
  return value as unknown as MigrationSnapshot;
}

function columnsOf(sql: SqlStorage, table: string): string[] {
  return sql.exec(`PRAGMA table_info("${table}")`).toArray().map((row) => String(row.name));
}

export function dumpMigrationTables(sql: SqlStorage): MigrationSnapshot {
  return { tables: Object.fromEntries(MIGRATION_TABLES.map((table) => {
    const columns = columnsOf(sql, table);
    return [table, { columns, rows: columns.length === 0 ? [] : sql.exec(`SELECT * FROM "${table}"`).toArray() }];
  })) } as MigrationSnapshot;
}

/** Existing user data is authoritative and must never be overwritten by recovery. */
export function migrationStatus(sql: SqlStorage): { migrated: boolean; preservedExisting: boolean } {
  const marker = sql.exec("SELECT value FROM dsh_session_host_meta WHERE key = ?", MIGRATION_KEY).toArray().at(0);
  const preservedExisting = MIGRATION_TABLES.filter((table) => !table.includes("job_")).some((table) =>
    columnsOf(sql, table).length > 0 && Number(sql.exec(`SELECT COUNT(*) AS count FROM "${table}"`).toArray().at(0)?.count ?? 0) > 0);
  return { migrated: marker !== undefined || preservedExisting, preservedExisting };
}

/**
 * All restored tables, optional sidecar, verification and completion marker share
 * one SQLite transaction. A crash/exception rolls back everything; a lost HTTP
 * response is safe to retry. Concurrent commits observe the winner's marker.
 */
export function commitMigration(
  sql: SqlStorage,
  input: { snapshot?: unknown; sidecar?: unknown },
  restoreSidecar: (sidecar: unknown) => void,
): { migrated: true; imported: Record<string, number>; preservedExisting: boolean } {
  const snapshot = input.snapshot === undefined ? undefined : validateMigrationSnapshot(input.snapshot);
  if (sql.transactionSync === undefined) throw new Error("migration requires an atomic storage transaction");
  return sql.transactionSync(() => {
    const status = migrationStatus(sql);
    if (status.migrated) return { ...status, migrated: true, imported: {} };
    const imported: Record<string, number> = {};
    if (snapshot !== undefined) {
      // Validate the complete schema before the first write. Unknown columns
      // require an explicit migration, never silent field loss.
      for (const [table, entry] of Object.entries(snapshot.tables)) {
        const targetColumns = columnsOf(sql, table);
        if (entry.rows.length > 0 && entry.columns.some((column) => !targetColumns.includes(column))) {
          throw new Error(`migration schema mismatch: ${table}`);
        }
      }
      for (const [table, entry] of Object.entries(snapshot.tables)) {
        if (entry.rows.length === 0) continue;
        const statement = `INSERT INTO "${table}" (${entry.columns.map((column) => `"${column}"`).join(", ")}) VALUES (${entry.columns.map(() => "?").join(", ")})`;
        for (const row of entry.rows) sql.exec(statement, ...entry.columns.map((column) => row[column]));
        const count = Number(sql.exec(`SELECT COUNT(*) AS count FROM "${table}"`).toArray().at(0)?.count);
        if (count !== entry.rows.length) throw new Error(`migration verification failed: ${table}`);
        imported[table] = count;
      }
    }
    if (input.sidecar !== undefined) restoreSidecar(input.sidecar);
    sql.exec("INSERT INTO dsh_session_host_meta (key, value) VALUES (?, ?)", MIGRATION_KEY, "complete");
    return { migrated: true, imported, preservedExisting: false };
  });
}

/** One table snapshot carried by the migration export. */
interface MigrationTableLike {
  readonly columns?: readonly unknown[];
  readonly rows?: readonly unknown[];
}

/** One export payload produced by `/migrate/export`. */
export interface MigrationSnapshotLike {
  readonly tables?: Readonly<Record<string, MigrationTableLike>>;
}

/**
 * Count the retained rows in one migration export.
 * @param snapshot - parsed `/migrate/export` payload.
 * @returns total row count; zero for malformed or empty snapshots.
 */
export function migrationRowCount(snapshot: unknown): number {
  if (typeof snapshot !== "object" || snapshot === null) return 0;
  const tables = (snapshot as MigrationSnapshotLike).tables;
  if (typeof tables !== "object" || tables === null) return 0;
  let count = 0;
  for (const table of Object.values(tables)) {
    if (typeof table !== "object" || table === null) continue;
    const rows = table.rows;
    if (Array.isArray(rows)) count += rows.length;
  }
  return count;
}

/**
 * Score one export by the user-visible conversation content it carries.
 *
 * A newer generation can be non-empty while containing only a blank Session, so
 * recovery prefers the snapshot with the most Session/message rows instead of
 * the newest non-empty one.
 * @param snapshot - parsed `/migrate/export` payload.
 * @returns sum of Session and message rows.
 */
export function migrationScore(snapshot: unknown): number {
  if (typeof snapshot !== "object" || snapshot === null) return 0;
  const tables = (snapshot as MigrationSnapshotLike).tables;
  if (typeof tables !== "object" || tables === null) return 0;
  const scoreOf = (suffix: string): number => {
    let total = 0;
    for (const [name, table] of Object.entries(tables)) {
      if (!name.endsWith(suffix) || typeof table !== "object" || table === null) continue;
      if (Array.isArray(table.rows)) total += table.rows.length;
    }
    return total;
  };
  return scoreOf("dsh_session_host_sessions") + scoreOf("dsh_session_host_messages");
}
