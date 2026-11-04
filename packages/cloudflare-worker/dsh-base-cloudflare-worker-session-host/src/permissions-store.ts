/** Atomic Host persistence for the pinned permission service's complete event journal. */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { PermissionRuntime, PermissionChange } from '@dsh-base/cloudflare-worker-permissions/runtime';
import type { PermissionSnapshot } from '@dsh-base/cloudflare-worker-permissions/executor';
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { SqlStorage } from './sqlite-storage.ts';
import { SessionRpcFault } from './remote-contract.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Construct only after createPermissionRuntime() resolves; no async work enters transactions. */
export class PermissionStore {
  private readonly sql: SqlStorage;
  private readonly runtime: PermissionRuntime;
  private readonly resolveDefault: () => string;
  constructor(sql: SqlStorage, runtime: PermissionRuntime, resolveDefault: () => string) {
    this.sql = sql; this.runtime = runtime; this.resolveDefault = resolveDefault;
  }

  private transaction<T>(operation: () => T): T {
    if (this.sql.transactionSync === undefined) throw new SessionRpcFault('gateway/endpoint-unavailable', 'Atomic permission persistence is unavailable');
    return this.sql.transactionSync(operation);
  }

  private projections(sessionId: string): Record<string, unknown> {
    if (this.sql.exec('SELECT session_id FROM dsh_session_host_sessions WHERE session_id = ?', sessionId).toArray().length !== 1) {
      throw new SessionRpcFault('session/not-found', 'Session not found');
    }
    const row = this.sql.exec('SELECT value FROM dsh_session_host_projections WHERE session_id = ?', sessionId).toArray()[0];
    if (row === undefined) return {};
    const value: unknown = JSON.parse(String(row.value));
    if (!isRecord(value)) throw new Error('Invalid persisted session projections');
    return value;
  }

  private events(value: Record<string, unknown>, fresh: boolean): readonly SessionEvent[] | null {
    if (value.permissionEvents === undefined) return fresh ? null : [];
    if (!Array.isArray(value.permissionEvents)) throw new Error('Invalid persisted permission journal');
    // The runtime validates policy payloads and Session.create validates each
    // envelope/sequence before folding or writing. Stored snapshots are not trusted.
    return value.permissionEvents as readonly SessionEvent[];
  }

  private commit(sessionId: string, previous: Record<string, unknown>, change: PermissionChange): PermissionSnapshot {
    const permissions = { currentValue: change.snapshot.currentValue };
    if (previous._dshBasePermissionFresh === undefined && change.appended.length === 0 && JSON.stringify(previous.permissionState) === JSON.stringify(change.snapshot)
      && JSON.stringify(previous.permissions) === JSON.stringify(permissions)) return change.snapshot;
    const { _dshBasePermissionFresh: _fresh, ...retained } = previous;
    const notices = this.notices(previous);
    const next = { ...retained, permissionEvents: change.events, permissionState: change.snapshot, permissions,
      ...(notices.length + change.notices.length === 0 ? {} : { _dshBaseApprovalNotices: [...notices, ...change.notices] }) };
    this.sql.exec('INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value', sessionId, JSON.stringify(next));
    let seq = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_events WHERE session_id = ?', sessionId).toArray()[0]?.next ?? 1);
    for (const event of change.appended) {
      // Restore markers belong to the internal permission journal. The three
      // canonical whole-value policy facts also invalidate the Host follow feed.
      if (event.type === 'session/end-seed') continue;
      this.sql.exec('INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', sessionId, seq++, event.type, JSON.stringify(event.data), event.time);
    }
    return change.snapshot;
  }

  private initialChange(sessionId: string, previous: Record<string, unknown>, fresh = false): PermissionChange {
    const pinned = previous._dshBasePermissionFresh;
    if (pinned !== undefined && (typeof pinned !== 'string' || pinned.length === 0)) throw new Error('Invalid new-session permission marker');
    // Creation persists its default before publishing the Session. Recovery must
    // not substitute a user setting changed after that creation transaction.
    return this.runtime.initializeSession(sessionId, this.events(previous, fresh || pinned !== undefined), pinned ?? this.resolveDefault());
  }

