/** Generated namespace mounting through the unchanged official Gateway. */
import { Service, type Context } from '@deepseek-ai/cordis';
import { apply as applyGateway, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';

/**
 * Keep the existing Host namespaces while the unchanged official Gateway owns
 * generated descriptors, codecs, scoped invocation and namespace withdrawal.
 * Its separate Remote scope shares the real Connection transport and Typert
 * registry and is the only answering/event generation owner. No Connection
 * clone is made: its live generation, state, and transport stay authoritative.
 */
export async function installRemoteMount(ctx: Context, services: object): Promise<void> {
  const gatewayScope = Symbol('dsh-base: generated Remote mounts');
  applyGateway(ctx.isolate('remote', gatewayScope));

  class HostRemoteBridge extends Service {
    constructor(scope: Context) {
      super(scope, 'remote');
      Object.assign(this, services);
    }

    // A prototype method keeps Cordis's caller Context. The actual Gateway's
    // $mount owns teardown in that caller's fiber, not the adapter's lifetime.
    $mount(contribution: TypertRemoteContribution): ReturnType<ClientRemote['$mount']> {
      const gateway = this.ctx.isolate('remote', gatewayScope).get('remote');
      if (gateway === undefined) throw new Error('Generated Remote mount is unavailable');
      return gateway.$mount(contribution);
    }
  }
  new HostRemoteBridge(ctx);
}
