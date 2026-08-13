/**
 * Fork of @deepseek-ai/dsh-session-persistence-sqlite for Cloudflare Workers.
 *
 * dshBase.forkOf: @deepseek-ai/dsh-session-persistence-sqlite
 * (dsh-0.1.0-rc.6, commit 15148dbd9a, MIT). The storage semantics are preserved
 * verbatim (SCHEMA_VERSION 15, application id, lazy materialization, 1:1 events,
 * monotonic revision, crash-tail cut); only the SQLite boundary changed:
 * node:sqlite DatabaseSync -> the Durable Object SQL adapter in ../sqlite.ts.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS, MAX_WRITE_BATCH_DELAY_MS,
  SessionPersistence, SessionPersistenceRevision, PersistenceCoordinator,
  type PersistenceBackend, type SessionLocation, type SessionPersistenceSnapshot,
  type SessionInspection, type SessionPersistenceRevision as PersistenceRevision,
  type StoredPrefix, type StoredSuffix,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SurfaceEventType, SessionId, SessionHeader, SessionPreparation } from '@deepseek-ai/dsh-session'
import type { SqliteLike } from '../sqlite.ts'
import {
  openDatabase, rowToMeta, scanRows, type EventRow, type SessionRow,
} from './schema.ts'

export { SCHEMA_VERSION } from './schema.ts'

/**
 * Serialize an event's optional envelope fields for SQL binding. The surface
 * fields are nullable TEXT columns — null when the event has no surface
 * metadata; the ignorable marker is a nullable INTEGER column.
 */
function envelopeBindings(event: SessionEvent): [string | null, string | null, number | null] {
  const se = event as SessionEvent<SurfaceEventType>
  return [
    se.sourceEventSeqs ? JSON.stringify(se.sourceEventSeqs) : null,
    se.surfaceOp !== undefined ? JSON.stringify(se.surfaceOp) : null,
    event.ignorable === true ? 1 : null,
  ]
}

/** Build the source-qualified revision shared by full and lightweight reads. */
function sqliteRevision(storeIdentity: string, row: SessionRow): PersistenceRevision {
  return SessionPersistenceRevision(
    `${storeIdentity}:incarnation:${row.incarnation}:revision:${row.revision}`,
  )
}

/** Plugin configuration; the DO owns the database location and lifecycle. */
export interface Config {
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/**
 * The SQLite persistence backend over Durable Object SQL. The fork keeps the
 * upstream write path and coordinator; only the DatabaseSync boundary is the
 * adapter passed by the DO.
 */
export class SqliteSessionPersistence extends SessionPersistence implements PersistenceBackend<number> {
  override readonly supportsRawArtifacts = false

  static inject = ['sessions']

  override readonly name = 'session-persistence-sqlite'

  private readonly db: SqliteLike
  private storeIdentity = ''
  /** Resolves once the schema is open; rejects when the database fails closed. */
  readonly ready: Promise<void>
  private readonly coordinator: PersistenceCoordinator<number>

  constructor(ctx: Context, config: Config, db: SqliteLike) {
    super(ctx)
    this.db = db
    this.ready = this.openDb()
    this.coordinator = new PersistenceCoordinator<number>(this.ctx, this, {
      preparedSessionCacheSize: config.preparedSessionCacheSize ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE,
      writeBatchMaxDelayMs: config.writeBatchMaxDelayMs ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
    })
  }

  private async openDb(): Promise<void> {
    openDatabase(this.db)
    const row = this.db.prepare(
      'SELECT store_id FROM persistence_state WHERE singleton = 1',
    ).get() as { store_id: string } | undefined
    if (row === undefined || row.store_id.length === 0) {
      throw new Error('session database has no store identity')
    }
    this.storeIdentity = `do:store:${row.store_id}`
  }

  // --- SessionPersistence service API (delegated to the coordinator) ---

  /** SQLite has one database, not an independent local artifact per session. */
  locate(_meta: SessionHeader): SessionLocation | undefined {
    return undefined
  }

  create(meta: SessionHeader): Promise<void> {
    return this.coordinator.create(meta)
  }

