/** Models provider-card extension: actual deployment route and catalog status. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ModelAccessCard.module.css'

/** Public, non-secret model-route facts supplied by the Host. */
export interface ModelAccessSnapshot {
  readonly platformEnabled: boolean
  readonly ownerKeyConfigured: boolean
  readonly effective: 'owner-byok' | 'platform-gateway' | 'unavailable'
  readonly protocol: 'openai-chat-completions'
  readonly catalog: ReadonlyArray<{ readonly id: string; readonly label: string; readonly contextWindow: number }>
}

/** Registration-side loader; no credential or secret is returned. */
export interface ModelAccessCardInjected {
  load: () => Promise<ModelAccessSnapshot>
}

type ModelAccessCardProps =
  PropsRuntime<'settings.models.provider-card'>
  & PropsLocale<'settings'>
  & InjectFace<ModelAccessCardInjected>

/** Render platform-vs-owner route state beside the official provider row. */
export function ModelAccessCard({ load, t }: ModelAccessCardProps) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: ModelAccessSnapshot }
  >({ kind: 'loading' })
  useEffect(() => {
    let current = true
    void load().then(
      value => { if (current) setState({ kind: 'ready', value }) },
      () => { if (current) setState({ kind: 'error' }) },
    )
    return () => { current = false }
  }, [load])
  if (state.kind === 'loading') return <p className={css.hint} role="status">{t('modelAccess.loading')}</p>
  if (state.kind === 'error') return <p className={css.error} role="status">{t('modelAccess.error')}</p>
  const value = state.value
  const effective = value.effective === 'owner-byok' ? t('modelAccess.ownerActive')
    : value.effective === 'platform-gateway' ? t('modelAccess.platformActive')
      : t('modelAccess.unavailable')
  const owner = value.ownerKeyConfigured ? t('modelAccess.ownerKeyConfigured') : t('modelAccess.ownerKeyMissing')
  return <div className={css.card} role="status" data-model-access={value.effective}>
    <p className={css.title}>{t('modelAccess.title')}</p>
    <p className={css.hint}>{t('modelAccess.platformManaged')}</p>
    <p className={css.effective}>{effective}</p>
    <p className={css.hint}>{owner}</p>
    {value.catalog.length === 0 ? null : <p className={css.models}>
      <span>{t('modelAccess.models')}</span>
      {value.catalog.map(model => <code key={model.id}>{model.label}</code>)}
    </p>}
  </div>
}
