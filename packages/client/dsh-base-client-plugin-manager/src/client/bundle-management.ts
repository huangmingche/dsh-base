/** Own Host metadata for components addressed only through their bundle switch. */
export function readManagedByBundle(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!('readOnlyReason' in value) || value.readOnlyReason !== 'unaddressable') return undefined
  if (!('managedByBundle' in value) || typeof value.managedByBundle !== 'string') return undefined
  const name = value.managedByBundle.trim()
  return name.length === 0 ? undefined : name
}

/** Display-only explanation; the Host still refuses independent component writes. */
export function managedByBundleLabels(bundle: string) {
  return {
    en: `Managed by the ${bundle} switch`,
    zh: `由 ${bundle} 开关统一管理`,
    ja: `${bundle} のスイッチで一括管理`,
    es: `Se gestiona con el interruptor de ${bundle}`,
    fr: `Géré par le bouton de ${bundle}`,
    de: `Wird über den Schalter für ${bundle} verwaltet`,
    ru: `Управляется переключателем ${bundle}`,
    pt: `Gerido pelo interruptor de ${bundle}`,
  } as const
}
