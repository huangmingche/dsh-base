/** Literal plugin composition for bundled browsers and Workers, using Cordis fibers. */
import { Context, FiberState, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'

/** Stable identity of one entry in a platform composition. */
export type StaticPluginEntryId = string
const brandString = <T extends string>(value: string): T => value as T
/**
 * Brand an entry id assigned by the owning composition.
 * @param value - Composition-local identifier.
 * @returns The same identifier with its entry brand.
 */
export const StaticPluginEntryId = (value: string): StaticPluginEntryId => brandString<StaticPluginEntryId>(value)

/** Literal configuration accepted without JavaScript evaluation. */
export type PluginConfigValue = null | boolean | number | string
  | readonly PluginConfigValue[] | { readonly [key: string]: PluginConfigValue }

/** One configured plugin, including unavailable originals retained for inspection. */
export interface StaticPluginEntry {
  /** Stable composition-local identity. */
  readonly id: StaticPluginEntryId
  /** Scoped package name resolved only through the module table. */
  readonly name: string
  /** Original upstream identity or a project-owned fork/new implementation. */
  readonly origin: 'upstream' | 'fork' | 'custom'
  /** Disabled entries are inspected without importing or applying their module. */
  readonly disabled: boolean
  /** Literal configuration passed through the plugin's Cordis Config schema. */
  readonly config?: PluginConfigValue
  /** Original package replaced by this platform-specific plugin. */
  readonly replaces?: string
  /** Platform reason for a disabled entry; never interpreted as product copy. */
  readonly unavailableReason?: string
  /** Exact public document paths this plugin can mount without the private app composition. */
  readonly documentRoutes?: readonly string[]
}

/** Import function supplied by the build's explicit module table. */
export interface StaticPluginModule {
  /**
   * Resolve the already-selected function, service class, or namespace plugin.
   * @returns The executable plugin; default-export unwrapping belongs to this import function.
   */
  // Cordis plugins have heterogeneous Config schemas; each schema validates its own input.
  load: () => Promise<Plugin>
}

/** Complete startup composition and its available executable modules. */
export interface StaticPluginLoaderConfig {
  /** Literal rows; incompatible original plugins remain disabled in this list. */
  readonly entries: readonly StaticPluginEntry[]
  /** Only bundled module names can activate. */
  readonly modules: Readonly<Record<string, StaticPluginModule>>
}

/** Lifecycle phase reported from an actual Cordis fiber. */
export type StaticPluginPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Inspectable runtime entry; configuration and secrets are deliberately absent. */
export interface StaticPluginInspection {
  /** Stable identity from the composition row. */
  readonly entryId: StaticPluginEntryId
  /** Configured package name; its namespace does not establish authorship. */
  readonly moduleName: string
  /** Authorship declared by the composition, independent of scope and enablement. */
  readonly origin: StaticPluginEntry['origin']
  /** Whether this row is configured to execute. */
  readonly enabled: boolean
  /** Current Cordis state; null means no live fiber. */
  readonly fiberPhase: StaticPluginPhase
  /** Original package this entry adapts, when specified. */
  readonly replaces?: string
  /** Platform reason copied from a disabled declaration. */
  readonly unavailableReason?: string
}

interface RuntimeEntry {
  options: StaticPluginEntry
  fiber?: Fiber
}

const phases: Record<FiberState, StaticPluginPhase> = {
  [FiberState.PENDING]: 'pending', [FiberState.LOADING]: 'loading',
  [FiberState.ACTIVE]: 'active', [FiberState.FAILED]: 'failed',
  [FiberState.UNLOADING]: 'unloading', [FiberState.DISPOSED]: null,
}
const packageName = /^(?:@deepseek-ai\/(?:dsh-[a-z0-9][a-z0-9-]*|cordis(?:-[a-z0-9][a-z0-9-]*)?)|@dsh-base\/[a-z0-9][a-z0-9-]*)$/

/** Reject executable expressions and non-JSON values in durable configuration. */
function literalConfig(value: PluginConfigValue): PluginConfigValue {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (key === '__jsExpr') throw new Error('static_plugin_expressions_unavailable')
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol'
      || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) {
      throw new Error('static_plugin_config_requires_json')
    }
    return item
  })) as PluginConfigValue
}

