/** Reactive, generation-fenced Cloudflare AI Gateway status (no JSX, testable in Node). */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Public model declarations contain names, not account or deployment readiness. */
export type GatewayCatalog = ReadonlyArray<{ readonly id: string; readonly label: string }>

export interface GatewaySnapshot {
  readonly platformEnabled: boolean
  readonly providers?: Readonly<Record<string, { readonly available: boolean; readonly catalog: GatewayCatalog }>>
}
export type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: GatewaySnapshot }
  | { readonly kind: 'signed-out'; readonly catalog: GatewayCatalog }

/** The card needs an observable view, not a network-aware controller. */
export interface GatewayStoreFace {
  snapshot(): State
  subscribe(listener: () => void): () => void
  start(): void
  load(): Promise<void>
}

/** Immutable anonymous view: it owns no Host, event listener, credential or read operation. */
export function createSignedOutGatewayStore(catalog: GatewayCatalog = []): GatewayStoreFace {
  const declared = Object.freeze(catalog.map(model => Object.freeze({ id: model.id, label: model.label })))
  const state: State = Object.freeze({ kind: 'signed-out', catalog: declared })
  return {
    snapshot: () => state,
    subscribe: () => () => undefined,
    start: () => undefined,
    load: async () => undefined,
  }
}

/** Reactive, generation-fenced Gateway status; never reads DeepSeek credentials. */
export class GatewayStore implements GatewayStoreFace {
  private generation = 0
  private state: State = { kind: 'loading' }
  private readonly listeners = new Set<() => void>()
  private readonly cleanups: Array<() => void> = []
  private readonly ctx: ClientContext
  private started = false
  constructor(ctx: ClientContext) {
    this.ctx = ctx
    const refresh = (): void => { void this.load() }
    this.cleanups.push(
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    )
    if (typeof window !== 'undefined') {
      const focus = (): void => { refresh() }
      window.addEventListener('focus', focus)
      this.cleanups.push(() => window.removeEventListener('focus', focus))
    }
  }
  snapshot = (): State => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  start = (): void => { if (this.started) return; this.started = true; void this.load() }
  load = async (): Promise<void> => {
    const generation = ++this.generation
    try {
      const face = this.ctx.get('modelAccess') as unknown as { load: () => Promise<GatewaySnapshot> } | undefined
      if (face?.load === undefined) throw new Error('modelAccess service is unavailable')
      const value = await face.load()
      if (generation !== this.generation) return
      this.publish({ kind: 'ready', value })
    } catch {
      if (generation !== this.generation) return
      this.publish({ kind: 'error' })
    }
  }
  private publish(state: State): void { this.state = state; for (const listener of this.listeners) listener() }
  dispose(): void { this.generation += 1; for (const cleanup of this.cleanups.splice(0)) cleanup(); this.listeners.clear() }
}
