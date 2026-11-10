/** Explicit, lifetime-scoped permission to mount a bundle's own public configuration UI. */
export interface PublicPluginConfigurations {
  registerBundle(key: string): () => void
  hasBundle(key: string): boolean
  getSnapshot(): number
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context { publicPluginConfigurations: PublicPluginConfigurations }
}

export function createPublicPluginConfigurations(): PublicPluginConfigurations {
  const bundles = new Map<string, number>(), listeners = new Set<() => void>()
  let revision = 0
  const notify = () => { revision++; for (const listener of listeners) listener() }
  return {
    registerBundle(key) {
      if (!key || key.trim() !== key) throw new TypeError('A public configuration requires an exact bundle key')
      bundles.set(key, (bundles.get(key) ?? 0) + 1)
      notify()
      let active = true
      return () => {
        if (!active) return
        active = false
        const count = bundles.get(key) ?? 0
        if (count > 1) bundles.set(key, count - 1)
        else bundles.delete(key)
        notify()
      }
    },
    hasBundle: key => bundles.has(key),
    getSnapshot: () => revision,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
