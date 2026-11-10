/**
 * Anonymous settings document: the official theme/locale schemas over
 * localStorage, with no Host calls. Enabled only when the public session
 * endpoint explicitly says signed-out (see settings-remote.ts).
 */
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { CHAT_SETTINGS_NAMESPACE, ChatSettingsSchema } from '@deepseek-ai/dsh-client-ui-chat/src/chat-settings.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from '@deepseek-ai/dsh-client-ui-conversation/src/submission-settings.ts'
import { DEVELOPER_TOOLS_NAMESPACE, DeveloperToolsSettingsSchema } from '@deepseek-ai/dsh-client-ui-settings/src/developer-tools-settings.ts'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { SettingsResult } from './settings-remote.ts'

/** Storage key of the anonymous settings document (no secrets are ever stored). */
export const ANONYMOUS_SETTINGS_STORAGE_KEY = 'dsh-base.anonymous-settings.v1'

/** Document version; a mismatch discards the stored sections (fail closed). */
const DOCUMENT_VERSION = 1

/** Live schemastery node used for official validation and serialization. */
interface SchemaNode {
  (value: unknown): unknown
  toJSON(): unknown
}

/** One namespace this document may own. Anything else is refused. */
interface NamespaceSpec {
  readonly ns: string
  readonly schema: SchemaNode
}

const SPECS: readonly NamespaceSpec[] = [
  { ns: THEME_SETTINGS_NAMESPACE, schema: ThemeSettingsSchema as unknown as SchemaNode },
  { ns: LOCALE_SETTINGS_NAMESPACE, schema: LocaleSettingsSchema as unknown as SchemaNode },
  // Client-only preferences the anonymous settings panel can really change.
  { ns: CHAT_SETTINGS_NAMESPACE, schema: ChatSettingsSchema as unknown as SchemaNode },
  { ns: CONVERSATION_SETTINGS_NAMESPACE, schema: ConversationSettingsSchema as unknown as SchemaNode },
  { ns: DEVELOPER_TOOLS_NAMESPACE, schema: DeveloperToolsSettingsSchema as unknown as SchemaNode },
]

/** Minimal storage face; localStorage in the browser, a Map in tests. */
export interface AnonymousSettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface StoredDocument {
  version: number
  revisions: Record<string, number>
  sections: Record<string, Record<string, unknown>>
}

/** The local settings face consumed by settings-remote.ts. */
export interface AnonymousSettingsDocument {
  describe(): SettingsResult<SettingsDescribeValue>
  mutate(ns: string, ops: readonly SettingsPathOpView[], expectedRevision?: number): SettingsResult<SettingsNamespaceView>
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): SettingsResult<SettingsNamespaceView>
  replace(ns: string, section: Record<string, unknown>, expectedRevision?: number): SettingsResult<SettingsNamespaceView>
  /** Whether accepted writes reached localStorage or only memory. */
  readonly persistence: 'local' | 'memory'
}

type Failure = Extract<SettingsResult<never>, { ok: false }>

function failure(code: string, message: string): Failure {
  return { ok: false, error: { code, message } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Deep-merge a JSON-shaped patch into a section (arrays replace). */
function mergeSection(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key]
    next[key] = isPlainObject(value) && isPlainObject(current) ? mergeSection(current, value) : clone(value)
  }
  return next
}

/** Apply one path op to a detached JSON section. */
function applyOps(section: Record<string, unknown>, ops: readonly SettingsPathOpView[]): Record<string, unknown> {
  const edit = (input: unknown, path: readonly string[], op: SettingsPathOpView): unknown => {
    const [head, ...rest] = path
    if (head === undefined) return op.op === 'set' ? clone(op.value) : undefined
    if (Array.isArray(input)) {
      const result = [...input]
      if (!/^(0|[1-9][0-9]*)$/u.test(head)) throw new TypeError(`Config array index "${head}" is out of range`)
      const index = Number(head)
      if (rest.length === 0 && op.op === 'unset') {
        if (index >= result.length) throw new TypeError(`Config array index "${head}" is out of range`)
        result.splice(index, 1)
      } else {
        if (index > result.length) throw new TypeError(`Config array index "${head}" is out of range`)
        result[index] = edit(result[index], rest, op)
      }
      return result
    }
    const result = isPlainObject(input) ? { ...input } : {}
    const child = edit(Object.hasOwn(result, head) ? result[head] : undefined, rest, op)
    if (child === undefined) Reflect.deleteProperty(result, head)
    else result[head] = child
    return result
  }
  return ops.reduce<unknown>((value, op) => edit(value, op.path, op), section) as Record<string, unknown>
}

