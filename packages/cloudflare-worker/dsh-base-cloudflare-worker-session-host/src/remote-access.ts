/** Owner-only access baseline for the unchanged official RemoteAccess client. */
import type { RemoteAccessFrame } from '@deepseek-ai/dsh-api-remote-access/types';
import type { WireStreamInvocation, WireStreamRegistry } from '@dsh-base/cloudflare-worker-wire-rpc';
import { createHostCall } from './host-call.ts';
import { SessionRpcFault } from './remote-contract.ts';
import { argsOf } from './remote.ts';

async function* followOwnerAccess(invocation: WireStreamInvocation): AsyncIterable<RemoteAccessFrame> {
  // This identity is supplied only by the authenticated mux upgrade. No owner
  // identity, policy or grant is accepted from the logical stream's payload.
  if (typeof invocation.user?.id !== 'string' || invocation.user.id.trim() === '') {
    throw new SessionRpcFault('remote-access/denied', 'Authentication is required', { action: 'remoteAccess/follow', reason: 'unauthenticated' });
  }
  const signal = invocation.request.signal;
  if (signal.aborted) return;
  // Resolve the same authenticated owner's real Host before announcing access.
  // A missing/unavailable binding remains an error rather than a local grant.
  await createHostCall(invocation)('runtimeInfo');
  if (signal.aborted) return;
  yield { type: 'baseline', owner: true };
  // The official owner contract has exactly one baseline per generation.
  await new Promise<void>(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export function registerRemoteAccessStreamEndpoint(registry: WireStreamRegistry): () => void {
  return registry.register('remoteAccess/follow', (payload, invocation) => {
    const args = argsOf(payload, 'remoteAccess/follow');
    if (Object.keys(args).length !== 0) throw new SessionRpcFault('gateway/bad-request', 'remoteAccess/follow takes no arguments', {});
    return followOwnerAccess(invocation);
  });
}
