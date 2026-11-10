/** Generated namespace mounting through the unchanged official Gateway. */
import { Service, type Context } from '@deepseek-ai/cordis';
import { apply as applyGateway, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';

export interface RemoteMountAuthentication {
  isAuthenticated(): boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * Keep the existing Host namespaces while the unchanged official Gateway owns
 * generated descriptors, codecs, scoped invocation and namespace withdrawal.
 * Its separate Remote scope shares the real Connection transport and Typert
 * registry and is the only answering/event generation owner. No Connection
 * clone is made: its live generation, state, and transport stay authoritative.
 */
export async function installRemoteMount(ctx: Context, services: object, authentication?: RemoteMountAuthentication): Promise<void> {
  const gatewayScope = Symbol('dsh-base: generated Remote mounts');
  type Mount = { readonly ctx: Context; readonly contribution: TypertRemoteContribution; active: boolean; dispose?: () => Promise<void> };
  const mounts = new Set<Mount>();
  let gateway: { await(): Promise<unknown>; dispose(): Promise<unknown> } | undefined;
  let stopped = false;
  let revocations = 0;
  let transitions = Promise.resolve();
  const allowed = () => !stopped && authentication?.isAuthenticated() !== false;
  const closeGateway = async () => {
    const previous = gateway; gateway = undefined;
    const disposals = [...mounts].map(mount => { const dispose = mount.dispose; mount.dispose = undefined; return dispose?.(); });
    // One failed namespace cleanup must not leave the private carrier running.
    const results = await Promise.allSettled([...disposals, previous?.dispose()]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  };
  // Anonymous pages register real pending contributions without opening a
  // private carrier. Returning their cancellation handle also lets the official
  // RemoteAccess publish its closed state and the Loader finish booting.
  const reconcile = (): Promise<void> => {
    const apply = async () => {
      if (!allowed()) return closeGateway();
      const epoch = revocations;
      const current = () => allowed() && epoch === revocations;
      if (gateway === undefined) {
        gateway = ctx.isolate('remote', gatewayScope).plugin({ apply: applyGateway });
        await gateway.await();
      }
      if (!current()) return closeGateway();
      for (const mount of mounts) {
        if (!mount.active || mount.dispose !== undefined) continue;
        const remote = mount.ctx.isolate('remote', gatewayScope).get('remote');
        if (remote === undefined) throw new Error('Generated Remote mount is unavailable');
        const dispose = await remote.$mount(mount.contribution);
        if (mount.active && current()) mount.dispose = dispose;
        else await dispose();
        if (!current()) return closeGateway();
      }
    };
    transitions = transitions.then(apply, apply);
    return transitions;
  };
  const update = () => {
    if (!allowed()) {
      revocations++;
      // Stop Connection immediately even while a namespace registration awaits
      // Cordis. The serialized pass below owns complete cleanup and remounting.
      void gateway?.dispose().catch(error => ctx.logger.error('Authenticated Gateway shutdown failed', error));
    }
    void reconcile().catch(error => ctx.logger.error('Authenticated Remote mount failed', error));
  };
  const unsubscribe = authentication?.subscribe(update);
  ctx.effect(() => async () => {
    stopped = true; revocations++; unsubscribe?.();
    void gateway?.dispose().catch(error => ctx.logger.error('Authenticated Gateway shutdown failed', error));
    await reconcile();
  }, 'dsh-base: authenticated Gateway lifetime');

  class HostRemoteBridge extends Service {
    constructor(scope: Context) {
      super(scope, 'remote');
      Object.assign(this, services);
    }

    // A prototype method keeps Cordis's caller Context. The actual Gateway's
    // $mount owns teardown in that caller's fiber, not the adapter's lifetime.
    async $mount(contribution: TypertRemoteContribution): ReturnType<ClientRemote['$mount']> {
      const mount: Mount = { ctx: this.ctx, contribution, active: true };
      mounts.add(mount);
      const dispose = this.ctx.effect(() => async () => {
        mount.active = false;
        mounts.delete(mount);
        await mount.dispose?.();
        mount.dispose = undefined;
      }, `dsh-base: pending Remote mount ${contribution.package}`);
      await reconcile();
      return async () => { await dispose(); };
    }
  }
  new HostRemoteBridge(ctx);
  await reconcile();
}