function copyEntry(entry: StaticPluginEntry): StaticPluginEntry {
  return { ...entry, ...(entry.config === undefined ? {} : { config: literalConfig(entry.config) }) }
}

function validateEntries(entries: readonly StaticPluginEntry[], modules: StaticPluginLoaderConfig['modules']): void {
  const ids = new Set<StaticPluginEntryId>()
  const replacements = new Set<string>()
  for (const row of entries) {
    if (!row.id || ids.has(row.id)) throw new Error(`duplicate_or_empty_static_plugin_id:${row.id}`)
    ids.add(row.id)
    if (!packageName.test(row.name)) throw new Error(`invalid_static_plugin_name:${row.name}`)
    const origin: unknown = row.origin
    if (origin !== 'upstream' && origin !== 'custom' && origin !== 'fork') throw new Error(`invalid_static_plugin_origin:${row.name}`)
    if (row.replaces !== undefined && row.origin !== 'custom' && row.origin !== 'fork') throw new Error(`static_plugin_fork_requires_custom_origin:${row.name}`)
    if (!row.disabled && !Object.hasOwn(modules, row.name)) throw new Error(`static_plugin_not_bundled:${row.name}`)
    if (!row.disabled && row.unavailableReason !== undefined) throw new Error(`enabled_static_plugin_unavailable:${row.name}`)
    if (row.replaces === undefined) continue
    const originals = entries.filter(candidate => candidate.name === row.replaces)
    if (row.replaces === row.name || !originals.length) throw new Error(`static_plugin_original_missing:${row.name}`)
    if (row.disabled) continue
    if (originals.some(original => !original.disabled) || replacements.has(row.replaces)) {
      throw new Error(`static_plugin_replacement_conflict:${row.replaces}`)
    }
    replacements.add(row.replaces)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Bundled platform plugin composition and its actual lifecycle inventory. */
    staticPluginLoader: StaticPluginLoader
  }
}

/** Platform fork of Loader's literal entry activation over the original Cordis registry. */
export default class StaticPluginLoader extends Service {
  private readonly owner: Context
  private readonly records: RuntimeEntry[]
  private readonly modules: StaticPluginLoaderConfig['modules']
  private sequence: Promise<void> = Promise.resolve()
  private started = false
  private closed = false

  /**
   * Install the loader service; call start after its own fiber is active.
   * @param ctx - Context owning every activated plugin and its effects.
   * @param config - Explicit rows and bundled module resolvers.
   */
  constructor(ctx: Context, config: StaticPluginLoaderConfig) {
    super(ctx, 'staticPluginLoader')
    this.owner = ctx
    this.records = config.entries.map(options => ({ options: copyEntry(options) }))
    this.modules = config.modules
    validateEntries(this.records.map(record => record.options), this.modules)
    ctx.effect(() => () => { this.closed = true }, 'static-plugin-loader: lifetime')
  }

