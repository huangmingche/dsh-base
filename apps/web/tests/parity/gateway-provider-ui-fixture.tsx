/** Pinned official compact provider row vs the actual Gateway provider card. */
import React, { useEffect, useMemo, useState } from 'react'
import officialStyles from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css'
import forkStyles from '../../../../packages/client/dsh-base-client-deepseek-provider/src/client/ModelsSection.module.css'
import { GatewayCard, gatewayCopy, type GatewayLocale } from '../../../../packages/client/dsh-base-client-gateway-provider/src/client/index.tsx'
import { ModelsSection } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.tsx'
import { en as officialEn, zh as officialZh } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/locales.ts'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: { platformEnabled: boolean; providers: Record<string, { available: boolean; catalog: Array<{ id: string; label: string }> }> } }
class FakeGatewayStore {
  private state: State
  private readonly listeners = new Set<() => void>()
  loadCalls = 0
  constructor(state: State) { this.state = state }
  snapshot = (): State => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set = (state: State): void => { this.state = state; for (const listener of this.listeners) listener() }
  start = (): void => undefined
  load = async (): Promise<void> => {
    this.loadCalls += 1
    this.set({ kind: 'ready', value: readyValue })
  }
}
const readyValue = {
  platformEnabled: true,
  providers: {
    'cloudflare-ai-gateway': { available: true, catalog: [
      { id: 'cloudflare-ai-gateway/deepseek-flash', label: 'DeepSeek-V4.1-Flash' },
      { id: 'cloudflare-ai-gateway/deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
    ] },
  },
}
const unavailableValue = { platformEnabled: false, providers: { 'cloudflare-ai-gateway': { available: false, catalog: [] } } }
const provider = { provider: 'cloudflare-ai-gateway', displayName: 'Cloudflare AI Gateway', settingsNs: 'llm-cloudflare-gateway', settingsPath: [], active: true }

export function GatewayProviderUiFixture({ locale = 'en', state: initialState = 'available' }: { locale?: GatewayLocale; state?: string }) {
  const copy = gatewayCopy[locale] ?? gatewayCopy.en
  const t = (key: keyof typeof gatewayCopy.en): string => copy[key] as string
  const [revision, setRevision] = useState(0)
  const store = useMemo(() => new FakeGatewayStore(
    initialState === 'loading' ? { kind: 'loading' }
      : initialState === 'error' ? { kind: 'error' }
        : initialState === 'unavailable' ? { kind: 'ready', value: unavailableValue }
          : { kind: 'ready', value: readyValue },
  ), [initialState])
  const officialRows = [{
    entry: { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
    configured: true, removable: false, apiKeyEnv: undefined, credential: { configured: true },
  }]
  const officialState = { status: 'ready', error: null, credentialError: null, writable: true, rows: officialRows, namespaces: new Map([['llm-deepseek', {}]]) }
  const officialController = { load: async () => undefined, store: { getSnapshot: () => officialState, subscribe: () => () => undefined } }
  useEffect(() => { (window as any).__GATEWAY_UI_FIXTURE__ = { store, revision, setState: (state: string) => { store.set(state === 'error' ? { kind: 'error' } : state === 'loading' ? { kind: 'loading' } : state === 'unavailable' ? { kind: 'ready', value: unavailableValue } : { kind: 'ready', value: readyValue }); setRevision(current => current + 1) } } }, [store, revision])
  return <div className="gateway-parity" style={{ padding: 24, maxWidth: 720, width: '100%', boxSizing: 'border-box' }}>
    <div data-testid="official-reference">
      <ModelsSection
        controller={officialController as never}
        useSnapshot={(selector: (state: any) => unknown) => selector(officialState)}
        operations={{} as never}
        schema={{} as never}
        t={(key: string) => (locale === 'zh' ? officialZh : officialEn)[key as keyof typeof officialEn] as string}
        renderSlot={() => null as never}
      />
    </div>
    <div style={{ height: 12 }} />
    <ul className={forkStyles['rows']} data-testid="gateway-row">
      <li className={forkStyles['rowCard']} data-parity-row="gateway">
        <GatewayCard store={store as never} t={t} provider={provider} />
      </li>
    </ul>
    <div style={{ position: "absolute", left: -99999, top: 0 }} data-testid="official-editor-reference">
      <div className={officialStyles['editor']}>
        <div className={officialStyles['editorHeader']}><span className={officialStyles['editorTitle']}>Details</span><span className={officialStyles['editorRoute']}>cloudflare-ai-gateway</span></div>
        <div className={officialStyles['field']}><span className={officialStyles['fieldLabel']}>Status</span><span className={officialStyles['advancedHint']}>Available</span></div>
      </div>
    </div>
  </div>
}
