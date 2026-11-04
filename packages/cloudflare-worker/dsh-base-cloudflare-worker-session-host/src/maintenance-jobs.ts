/**
 * Durable interval jobs for the Workers-native Session Host.
 *
 * This is the Host's equivalent of createbuddy's `HubScheduledProvider`: a
 * durable `scheduleEvery`-style registration table plus a run journal. The
 * Session Host alarm executes due callbacks; nothing depends on an open tab.
 */
import type { SqlStorage } from "./sqlite-storage.ts";

/** One registered interval callback. */
export interface MaintenanceJobSchedule {
  readonly kind: string;
  readonly intervalSeconds: number;
  readonly nextAt: number;
  readonly lastStatus?: "ok" | "failed";
  readonly lastRunAt?: number;
  readonly lastError?: string;
}

/** One completed execution. */
export interface MaintenanceJobRun {
  readonly id: number;
  readonly kind: string;
  readonly status: "ok" | "failed";
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly detail: Record<string, unknown>;
}

const SCHEDULES = "dsh_session_host_job_schedules";
const RUNS = "dsh_session_host_job_runs";

interface ScheduleRow {
  kind: string;
  interval_seconds: number;
  next_at: number;
  last_status: string | null;
  last_run_at: number | null;
  last_error: string | null;
}

interface RunRow {
  id: number;
  kind: string;
  status: string;
  started_at: number;
  finished_at: number;
  detail: string;
}

function scheduleOf(row: ScheduleRow): MaintenanceJobSchedule {
  return {
    kind: row.kind,
    intervalSeconds: row.interval_seconds,
    nextAt: row.next_at,
    ...(row.last_status === null ? {} : { lastStatus: row.last_status as "ok" | "failed" }),
    ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

/** SQLite registration + run journal shared by the Host and its alarm. */
export class MaintenanceJobStore {
  private readonly sql: SqlStorage;

  /**
   * @param sql - Durable Object SQL executor.
   */
  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${SCHEDULES} (
      kind TEXT PRIMARY KEY,
      interval_seconds INTEGER NOT NULL,
      next_at INTEGER NOT NULL,
      last_status TEXT,
      last_run_at INTEGER,
      last_error TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${RUNS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      detail TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ${RUNS}_kind ON ${RUNS} (kind, id DESC)`);
  }

  /**
   * Register one interval callback when absent, keeping an existing registration.
   * @param kind - stable callback key.
   * @param intervalSeconds - positive interval.
   * @returns the committed schedule.
   */
  ensureInterval(kind: string, intervalSeconds: number): MaintenanceJobSchedule {
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 5) throw new Error("maintenance interval must be at least 5 seconds");
    const existing = this.sql.exec(`SELECT * FROM ${SCHEDULES} WHERE kind = ?`, kind).toArray().at(0) as ScheduleRow | undefined;
    if (existing === undefined) {
      this.sql.exec(
        `INSERT INTO ${SCHEDULES} (kind, interval_seconds, next_at) VALUES (?, ?, ?)`,
        kind,
        intervalSeconds,
        Date.now() + intervalSeconds * 1000,
      );
    } else if (existing.interval_seconds !== intervalSeconds) {
      this.sql.exec(`UPDATE ${SCHEDULES} SET interval_seconds = ? WHERE kind = ?`, intervalSeconds, kind);
    }
    return this.list().find((schedule) => schedule.kind === kind)!;
  }

  /** Every registration in kind order. */
  list(): MaintenanceJobSchedule[] {
    return (this.sql.exec(`SELECT * FROM ${SCHEDULES} ORDER BY kind`).toArray() as unknown as ScheduleRow[]).map(scheduleOf);
  }

  /** Registrations due at or before `nowMs`. */
  due(nowMs: number, limit = 5): MaintenanceJobSchedule[] {
    return (this.sql.exec(
      `SELECT * FROM ${SCHEDULES} WHERE next_at <= ? ORDER BY next_at LIMIT ?`,
      nowMs,
      limit,
    ).toArray() as unknown as ScheduleRow[]).map(scheduleOf);
  }

  /** Earliest registration instant. */
  nextDueAtMs(): number | undefined {
    const row = this.sql.exec(`SELECT MIN(next_at) AS next FROM ${SCHEDULES}`).toArray().at(0) as { next?: number | null } | undefined;
    return typeof row?.next === "number" ? row.next : undefined;
  }

  /**
   * Journal one execution and advance its registration.
   * @param input - outcome and next instant.
   * @returns the committed run row.
   */
  recordRun(input: { kind: string; status: "ok" | "failed"; startedAt: number; finishedAt: number; detail: Record<string, unknown>; nextAt: number }): MaintenanceJobRun {
    this.sql.exec(
      `UPDATE ${SCHEDULES} SET next_at = ?, last_status = ?, last_run_at = ?, last_error = ? WHERE kind = ?`,
      input.nextAt,
      input.status,
      input.finishedAt,
      input.status === "failed" ? String(input.detail.error ?? "failed") : null,
      input.kind,
    );
    this.sql.exec(
      `INSERT INTO ${RUNS} (kind, status, started_at, finished_at, detail) VALUES (?, ?, ?, ?, ?)`,
      input.kind,
      input.status,
      input.startedAt,
      input.finishedAt,
      JSON.stringify(input.detail),
    );
    return this.history(1)[0]!;
  }

  /** Newest-first execution journal. */
  history(limit = 20): MaintenanceJobRun[] {
    const rows = this.sql.exec(`SELECT * FROM ${RUNS} ORDER BY id DESC LIMIT ?`, Math.min(100, Math.max(1, limit))).toArray() as unknown as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status as "ok" | "failed",
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      detail: JSON.parse(row.detail) as Record<string, unknown>,
    }));
  }

  /** Move one registration to an explicit instant (manual run / repair). */
  scheduleAt(kind: string, nextAt: number): void {
    this.sql.exec(`UPDATE ${SCHEDULES} SET next_at = ? WHERE kind = ?`, nextAt, kind);
  }
}
