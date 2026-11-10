/** Independent Cloudflare AI Gateway provider-card seam for the official Models page. */
import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { z } from 'zod'
import { GatewayStore, type GatewayStoreFace } from './gateway-store.ts'
import styles from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css'
export { createSignedOutGatewayStore } from './gateway-store.ts'
export type { GatewayCatalog, GatewaySnapshot, GatewayStoreFace } from './gateway-store.ts'

/** Loader contract for this plugin (no options). */
export const Config = z.object({}).default({})
/** Runtime services required by the provider-card seam. */
export const inject = ['slots', 'locale', 'remote', 'modelAccess']

type GatewayKey = 'available' | 'unavailable' | 'catalog' | 'checking' | 'error' | 'retry' | 'operator'
  | 'details' | 'collapse' | 'statusLabel' | 'authenticationLabel' | 'modelsLabel'
  | 'credentialConfigured' | 'signedOut'
const en: Record<GatewayKey, string> = {
  available: 'Platform authentication is available through Cloudflare AI Gateway.',
  credentialConfigured: 'Platform authentication is configured and available.',
  unavailable: 'Cloudflare AI Gateway is not enabled for this deployment.',
  catalog: 'Available models', checking: 'Checking Cloudflare AI Gateway configuration…',
  error: 'Cloudflare AI Gateway status is unavailable.', retry: 'Retry',
  operator: 'Gateway configuration is operator-managed and read-only.',
  details: 'Details', collapse: 'Hide details', statusLabel: 'Status',
  authenticationLabel: 'Authentication', modelsLabel: 'Models',
  signedOut: 'Sign in to view',
}
const zh: Record<GatewayKey, string> = {
  available: '平台认证通过 Cloudflare AI Gateway 提供。',
  credentialConfigured: '平台认证已配置并可用。',
  unavailable: '当前部署未启用 Cloudflare AI Gateway。',
  catalog: '可用模型', checking: '正在检查 Cloudflare AI Gateway 配置…',
  error: '暂时无法读取 Cloudflare AI Gateway 状态。', retry: '重试',
  operator: 'Gateway 配置由平台运营者管理，只读。',
  details: '详情', collapse: '收起详情', statusLabel: '状态',
  authenticationLabel: '认证', modelsLabel: '模型',
  signedOut: '登录后查看',
}
const ja: Record<GatewayKey, string> = {
  available: 'Cloudflare AI Gateway によるプラットフォーム認証が利用できます。',
  credentialConfigured: 'プラットフォーム認証は設定済みで利用可能です。',
  unavailable: 'このデプロイでは Cloudflare AI Gateway が有効ではありません。',
  catalog: '利用可能なモデル', checking: 'Cloudflare AI Gateway の設定を確認中…',
  error: 'Cloudflare AI Gateway の状態を取得できません。', retry: '再試行',
  operator: 'Gateway 設定は運営者が管理し、読み取り専用です。',
  details: '詳細', collapse: '詳細を閉じる', statusLabel: '状態',
  authenticationLabel: '認証', modelsLabel: 'モデル',
  signedOut: 'サインインして表示',
}
const es: Record<GatewayKey, string> = {
  available: 'La autenticación de plataforma está disponible mediante Cloudflare AI Gateway.',
  credentialConfigured: 'La autenticación de plataforma está configurada y disponible.',
  unavailable: 'Cloudflare AI Gateway no está habilitado en este despliegue.',
  catalog: 'Modelos disponibles', checking: 'Comprobando la configuración de Cloudflare AI Gateway…',
  error: 'El estado de Cloudflare AI Gateway no está disponible.', retry: 'Reintentar',
  operator: 'La configuración de Gateway la gestiona el operador y es de solo lectura.',
  details: 'Detalles', collapse: 'Ocultar detalles', statusLabel: 'Estado',
  authenticationLabel: 'Autenticación', modelsLabel: 'Modelos',
  signedOut: 'Inicia sesión para ver',
}
const fr: Record<GatewayKey, string> = {
  available: "L’authentification de la plateforme est disponible via Cloudflare AI Gateway.",
  credentialConfigured: "L’authentification de la plateforme est configurée et disponible.",
  unavailable: "Cloudflare AI Gateway n’est pas activé pour ce déploiement.",
  catalog: 'Modèles disponibles', checking: 'Vérification de la configuration Cloudflare AI Gateway…',
  error: 'L’état de Cloudflare AI Gateway est indisponible.', retry: 'Réessayer',
  operator: 'La configuration Gateway est gérée par l’opérateur et en lecture seule.',
  details: 'Détails', collapse: 'Masquer les détails', statusLabel: 'État',
  authenticationLabel: 'Authentification', modelsLabel: 'Modèles',
  signedOut: 'Connectez-vous pour consulter',
}
const de: Record<GatewayKey, string> = {
  available: 'Die Plattformauthentifizierung ist über Cloudflare AI Gateway verfügbar.',
  credentialConfigured: 'Plattform-Authentifizierung ist konfiguriert und verfügbar.',
  unavailable: 'Cloudflare AI Gateway ist für dieses Deployment nicht aktiviert.',
  catalog: 'Verfügbare Modelle', checking: 'Cloudflare AI Gateway-Konfiguration wird geprüft…',
  error: 'Der Cloudflare AI Gateway-Status ist nicht verfügbar.', retry: 'Erneut versuchen',
  operator: 'Die Gateway-Konfiguration wird vom Betreiber verwaltet und ist schreibgeschützt.',
  details: 'Details', collapse: 'Details ausblenden', statusLabel: 'Status',
  authenticationLabel: 'Authentifizierung', modelsLabel: 'Modelle',
  signedOut: 'Zum Anzeigen anmelden',
}
const ru: Record<GatewayKey, string> = {
  available: 'Аутентификация платформы доступна через Cloudflare AI Gateway.',
  credentialConfigured: 'Аутентификация платформы настроена и доступна.',
  unavailable: 'Cloudflare AI Gateway не включён для этого развёртывания.',
  catalog: 'Доступные модели', checking: 'Проверка конфигурации Cloudflare AI Gateway…',
  error: 'Статус Cloudflare AI Gateway недоступен.', retry: 'Повторить',
  operator: 'Конфигурацией Gateway управляет оператор; доступ только для чтения.',
  details: 'Подробнее', collapse: 'Скрыть подробности', statusLabel: 'Статус',
  authenticationLabel: 'Аутентификация', modelsLabel: 'Модели',
  signedOut: 'Войдите для просмотра',
}
const pt: Record<GatewayKey, string> = {
  available: 'A autenticação da plataforma está disponível através do Cloudflare AI Gateway.',
  credentialConfigured: 'A autenticação da plataforma está configurada e disponível.',
  unavailable: 'O Cloudflare AI Gateway não está ativo nesta implantação.',
  catalog: 'Modelos disponíveis', checking: 'A verificar a configuração do Cloudflare AI Gateway…',
  error: 'O estado do Cloudflare AI Gateway não está disponível.', retry: 'Tentar novamente',
  operator: 'A configuração do Gateway é gerida pelo operador e só de leitura.',
  details: 'Detalhes', collapse: 'Ocultar detalhes', statusLabel: 'Estado',
  authenticationLabel: 'Autenticação', modelsLabel: 'Modelos',
  signedOut: 'Entre para visualizar',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.gatewayProvider': GatewayKey }
}
const NS = 'settings.gatewayProvider'
/** Locale dictionaries exported for the UI parity fixture; the plugin owns all eight locales. */
export const gatewayCopy = { en, zh, ja, es, fr, de, ru, pt } as const
export type GatewayLocale = keyof typeof gatewayCopy

