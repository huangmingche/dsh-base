import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANONYMOUS_SETTINGS_STORAGE_KEY, createLocalSettingsDocument, type AnonymousSettingsStorage } from '../src/client/local-settings-document.ts'

function memoryStorage(): AnonymousSettingsStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

function themeView(document: ReturnType<typeof createLocalSettingsDocument>) {
  const described = document.describe()
  assert.equal(described.ok, true)
  if (!described.ok) throw new Error('describe failed')
  const view = described.value.namespaces.find(namespace => namespace.ns === 'ui-theme')
  assert.ok(view, 'ui-theme namespace is present')
  return view
}

test('describe exposes only the whitelisted official namespaces with schema defaults', () => {
  const document = createLocalSettingsDocument({ storage: memoryStorage() })
  const described = document.describe()
  assert.equal(described.ok, true)
  if (!described.ok) return
  assert.equal(described.value.writable, true)
  assert.equal(described.value.hasDocument, false)
  assert.deepEqual(described.value.namespaces.map(view => view.ns), ['ui-theme', 'locale', 'ui-chat', 'ui-conversation', 'ui-settings'])
  const theme = described.value.namespaces[0]
  assert.equal(theme.applies, 'live')
  assert.equal(theme.revision, 0)
  assert.deepEqual(theme.secrets, [])
  const value = theme.value as { preference?: string; fontSize?: number; codeFontSize?: number; terminalFontSize?: number }
  assert.equal(value.preference, 'system')
  assert.equal(value.fontSize, 14)
  assert.equal(value.codeFontSize, 11)
  assert.equal(value.terminalFontSize, 13)
  assert.ok(theme.schema !== undefined, 'official schema envelope rides the view')
})

test('the expanded client-preference namespaces carry official defaults', () => {
  const document = createLocalSettingsDocument({ storage: memoryStorage() })
  const described = document.describe()
  assert.equal(described.ok, true)
  if (!described.ok) return
  const valueOf = (ns: string) => described.value.namespaces.find(view => view.ns === ns)?.value as Record<string, unknown>
  const chat = valueOf('ui-chat')
  assert.equal(chat.transcriptView, undefined, 'missing work-details mode defers to the client default')
  assert.equal(chat.collapseTiming, 'completion')
  assert.equal(chat.foldedReplies, 'all')
  assert.equal(chat.linkOpening, 'sidebar')
  assert.equal(chat.performanceUsage, 'detailed')
  const conversation = valueOf('ui-conversation')
  assert.equal(conversation.busyEnter, 'queue')
  const settings = valueOf('ui-settings')
  assert.equal(settings.enabled, true)
})

test('the six client preferences round-trip through the local document', () => {
  const storage = memoryStorage()
  const document = createLocalSettingsDocument({ storage })
  assert.equal(document.update('ui-chat', { transcriptView: 'detailed', collapseTiming: 'next-input', foldedReplies: 'final', linkOpening: 'new-tab', performanceUsage: 'detailed' }).ok, true)
  assert.equal(document.update('ui-conversation', { busyEnter: 'steer' }).ok, true)
  assert.equal(document.update('ui-settings', { enabled: false }).ok, true)
  const reloaded = createLocalSettingsDocument({ storage })
  const described = reloaded.describe()
  assert.equal(described.ok, true)
  if (!described.ok) return
  const valueOf = (ns: string) => described.value.namespaces.find(view => view.ns === ns)?.value as Record<string, unknown>
  assert.equal(valueOf('ui-chat').transcriptView, 'detailed')
  assert.equal(valueOf('ui-chat').collapseTiming, 'next-input')
  assert.equal(valueOf('ui-chat').foldedReplies, 'final')
  assert.equal(valueOf('ui-chat').linkOpening, 'new-tab')
  assert.equal(valueOf('ui-chat').performanceUsage, 'detailed')
  assert.equal(valueOf('ui-conversation').busyEnter, 'steer')
  assert.equal(valueOf('ui-settings').enabled, false)
  const raw = storage.getItem('dsh-base.anonymous-settings.v1') ?? ''
  assert.ok(!/apiKey|secret|token/iu.test(raw), 'only client preferences are stored')
})

test('mutate persists the locale preference and survives a fresh document', () => {
  const storage = memoryStorage()
  const document = createLocalSettingsDocument({ storage })
  const result = document.mutate('locale', [{ op: 'set', path: ['preference'], value: 'zh' }])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.revision, 1)
  assert.equal((result.value.value as { preference?: string }).preference, 'zh')
  assert.equal(document.persistence, 'local')

  const reloaded = createLocalSettingsDocument({ storage })
  const described = reloaded.describe()
  if (!described.ok) throw new Error('describe failed')
  const locale = described.value.namespaces.find(view => view.ns === 'locale')
  assert.equal((locale?.value as { preference?: string }).preference, 'zh')
  assert.equal(locale?.revision, 1)
})

