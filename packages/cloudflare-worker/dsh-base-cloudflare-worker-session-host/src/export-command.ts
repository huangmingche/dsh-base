/** Narrow command port for the pinned, attachment-free official /export handler. */
import { Context } from '@deepseek-ai/cordis';
import * as officialExport from '@deepseek-ai/dsh-session-log-export';
import { CommandId, parseCommand, type CommandDefinition, type CommandExecution } from '@deepseek-ai/dsh-commands';
import type { SqlStorage } from './sqlite-storage.ts';
import { SessionRpcFault } from './remote-contract.ts';

async function definition(): Promise<CommandDefinition> {
  const ctx = new Context();
  let command: CommandDefinition | undefined;
  ctx.provide('commands', { register(value: CommandDefinition) { command = value; return () => {}; } } as unknown as Context['commands']);
  // Route registration is inert in this command-only Host port; the Worker
  // export plugin owns real authenticated HTTP routes and their lifetime.
  ctx.provide('connection', { fetch: { register() { return async () => {}; } } });
  try {
    await ctx.plugin(officialExport);
    if (!command) throw new Error('Official export command did not activate');
    return command;
  } finally { await ctx.fiber.dispose(); }
}

export async function exportCommandDescriptor() {
  const { handler: _handler, recordInput: _recordInput, ...descriptor } = await definition();
  return descriptor;
}

/** Persist real command lifecycle/receipt atomically, without constructing an Agent. */
export async function executeExportCommand(sql: SqlStorage, input: {
  sessionId: string; line: string; attachments: readonly unknown[]; rpcId: string;
}): Promise<CommandExecution> {
  const { sessionId, line, attachments, rpcId } = input;
  const parsed = parseCommand(line);
  if (parsed?.name !== 'export' || line.length > 4096 || rpcId.length === 0) throw new SessionRpcFault('gateway/bad-request', 'Invalid export command');
  if (!sql.transactionSync) throw new SessionRpcFault('gateway/endpoint-unavailable', 'Atomic command persistence is unavailable');
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ line, attachments }))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // The pinned handler reads rawInput only. This throwing Agent accessor is an
  // explicit unsupported port; upgrade review must not silently widen it.
  const command = await definition();
  const commandId = CommandId(`cmd-${crypto.randomUUID()}`);
  const result = attachments.length ? { kind: 'error' as const, text: '/export does not accept attachments' }
    : await command.handler({ commandId, rawInput: parsed.rawInput, attachments: [], signal: new AbortController().signal,
      get agent(): never { throw new Error('Session export must not access an Agent'); } });
  const execution = { commandId, result };
  return sql.transactionSync(() => {
    if (sql.exec('SELECT session_id FROM dsh_session_host_sessions WHERE session_id = ?', sessionId).toArray().length !== 1) throw new SessionRpcFault('session/not-found', 'Session not found');
    const row = sql.exec('SELECT value FROM dsh_session_host_projections WHERE session_id = ?', sessionId).toArray()[0];
    const previous = row === undefined ? {} : JSON.parse(String(row.value));
    const receipts = previous._dshBaseExportCommands ?? {};
    const saved = Object.hasOwn(receipts, rpcId) ? receipts[rpcId] : undefined;
    if (saved !== undefined) {
      if (saved.fingerprint !== fingerprint) throw new SessionRpcFault('session/command-conflict', 'Command request id was reused with different input');
      return saved.execution as CommandExecution;
    }
    sql.exec('INSERT INTO dsh_session_host_projections (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value', sessionId,
      JSON.stringify({ ...previous, _dshBaseExportCommands: { ...receipts, [rpcId]: { fingerprint, execution } } }));
    let seq = Number(sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dsh_session_host_events WHERE session_id = ?', sessionId).toArray()[0]?.next ?? 1);
    const now = Date.now();
    for (const [type, data] of [
      ['command/run', { commandId, name: parsed.name, args: parsed.rawInput, source: { kind: 'user' } }],
      ['command/done', { commandId, ...result }],
    ]) sql.exec('INSERT INTO dsh_session_host_events (session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', sessionId, seq++, type, JSON.stringify(data), now);
    return execution;
  });
}
