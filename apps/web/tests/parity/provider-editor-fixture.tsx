/** Actual official DeepSeek ProviderEditor over an in-memory credential/settings transport. */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { ProviderEditor } from '../../../../packages/client/dsh-base-client-deepseek-provider/src/client/ProviderEditor.tsx'
import { createSettingsSchemaOperations } from '../../../../packages/client/dsh-base-client-deepseek-provider/src/client/schema-operations.ts'
import { en, zh } from '../../../../packages/client/dsh-base-client-deepseek-provider/src/client/locales.ts'

const raw = Schema.object({
  apiKeyEnv: Schema.string(),
  baseURL: Schema.string(),
  models: Schema.array(Schema.object({ id: Schema.string(), name: Schema.string(), contextWindow: Schema.number() })),
})
const wireSchema = JSON.parse(JSON.stringify(raw.toJSON())) as never
const schema = createSettingsSchemaOperations(new SettingsSchemaService(new Context()))
const defaults = [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576 }]

export function ProviderEditorFixture({ locale }: { locale: 'en' | 'zh' }) {
  const t = (key: keyof typeof en) => (locale === 'zh' ? zh : en)[key] as string
  const [credential, setCredential] = useState('')
  const [stored, setStored] = useState('')
  const [failures, setFailures] = useState(0)
  const [writes, setWrites] = useState(0)
  const [view, setView] = useState({ ns: 'llm-deepseek', schema: wireSchema, value: { apiKeyEnv: 'DEEPSEEK_OFFICIAL_API_KEY', models: defaults }, base: { models: defaults }, user: {}, autoGenerate: false, applies: 'live' as const, secrets: [], revision: 1 })
  const [editorKey, setEditorKey] = useState(0)
  const operations = useMemo(() => ({
    storeCredential: async (_ref: string, value: string) => {
      if (failures > 0) { setFailures(current => current - 1); return 'fixture credential transport failure' }
      setStored(value); return undefined
    },
    removeCredential: async () => undefined,
    writeSettings: async (_ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[], expectedRevision: number | undefined) => {
      setWrites(current => current + 1)
      const user: Record<string, unknown> = JSON.parse(JSON.stringify(view.user))
      for (const op of ops) {
        const [head, ...rest] = op.path.map(String)
        if (head === undefined) continue
        if (op.op === 'unset') delete user[head]
        else if (rest.length === 0) user[head] = op.value
        else {
          const nested = rest.reduce<Record<string, unknown>>((current, key) => {
            const nextValue = current[key]
            if (typeof nextValue !== 'object' || nextValue === null || Array.isArray(nextValue)) current[key] = {}
            return current[key] as Record<string, unknown>
          }, user as Record<string, any>)
          void nested
          user[head] = op.value
        }
      }
      const next = { ...view, value: { ...view.base, ...user }, user, revision: (expectedRevision ?? view.revision) + 1 }
      setView(next)
      return { kind: 'written' as const, view: next }
    },
    discoverModels: async () => ({ kind: 'found' as const, models: [] }),
  }), [failures, view])
  useEffect(() => { (window as any).__PROVIDER_EDITOR_FIXTURE__ = { stored, writes, failNext: () => setFailures(1) } }, [stored, writes])
  return <div className="provider-editor-fixture" style={{ padding: 24, maxWidth: 720 }}>
    <div data-testid="credential">{stored}</div>
    <div data-testid="writes">{writes}</div>
    <div data-testid="endpoint">{String(view.user.baseURL ?? '')}</div>
    <div data-testid="catalog">{JSON.stringify(view.user.models ?? [])}</div>
    <button data-testid="remount" onClick={() => setEditorKey(current => current + 1)}>Remount</button>
    <ProviderEditor key={editorKey} provider="deepseek-official" displayName="DeepSeek" namespace={view as never} settingsPath={[]} schema={schema} operations={operations as never} t={t} readOnly={false} onClose={() => undefined} />
  </div>
}
