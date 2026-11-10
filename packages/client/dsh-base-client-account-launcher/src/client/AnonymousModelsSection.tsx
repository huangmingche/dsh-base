/** Public declarations rendered by the marked official Models plugin. */
import { useMemo, type ReactElement } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { ModelsSection, type SettingsSchemaOperations, type ProviderCardExtrasOwnerProps } from '@dsh-base/client-deepseek-provider/client'
import { GatewayCard, createSignedOutGatewayStore, type GatewaySeatControl } from '@dsh-base/client-gateway-provider/client'
import styles from '@dsh-base/client-deepseek-provider/src/client/ModelsSection.module.css'
import { DEPLOYMENT_MODELS } from '@dsh-base/model-declarations'
import { createAnonymousModelsHost } from './anonymous-models-host.ts'
import type { ModelsCopy } from './locales.ts'

export interface AnonymousModelsSectionProps {
  readonly t: Translate
  readonly gatewayT: Translate
  readonly copy: ModelsCopy
  readonly schema: SettingsSchemaOperations
  readonly signIn: () => void
}

export function AnonymousModelsSection({ t, gatewayT, copy, schema, signIn }: AnonymousModelsSectionProps): ReactElement {
  const host = useMemo(() => createAnonymousModelsHost(copy), [copy])
  const gateway = useMemo(() => createSignedOutGatewayStore(DEPLOYMENT_MODELS.map(({ id, label }) => ({ id, label }))), [])
  return <div data-anonymous-models="true">
    <ModelsSection {...host} schema={schema} presentation="public-declarations" onRequestAccess={signIn}
      t={key => key === 'readOnly' ? copy.signInRequired : t(key)}
      renderSlot={(slot, owner) => {
        if (slot === 'settings.models.footer') return <div className={styles['editorActions']}>
          <Button variant="primary" data-anonymous-models-sign-in onClick={signIn}>{copy.signIn}</Button>
        </div>
        if (slot !== 'settings.models.provider-card') return null
        // SlotRender is generic; its key check does not narrow the paired owner.
        const card = owner as unknown as ProviderCardExtrasOwnerProps & GatewaySeatControl
        if (card.provider.settingsNs !== 'llm-cloudflare-gateway') return null
        return <GatewayCard {...card} store={gateway} t={key => gatewayT(key)} />
      }} />
  </div>
}