  initialize(sessionId: string, fresh = false): PermissionSnapshot {
    return this.transaction(() => {
      const previous = this.projections(sessionId);
      return this.commit(sessionId, previous, this.initialChange(sessionId, previous, fresh));
    });
  }

  select(sessionId: string, preset: string): PermissionSnapshot {
    return this.transaction(() => {
      const previous = this.projections(sessionId);
      const initialized = this.initialChange(sessionId, previous);
      const changed = this.runtime.selectPreset(sessionId, initialized.events, preset);
      return this.commit(sessionId, previous, { ...changed, appended: [...initialized.appended, ...changed.appended] });
    });
  }

  snapshot(sessionId: string): PermissionSnapshot { return this.initialize(sessionId, false); }
  private notices(value: Record<string, unknown>): readonly UserMessage[] {
    const notices = value._dshBaseApprovalNotices ?? [];
    if (!Array.isArray(notices) || notices.some(message => !isRecord(message) || typeof message.id !== 'string'
      || message.role !== 'user' || !isRecord(message.source) || message.source.kind !== 'user-approval'
      || !Array.isArray(message.content) || message.content.some(part => !isRecord(part) || part.type !== 'text' || typeof part.text !== 'string'))) {
      throw new Error('Invalid approval policy notice outbox');
    }
    return notices as readonly UserMessage[];
  }

  /** Read a coherent policy/outbox snapshot; this never wakes an Agent. */
  async modelContext(sessionId: string) {
    const saved = this.transaction(() => {
      const previous = this.projections(sessionId);
      const initialized = this.initialChange(sessionId, previous);
      this.commit(sessionId, previous, initialized);
      return { events: initialized.events, notices: this.notices(previous), approval: initialized.snapshot.approval };
    });
    return { approval: saved.approval, context: await this.runtime.modelContext(sessionId, saved.events), notices: saved.notices };
  }
  catalog() { return this.runtime.catalog(this.resolveDefault()); }
  commands(sessionId: string) { this.projections(sessionId); return this.runtime.commands(); }

  /** One real command receipt and all its effects commit together, including retries. */
  async executeCommand(sessionId: string, line: string, attachments: readonly unknown[], rpcId: string): Promise<CommandExecution> {
    if (rpcId === '' || line.length > 4096) throw new SessionRpcFault('gateway/bad-request', 'Invalid permission command request');
    // Hash outside the transaction; rejected command attachments are never copied
    // into durable settings or sent to an attachment service.
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ sessionId, line, attachments })));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return this.transaction(() => {
      const previous = this.projections(sessionId);
      const saved = previous._dshBasePermissionCommands;
      if (saved !== undefined && !isRecord(saved)) throw new Error('Invalid permission command receipts');
      const receipts = saved ?? {};
      if (Object.hasOwn(receipts, rpcId)) {
        const receipt = receipts[rpcId];
        if (!isRecord(receipt) || receipt.fingerprint !== fingerprint) throw new SessionRpcFault('session/command-conflict', 'Command request id was reused with different input');
        const execution = receipt.execution;
        if (!isRecord(execution) || typeof execution.commandId !== 'string' || !isRecord(execution.result) || !['success', 'error'].includes(String(execution.result.kind))) throw new Error('Invalid saved permission command receipt');
        return execution as unknown as CommandExecution;
      }
      const initialized = this.initialChange(sessionId, previous);
      const changed = this.runtime.executeCommand(sessionId, initialized.events, line, `cmd-${crypto.randomUUID()}`, attachments.length);
      if (changed === undefined) throw new SessionRpcFault('gateway/endpoint-unavailable', 'This Host implements only the permission command');
      this.commit(sessionId, { ...previous, _dshBasePermissionCommands: { ...receipts, [rpcId]: { fingerprint, execution: changed.execution } } },
        { ...changed, appended: [...initialized.appended, ...changed.appended] });
      return changed.execution;
    });
  }
}
