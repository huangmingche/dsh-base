/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
  readonly catalogs: WeakMapWithValues<SessionBinding, ModelCatalogDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session', 'sessionModelCatalog']

  private readonly live: LiveState = { directories: new WeakMapWithValues(), catalogs: new WeakMapWithValues() }

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context) {
    super(ctx, 'modelDirectories')
    ctx.on('connection/reset', () => {
      for (const catalog of this.live.catalogs.values) catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    const refresh = () => { for (const catalog of this.live.catalogs.values) catalog.refresh() }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('llm/models-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
    ctx.remote.$on('credentials/record-updated', refresh)
    ctx.remote.$on('credentials/reference-updated', refresh)
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const catalog = new ModelCatalogDirectory(this.ctx, sessionId)
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      catalog,
      binding.session.projections.faceOf('modelSelection'),
      () => binding.session.getSnapshot().blank,
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
    )
    live.directories.set(binding, directory)
    live.catalogs.set(binding, catalog)
    void catalog.load().catch(() => { /* selectors expose the Session error */ })
    actx.effect(() => () => {
      directory.dispose()
      catalog.dispose()
      live.directories.delete(binding)
      live.catalogs.delete(binding)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
