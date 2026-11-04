/** Official permission commands use a durable Host execution receipt. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { CommandDescriptor, CommandExecution, CommandSubmitAttachment } from '@deepseek-ai/dsh-commands/types';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };
export function createPermissionCommands(rpc: () => Pick<ClientConnectionRpc, 'call'>, feedbackReason: () => string) {
  return {
    list: async (sessionId: string): Promise<Result<readonly CommandDescriptor[]>> => {
      const result = await rpc().call('/api', 'commands/list', { args: { sessionId } }) as Result<readonly CommandDescriptor[]>;
      return result.ok ? { ok: true, value: [...result.value, { name: 'feedback', description: feedbackReason(), input: { hint: feedbackReason() } }] } : result;
    },
    execute: async (sessionId: string, line: string, attachments: readonly CommandSubmitAttachment[] = []): Promise<Result<CommandExecution | undefined>> => {
      if (/^\/feedback(?:\s|$)/u.test(line.trim())) return { ok: false, error: { code: 'feedback/unavailable', message: feedbackReason(), details: {} } };
      const result = await rpc().call('/api', 'commands/execute', { args: { sessionId, line, attachments } }) as Result<CommandExecution | undefined>;
      if (result.ok && result.value !== undefined && (typeof result.value.commandId !== 'string' || result.value.commandId === '' || !['success', 'error'].includes(result.value.result?.kind))) {
        return { ok: false, error: { code: 'gateway/endpoint-unavailable', message: 'Host command execution receipt is invalid.', details: {} } };
      }
      return result;
    },
  };
}
