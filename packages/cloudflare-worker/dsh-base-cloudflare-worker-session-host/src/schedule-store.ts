/**
 * Durable Host task storage for the official `schedule` namespace.
 *
 * One row per task (record + resolved target + status) and one row per inbox
 * delivery. The timer itself is the Session Host Durable Object alarm; this
 * module only stores facts and answers the official catalog/history shapes.
 */
import type { SqlStorage } from "./sqlite-storage.ts";

/** One stored record shared by every timing kind. */
export interface ScheduleRecordLike {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly prompt: string;
  readonly afterSeconds?: number;
  readonly everySeconds?: number;
  /** Official DTSTART + RRULE content; interpreted by dsh-util-time. */
  readonly rrule?: string;
  /** Official canonical five-field Cron expression. */
  readonly expression?: string;
  /** Daily/weekly local wall-clock time, normalized `HH:mm:ss.SSS`. */
  readonly time?: string;
  /** Daily/weekly IANA zone. */
  readonly timeZone?: string;
  /** Weekly ISO weekdays, Monday 1 through Sunday 7. */
  readonly weekdays?: readonly number[];
  readonly scheduledAt: string;
}

/** Stored destination; `new_once` flips to `session` after its first delivery. */
export type ScheduleTargetLike =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "new_once"; readonly sessionId: string; readonly create?: Record<string, unknown> }
  | { readonly kind: "new"; readonly create?: Record<string, unknown> };

/** One delivery receipt in the saved history. */
export interface ScheduleDeliveryLike {
  readonly scheduledAt: string;
  readonly deliveredAt: string;
  readonly messageId: string;
  readonly targetSessionId: string;
  readonly prompt?: string;
}

/** Browser-safe catalog entry returned by the official methods. */
export type ScheduleEntry = ScheduleRecordLike & {
  readonly target: ScheduleTargetLike;
  readonly involvedSessionIds: readonly string[];
  readonly status: "active" | "paused" | "ended";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastDelivery?: ScheduleDeliveryLike;
};

/** Schedule request failed validation before storage. */
export class ScheduleInputError extends Error {
  readonly code = "schedule/input-invalid";
  /** Stable input-classification reason. */
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "ScheduleInputError";
    this.reason = reason;
  }
}

/** Schedule edit lost an optimistic revision race. */
export class ScheduleConflictError extends Error {
  readonly code = "schedule:conflict";
  /** Task identity that lost the race. */
  readonly id: string;
  constructor(id: string) {
    super(`schedule ${id} changed after the editor read it`);
    this.name = "ScheduleConflictError";
    this.id = id;
  }
}

const TASKS = "dsh_session_host_schedules";
const DELIVERIES = "dsh_session_host_schedule_deliveries";

interface Row extends Record<string, unknown> {
  id: string;
  record_json: string;
  target_json: string;
  involved_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_delivery_json: string | null;
}

