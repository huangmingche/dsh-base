import { UPLOAD_TTL_MS } from "./uploads.ts";
/** Durable Object SQLite adapter for the Workers-native Session Host storage port. */
import { LogicalDirectoryStore } from "./logical-directories.ts";
import { providerForModelId } from "../../../boot/dsh-base-session-wire/src/model-routes.ts";
import { SessionRpcFault } from "./remote-contract.ts";
import type {
  SessionInputExecutionConfig,
  SessionModelRequest,
  SessionStepStart,
  SessionReasoningEffort,
  SessionHostAttachment,
  SessionHostEvent,
  SessionHostStorage,
  SessionHostSubmission,
  SessionHostSubmissionStatus,
  SessionMessageRecord,
  SessionRecord,
  SessionCreatePlacement,
  SessionTranscriptSnapshot,
  SessionWorkspaceFlags,
  SessionWorkspaceMembership,
  SessionWorkspaceRecord,
} from "./storage.ts";

/** Minimal SQL cursor shared by Durable Object SQLite and tests. */
export interface SqlCursor {
  toArray(): Array<Record<string, unknown>>;
}

/** Minimal SQL executor shared by Durable Object SQLite and tests. */
export interface SqlStorage {
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor;
  /**
   * Run a synchronous group atomically when the platform exposes it
   * (`DurableObjectStorage.transactionSync`); omitted test doubles fall back to
   * sequential writes.
   */
  transactionSync?<T>(operation: () => T): T;
}

interface SessionRow {
  session_id: string;
  title: string;
  running: number;
  blank: number;
  archived: number;
  model: string | null;
  reasoning_effort: SessionReasoningEffort | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  seq: number;
  role: string;
  parts: string;
}

function toSession(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    title: row.title,
    running: row.running === 1,
    blank: row.blank === 1,
    archived: row.archived === 1,
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.reasoning_effort == null ? {} : { reasoningEffort: row.reasoning_effort }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): SessionMessageRecord {
  return { id: row.id, seq: row.seq, role: row.role, parts: JSON.parse(row.parts) as unknown[] };
}

