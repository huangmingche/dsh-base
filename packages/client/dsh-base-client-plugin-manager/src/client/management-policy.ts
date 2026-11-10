/** Host ownership of a visible plugin is separate from installation and runtime state. */
export type ManagementPolicy = 'required' | 'deployment'

export function readManagementPolicy(value: unknown): ManagementPolicy | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!('readOnlyReason' in value) || value.readOnlyReason !== 'unaddressable') return undefined
  if (!('managementPolicy' in value)) return undefined
  return value.managementPolicy === 'required' || value.managementPolicy === 'deployment' ? value.managementPolicy : undefined
}

/** Preserve validated Host ownership for the unchanged official detail-slot contract. */
export function managementPolicyRef(value: unknown): { readonly readOnlyReason?: 'unaddressable'; readonly managementPolicy?: ManagementPolicy } {
  const policy = readManagementPolicy(value)
  return policy === undefined ? {} : { readOnlyReason: 'unaddressable', managementPolicy: policy }
}

/** Short explanations follow the official plugin manager's control-copy style. */
export const MANAGEMENT_POLICY_LABELS = {
  required: {
    en: 'Required by the app', zh: '应用所需', ja: 'アプリに必要', es: 'Necesario para la aplicación',
    fr: 'Nécessaire à l’application', de: 'Von der App benötigt', ru: 'Требуется приложению', pt: 'Necessário para a aplicação',
  },
  deployment: {
    en: 'Managed by the deployment', zh: '由部署管理', ja: 'デプロイで管理', es: 'Gestionado por el despliegue',
    fr: 'Géré par le déploiement', de: 'Vom Deployment verwaltet', ru: 'Управляется развёртыванием', pt: 'Gerido pela implantação',
  },
} as const