  append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    return this.coordinator.append(id, events)
  }

  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    return this.coordinator.prepare(id, signal)
  }

  load(id: SessionId): Promise<SessionInspection> {
    return this.coordinator.load(id)
  }

  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    return this.coordinator.inspect(id, signal)
  }

  readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }

  // One method serves both public `list` and the backend hook; delegating it to
  // the coordinator would call this hook recursively.

  // --- PersistenceBackend hooks (the SQLite storage primitives) ---

  /** Read a stored prefix by id (ids are globally unique — no scope to scan). */
  loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<number> | undefined> {
    return this.readPrefix(id, signal)
  }

  /** Read one row's revision without loading its events. */
  async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<PersistenceRevision | undefined> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const row = this.rowFor(id)
    return row === undefined ? undefined : sqliteRevision(this.storeIdentity, row)
  }

  /**
   * Seek-capable suffix read: SQL selects `seq >= fromSeq` directly, so the
   * read scales with the suffix, not the log. Torn rows past the preserved
   * region are dropped, never repaired (non-mutating read).
   */
  async loadStoredFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const row = this.rowFor(id)
    if (row === undefined) return undefined
    const meta = rowToMeta(row)
    const eventRows = this.db
      .prepare('SELECT seq, type, time, data, source_event_seqs, surface_op, ignorable FROM events WHERE session_id = ? AND seq >= ? ORDER BY seq')
      .all(id, fromSeq) as unknown as EventRow[]
    signal?.throwIfAborted()
    const { preserved } = scanRows(eventRows, fromSeq)
    return { meta, events: preserved }
  }

  /**
   * Read a session's row + ordered events into a {@link StoredPrefix}. The
   * torn-tail marker is the seq from which a never-committed tail must be deleted
   * (`scanRows` already returns it as `number | undefined`).
   */
  private async readPrefix(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<number> | undefined> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const snapshot = this.db.transaction<{ row: SessionRow; eventRows: EventRow[] } | undefined>(() => {
      const row = this.rowFor(id)
      if (row === undefined) return undefined
      const eventRows = this.db
        .prepare('SELECT seq, type, time, data, source_event_seqs, surface_op, ignorable FROM events WHERE session_id = ? ORDER BY seq')
        .all(id) as unknown as EventRow[]
      return { row, eventRows }
    })
    signal?.throwIfAborted()
    if (snapshot === undefined) return undefined
    const { row, eventRows } = snapshot
    const { preserved, tornFrom } = scanRows(eventRows)
    return {
      meta: rowToMeta(row),
      events: preserved,
      revision: sqliteRevision(this.storeIdentity, row),
      ...tornFrom !== undefined ? { tornMarker: tornFrom } : {},
    }
  }

  /**
   * Durably append a batch in ONE transaction: materialize the sessions row (if
   * lazy) and INSERT every event, or roll back entirely. The transaction is the
   * atomicity + durability boundary, so a mid-batch failure (a UNIQUE violation
   * on a duplicated seq) leaves the stored log untouched.
   */
  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void> {
    await this.ready
    this.db.transaction(() => {
      if (!isMaterialized) this.writeRow(meta)
      const insertEvent = this.db.prepare(
        'INSERT INTO events (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const event of events) {
        const [surfaceSeqs, surfaceOp, ignorable] = envelopeBindings(event)
        insertEvent.run(meta.id, event.seq, event.type, event.time, JSON.stringify(event.data), surfaceSeqs, surfaceOp, ignorable)
      }
      this.db.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?').run(meta.id)
    })
  }

  /**
   * Make a crash repair durable in ONE transaction: DELETE the torn tail (from
   * `tornMarker`) and INSERT the synthetic `closers`. After COMMIT the stored rows
   * == the balanced log.
   */
  async commitRepair(meta: SessionHeader, tornMarker: number | undefined, closers: readonly SessionEvent[]): Promise<void> {
    await this.ready
    this.db.transaction(() => {
      if (tornMarker !== undefined) {
        this.db.prepare('DELETE FROM events WHERE session_id = ? AND seq >= ?').run(meta.id, tornMarker)
      }
      if (closers.length > 0) {
        const insertEvent = this.db.prepare(
          'INSERT INTO events (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        for (const event of closers) {
          const [surfaceSeqs, surfaceOp, ignorable] = envelopeBindings(event)
          insertEvent.run(meta.id, event.seq, event.type, event.time, JSON.stringify(event.data), surfaceSeqs, surfaceOp, ignorable)
        }
      }
      if (tornMarker !== undefined || closers.length > 0) {
        this.db.prepare('UPDATE sessions SET revision = revision + 1 WHERE id = ?').run(meta.id)
      }
    })
  }

  /** List all materialized sessions' metadata (every row is a materialized session). */
  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const rows = this.db
      .prepare('SELECT * FROM sessions')
      .all() as unknown as SessionRow[]
    signal?.throwIfAborted()
    return rows.map(rowToMeta)
  }

  /** List metadata with a source-qualified monotonic revision per session. */
  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const rows = this.db.prepare('SELECT * FROM sessions').all() as unknown as SessionRow[]
    signal?.throwIfAborted()
    return rows.map(row => ({
      header: rowToMeta(row),
      revision: SessionPersistenceRevision(
        `${this.storeIdentity}:incarnation:${row.incarnation}:revision:${row.revision}`,
      ),
    }))
  }

  /** The Durable Object owns the database lifetime; nothing to close here. */
  async close(): Promise<void> {
    await this.ready
  }

  // --- row helpers ---

  /** Fetch a session's row, or undefined if absent. */
  private rowFor(id: SessionId): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow | undefined
  }

  /**
   * Insert-or-replace a session's metadata row. The only caller is the first
   * materializing `appendBatch`, so writing the row IS the materialization (its
   * existence is the signal `list` reads).
   */
  private writeRow(meta: SessionHeader): void {
    this.db.prepare(`
      INSERT INTO sessions
        (id, version, created_at, cwd, parent_session, seed_length, origin, delegation_depth, agent_preset, incarnation, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        created_at = excluded.created_at,
        cwd = excluded.cwd,
        parent_session = excluded.parent_session,
        seed_length = excluded.seed_length,
        origin = excluded.origin,
        delegation_depth = excluded.delegation_depth,
        agent_preset = excluded.agent_preset
    `).run(
      meta.id,
      meta.version,
      meta.createdAt,
      meta.cwd ?? null,
      meta.parentSession ?? null,
      meta.seedLength ?? null,
      meta.origin ?? null,
      meta.delegationDepth ?? null,
      meta.agentPreset ?? null,
      crypto.randomUUID(),
    )
  }
}

export default SqliteSessionPersistence
