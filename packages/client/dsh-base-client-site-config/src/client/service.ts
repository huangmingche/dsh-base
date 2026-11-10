/** One public site snapshot shared by brand and site settings; failed refreshes retain the last good value. */
import { mergeSiteConfig, parseSiteRuntimeConfig, type SiteConfig } from '@dsh-base/site-config';
export interface SiteConfigSnapshot { readonly config: SiteConfig; readonly environmentLabel?: string }
export interface SiteConfigService {
  getSnapshot(): SiteConfigSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<boolean>;
}
export function createSiteConfigService(fetcher: typeof fetch = fetch): SiteConfigService & { dispose(): void } {
  let snapshot: SiteConfigSnapshot = Object.freeze({ config: mergeSiteConfig(undefined) });
  const listeners = new Set<() => void>();
  let generation = 0, disposed = false;
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: async () => {
      if (disposed) return false;
      const current = ++generation;
      try {
        const response = await fetcher('/api/site-config', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return false;
        const body: unknown = await response.json();
        if (body === null || typeof body !== 'object' || Array.isArray(body) || !('brand' in body)) return false;
        const runtime = parseSiteRuntimeConfig(body);
        if (disposed || generation !== current) return false;
        snapshot = Object.freeze({ config: mergeSiteConfig(runtime.config), ...(runtime.environmentLabel === undefined ? {} : { environmentLabel: runtime.environmentLabel }) });
        for (const listener of [...listeners]) { try { listener(); } catch { /* An observer cannot stop another observer. */ } }
        return true;
      } catch { return false; }
    },
    dispose: () => { disposed = true; generation++; listeners.clear(); },
  };
}