function entryOf(row: Row): ScheduleEntry {
  const record = JSON.parse(row.record_json) as ScheduleRecordLike;
  const target = JSON.parse(row.target_json) as ScheduleTargetLike;
  const involved = JSON.parse(row.involved_json) as string[];
  const lastDelivery = row.last_delivery_json === null ? undefined : JSON.parse(row.last_delivery_json) as ScheduleDeliveryLike;
  return {
    ...record,
    target,
    involvedSessionIds: involved,
    status: row.status as ScheduleEntry["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(lastDelivery === undefined ? {} : { lastDelivery }),
  };
}

/** SQLite task/delivery store shared by the Host and its alarm engine. */
export class ScheduleStore {
  private readonly sql: SqlStorage;

  /**
   * @param sql - Durable Object SQL executor.
   */
  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${TASKS} (
      id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      involved_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_delivery_json TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${DELIVERIES} (
      schedule_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      target_session_id TEXT NOT NULL,
      prompt TEXT,
      PRIMARY KEY (schedule_id, seq)
    )`);
  }

  private row(id: string): Row | undefined {
    return this.sql.exec(`SELECT * FROM ${TASKS} WHERE id = ?`, id).toArray().at(0) as Row | undefined;
  }

  /** Store one new task. */
  create(entry: { record: ScheduleRecordLike; target: ScheduleTargetLike; involvedSessionIds: readonly string[]; createdAt: string }): ScheduleEntry {
    this.sql.exec(
      `INSERT INTO ${TASKS} (id, record_json, target_json, involved_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      entry.record.id, JSON.stringify(entry.record), JSON.stringify(entry.target),
      JSON.stringify(entry.involvedSessionIds), entry.createdAt, entry.createdAt,
    );
    return this.view(entry.record.id)!;
  }

  /** Read one task. */
  view(id: string): ScheduleEntry | undefined {
    const row = this.row(id);
    return row === undefined ? undefined : entryOf(row);
  }

  /** List tasks in official order (active first, then next occurrence). */
  list(input: { active?: boolean; limit?: number; offset?: number } = {}): { items: ScheduleEntry[]; total: number; limit: number; offset: number } {
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const offset = Math.max(0, input.offset ?? 0);
    const rows = this.sql.exec(`SELECT * FROM ${TASKS}`).toArray() as Row[];
    const entries = rows.map(entryOf)
      .filter((entry) => input.active === undefined || (entry.status === "active") === input.active)
      .sort((left, right) => {
        if ((left.status === "active") !== (right.status === "active")) return left.status === "active" ? -1 : 1;
        return left.scheduledAt.localeCompare(right.scheduledAt);
      });
    return { items: entries.slice(offset, offset + limit), total: entries.length, limit, offset };
  }

  /** Delete every non-active task. */
  deleteInactive(): number {
    const before = (this.sql.exec(`SELECT COUNT(*) AS count FROM ${TASKS} WHERE status != 'active'`).toArray().at(0) as { count?: number } | undefined)?.count ?? 0;
    this.sql.exec(`DELETE FROM ${DELIVERIES} WHERE schedule_id IN (SELECT id FROM ${TASKS} WHERE status != 'active')`);
    this.sql.exec(`DELETE FROM ${TASKS} WHERE status != 'active'`);
    return before;
  }

  /** Every active task due at or before `nowIso`. */
  due(nowIso: string, limit = 5): ScheduleEntry[] {
    const rows = this.sql.exec(`SELECT * FROM ${TASKS} WHERE status = 'active'`).toArray() as Row[];
    return rows.map(entryOf)
      .filter((entry) => entry.scheduledAt <= nowIso)
      .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
      .slice(0, limit);
  }

  /** Earliest future active occurrence. */
  nextDueAt(): string | undefined {
    const rows = this.sql.exec(`SELECT * FROM ${TASKS} WHERE status = 'active'`).toArray() as Row[];
    return rows.map(entryOf).map((entry) => entry.scheduledAt).sort()[0];
  }

  /** Persist one delivery and advance/end the task. */
  deliver(id: string, delivery: ScheduleDeliveryLike, update: { record?: ScheduleRecordLike; target?: ScheduleTargetLike; status: "active" | "paused" | "ended" }): ScheduleEntry | undefined {
    const row = this.row(id);
    if (row === undefined) return undefined;
    const record = update.record ?? JSON.parse(row.record_json) as ScheduleRecordLike;
    const target = update.target ?? JSON.parse(row.target_json) as ScheduleTargetLike;
    const seq = (this.sql.exec(`SELECT COALESCE(MAX(seq), 0) AS seq FROM ${DELIVERIES} WHERE schedule_id = ?`, id).toArray().at(0) as { seq?: number } | undefined)?.seq ?? 0;
    this.sql.exec(
      `INSERT INTO ${DELIVERIES} (schedule_id, seq, message_id, scheduled_at, delivered_at, target_session_id, prompt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, seq + 1, delivery.messageId, delivery.scheduledAt, delivery.deliveredAt, delivery.targetSessionId, delivery.prompt ?? null,
    );
    this.sql.exec(
      `UPDATE ${TASKS} SET record_json = ?, target_json = ?, status = ?, updated_at = ?, last_delivery_json = ? WHERE id = ?`,
      JSON.stringify(record), JSON.stringify(target), update.status, delivery.deliveredAt, JSON.stringify(delivery), id,
    );
    return this.view(id);
  }

  /** Edit one task (official `edit` action). */
  edit(input: { id: string; action: "update" | "delete"; patch?: Record<string, unknown>; expectedUpdatedAt?: string | null; record?: ScheduleRecordLike; target?: ScheduleTargetLike }): ScheduleEntry | { deleted: true; id: string } | { code: "schedule_not_found"; id: string } | { code: "schedule_conflict"; id: string } {
    const row = this.row(input.id);
    if (row === undefined) return { id: input.id, code: "schedule_not_found" };
    if (input.action === "delete") {
      if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== null && input.expectedUpdatedAt !== row.updated_at) {
        return { id: input.id, code: "schedule_conflict" };
      }
      this.sql.exec(`DELETE FROM ${DELIVERIES} WHERE schedule_id = ?`, input.id);
      this.sql.exec(`DELETE FROM ${TASKS} WHERE id = ?`, input.id);
      return { id: input.id, deleted: true };
    }
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== null && input.expectedUpdatedAt !== row.updated_at) {
      return { id: input.id, code: "schedule_conflict" };
    }
    const record = input.record ?? JSON.parse(row.record_json) as ScheduleRecordLike;
    const patch = input.patch ?? {};
    const nextRecord: ScheduleRecordLike = {
      ...record,
      ...(typeof patch.title === "string" ? { title: patch.title } : {}),
      ...(typeof patch.prompt === "string" ? { prompt: patch.prompt } : {}),
    } as ScheduleRecordLike;
    const status = patch.active === false ? "paused" : patch.active === true ? "active" : row.status;
    const involved = JSON.parse(row.involved_json) as string[];
    if (input.target?.kind === "session" && !involved.includes(input.target.sessionId)) involved.push(input.target.sessionId);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
    this.sql.exec(
      `UPDATE ${TASKS} SET record_json = ?, target_json = ?, involved_json = ?, status = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(nextRecord), input.target === undefined ? row.target_json : JSON.stringify(input.target), JSON.stringify(involved), status, updatedAt, input.id,
    );
    return this.view(input.id)!;
  }

  /**
   * Restore task rows from a migration sidecar without changing their ids,
   * targets, statuses, timestamps, or last delivery.
   * @param entries - catalog entries exported from the previous generation.
   * @returns restored row count.
   */
  restore(entries: readonly ScheduleEntry[]): number {
    let restored = 0;
    for (const entry of entries) {
      if (typeof entry?.id !== "string" || entry.id === "" || !Number.isFinite(Date.parse(entry.scheduledAt))
        || !Number.isFinite(Date.parse(entry.createdAt)) || !Number.isFinite(Date.parse(entry.updatedAt))
        || typeof entry.kind !== "string" || typeof entry.title !== "string" || typeof entry.prompt !== "string"
        || !["active", "paused", "ended"].includes(entry.status)
        || typeof entry.target !== "object" || entry.target === null
        || !["session", "new_once", "new"].includes(entry.target.kind)) throw new Error("invalid migration schedule");
      const current = this.view(entry.id);
      if (current !== undefined && Date.parse(current.updatedAt) >= Date.parse(entry.updatedAt)) continue;
      const record: ScheduleRecordLike = {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        prompt: entry.prompt,
        scheduledAt: entry.scheduledAt,
        ...(entry.afterSeconds === undefined ? {} : { afterSeconds: entry.afterSeconds }),
        ...(entry.everySeconds === undefined ? {} : { everySeconds: entry.everySeconds }),
        ...(entry.rrule === undefined ? {} : { rrule: entry.rrule }),
        ...(entry.expression === undefined ? {} : { expression: entry.expression }),
        ...(entry.time === undefined ? {} : { time: entry.time }),
        ...(entry.timeZone === undefined ? {} : { timeZone: entry.timeZone }),
        ...(entry.weekdays === undefined ? {} : { weekdays: entry.weekdays }),
      };
      this.sql.exec(
        `INSERT INTO ${TASKS} (id, record_json, target_json, involved_json, status, created_at, updated_at, last_delivery_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           record_json = excluded.record_json, target_json = excluded.target_json,
           involved_json = excluded.involved_json, status = excluded.status,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           last_delivery_json = excluded.last_delivery_json`,
        entry.id, JSON.stringify(record), JSON.stringify(entry.target), JSON.stringify(entry.involvedSessionIds ?? []),
        entry.status, entry.createdAt, entry.updatedAt, entry.lastDelivery === undefined ? null : JSON.stringify(entry.lastDelivery),
      );
      restored += 1;
    }
    return restored;
  }

  /** Newest-first saved deliveries for one task. */
  history(input: { id: string; limit: number; before?: string }): { id: string; records: ScheduleDeliveryLike[]; earlierRecordsUnavailable: boolean; earlierRecordsPruned: boolean; retention: { days: number; records: number }; nextBefore?: string } | { id: string; code: "schedule_not_found" | "delivery_cursor_not_found" } {
    if (this.row(input.id) === undefined) return { id: input.id, code: "schedule_not_found" };
    const limit = Math.min(100, Math.max(1, input.limit));
    const rows = this.sql.exec(
      `SELECT message_id, scheduled_at, delivered_at, target_session_id, prompt FROM ${DELIVERIES} WHERE schedule_id = ? ORDER BY seq DESC`,
      input.id,
    ).toArray() as Array<{ message_id: string; scheduled_at: string; delivered_at: string; target_session_id: string; prompt: string | null }>;
    let start = 0;
    if (input.before !== undefined) {
      const index = rows.findIndex((row) => row.message_id === input.before);
      if (index === -1) return { id: input.id, code: "delivery_cursor_not_found" };
      start = index + 1;
    }
    const page = rows.slice(start, start + limit).map((row) => ({
      scheduledAt: row.scheduled_at,
      deliveredAt: row.delivered_at,
      messageId: row.message_id,
      targetSessionId: row.target_session_id,
      ...(row.prompt === null ? {} : { prompt: row.prompt }),
    }));
    const hasMore = start + limit < rows.length;
    return {
      id: input.id,
      records: page,
      earlierRecordsUnavailable: false,
      earlierRecordsPruned: false,
      retention: { days: 30, records: 500 },
      ...(hasMore ? { nextBefore: page.at(-1)?.messageId } : {}),
    };
  }
  /**
   * Delete ended tasks and their saved deliveries older than a cutoff.
   * @param input - retention cutoff in milliseconds and batch limit.
   * @returns removed task count.
   */
  pruneEnded(input: { olderThanMs?: number; limit?: number } = {}): number {
    const cutoff = new Date(Date.now() - Math.max(0, input.olderThanMs ?? 30 * 24 * 60 * 60 * 1000)).toISOString();
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const rows = this.sql.exec(
      `SELECT id FROM ${TASKS} WHERE status != 'active' AND updated_at < ? ORDER BY updated_at LIMIT ?`,
      cutoff,
      limit,
    ).toArray() as Array<{ id: string }>;
    for (const row of rows) {
      this.sql.exec(`DELETE FROM ${DELIVERIES} WHERE schedule_id = ?`, row.id);
      this.sql.exec(`DELETE FROM ${TASKS} WHERE id = ?`, row.id);
    }
    return rows.length;
  }

}
