/**
 * Durable per-owner settings values for the Workers-native Session Host.
 *
 * The adapter keeps the official settings namespace *views* (schemas and copy)
 * in the browser seam; this store owns only the durable namespace values, so a
 * write survives reloads and every tab observes one revision.
 */
import type { SqlStorage } from "./sqlite-storage.ts";
import { validatePermissionSettings } from '@dsh-base/cloudflare-worker-permissions/settings';

/** One durable settings document shared by all workspaces of one owner. */
export interface SettingsSnapshot {
  /** Monotonic document revision; a mutation compares against it. */
  readonly revision: number;
  /** Namespace key to its complete JSON object value. */
  readonly values: Readonly<Record<string, Record<string, unknown>>>;
}

/** One path mutation inside a namespace value. */
export interface SettingsOperation {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: unknown;
}

/** Settings mutation that lost a revision race. */
export class SettingsConflictError extends Error {
  /** Stable failure code. */
  readonly code = "settings/conflict";

  /** Revision the caller based its write on. */
  readonly expectedRevision: number;
  /** Revision currently stored. */
  readonly actualRevision: number;

  /**
   * @param expectedRevision - revision the caller based its write on.
   * @param actualRevision - revision currently stored.
   */
  constructor(expectedRevision: number, actualRevision: number) {
    super(`settings revision ${String(actualRevision)} does not match expected ${String(expectedRevision)}`);
    this.name = "SettingsConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Settings mutation that carried an unusable path/operation. */
export class SettingsInputError extends Error {
  /** Stable failure code. */
  readonly code = "gateway/bad-request";

  /**
   * @param message - diagnostic for the rejected operation.
   */
  constructor(message: string) {
    super(message);
    this.name = "SettingsInputError";
  }
}

const TABLE = "dsh_session_host_settings";
const EMPTY: SettingsSnapshot = { revision: 0, values: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Official update semantics: recursively merge objects; replace arrays/scalars. */
export function mergeSettingsPatch(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new SettingsInputError("unsafe settings path");
    result[key] = isRecord(value) ? mergeSettingsPatch(isRecord(result[key]) ? result[key] : {}, value) : clone(value);
  }
  return result;
}

/** Apply one mutation to a namespace value; returns the new namespace object. */
function applyOperations(ns: string, current: Record<string, unknown>, operations: readonly SettingsOperation[]): Record<string, unknown> {
  let root = clone(current);
  for (const operation of operations) {
    if (operation.op !== "set" && operation.op !== "unset") throw new SettingsInputError(`settings ${ns}: unsupported op`);
    if (!Array.isArray(operation.path) || operation.path.some((segment) => typeof segment !== "string" || segment === "")) {
      throw new SettingsInputError(`settings ${ns}: path must be non-empty string segments`);
    }
    if (operation.path.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))) throw new SettingsInputError("unsafe settings path");
    if (operation.path.length === 0) {
      if (operation.op === "unset") { root = {}; continue; }
      if (!isRecord(operation.value)) throw new SettingsInputError(`settings ${ns}: root set requires an object value`);
      root = clone(operation.value);
      continue;
    }
    let cursor: Record<string, unknown> = root;
    for (let index = 0; index < operation.path.length - 1; index += 1) {
      const segment = operation.path[index]!;
      const next = cursor[segment];
      if (!isRecord(next)) {
        if (operation.op === "unset") break;
        const created: Record<string, unknown> = {};
        cursor[segment] = created;
        cursor = created;
      } else {
        cursor = next;
      }
    }
    const leaf = operation.path[operation.path.length - 1]!;
    if (operation.op === "set") cursor[leaf] = clone(operation.value);
    else delete cursor[leaf];
  }
  return root;
}

/** SQLite-backed settings document for one Session Host owner. */
export class SettingsStore {
  private readonly sql: SqlStorage;

  /**
   * @param sql - Durable Object SQL executor (or a test double).
   */
  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      revision INTEGER NOT NULL,
      settings_json TEXT NOT NULL
    )`);
  }

  /**
   * Read the current document.
   * @returns revision and namespace values; defaults for a fresh owner.
   */
  /**
   * Replace the stored settings document with a migration snapshot.
   * @param values - namespace → section map from the exported document.
   * @param revision - revision to store, at least 1.
   * @returns number of restored namespaces.
   */
  restore(values: Readonly<Record<string, Readonly<Record<string, unknown>>>>, revision = 1): number {
    this.sql.exec(
      `INSERT INTO ${TABLE} (singleton, revision, settings_json) VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, settings_json = excluded.settings_json`,
      Math.max(1, revision),
      JSON.stringify(values),
    );
    return Object.keys(values).length;
  }

  read(): SettingsSnapshot {
    const row = this.sql.exec(`SELECT revision, settings_json FROM ${TABLE} WHERE singleton = 1`).toArray().at(0);
    if (row === undefined) return EMPTY;
    const parsed = JSON.parse(String(row.settings_json)) as unknown;
    return {
      revision: Number(row.revision),
      values: isRecord(parsed) ? parsed as Record<string, Record<string, unknown>> : {},
    };
  }

  /** Merge against the current durable value in the same synchronous operation. */
  update(input: { ns: string; patch: Record<string, unknown>; expectedRevision?: number }): SettingsSnapshot {
    const current = this.read();
    return this.mutate({ ns: input.ns, expectedRevision: input.expectedRevision ?? current.revision,
      ops: [{ op: "set", path: [], value: mergeSettingsPatch(current.values[input.ns] ?? {}, input.patch) }] });
  }

  /**
   * Apply operations atomically against one expected revision.
   * @param input - namespace, operations, and optional expected revision.
   * @returns the persisted snapshot after the mutation.
   * @throws SettingsConflictError on a revision mismatch, SettingsInputError on bad input.
   */
  mutate(input: { ns: string; ops: readonly SettingsOperation[]; expectedRevision?: number }): SettingsSnapshot {
    if (typeof input.ns !== "string" || input.ns === "") throw new SettingsInputError("settings namespace is required");
    if (!Array.isArray(input.ops) || input.ops.length === 0) throw new SettingsInputError("settings mutate requires operations");
    const current = this.read();
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new SettingsConflictError(input.expectedRevision, current.revision);
    }
    const namespace = isRecord(current.values[input.ns]) ? current.values[input.ns]! : {};
    const next = applyOperations(input.ns, namespace, input.ops);
    if (input.ns === 'permission') {
      try { validatePermissionSettings(next); }
      catch (error) { throw new SettingsInputError(error instanceof Error ? error.message : String(error)); }
    }
    const values = { ...current.values, [input.ns]: next };
    const revision = current.revision + 1;
    this.sql.exec(
      `INSERT INTO ${TABLE} (singleton, revision, settings_json) VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, settings_json = excluded.settings_json`,
      revision,
      JSON.stringify(values),
    );
    return { revision, values };
  }
}