/** SQLite-backed storage; pass a Durable Object SQL executor in production. */
export class SqliteSessionHostStorage implements SessionHostStorage {
  private readonly sql: SqlStorage;
  private readonly directories: LogicalDirectoryStore;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.ensureSchema();
    this.directories = new LogicalDirectoryStore(sql);
  }

  private ensureSchema(): void {
    const statements = [
      `CREATE TABLE IF NOT EXISTS dsh_session_host_sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        running INTEGER NOT NULL,
        blank INTEGER NOT NULL,
        archived INTEGER NOT NULL,
        model TEXT,
        reasoning_effort TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_projection_revisions (
        session_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_execution_steps (
        session_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        sdk_request_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, step_id)
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_model_requests (
        session_id TEXT NOT NULL,
        sdk_request_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT,
        PRIMARY KEY (session_id, sdk_request_id)
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_input_configs (
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT,
        PRIMARY KEY (session_id, request_id)
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_messages (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        parts TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      )`,
      `CREATE INDEX IF NOT EXISTS dsh_session_host_messages_seq
        ON dsh_session_host_messages (session_id, seq)`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_projections (
        session_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_attachments (
        attachment_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        data_base64 TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_submissions (
        submission_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        text TEXT NOT NULL,
        attachments TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS dsh_session_host_submissions_session
        ON dsh_session_host_submissions (session_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_workspaces (
        workspace_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_workspace_sessions (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, session_id)
      )`,
      `CREATE TABLE IF NOT EXISTS dsh_session_host_session_flags (
        session_id TEXT PRIMARY KEY,
        pinned INTEGER NOT NULL,
        archived INTEGER NOT NULL
      )`,
    ];
    for (const statement of statements) this.sql.exec(statement);
    const columns = this.sql.exec("PRAGMA table_info(dsh_session_host_sessions)").toArray();
    if (!columns.some(column => column.name === "reasoning_effort")) this.sql.exec("ALTER TABLE dsh_session_host_sessions ADD COLUMN reasoning_effort TEXT");
    // These revisions order projection snapshots, not chat journal events.
    // SQLite triggers include direct permission-store writes and roll back
    // together with the owning mutation; no caller clock participates.
    for (const table of ["sessions", "projections"]) {
      for (const operation of ["INSERT", "UPDATE"]) this.sql.exec(`CREATE TRIGGER IF NOT EXISTS dsh_projection_revision_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON dsh_session_host_${table}
        BEGIN INSERT INTO dsh_session_host_projection_revisions (session_id, revision) VALUES (NEW.session_id, 1)
          ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1; END`);
    }

  }

  async projectionSnapshot(sessionId: string): Promise<{ session: SessionRecord; values: Record<string, unknown>; revision: number; stepCounts: readonly import('./execution-stats.ts').AssistantStepCount[]; turns: number }> {
    const read = () => {
      const row = this.sql.exec("SELECT s.*, p.value AS projection_value, COALESCE(r.revision, 0) AS projection_revision FROM dsh_session_host_sessions s LEFT JOIN dsh_session_host_projections p ON p.session_id = s.session_id LEFT JOIN dsh_session_host_projection_revisions r ON r.session_id = s.session_id WHERE s.session_id = ?", sessionId).toArray().at(0);
      if (row === undefined) throw new SessionRpcFault("session/not-found", "Session not found", { sessionId });
      // Return only accounting evidence, not the full conversation text, when
      // control projects every Session. Counts and revision share this read.
      const counts = this.sql.exec(`SELECT id,
        (SELECT COUNT(*) FROM json_each(m.parts) p WHERE p.type = 'object' AND json_extract(p.value, '$.type') = 'step-start') AS starts,
        EXISTS(SELECT 1 FROM json_each(m.parts) p WHERE p.type = 'object' AND COALESCE(json_extract(p.value, '$.type'), '') != 'data-dsh-model-source') AS content,
        (SELECT json_group_array(json_extract(p.value, '$.data.id')) FROM json_each(m.parts) p WHERE p.type = 'object' AND json_extract(p.value, '$.type') = 'data-dsh-step' AND json_type(p.value, '$.data.id') = 'text') AS step_ids
        FROM dsh_session_host_messages m WHERE session_id = ? AND role = 'assistant' ORDER BY seq`, sessionId).toArray();
      const turns = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM dsh_session_host_messages m WHERE m.session_id = ? AND m.role = 'user'
        AND NOT EXISTS(SELECT 1 FROM dsh_session_host_submissions s WHERE s.session_id = m.session_id AND s.request_id = m.id AND s.status = 'queued')`, sessionId).toArray()[0]!.n);
      return { session: toSession(row as unknown as SessionRow), values: row.projection_value === null ? {} : JSON.parse(String(row.projection_value)), revision: Number(row.projection_revision),
        stepCounts: counts.map(value=>({messageId:String(value.id),steps:Math.max(Number(value.starts),Number(value.content)),ids:JSON.parse(String(value.step_ids)) as string[]})), turns };
    };
    return this.sql.transactionSync ? this.sql.transactionSync(read) : read();
  }

  async renameSession(sessionId: string, title: string): Promise<{ title: string; projectionRevision: number }> {
    const rename = () => {
      const row = this.sql.exec("UPDATE dsh_session_host_sessions SET title = ?, updated_at = ? WHERE session_id = ? RETURNING session_id", title, Date.now(), sessionId).toArray().at(0);
      if (row === undefined) throw new SessionRpcFault("session/not-found", "Session not found", { sessionId });
      return { title, projectionRevision: Number(this.sql.exec("SELECT revision FROM dsh_session_host_projection_revisions WHERE session_id = ?", sessionId).toArray()[0]!.revision) };
    };
    return this.sql.transactionSync ? this.sql.transactionSync(rename) : rename();
  }

  async listSessions(): Promise<readonly SessionRecord[]> {
    const rows = this.sql.exec(`SELECT * FROM dsh_session_host_sessions`).toArray() as unknown as SessionRow[];
    return rows.map(toSession);
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_sessions WHERE session_id = ?`, sessionId)
      .toArray() as unknown as SessionRow[];
    const row = rows[0];
    return row === undefined ? undefined : toSession(row);
  }

  async transcriptSnapshot(sessionId: string): Promise<SessionTranscriptSnapshot> {
    const read = () => {
      const row = this.sql.exec("SELECT * FROM dsh_session_host_sessions WHERE session_id = ?", sessionId).toArray().at(0) as unknown as SessionRow | undefined;
      if (!row) throw new Error("session not found");
      const records = (this.sql.exec("SELECT * FROM dsh_session_host_messages WHERE session_id = ? ORDER BY seq ASC", sessionId).toArray() as unknown as MessageRow[]).map(toMessage);
      const submissions = this.sql.exec("SELECT * FROM dsh_session_host_submissions WHERE session_id = ? ORDER BY created_at ASC, rowid ASC", sessionId).toArray().map(entry => ({
        submissionId: String(entry.submission_id), sessionId, requestId: String(entry.request_id), text: String(entry.text),
        attachments: JSON.parse(String(entry.attachments)), status: String(entry.status) as SessionHostSubmissionStatus,
        createdAt: Number(entry.created_at), updatedAt: Number(entry.updated_at),
      }));
      const events = this.sql.exec("SELECT * FROM dsh_session_host_events WHERE session_id = ? ORDER BY seq ASC", sessionId).toArray().map(entry => ({ sessionId, seq: Number(entry.seq), type: String(entry.type), payload: JSON.parse(String(entry.payload)), createdAt: Number(entry.created_at) }));
      const projection = this.sql.exec("SELECT value FROM dsh_session_host_projections WHERE session_id = ?", sessionId).toArray().at(0);
      const saved = projection === undefined ? {} : JSON.parse(String(projection.value));
      const inheritedTurns = saved._dshBaseInheritedTurns;
      return { session: toSession(row), records, submissions, events, ...(saved._dshBaseForkSeed === undefined ? {} : { forkSeed: saved._dshBaseForkSeed }), ...(Array.isArray(inheritedTurns) ? { inheritedTurns } : {}), ...(saved._dshBaseExecutionSteps === undefined ? {} : { executionSteps: saved._dshBaseExecutionSteps }) };
    };
    return this.sql.transactionSync === undefined ? read() : this.sql.transactionSync(read);
  }

  async putSession(record: SessionRecord): Promise<void> { this.writeSession(record); }

  async createSession(record: SessionRecord, placement: SessionCreatePlacement): Promise<{ sessionId: string }> {
    const create = () => {
      let sessionId = record.sessionId;
      const existing = this.sql.exec("SELECT * FROM dsh_session_host_sessions WHERE session_id = ?", sessionId).toArray().at(0);
      if (existing !== undefined) {
        const membership = this.sql.exec(`SELECT m.workspace_id, w.path FROM dsh_session_host_workspace_sessions m
          LEFT JOIN dsh_session_host_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.session_id = ? ORDER BY m.rowid DESC LIMIT 1`, sessionId).toArray().at(0);
        const existingCwd = typeof membership?.path === "string" ? membership.path : "/";
        if (placement.requireLocation && existingCwd !== placement.cwd) throw new SessionRpcFault("session/conflict", "Session belongs to another working directory", { sessionId, requestedCwd: placement.cwd, existingCwd });
        const workspaceMismatch = placement.requestedWorkspaceId !== undefined && membership?.workspace_id !== placement.requestedWorkspaceId;
        if (!placement.reuseBlankOnly && workspaceMismatch) throw new SessionRpcFault("session/conflict", "Session belongs to another Workspace", { sessionId, workspaceId: placement.requestedWorkspaceId });
        const flags = this.sql.exec("SELECT archived FROM dsh_session_host_session_flags WHERE session_id = ?", sessionId).toArray().at(0);
        if (!placement.reuseBlankOnly || (existing.blank === 1 && existing.running !== 1 && existing.archived !== 1 && flags?.archived !== 1 && !workspaceMismatch)) return { sessionId };
        // A named nonblank/archived Session is only a creation hint in the
        // official protocol. Publish a fresh id without touching the original.
        sessionId = crypto.randomUUID();
      }
      this.sql.exec(`INSERT INTO dsh_session_host_sessions
        (session_id, title, running, blank, archived, model, reasoning_effort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, sessionId, record.title, record.running ? 1 : 0, record.blank ? 1 : 0, record.archived ? 1 : 0, record.model ?? null, record.reasoningEffort ?? null, record.createdAt, record.updatedAt);
      this.sql.exec('INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?)', sessionId, JSON.stringify({ _dshBasePermissionFresh: placement.permissionPreset ?? 'workspace-write' }));
      // Allocate placement in the same transaction as metadata, never from a
      // potentially stale list taken before a concurrent named create.
      this.sql.exec(`INSERT INTO dsh_session_host_workspace_sessions (workspace_id, session_id, position)
        SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM dsh_session_host_workspace_sessions WHERE workspace_id = ?`, placement.workspaceId, sessionId, placement.workspaceId);
      return { sessionId };
    };
    return this.sql.transactionSync === undefined ? create() : this.sql.transactionSync(create);
  }

  private writeSession(record: SessionRecord): void {
    this.sql.exec(
      `INSERT INTO dsh_session_host_sessions
        (session_id, title, running, blank, archived, model, reasoning_effort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         title = excluded.title,
         running = excluded.running,
         blank = excluded.blank,
         archived = COALESCE((SELECT archived FROM dsh_session_host_session_flags WHERE session_id = excluded.session_id), excluded.archived),
         updated_at = excluded.updated_at`,
      record.sessionId,
      record.title,
      record.running ? 1 : 0,
      record.blank ? 1 : 0,
      record.archived ? 1 : 0,
      record.model ?? null,
      record.reasoningEffort ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }

  async forkSession(sourceId: string, target: SessionRecord, messages: readonly SessionMessageRecord[], projections: Record<string, unknown>): Promise<void> {
    const fork = () => {
      if (this.sql.exec("SELECT session_id FROM dsh_session_host_sessions WHERE session_id = ?", target.sessionId).toArray().length) throw new SessionRpcFault("gateway/bad-request", "Fork target Session already exists", {});
      this.writeSession(target);
      const placement = this.sql.exec("SELECT workspace_id FROM dsh_session_host_workspace_sessions WHERE session_id = ?", sourceId).toArray().at(0);
      if (placement) this.sql.exec(`INSERT INTO dsh_session_host_workspace_sessions (workspace_id, session_id, position)
        SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM dsh_session_host_workspace_sessions WHERE workspace_id = ?`,
        placement.workspace_id, target.sessionId, placement.workspace_id);
      this.writeMessages(target.sessionId, messages);
      this.sql.exec("INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?)", target.sessionId, JSON.stringify(projections));
      for (const message of messages) for (const part of message.parts) {
        if (typeof part !== "object" || part === null || (part as { type?: unknown }).type !== "file") continue;
        if (this.sql.transactionSync === undefined) throw new SessionRpcFault("session/attachment-invalid", "Atomic file fork is unavailable", { reason: "STORAGE_UNAVAILABLE" });
        const attachment = (part as { attachment?: { attachmentId?: unknown; name?: unknown; bytes?: unknown } }).attachment;
        if (!attachment) throw new Error("Invalid file history reference");
        const row = this.sql.exec("SELECT * FROM dsh_session_host_uploads WHERE session_id = ? AND attachment_id = ? AND name = ? AND bytes = ? AND request_id IS NOT NULL LIMIT 1", sourceId, attachment.attachmentId, attachment.name, attachment.bytes).toArray().at(0);
        if (!row) throw new SessionRpcFault("session/attachment-invalid", "Fork file reference is unavailable", { reason: "FILE_NOT_ADMITTED" });
        this.sql.exec("INSERT INTO dsh_session_host_uploads (receipt_id, session_id, attachment_id, name, bytes, object_key, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", crypto.randomUUID(), target.sessionId, row.attachment_id, row.name, row.bytes, row.object_key, message.id, Date.now());
      }
    };
    if (this.sql.transactionSync === undefined && messages.some(message => message.parts.some(part => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "file"))) throw new SessionRpcFault("session/attachment-invalid", "Atomic file fork is unavailable", { reason: "STORAGE_UNAVAILABLE" });
    this.sql.transactionSync === undefined ? fork() : this.sql.transactionSync(fork);
  }

  async archiveSession(sessionId: string, stopActivity: boolean): Promise<void> {
    const archive = () => {
      const session = this.sql.exec("SELECT archived FROM dsh_session_host_sessions WHERE session_id = ?", sessionId).toArray().at(0);
      if (session === undefined) throw new Error("session not found");
      const turns = this.sql.exec("SELECT request_id FROM dsh_session_host_submissions WHERE session_id = ? AND status IN ('queued', 'running', 'awaiting-approval', 'continuing')", sessionId).toArray();
      const hasSchedules = this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dsh_session_host_schedules'").toArray().length > 0;
      const tasks = hasSchedules ? this.sql.exec("SELECT id, record_json, target_json FROM dsh_session_host_schedules WHERE status = 'active'").toArray().filter((row) => {
        const target = JSON.parse(String(row.target_json));
        return target.kind !== "new" && target.sessionId === sessionId;
      }) : [];
      const activity = [
        ...(turns.length === 0 ? [] : [{ kind: "turn", items: turns.map((row) => ({ id: String(row.request_id) })) }]),
        ...(tasks.length === 0 ? [] : [{ kind: "schedule", items: tasks.map((row) => ({ id: String(row.id), label: String(JSON.parse(String(row.record_json)).title) })) }]),
      ];
      if (session.archived !== 1 && !stopActivity && activity.length > 0) {
        throw new SessionRpcFault("workspace/session-active", "Session has active work", { sessionId, activity });
      }
      this.sql.exec("INSERT INTO dsh_session_host_session_flags (session_id, pinned, archived) VALUES (?, 0, 1) ON CONFLICT(session_id) DO UPDATE SET pinned = 0, archived = 1", sessionId);
      this.sql.exec("UPDATE dsh_session_host_sessions SET archived = 1, updated_at = ? WHERE session_id = ?", Date.now(), sessionId);
      // Official schedule/session-stop removes active targeted tasks. Keep
      // delivery history, and leave paused/ended tasks untouched.
      if (stopActivity || session.archived === 1) for (const task of tasks) this.sql.exec("DELETE FROM dsh_session_host_schedules WHERE id = ?", task.id);
    };
    this.sql.transactionSync === undefined ? archive() : this.sql.transactionSync(archive);
  }

  async admitSubmission(submission: SessionHostSubmission, parts: readonly unknown[], derivedTitle: string, receiptIds: readonly string[] = [], defaultConfig?: SessionInputExecutionConfig): Promise<{ requestId: string; submissionId: string }> {
    if (receiptIds.length > 0 && this.sql.transactionSync === undefined) throw new SessionRpcFault("session/attachment-invalid", "Atomic attachment admission is unavailable", { reason: "STORAGE_UNAVAILABLE" });
    const admit = () => {
      const previous = this.sql.exec("SELECT submission_id FROM dsh_session_host_submissions WHERE session_id = ? AND request_id = ?", submission.sessionId, submission.requestId).toArray().at(0);
      if (previous !== undefined) return { requestId: submission.requestId, submissionId: String(previous.submission_id) };
      const session = this.sql.exec("SELECT archived, model, reasoning_effort FROM dsh_session_host_sessions WHERE session_id = ?", submission.sessionId).toArray().at(0);
      if (session === undefined) throw new Error("session not found");
      if (session.archived === 1) throw new SessionRpcFault("session/archived", "Session is archived", { sessionId: submission.sessionId });
      for (const receiptId of new Set(receiptIds)) {
        const upload = this.sql.exec("SELECT request_id, created_at FROM dsh_session_host_uploads WHERE receipt_id = ? AND session_id = ?", receiptId, submission.sessionId).toArray().at(0);
        if (upload === undefined || (upload.request_id === null && Number(upload.created_at) <= Date.now() - UPLOAD_TTL_MS) || (upload.request_id !== null && upload.request_id !== submission.requestId)) throw new SessionRpcFault("session/attachment-invalid", "Upload receipt is unavailable or already used", { reason: "FILE_NOT_STAGED" });
        this.sql.exec("UPDATE dsh_session_host_uploads SET request_id = ? WHERE receipt_id = ?", submission.requestId, receiptId);
      }
      // Freeze the current picker in the same transaction as this admission.
      // A model changed while upload validation awaited belongs to this input;
      // later picker changes cannot rewrite queued or approval continuations.
      const model = typeof session.model === "string" ? session.model : defaultConfig?.model;
      const effort = session.reasoning_effort ?? (model === "deepseek-flash" || model === "deepseek-v4-pro" ? "high" : undefined);
      if (model !== undefined) this.sql.exec("INSERT INTO dsh_session_host_input_configs (session_id, request_id, model, reasoning_effort) VALUES (?, ?, ?, ?)", submission.sessionId, submission.requestId, model, effort ?? null);
      const messageSeq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_messages WHERE session_id = ?", submission.sessionId).toArray().at(0)?.next ?? 1);
      this.writeMessages(submission.sessionId, [{ id: submission.requestId, seq: messageSeq, role: "user", parts }]);
      this.sql.exec("INSERT INTO dsh_session_host_submissions (submission_id, session_id, request_id, text, attachments, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        submission.submissionId, submission.sessionId, submission.requestId, submission.text, JSON.stringify(submission.attachments ?? []), submission.status, submission.createdAt, submission.updatedAt);
      const eventSeq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_events WHERE session_id = ?", submission.sessionId).toArray().at(0)?.next ?? 1);
      this.sql.exec("INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at) VALUES (?, ?, 'submission.queued', ?, ?)", submission.sessionId, eventSeq, JSON.stringify(submission), submission.createdAt);
      this.sql.exec("UPDATE dsh_session_host_sessions SET title = CASE WHEN title = 'New Session' THEN ? ELSE title END, running = 1, blank = 0, updated_at = ? WHERE session_id = ?", derivedTitle, submission.createdAt, submission.sessionId);
      return { requestId: submission.requestId, submissionId: submission.submissionId };
    };
    return this.sql.transactionSync === undefined ? admit() : this.sql.transactionSync(admit);
  }

  async selectModel(sessionId: string, selection: SessionInputExecutionConfig): Promise<SessionInputExecutionConfig> {
    const row = this.sql.exec("UPDATE dsh_session_host_sessions SET model = ?, reasoning_effort = ?, updated_at = ? WHERE session_id = ? RETURNING session_id", selection.model, selection.reasoningEffort ?? null, Date.now(), sessionId).toArray().at(0);
    if (row === undefined) throw new SessionRpcFault("session/not-found", "Session not found", { sessionId });
    return selection;
  }

  freezeInputModel(sessionId: string, requestId: string, model: string): void {
    const row = this.sql.exec("SELECT model FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?", sessionId, requestId).toArray().at(0);
    if (row === undefined) throw new SessionRpcFault("gateway/bad-request", "No frozen input configuration exists", { requestId });
    const current = String(row.model);
    if (current === model) return;
    if (current.includes("/")) throw new SessionRpcFault("session/conflict", "An explicit provider route is already frozen for this input", { requestId, current, model });
    this.sql.exec("UPDATE dsh_session_host_input_configs SET model = ? WHERE session_id = ? AND request_id = ?", model, sessionId, requestId);
  }

  async getInputExecutionConfig(sessionId: string, requestId: string): Promise<SessionInputExecutionConfig | undefined> {
    const row = this.sql.exec("SELECT model, reasoning_effort FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?", sessionId, requestId).toArray().at(0);
    return row === undefined ? undefined : { model: String(row.model), ...(row.reasoning_effort === null ? {} : { reasoningEffort: row.reasoning_effort as SessionReasoningEffort }) };
  }

  async recordModelRequest(request: SessionModelRequest): Promise<void> {
    const record = () => {
      const config = this.sql.exec("SELECT model, reasoning_effort FROM dsh_session_host_input_configs WHERE session_id = ? AND request_id = ?", request.sessionId, request.requestId).toArray().at(0);
      if (config === undefined || config.model !== request.model || (config.reasoning_effort ?? undefined) !== request.reasoningEffort) throw new SessionRpcFault("session/conflict", "Model request does not match the admitted input configuration", { requestId: request.requestId });
      const prior = this.sql.exec("SELECT request_id, model, reasoning_effort FROM dsh_session_host_model_requests WHERE session_id = ? AND sdk_request_id = ?", request.sessionId, request.sdkRequestId).toArray().at(0);
      if (prior !== undefined) {
        if (prior.request_id !== request.requestId || prior.model !== request.model || (prior.reasoning_effort ?? undefined) !== request.reasoningEffort) throw new SessionRpcFault("session/conflict", "Model request identity was already recorded with another configuration", { sdkRequestId: request.sdkRequestId });
        return;
      }
      const row = this.sql.exec("SELECT value FROM dsh_session_host_projections WHERE session_id = ?", request.sessionId).toArray().at(0);
      const value = row === undefined ? {} : JSON.parse(String(row.value));
      const lastUsed = { provider: providerForModelId(request.model), model: request.model, ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) };
      this.sql.exec("INSERT INTO dsh_session_host_model_requests (session_id, sdk_request_id, request_id, model, reasoning_effort) VALUES (?, ?, ?, ?, ?)", request.sessionId, request.sdkRequestId, request.requestId, request.model, request.reasoningEffort ?? null);
      this.sql.exec("INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value", request.sessionId, JSON.stringify({ ...value, modelSelection: { ...value.modelSelection, lastUsed }, _dshBaseModelRequest: { requestId: request.requestId, sdkRequestId: request.sdkRequestId } }));
    };
    if (!this.sql.transactionSync) throw new SessionRpcFault("gateway/endpoint-unavailable", "Atomic model request recording is unavailable", {});
    this.sql.transactionSync(record);
  }

  async recordStepStart(step: SessionStepStart): Promise<void> {
    const write = () => {
      const request = this.sql.exec("SELECT request_id FROM dsh_session_host_model_requests WHERE session_id = ? AND sdk_request_id = ?", step.sessionId, step.sdkRequestId).toArray().at(0);
      if (request?.request_id !== step.requestId) throw new SessionRpcFault("session/conflict", "Step has no matching admitted model request", { requestId: step.requestId, sdkRequestId: step.sdkRequestId });
      const prior = this.sql.exec("SELECT request_id, sdk_request_id, started_at FROM dsh_session_host_execution_steps WHERE session_id = ? AND step_id = ?", step.sessionId, step.stepId).toArray().at(0);
      if (prior !== undefined) {
        if (prior.request_id !== step.requestId || prior.sdk_request_id !== step.sdkRequestId || Number(prior.started_at) !== step.startedAt) throw new SessionRpcFault("session/conflict", "Step identity already has different execution evidence", { stepId: step.stepId });
        return;
      }
      const submission = this.sql.exec("SELECT status FROM dsh_session_host_submissions WHERE session_id = ? AND request_id = ?", step.sessionId, step.requestId).toArray().at(0);
      if (submission === undefined || ["cancelled", "completed", "failed"].includes(String(submission.status))) throw new SessionRpcFault("session/conflict", "Input is no longer active for a new model step", { requestId: step.requestId });
      const row = this.sql.exec("SELECT value FROM dsh_session_host_projections WHERE session_id = ?", step.sessionId).toArray().at(0);
      const value = row === undefined ? {} : JSON.parse(String(row.value));
      const executions = value._dshBaseExecutionSteps ?? {};
      const steps = [...(executions[step.requestId] ?? []), { id: step.stepId, sdkRequestId: step.sdkRequestId, startedAt: step.startedAt }];
      this.sql.exec("INSERT INTO dsh_session_host_execution_steps (session_id, step_id, request_id, sdk_request_id, started_at) VALUES (?, ?, ?, ?, ?)", step.sessionId, step.stepId, step.requestId, step.sdkRequestId, step.startedAt);
      this.sql.exec("INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value", step.sessionId, JSON.stringify({ ...value, _dshBaseExecutionSteps: { ...executions, [step.requestId]: steps } }));
      const seq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_events WHERE session_id = ?", step.sessionId).toArray()[0]!.next);
      this.sql.exec("INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at) VALUES (?, ?, 'execution.step-started', ?, ?)", step.sessionId, seq, JSON.stringify(step), step.startedAt);
    };
    if (!this.sql.transactionSync) throw new SessionRpcFault("gateway/endpoint-unavailable", "Atomic step start recording is unavailable", {});
    this.sql.transactionSync(write);
  }

  async syncMessages(sessionId: string, messages: readonly { id: string; role: string; parts: readonly unknown[] }[]): Promise<SessionMessageRecord[]> {
    const sync = () => {
      const records = (this.sql.exec("SELECT * FROM dsh_session_host_messages WHERE session_id = ? ORDER BY seq ASC", sessionId).toArray() as unknown as MessageRow[]).map(toMessage);
      const pending = this.sql.exec("SELECT request_id, text FROM dsh_session_host_submissions WHERE session_id = ? AND status = 'queued' ORDER BY created_at ASC", sessionId).toArray();
      const presented = messages.map(message => {
        const source = records.find(row => row.id === message.id && row.role === message.role);
        if (message.role === "assistant" && source !== undefined) {
          // Agent execution history intentionally excludes Host-only evidence.
          // A fresh Agent syncing the same message must not erase that evidence,
          // or restore stale tool parts over the Agent's latest result.
          const typeOf = (part: unknown) => typeof part === "object" && part !== null ? (part as { type?: unknown }).type : undefined;
          const incomingTypes = new Set(message.parts.map(typeOf));
          const retained = source.parts.filter(part => ["data-dsh-step", "data-dsh-model-source"].includes(String(typeOf(part))) && !incomingTypes.has(typeOf(part)));
          return retained.length === 0 ? message : { ...message, parts: [...message.parts, ...retained] };
        }
        return source?.parts.some(part => typeof part === "object" && part !== null && ["file", "image", "attachment"].includes(String((part as { type?: unknown }).type))) ? { ...message, parts: source.parts } : message;
      });
      const ids = new Set(presented.map((message) => message.id));
      const queued = pending.flatMap((submission) => {
        const requestId = String(submission.request_id);
        if (ids.has(requestId)) return [];
        const record = records.find((message) => message.id === requestId) ?? [...records].reverse().find((message) => message.role === "user"
          && message.parts.flatMap((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" ? [String((part as { text?: unknown }).text ?? "")] : []).join("") === submission.text);
        return record === undefined ? [] : [{ ...record, id: requestId }];
      });
      const merged = [...presented, ...queued].map((message, index) => ({ ...message, seq: index + 1 }));
      this.sql.exec("DELETE FROM dsh_session_host_messages WHERE session_id = ?", sessionId);
      this.writeMessages(sessionId, merged);
      return merged;
    };
    return this.sql.transactionSync === undefined ? sync() : this.sql.transactionSync(sync);
  }

  async repairCompletedToolResults(sessionId:string,messages:readonly {id:string;role:string;parts:readonly unknown[]}[]):Promise<number> {
    const repair=()=>{
      const records=(this.sql.exec('SELECT * FROM dsh_session_host_messages WHERE session_id = ? ORDER BY seq',sessionId).toArray() as unknown as MessageRow[]).map(toMessage);
      const completed=new Set(this.sql.exec("SELECT request_id FROM dsh_session_host_submissions WHERE session_id = ? AND status = 'completed'",sessionId).toArray().map(row=>String(row.request_id)));
      const evidence=new Map<string,{requestId:string;message:typeof messages[number]}>();
      let evidenceRequest:string|undefined;
      for(const message of messages){
        if(message.role==='user')evidenceRequest=message.id;
        else if(message.role==='assistant'&&evidenceRequest!==undefined)evidence.set(message.id,{requestId:evidenceRequest,message});
      }
      let eligible=false,changed=0,currentRequest:string|undefined;
      const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
      for(const row of records){
        if(row.role==='user'){currentRequest=row.id;eligible=completed.has(row.id);continue;}
        if(!eligible||row.role!=='assistant')continue;
        const source=evidence.get(row.id);if(source===undefined||source.requestId!==currentRequest)continue;
        const actual=source.message;
        let repaired=false;
        let parts=row.parts.map(part=>{
          if(!object(part)||typeof part.toolCallId!=='string'||!['input-available','approval-requested','approval-responded'].includes(String(part.state)))return part;
          const terminal=actual.parts.find(candidate=>object(candidate)&&candidate.toolCallId===part.toolCallId&&['output-available','output-error','output-denied'].includes(String(candidate.state)));
          if(terminal===undefined)return part;
          repaired=true;return terminal;
        });
        if(!repaired)continue;
        parts=parts.map(part=>{
          if(!object(part)||part.type!=='data-dsh-step'||!object(part.data))return part;
          return actual.parts.find(candidate=>object(candidate)&&candidate.type==='data-dsh-step'&&object(candidate.data)&&candidate.data.id===(part.data as Record<string,unknown>).id)??part;
        });
        this.sql.exec('UPDATE dsh_session_host_messages SET parts = ? WHERE session_id = ? AND id = ?',JSON.stringify(parts),sessionId,row.id);changed++;
      }
      if(changed>0){
        const now=Date.now();
        const seq=Number(this.sql.exec('SELECT COALESCE(MAX(seq),0)+1 AS next FROM dsh_session_host_events WHERE session_id = ?',sessionId).toArray()[0]!.next);
        this.sql.exec('INSERT INTO dsh_session_host_events (session_id,seq,type,payload,created_at) VALUES (?,?,?,?,?)',sessionId,seq,'agent.tool-results-repaired',JSON.stringify({messages:changed}),now);
        this.sql.exec('UPDATE dsh_session_host_sessions SET updated_at = ? WHERE session_id = ?',now,sessionId);
      }
      return changed;
    };
    if(!this.sql.transactionSync)throw new Error('Atomic tool result repair unavailable');
    return this.sql.transactionSync(repair);
  }

  async pageMessages(
    sessionId: string,
    beforeSeq: number | undefined,
    limit: number,
  ): Promise<{ records: readonly SessionMessageRecord[]; hasMore: boolean }> {
    const query = beforeSeq === undefined
      ? `SELECT * FROM dsh_session_host_messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?`
      : `SELECT * FROM dsh_session_host_messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`;
    const bindings = beforeSeq === undefined ? [sessionId, limit + 1] : [sessionId, beforeSeq, limit + 1];
    const rows = this.sql.exec(query, ...bindings).toArray() as unknown as MessageRow[];
    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit).map(toMessage).reverse();
    return { records, hasMore };
  }

  async getProjections(sessionId: string): Promise<Record<string, unknown>> {
    const rows = this.sql
      .exec(`SELECT value FROM dsh_session_host_projections WHERE session_id = ?`, sessionId)
      .toArray() as unknown as Array<{ value: string }>;
    return rows[0] === undefined ? {} : JSON.parse(rows[0].value) as Record<string, unknown>;
  }

  async putProjections(sessionId: string, value: Record<string, unknown>): Promise<void> {
    // Transcript/usage writers may have read their snapshot before a newer
    // permission decision or model attempt. Those authorities own these fields.
    const row = this.sql.exec("SELECT value FROM dsh_session_host_projections WHERE session_id = ?", sessionId).toArray().at(0);
    const current = row === undefined ? {} : JSON.parse(String(row.value));
    const saved = { ...value };
    for (const field of ["permissionEvents", "permissionState", "permissions", "_dshBasePermissionFresh", "_dshBasePermissionCommands", "_dshBaseApprovalNotices", "_dshBaseExecutionSteps"]) if (current[field] !== undefined) saved[field] = current[field];
    if (current._dshBaseModelRequest !== undefined) {
      saved._dshBaseModelRequest = current._dshBaseModelRequest;
      saved.modelSelection = { ...(value.modelSelection as Record<string, unknown> | undefined), lastUsed: current.modelSelection?.lastUsed ?? null };
    }
    this.sql.exec(
      `INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET value = excluded.value`,
      sessionId,
      JSON.stringify(saved),
    );
  }

  async nextMessageSeq(sessionId: string): Promise<number> {
    const rows = this.sql
      .exec(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_messages WHERE session_id = ?`, sessionId)
      .toArray() as unknown as Array<{ next: number }>;
    return rows[0]?.next ?? 1;
  }

  async appendEvent(sessionId: string, type: string, payload: unknown): Promise<SessionHostEvent> {
    const rows = this.sql
      .exec(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_events WHERE session_id = ?`, sessionId)
      .toArray() as unknown as Array<{ next: number }>;
    const seq = rows[0]?.next ?? 1;
    const createdAt = Date.now();
    this.sql.exec(
      `INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      sessionId, seq, type, JSON.stringify(payload), createdAt,
    );
    return { sessionId, seq, type, payload, createdAt };
  }

  async listEvents(sessionId: string, afterSeq: number, limit: number): Promise<readonly SessionHostEvent[]> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
        sessionId, afterSeq, limit)
      .toArray() as unknown as Array<{ session_id: string; seq: number; type: string; payload: string; created_at: number }>;
    return rows.map((row) => ({
      sessionId: row.session_id,
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payload) as unknown,
      createdAt: row.created_at,
    }));
  }

  async putAttachment(attachment: SessionHostAttachment): Promise<void> {
    this.sql.exec(
      `INSERT INTO dsh_session_host_attachments
        (attachment_id, session_id, name, media_type, data_base64, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(attachment_id) DO NOTHING`,
      attachment.attachmentId, attachment.sessionId, attachment.name, attachment.mediaType,
      attachment.dataBase64, attachment.size, attachment.createdAt,
    );
  }

  async getAttachment(attachmentId: string): Promise<SessionHostAttachment | undefined> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_attachments WHERE attachment_id = ?`, attachmentId)
      .toArray() as unknown as Array<{
        attachment_id: string; session_id: string; name: string; media_type: string;
        data_base64: string; size: number; created_at: number;
      }>;
    const row = rows[0];
    return row === undefined ? undefined : {
      attachmentId: row.attachment_id,
      sessionId: row.session_id,
      name: row.name,
      mediaType: row.media_type,
      dataBase64: row.data_base64,
      size: row.size,
      createdAt: row.created_at,
    };
  }

  async putSubmission(submission: SessionHostSubmission): Promise<void> {
    this.sql.exec(
      `INSERT INTO dsh_session_host_submissions
        (submission_id, session_id, request_id, text, attachments, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(submission_id) DO UPDATE SET
         request_id = excluded.request_id, text = excluded.text, attachments = excluded.attachments,
         status = excluded.status, updated_at = excluded.updated_at`,
      submission.submissionId, submission.sessionId, submission.requestId, submission.text,
      JSON.stringify(submission.attachments ?? []), submission.status, submission.createdAt, submission.updatedAt,
    );
  }

  async transitionSubmission(submissionId: string, status: SessionHostSubmissionStatus, eventType: string, payload: unknown): Promise<SessionHostSubmission> {
    const transition = () => {
      const row = this.sql.exec("SELECT * FROM dsh_session_host_submissions WHERE submission_id = ?", submissionId).toArray().at(0);
      if (!row) throw new Error("submission not found");
      const previous: SessionHostSubmission = { submissionId, sessionId: String(row.session_id), requestId: String(row.request_id), text: String(row.text),
        attachments: JSON.parse(String(row.attachments)), status: String(row.status) as SessionHostSubmissionStatus, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
      if (previous.status === "cancelled") return previous;
      const updatedAt = Date.now();
      this.sql.exec("UPDATE dsh_session_host_submissions SET status = ?, updated_at = ? WHERE submission_id = ?", status, updatedAt, submissionId);
      this.sql.exec(`INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at)
        SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM dsh_session_host_events WHERE session_id = ?`, previous.sessionId, eventType, JSON.stringify(payload), updatedAt, previous.sessionId);
      this.sql.exec(`UPDATE dsh_session_host_sessions SET running = EXISTS (
        SELECT 1 FROM dsh_session_host_submissions WHERE session_id = ? AND status IN ('queued', 'running', 'awaiting-approval', 'continuing')
      ), updated_at = ? WHERE session_id = ?`, previous.sessionId, updatedAt, previous.sessionId);
      return { ...previous, status, updatedAt };
    };
    return this.sql.transactionSync === undefined ? transition() : this.sql.transactionSync(transition);
  }

  async getSubmission(submissionId: string): Promise<SessionHostSubmission | undefined> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_submissions WHERE submission_id = ?`, submissionId)
      .toArray() as unknown as Array<{
        submission_id: string; session_id: string; request_id: string; text: string;
        attachments: string; status: SessionHostSubmissionStatus; created_at: number; updated_at: number;
      }>;
    const row = rows[0];
    return row === undefined ? undefined : {
      submissionId: row.submission_id,
      sessionId: row.session_id,
      requestId: row.request_id,
      text: row.text,
      attachments: JSON.parse(row.attachments) as SessionHostSubmission["attachments"],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listSubmissions(sessionId: string): Promise<readonly SessionHostSubmission[]> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_submissions WHERE session_id = ? ORDER BY created_at ASC`, sessionId)
      .toArray() as unknown as Array<{
        submission_id: string; session_id: string; request_id: string; text: string;
        attachments: string; status: SessionHostSubmissionStatus; created_at: number; updated_at: number;
      }>;
    return rows.map((row) => ({
      submissionId: row.submission_id,
      sessionId: row.session_id,
      requestId: row.request_id,
      text: row.text,
      attachments: JSON.parse(row.attachments) as SessionHostSubmission["attachments"],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async directoryList(path?: string) { return this.directories.list(path); }
  async directoryCreate(path: string, name: string) { return this.directories.create(path, name); }

  async listWorkspaces(): Promise<readonly SessionWorkspaceRecord[]> {
    const rows = this.sql.exec(`SELECT * FROM dsh_session_host_workspaces ORDER BY position ASC`).toArray() as unknown as Array<{
      workspace_id: string; title: string; path: string; position: number; created_at: number; updated_at: number;
    }>;
    return rows.map((row) => ({
      workspaceId: row.workspace_id, title: row.title, path: row.path, position: row.position,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async getWorkspace(workspaceId: string): Promise<SessionWorkspaceRecord | undefined> {
    const rows = this.sql.exec(`SELECT * FROM dsh_session_host_workspaces WHERE workspace_id = ?`, workspaceId)
      .toArray() as unknown as Array<{
        workspace_id: string; title: string; path: string; position: number; created_at: number; updated_at: number;
      }>;
    const row = rows[0];
    return row === undefined ? undefined : {
      workspaceId: row.workspace_id, title: row.title, path: row.path, position: row.position,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async putWorkspace(workspace: SessionWorkspaceRecord): Promise<void> {
    const put = () => {
    this.sql.exec(
      `INSERT INTO dsh_session_host_workspaces
        (workspace_id, title, path, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         title = excluded.title, path = excluded.path, position = excluded.position,
         updated_at = excluded.updated_at`,
      workspace.workspaceId, workspace.title, workspace.path, workspace.position,
      workspace.createdAt, workspace.updatedAt,
    );
    this.directories.remember(workspace.path);
    };
    this.sql.transactionSync === undefined ? put() : this.sql.transactionSync(put);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const path = this.sql.exec("SELECT path FROM dsh_session_host_workspaces WHERE workspace_id = ?", workspaceId).toArray().at(0)?.path;
    if (typeof path === "string") this.directories.remember(path);
    this.sql.exec(`DELETE FROM dsh_session_host_workspaces WHERE workspace_id = ?`, workspaceId);
  }

  async listMemberships(): Promise<readonly SessionWorkspaceMembership[]> {
    const rows = this.sql.exec(`SELECT * FROM dsh_session_host_workspace_sessions`).toArray() as unknown as Array<{
      workspace_id: string; session_id: string; position: number;
    }>;
    return rows.map((row) => ({ workspaceId: row.workspace_id, sessionId: row.session_id, position: row.position }));
  }

  async putMembership(workspaceId: string, sessionId: string, position: number): Promise<void> {
    this.sql.exec(
      `INSERT INTO dsh_session_host_workspace_sessions (workspace_id, session_id, position)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, session_id) DO UPDATE SET position = excluded.position`,
      workspaceId, sessionId, position,
    );
  }

  async removeMembership(workspaceId: string, sessionId: string): Promise<void> {
    this.sql.exec(`DELETE FROM dsh_session_host_workspace_sessions WHERE workspace_id = ? AND session_id = ?`, workspaceId, sessionId);
  }

  async deleteWorkspaceMemberships(workspaceId: string): Promise<void> {
    this.sql.exec(`DELETE FROM dsh_session_host_workspace_sessions WHERE workspace_id = ?`, workspaceId);
  }

  async listSessionFlags(): Promise<Readonly<Record<string, SessionWorkspaceFlags>>> {
    // Oldest flag write first: the Host reverses the pinned subset to obtain
    // the official most-recently-pinned-first order.
    const rows = this.sql.exec(`SELECT session_id, pinned, archived FROM dsh_session_host_session_flags ORDER BY rowid ASC`).toArray() as unknown as Array<{
      session_id: string; pinned: number; archived: number;
    }>;
    const flags: Record<string, SessionWorkspaceFlags> = {};
    for (const row of rows) flags[row.session_id] = { pinned: row.pinned === 1, archived: row.archived === 1 };
    return flags;
  }

  async putSessionFlags(sessionId: string, flags: SessionWorkspaceFlags): Promise<void> {
    // REPLACE rather than UPSERT so a changed flag row moves to the newest
    // rowid; that is how the pin/archive order survives without a schema column.
    this.sql.exec(
      `INSERT OR REPLACE INTO dsh_session_host_session_flags (session_id, pinned, archived)
       VALUES (?, ?, ?)`,
      sessionId, flags.pinned ? 1 : 0, flags.archived ? 1 : 0,
    );
  }

  async readAllMessages(sessionId: string): Promise<readonly SessionMessageRecord[]> {
    const rows = this.sql
      .exec(`SELECT * FROM dsh_session_host_messages WHERE session_id = ? ORDER BY seq ASC`, sessionId)
      .toArray() as unknown as MessageRow[];
    return rows.map(toMessage);
  }

  async replaceMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void> {
    const replace = (): void => {
      this.sql.exec(`DELETE FROM dsh_session_host_messages WHERE session_id = ?`, sessionId);
      this.writeMessages(sessionId, messages);
    };
    // DELETE+INSERT must never be observed half-applied by a concurrent reader
    // (follow/page) when the runtime offers a synchronous transaction.
    const transaction = this.sql.transactionSync;
    if (transaction === undefined) replace();
    else transaction.call(this.sql, replace);
  }

  async appendMessages(sessionId: string, messages: readonly SessionMessageRecord[]): Promise<void> {
    this.writeMessages(sessionId, messages);
  }

  /** Synchronous helper so transaction exceptions cannot escape as rejected promises. */
  private writeMessages(sessionId: string, messages: readonly SessionMessageRecord[]): void {
    for (const message of messages) {
      this.sql.exec(
        `INSERT INTO dsh_session_host_messages (session_id, id, seq, role, parts)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET
           seq = excluded.seq, role = excluded.role, parts = excluded.parts`,
        sessionId,
        message.id,
        message.seq,
        message.role,
        JSON.stringify(message.parts),
      );
    }
  }
}
