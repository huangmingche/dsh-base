/** Official permission catalog, resolved from the authenticated owner's durable settings. */
import type { WireRpc } from '@dsh-base/cloudflare-worker-wire-rpc';
import { createHostCall } from './host-call.ts';
import { argsOf, sessionIdOf } from './remote.ts';
import { SessionRpcFault } from './remote-contract.ts';

/** The official catalog remains read-only; selections use the /permission command. */
export function registerPermissionPresetEndpoints(wireRpc: WireRpc): () => void {
  const disposers = [wireRpc.register('permissionPresets/catalog', async (payload, invocation) => {
    argsOf(payload, 'permissionPresets/catalog');
    return createHostCall(invocation)('permissionCatalog');
  }), wireRpc.register('commands/list', async (payload, invocation) => {
    const args = argsOf(payload, 'commands/list');
    return createHostCall(invocation)('permissionCommands', { sessionId: sessionIdOf(args, 'commands/list') });
  }), wireRpc.register('commands/execute', async (payload, invocation) => {
    const args = argsOf(payload, 'commands/execute');
    if (typeof args.line !== 'string' || !Array.isArray(args.attachments)) throw new SessionRpcFault('gateway/bad-request', 'Invalid command line or attachments');
    if (invocation.request.signal.aborted) throw new SessionRpcFault('gateway/cancelled', 'Command request was cancelled');
    const receipt = await createHostCall(invocation)('executePermissionCommand', { sessionId: sessionIdOf(args, 'commands/execute'), line: args.line, attachments: args.attachments, rpcId: invocation.rpcId }) as { commandId?: unknown; result?: {kind?: unknown; text?: unknown} };
    if (typeof receipt?.commandId !== 'string' || !['success', 'error'].includes(String(receipt.result?.kind))) throw new SessionRpcFault('gateway/internal', 'Host returned an invalid command receipt');
    // Until command events join the shared canonical transcript, an error must
    // still reach the real command dispatch surface instead of disappearing.
    if (receipt.result?.kind === 'error') throw new SessionRpcFault('command/failed', typeof receipt.result.text === 'string' ? receipt.result.text : 'Permission command failed', { commandId: receipt.commandId, result: receipt.result });
    return receipt;
  })];
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