/** Explicit adapter contract: the marked Models fork owns one open card at a time. */
export interface GatewaySeatControl {
  readonly gatewayOpen?: boolean
  readonly onGatewayToggle?: (open: boolean) => void
}
interface CardInjected { store: GatewayStoreFace }
type CardProps = Pick<PropsRuntime<'settings.models.provider-card'>, 'provider'> & PropsLocale<'settings.gatewayProvider'> & InjectFace<CardInjected> & GatewaySeatControl
/** The compact provider row and its read-only details, using the pinned official Models styles. */
export function GatewayCard({ store, t, provider, gatewayOpen, onGatewayToggle }: CardProps) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = gatewayOpen ?? internalOpen
  const toggle = (): void => { if (onGatewayToggle !== undefined) onGatewayToggle(!open); else setInternalOpen(current => !current) }
  const titleId = useId()
  const panelId = useId()
  useEffect(() => { store.start() }, [store])
  const gateway = state.kind === 'ready' ? state.value.providers?.['cloudflare-ai-gateway'] : undefined
  const catalog = state.kind === 'signed-out' ? state.catalog : gateway?.catalog
  const available = state.kind === 'ready' && state.value.platformEnabled && gateway?.available === true
  const status = state.kind === 'signed-out' ? t('signedOut') : state.kind === 'loading' ? t('checking') : state.kind === 'error' ? t('error') : available ? t('available') : t('unavailable')
  return (
    <>
      <div data-gateway-provider={state.kind === 'signed-out' ? 'signed-out' : state.kind === 'loading' ? 'loading' : state.kind === 'error' ? 'error' : available ? 'available' : 'unavailable'}>
        <div className={styles['rowHead']}>
        <span className={styles['rowIdentity']}>
          <span className={styles['rowName']}>{provider.displayName}</span>
          {available
            ? <span className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`} role="img" aria-label={t('credentialConfigured')} title={t('credentialConfigured')} data-gateway-status="available" />
            : null}
        </span>
          <span className={styles['rowActions']}>
            <button type="button" className={styles['secondaryButton']} aria-expanded={open} aria-controls={panelId} onClick={toggle}>
              {open ? t('collapse') : t('details')}
            </button>
          </span>
        </div>
      </div>
      <div id={panelId} role="region" aria-labelledby={titleId} hidden={!open}>
        <div className={styles['editor']}>
          <div className={styles['editorHeader']}>
            <span id={titleId} className={styles['editorTitle']}>{provider.displayName}</span>
            <span className={styles['editorRoute']}>{provider.provider}</span>
          </div>
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('statusLabel')}</span>
            <span className={styles['advancedHint']} role="status">{status}</span>
          </div>
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('authenticationLabel')}</span>
            <span className={styles['advancedHint']}>{state.kind === 'signed-out' ? t('signedOut') : t('operator')}</span>
          </div>
          {catalog !== undefined && catalog.length > 0
            ? (
              <div className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('modelsLabel')}</span>
                <span className={styles['advancedHint']}>{catalog.map(model => model.label).join(' · ')}</span>
              </div>
            )
            : null}
          {state.kind === 'error'
            ? <div className={styles['editorActions']}><button type="button" className={styles['secondaryButton']} onClick={() => { void store.load() }}>{t('retry')}</button></div>
            : null}
        </div>
      </div>
    </>
  )
}

/** Register the Gateway card without touching the official DeepSeek card/editor. */
export function apply(ctx: ClientContext): void {
  const store = new GatewayStore(ctx)
  ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }), 'gateway-provider: dictionaries')
  ctx.effect(() => () => store.dispose(), 'gateway-provider: store disposal')
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-cloudflare-gateway', locale: NS,
    inject: (): CardInjected => ({ store }),
  }, GatewayCard))
}
