/** Request-scoped Host ports for the unchanged official Session export plugin. */
import { Context } from '@deepseek-ai/cordis';
import * as officialExport from '@deepseek-ai/dsh-session-log-export';
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';
import { SessionHandleClosedError, SessionPersistenceNotFoundError, SessionPersistenceRevision, SessionReadOnlyError } from '@deepseek-ai/dsh-session-persistence';
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { buildSessionHistory } from '@dsh-base/session-wire';
import type { SessionHistorySnapshot } from '@dsh-base/session-wire';

export interface ExportSnapshot extends SessionHistorySnapshot {
  readonly session: { readonly sessionId: string; readonly title: string; readonly createdAt: number; readonly updatedAt: number };
}
export type HostCall = (method: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
interface ExportRoute {
  readonly path: string;
  readonly methods: readonly string[];
  readonly fetch: (request: Request) => Promise<Response>;
}

/** The same wire projection as Session/page, with the snapshot's authoritative title. */
export function exportLog(snapshot: ExportSnapshot) {
  // The Host wire cursor starts at one; the released artifact starts at zero.
  const events = buildSessionHistory(snapshot.records ?? [], undefined, snapshot.turns, snapshot.forkSeed).map(({ event }, seq) => ({
    ...event, seq: SessionSeq(seq),
    ...('sourceEventSeqs' in event ? { sourceEventSeqs: (event.sourceEventSeqs as number[]).map(value => value - 1) } : {}),
  })) as SessionEvent[];
  // A snapshot label represents the current owner-edited title. Keep it after
  // inherited titles; it is metadata, not a claim of a persisted title event.
  events.push({ type: 'session/title', seq: SessionSeq(events.length), time: snapshot.session.updatedAt,
    data: { title: snapshot.session.title, messageSeqs: [], source: { kind: 'user' } } });
  const seed = events.find(event => event.type === 'session/end-seed' && event.data.inherited === true);
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(snapshot.session.sessionId),
    createdAt: snapshot.session.createdAt, isSeeded: seed !== undefined };
  return { header, events, inheritedEventCount: SessionLogOffset(seed?.seq ?? 0) };
}

/** Mount the original routes; the scoped services can read only the selected owner Session. */
export async function createExportRuntime(call: HostCall, sessionId: string, signal: AbortSignal) {
  const ctx = new Context();
  const routes = new Map<string, ExportRoute>();
  let command: CommandDefinition | undefined;
  let captured: ReturnType<typeof exportLog> | undefined;
  const load = async (id: string) => {
    signal.throwIfAborted();
    if (id !== sessionId) throw new SessionPersistenceNotFoundError(SessionId(id));
    if (captured === undefined) {
      const snapshot = await call('logExportSnapshot', { sessionId }, signal) as ExportSnapshot;
      signal.throwIfAborted();
      if (snapshot?.session?.sessionId !== sessionId || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.turns)) throw new Error('Invalid Session export snapshot');
      captured = exportLog(snapshot);
    }
    return captured;
  };
  const query = {
    async readSession(id: string) {
      try { const log = await load(id); return { session: log.header, events: log.events, inheritedEventCount: log.inheritedEventCount }; }
      catch (error) {
        if (error instanceof SessionPersistenceNotFoundError) throw Object.assign(new Error('Session not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' });
        throw error;
      }
    },
    async traceSession(id: string, abort?: AbortSignal) {
      abort?.throwIfAborted();
      await load(id);
      // This Host does not create subagent Sessions. Ordinary forks are independent
      // Sessions, never descendants and never implicitly included in an archive.
      return { descendants: [] };
    },
  };
  const persistence = {
    async stat(id: string) {
      const log = await load(id);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(log))));
      return { header: log.header, revision: SessionPersistenceRevision([...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')), eventCount: log.events.length };
    },
    async open(id: string, access: string, options?: { signal?: AbortSignal }): Promise<SessionHandle> {
      options?.signal?.throwIfAborted();
      if (access !== 'read') throw new SessionReadOnlyError(SessionId(id), 'open');
      const log = await load(id);
      // Do not manufacture missing lifecycle events to make legacy transcripts
      // importable. HEAD and GET must both refuse an invalid native artifact.
      const rows = officialExport.serializeSessionLog(log.header, log.events).trimEnd().split('\n').map(line => JSON.parse(line));
      const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' });
      for (const row of rows.slice(1)) restore.decodeRow(row);
      restore.finish();
      let closed = false;
      const close = async () => { closed = true; };
      const assertOpen = (operation: string) => { if (closed) throw new SessionHandleClosedError(SessionId(id), operation); };
      return { id: log.header.id, header: log.header, inheritedEventCount: log.inheritedEventCount, access: 'read',
        async read(offset = 0, length, options) {
          assertOpen('read'); options?.signal?.throwIfAborted(); signal.throwIfAborted();
          return { eventState: 'detached', events: structuredClone(log.events.slice(offset, length === undefined ? undefined : offset + length)) };
        },
        async append() { assertOpen('append'); throw new SessionReadOnlyError(log.header.id, 'append'); },
        async flush() { assertOpen('flush'); throw new SessionReadOnlyError(log.header.id, 'flush'); },
        close, [Symbol.asyncDispose]: close };
    },
  };
  const attachments = {
    async readImage() { throw new Error('Normalized image export is unavailable'); },
    async *readFileStream(ref: FileAttachmentRef, abort?: AbortSignal) {
      signal.throwIfAborted(); abort?.throwIfAborted();
      // Only references in the captured transcript reach the original archive
      // iterator. The Host independently enforces owner + Session admission.
      const combined = abort === undefined ? signal : AbortSignal.any([signal, abort]);
      const result = await call('logExportFile', { sessionId, file: ref }, combined) as { file?: FileAttachmentRef; data?: string };
      combined.throwIfAborted();
      if (!result.file || result.file.attachmentId !== ref.attachmentId || result.file.name !== ref.name || result.file.bytes !== ref.bytes || typeof result.data !== 'string') throw new Error('Invalid export attachment');
      const bytes = Uint8Array.from(atob(result.data), value => value.charCodeAt(0));
      if (bytes.byteLength !== ref.bytes) throw new Error('Invalid export attachment length');
      for (let offset = 0; offset < bytes.length; offset += 65536) { combined.throwIfAborted(); yield bytes.subarray(offset, offset + 65536); }
    },
  };
  // These intentionally narrow ports serve only the pinned export plugin. They
  // never advertise a full native Session engine or a general persistence store.
  ctx.provide('sessionQuery', query as unknown as Context['sessionQuery']);
  ctx.provide('sessionPersistence', persistence as unknown as Context['sessionPersistence']);
  ctx.provide('attachments', attachments as unknown as Context['attachments']);
  ctx.provide('commands', { register(definition: CommandDefinition) { command = definition; return () => { command = undefined; }; } } as unknown as Context['commands']);
  ctx.provide('connection', { fetch: { register(route: ExportRoute) { routes.set(route.path, route); return async () => { routes.delete(route.path); }; } } });
  try { await ctx.plugin(officialExport); }
  catch (error) { await ctx.fiber.dispose(); throw error; }
  if (!command || routes.size !== 2) { await ctx.fiber.dispose(); throw new Error('Official export plugin did not activate'); }
  return { routes, command, dispose: () => ctx.fiber.dispose() };
}
