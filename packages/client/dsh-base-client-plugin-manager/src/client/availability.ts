/** Own Host-data adaptation for the marked fork; no official implementation is copied here. */
export type DeploymentAvailability = 'not-adapted'

/** An unknown future/invalid marker must never erase a real official status. */
export function readDeploymentAvailability(value: unknown): DeploymentAvailability | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return 'deploymentAvailability' in value && value.deploymentAvailability === 'not-adapted' ? 'not-adapted' : undefined
}

interface CapabilityView {
  readonly official: boolean
  readonly availability: string
  readonly installed: boolean
  readonly enabled: boolean
  readonly installTarget?: unknown
  readonly error?: unknown
  readonly meta?: { readonly error?: unknown }
  readonly rows: readonly { readonly phase?: string | null }[]
  readonly deploymentAvailability?: DeploymentAvailability
}

/** The Host explicitly marks missing catalog metadata; real failure always wins. */
export function deploymentAvailabilityStatus(pkg: CapabilityView): 'unavailable' | 'problem' | undefined {
  if (readDeploymentAvailability(pkg) === undefined) return undefined
  if (pkg.error !== undefined || pkg.meta?.error !== undefined || pkg.rows.some(row => row.phase === 'failed')) return 'problem'
  return pkg.official && pkg.availability === 'missing' && !pkg.installed && !pkg.enabled
    && pkg.installTarget === undefined && pkg.rows.length === 0 ? 'unavailable' : undefined
}

/** Same eight-language neutral availability label used by the built-in cards. */
export const UNAVAILABLE_LABEL = {
  en: 'Unavailable', zh: '不可用', ja: '利用不可', es: 'No disponible',
  fr: 'Indisponible', de: 'Nicht verfügbar', ru: 'Недоступно', pt: 'Indisponível',
} as const