  /**
   * Activate enabled rows concurrently so Cordis can resolve service dependencies.
   * @returns Resolves when all enabled entries are active; failure disposes their fibers.
   */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.started) return
      try {
        const outcomes = await Promise.allSettled(this.records.map(record => this.activate(record)))
        const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
        if (failure) throw failure.reason
        await this.await()
        for (const record of this.records) this.assertActive(record)
        this.started = true
      } catch (error) {
        await Promise.all(this.records.map(record => this.deactivate(record)))
        throw error
      }
    })
  }

  /**
   * Wait for all current import-independent Cordis lifecycle transitions.
   * @returns Resolves after fibers settle, including dependency-pending fibers.
   */
  async await(): Promise<void> {
    do {
      await Promise.all(this.records.map(async (record) => { await record.fiber?.await() }))
    } while (this.records.some(record => record.fiber?.inertia !== undefined))
  }

  /**
   * Inspect configured rows and their real fiber states without exposing config.
   * @returns A fresh inventory including disabled originals.
   */
  entries(): StaticPluginInspection[] {
    return this.records.map(({ options, fiber }) => ({
      entryId: options.id, moduleName: options.name, origin: options.origin, enabled: !options.disabled,
      fiberPhase: fiber === undefined ? null : phases[fiber.state],
      ...(options.replaces === undefined ? {} : { replaces: options.replaces }),
      ...(options.unavailableReason === undefined ? {} : { unavailableReason: options.unavailableReason }),
    }))
  }

  /**
   * Read literal configured rows for an authorized configuration inspector.
   * @returns Detached rows; callers must redact provider-owned secret fields before transmission.
   */
  configEntries(): StaticPluginEntry[] { return this.records.map(record => copyEntry(record.options)) }

  /**
   * Serialize one activation or configuration change with rollback on failure.
   * @param id - Existing entry identity.
   * @param patch - Disabled flag and/or complete replacement config.
   * @returns Resolves after application; persistence belongs to the platform owner.
   */
  update(id: StaticPluginEntryId, patch: { disabled?: boolean; config?: PluginConfigValue }): Promise<void> {
    return this.enqueue(async () => {
      if (!this.started) throw new Error('static_plugin_loader_not_started')
      const record = this.records.find(candidate => candidate.options.id === id)
      if (!record) throw new Error(`static_plugin_entry_missing:${id}`)
      const previous = record.options
      const candidate = copyEntry({ ...previous, ...patch })
      validateEntries(this.records.map(item => item === record ? candidate : item.options), this.modules)
      record.options = candidate
      try {
        if (candidate.disabled) await this.deactivate(record)
        else if (record.fiber) record.fiber.update(candidate.config)
        else await this.activate(record)
        await this.await()
        this.assertActive(record)
      } catch (error) {
        record.options = previous
        try {
          if (previous.disabled) await this.deactivate(record)
          else if (record.fiber) record.fiber.update(previous.config)
          else await this.activate(record)
          await this.await()
          this.assertActive(record)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `static_plugin_rollback_failed:${id}`)
        }
        throw error
      }
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.sequence.then(async () => {
      if (this.closed) throw new Error('static_plugin_loader_disposed')
      await operation()
    })
    // Callers receive the rejection; subsequent independent updates still run.
    this.sequence = next.catch(() => {})
    return next
  }

  private async activate(record: RuntimeEntry): Promise<void> {
    if (record.options.disabled) return
    const resolver = this.modules[record.options.name]
    if (!resolver) throw new Error(`static_plugin_not_bundled:${record.options.name}`)
    const plugin = await resolver.load()
    if (this.closed) throw new Error('static_plugin_loader_disposed')
    const fiber = this.owner.plugin(plugin, record.options.config)
    record.fiber = fiber
    await fiber
  }

  private async deactivate(record: RuntimeEntry): Promise<void> {
    const fiber = record.fiber
    if (fiber === undefined) return
    await fiber.dispose()
    delete record.fiber
  }

  private assertActive(record: RuntimeEntry): void {
    if (record.options.disabled || record.fiber?.state === FiberState.ACTIVE) return
    const missing = Object.keys(record.fiber?.inject ?? {}).filter(key => this.owner.get(key) === undefined)
    throw new Error(`static_plugin_not_active:${record.options.name}:${missing.join(',')}`)
  }
}

/**
 * Install and start a literal composition in an existing platform context.
 * @param ctx - Fresh owner context; disposal releases the entire plugin tree.
 * @param config - Static rows and available modules.
 * @returns The active loader with its execution-backed inventory.
 */
export async function bootStaticPlugins(ctx: Context, config: StaticPluginLoaderConfig): Promise<StaticPluginLoader> {
  await ctx.plugin(StaticPluginLoader, config)
  const loader = ctx.get('staticPluginLoader')
  if (!loader) throw new Error('static_plugin_loader_missing')
  await loader.start()
  return loader
}