test('update merges a patch and replace swaps the section', () => {
  const document = createLocalSettingsDocument({ storage: memoryStorage() })
  const updated = document.update('ui-theme', { preference: 'dark', fontSize: 16 })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  const value = updated.value.value as { preference?: string; fontSize?: number; codeFontSize?: number }
  assert.equal(value.preference, 'dark')
  assert.equal(value.fontSize, 16)
  assert.equal(value.codeFontSize, 11, 'schema defaults survive a partial patch')

  const replaced = document.replace('ui-theme', { preference: 'light' })
  assert.equal(replaced.ok, true)
  if (!replaced.ok) return
  const after = replaced.value.value as { preference?: string; fontSize?: number }
  assert.equal(after.preference, 'light')
  assert.equal(after.fontSize, 14, 'replace resets to schema defaults')
})

test('non-whitelisted namespaces are refused without persistence', () => {
  const storage = memoryStorage()
  const document = createLocalSettingsDocument({ storage })
  const result = document.mutate('llm-deepseek', [{ op: 'set', path: ['apiKey'], value: 'secret' }])
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'settings/namespace-unavailable')
  assert.equal(storage.data.has(ANONYMOUS_SETTINGS_STORAGE_KEY), false)
})

test('the official schema rejects invalid values (fail closed)', () => {
  const document = createLocalSettingsDocument({ storage: memoryStorage() })
  const result = document.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: 'blue' }])
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'settings/invalid')
})

test('a stale expected revision is refused as a conflict', () => {
  const document = createLocalSettingsDocument({ storage: memoryStorage() })
  assert.equal(document.mutate('locale', [{ op: 'set', path: ['preference'], value: 'en' }]).ok, true)
  const stale = document.mutate('locale', [{ op: 'set', path: ['preference'], value: 'zh' }], 0)
  assert.equal(stale.ok, false)
  if (stale.ok) return
  assert.equal(stale.error.code, 'SETTINGS_CONFLICT')
})

test('storage failures degrade to memory without crashing or persisting', () => {
  const storage: AnonymousSettingsStorage = { getItem: () => null, setItem: () => { throw new Error('quota exceeded') } }
  const document = createLocalSettingsDocument({ storage })
  const result = document.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: 'dark' }])
  assert.equal(result.ok, true)
  assert.equal(document.persistence, 'memory')
  const described = document.describe()
  if (!described.ok) throw new Error('describe failed')
  const theme = described.value.namespaces.find(view => view.ns === 'ui-theme')
  assert.equal((theme?.value as { preference?: string }).preference, 'dark')
})

test('corrupt or version-mismatched storage is ignored, not projected', () => {
  const storage = memoryStorage()
  storage.data.set(ANONYMOUS_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 99, sections: { 'ui-theme': { preference: 'dark' } }, revisions: { 'ui-theme': 3 } }))
  const document = createLocalSettingsDocument({ storage })
  const theme = themeView(document)
  assert.equal((theme.value as { preference?: string }).preference, 'system')

  storage.data.set(ANONYMOUS_SETTINGS_STORAGE_KEY, '{not json')
  const broken = createLocalSettingsDocument({ storage })
  assert.equal((themeView(broken).value as { preference?: string }).preference, 'system')
})

test('a stored section invalid under the current schema is ignored (fail closed)', () => {
  const storage = memoryStorage()
  storage.data.set(ANONYMOUS_SETTINGS_STORAGE_KEY, JSON.stringify({
    version: 1,
    revisions: { 'ui-theme': 5 },
    sections: { 'ui-theme': { preference: 'blue' } },
  }))
  const document = createLocalSettingsDocument({ storage })
  const theme = themeView(document)
  assert.equal((theme.value as { preference?: string }).preference, 'system')
  assert.equal(theme.revision, 0, 'invalid stored revisions never claim a document version')
})

test('no secrets are ever written into the stored document', () => {
  const storage = memoryStorage()
  const document = createLocalSettingsDocument({ storage })
  document.mutate('ui-theme', [{ op: 'set', path: ['preference'], value: 'dark' }])
  document.mutate('locale', [{ op: 'set', path: ['preference'], value: 'zh' }])
  const raw = storage.data.get(ANONYMOUS_SETTINGS_STORAGE_KEY) ?? ''
  assert.ok(raw.length > 0)
  assert.deepEqual(Object.keys(JSON.parse(raw).sections).sort(), ['locale', 'ui-theme'])
  assert.ok(!/token|secret|password|key/iu.test(raw), 'stored document holds preferences only')
})
