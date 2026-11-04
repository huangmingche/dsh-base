/** Host persistence seam around the complete pinned permission service. */
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import { APPROVAL_POLICIES } from '@deepseek-ai/dsh-user-approval';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { applyApprovalPolicy, approvalPolicyContext, type ApprovalPolicyAgentPort } from './approval-agent-port.ts';
import { SANDBOX_MODES } from '@deepseek-ai/dsh-sandbox-policy';
import { PermissionPresetService, PERMISSION_COMMAND } from './presets.ts';
import { PERMISSION_PRESETS, DEFAULT_PERMISSION_PRESET } from './settings.ts';
import { parseCommand } from '@deepseek-ai/dsh-commands';
import { CommandId } from '@deepseek-ai/dsh-commands/brand';
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands/types';
import { LogicalR2PermissionExecutor, type PermissionSnapshot } from './executor.ts';
import type { PermissionCatalog } from './types.ts';

export interface PermissionChange {
  readonly snapshot: PermissionSnapshot;
  /** Complete contiguous official permission journal, including restore markers. */
  readonly events: readonly SessionEvent[];
  /** Commit these events and the snapshot together in the caller's transaction. */
  readonly appended: readonly SessionEvent[];
  /** Official non-waking next-step messages, committed with the policy facts. */
  readonly notices: readonly UserMessage[];
}
export interface PermissionRuntime {
  catalog(defaultPreset?: string): PermissionCatalog;
  initializeSession(sessionId: string, events: readonly SessionEvent[] | null, defaultPreset?: string): PermissionChange;
  selectPreset(sessionId: string, events: readonly SessionEvent[], preset: string): PermissionChange;
  snapshot(sessionId: string, events: readonly SessionEvent[]): PermissionSnapshot;
  modelContext(sessionId: string, events: readonly SessionEvent[]): Promise<string>;
  commands(): readonly CommandDescriptor[];
  executeCommand(sessionId: string, events: readonly SessionEvent[], line: string, commandId: string, attachmentCount: number): (PermissionChange & { execution: CommandExecution }) | undefined;
  dispose(): Promise<void>;
}

/** Persisted input is untrusted; the official Session validates its envelope/sequence. */
function validatePolicyFacts(events: readonly SessionEvent[]): void {
  for (const value of events as readonly unknown[]) {
    if (value === null || typeof value !== 'object' || !('type' in value) || !('data' in value)
      || value.data === null || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('Invalid permission journal fact');
    const data = value.data as Record<string, unknown>;
    switch (value.type) {
      case 'permission/preset':
        if (typeof data.preset !== 'string' || data.preset.length === 0) throw new Error('Invalid permission preset fact');
        break;
      case 'sandbox/mode':
        if (!SANDBOX_MODES.some(mode => mode === data.mode)) throw new Error('Invalid sandbox mode fact');
        break;
      case 'approval/policy':
        if (!APPROVAL_POLICIES.some(policy => policy === data.policy)) throw new Error('Invalid approval policy fact');
        break;
      case 'session/end-seed':
        if (data.inherited !== undefined && typeof data.inherited !== 'boolean') throw new Error('Invalid permission seed marker');
        break;
      case 'command/run':
        if (typeof data.commandId !== 'string' || data.name !== 'permission' || (data.args !== undefined && typeof data.args !== 'string')) throw new Error('Invalid permission command run');
        break;
      case 'command/done':
        if (typeof data.commandId !== 'string' || !['success', 'error'].includes(String(data.kind)) || (data.text !== undefined && typeof data.text !== 'string')) throw new Error('Invalid permission command result');
        break;
      default: throw new Error('Permission journal contains an unrelated event');
    }
  }
}

/** Mount real official Session, projection and approval services, without a fake Agent or shell. */
export async function createPermissionRuntime(): Promise<PermissionRuntime> {
  const ctx = new Context();
  let defaultPreset = DEFAULT_PERMISSION_PRESET;
  let permission: PermissionPresetService | undefined;
  class HostPermissionService extends PermissionPresetService {
    constructor(scope: Context) {
      super(scope, { presets: PERMISSION_PRESETS, defaultPreset: { get: () => defaultPreset } });
      permission = this;
    }
  }
  try {
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true });
    await ctx.plugin(ApprovalService, { policy: 'ask' });
    ctx.provide('permissionExecutor', new LogicalR2PermissionExecutor());
    await ctx.plugin(HostPermissionService);
  } catch (error) { await ctx.fiber.dispose(); throw error; }
  if (permission === undefined) { await ctx.fiber.dispose(); throw new Error('Permission service did not activate'); }
  const service = permission;
  const hydrate = (id: string, events: readonly SessionEvent[] | null): Session => {
    if (events !== null) validatePolicyFacts(events);
    return events === null ? Session.create(SessionId(id)) : Session.create(SessionId(id), events);
  };
  const read = (session: Session): PermissionSnapshot => ({
    currentValue: service.current(session),
    // The service has already folded these through the pinned official registry.
    sandbox: service.effectiveKnobs(session).sandbox ?? ctx.permissionExecutor.sandboxMode,
    approval: ctx.approval.overrideOf(session) ?? ctx.approval.config.policy ?? 'ask',
  });
  const change = (id: string, events: readonly SessionEvent[] | null, operation: (session: Session, port: ApprovalPolicyAgentPort) => void): PermissionChange => {
    const session = hydrate(id, events), restoredLength = session.seq;
    const notices: UserMessage[] = [];
    const port: ApprovalPolicyAgentPort = { session, inject(message) { notices.push(message); } };
    operation(session, port);
    // A read or no-op selection must not persist an incidental restore marker.
    const changed = session.seq > restoredLength;
    const complete = changed ? session.snapshotEvents() : events ?? [];
    return { snapshot: read(session), events: complete, appended: changed ? complete.slice(events?.length ?? 0) : [], notices };
  };
  return {
    catalog(next = 'workspace-write') {
      service.resolve(next); defaultPreset = next;
      try { return service.catalog(); } finally { defaultPreset = 'workspace-write'; }
    },
    initializeSession(id, events, next = 'workspace-write') {
      service.resolve(next); defaultPreset = next;
      try { return change(id, events, session => service.initializeSession(session)); }
      finally { defaultPreset = 'workspace-write'; }
    },
    selectPreset(id, events, preset) { return change(id, events, (session, port) => service.set(session, preset, policy => applyApprovalPolicy(ctx.approval, port, policy))); },
    snapshot(id, events) { return read(hydrate(id, events)); },
    modelContext(id, events) { return approvalPolicyContext(ctx.systemPrompt, { session: hydrate(id, events), inject() { throw new Error('Context assembly must not inject messages'); } }); },
    commands() { return [PERMISSION_COMMAND]; },
    executeCommand(id, events, line, idValue, attachmentCount) {
      const parsed = parseCommand(line);
      if (parsed?.name !== 'permission') return undefined;
      const commandId = CommandId(idValue);
      let execution!: CommandExecution;
      const changed = change(id, events, (session, port) => {
        session.append('command/run', { commandId, name: parsed.name, args: parsed.rawInput, source: { kind: 'user' } });
        const result = attachmentCount > 0 ? { kind: 'error' as const, text: '/permission does not accept attachments' }
          : service.executeCommand(session, parsed.rawInput, policy => applyApprovalPolicy(ctx.approval, port, policy));
        session.append('command/done', { commandId, kind: result.kind, ...(result.text === undefined ? {} : { text: result.text }) });
        execution = { commandId, result };
      });
      return { ...changed, execution };
    },
    async dispose() { await ctx.fiber.dispose(); },
  };
}