/**
 * Create the anonymous settings document.
 * @param options.storage - storage override (tests); defaults to browser localStorage.
 * @returns the document face plus its persistence mode.
 */
export function createLocalSettingsDocument(options: { storage?: AnonymousSettingsStorage } = {}): AnonymousSettingsDocument {
  const storage: AnonymousSettingsStorage | undefined = options.storage ?? (() => {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage as AnonymousSettingsStorage
    } catch {
      return undefined
    }
  })()
  let capability = storage !== undefined
  let persistence: 'local' | 'memory' = storage === undefined ? 'memory' : 'local'

  const empty = (): StoredDocument => ({ version: DOCUMENT_VERSION, revisions: {}, sections: {} })
  const load = (): StoredDocument => {
    if (storage === undefined) return empty()
    try {
      const raw = storage.getItem(ANONYMOUS_SETTINGS_STORAGE_KEY)
      if (raw === null) return empty()
      const parsed: unknown = JSON.parse(raw)
      if (!isPlainObject(parsed) || parsed.version !== DOCUMENT_VERSION) return empty()
      const revisions = isPlainObject(parsed.revisions) ? parsed.revisions : {}
      const sections = isPlainObject(parsed.sections) ? parsed.sections : {}
      const next = empty()
      for (const spec of SPECS) {
        const section = sections[spec.ns]
        if (!isPlainObject(section)) continue
        // Fail closed on stale or malformed stored values: never project them.
        try { spec.schema(section) } catch { continue }
        next.sections[spec.ns] = section
        const revision = revisions[spec.ns]
        next.revisions[spec.ns] = typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0
      }
      return next
    } catch {
      capability = false
      persistence = 'memory'
      return empty()
    }
  }
  let state = load()

  const persist = (): void => {
    if (!capability || storage === undefined) return
    try {
      storage.setItem(ANONYMOUS_SETTINGS_STORAGE_KEY, JSON.stringify(state))
      persistence = 'local'
    } catch {
      capability = false
      persistence = 'memory'
    }
  }

  const value = (spec: NamespaceSpec, section: Record<string, unknown>): unknown => {
    try { return spec.schema(section) } catch { return spec.schema({}) }
  }
  const view = (spec: NamespaceSpec): SettingsNamespaceView => ({
    autoGenerate: false,
    ns: spec.ns,
    schema: spec.schema.toJSON() as never,
    revision: state.revisions[spec.ns] ?? 0,
    applies: 'live',
    value: value(spec, state.sections[spec.ns] ?? {}) as never,
    base: value(spec, {}) as never,
    user: clone(state.sections[spec.ns] ?? {}) as never,
    secrets: [],
  })

  const write = (ns: string, change: (current: Record<string, unknown>) => Record<string, unknown>, expectedRevision?: number): SettingsResult<SettingsNamespaceView> => {
    const spec = SPECS.find(candidate => candidate.ns === ns)
    if (spec === undefined) return failure('settings/namespace-unavailable', `anonymous settings do not own namespace "${ns}"`)
    const revision = state.revisions[ns] ?? 0
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      return failure('SETTINGS_CONFLICT', `settings namespace "${ns}" changed since it was read (expected revision ${String(expectedRevision)}, now ${String(revision)})`)
    }
    let next: Record<string, unknown>
    try {
      next = clone(change(clone(state.sections[ns] ?? {})))
      spec.schema(next)
    } catch (error) {
      return failure('settings/invalid', error instanceof Error ? error.message : String(error))
    }
    state = { ...state, sections: { ...state.sections, [ns]: next }, revisions: { ...state.revisions, [ns]: revision + 1 } }
    persist()
    return { ok: true, value: view(spec) }
  }

  return {
    get persistence() { return persistence },
    describe: () => ({ ok: true, value: { writable: true, hasDocument: false, namespaces: SPECS.map(view) } }),
    mutate: (ns, ops, expectedRevision) => write(ns, section => applyOps(section, ops), expectedRevision),
    update: (ns, patch, expectedRevision) => write(ns, section => mergeSection(section, patch), expectedRevision),
    replace: (ns, section, expectedRevision) => write(ns, () => clone(section), expectedRevision),
  }
}
