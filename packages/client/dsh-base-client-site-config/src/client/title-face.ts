/** Host data for the official title translation seat; no document writes or dictionary changes. */
import type { LocaleFace, Translate } from '@deepseek-ai/dsh-client-ui-slots';
import type { SiteConfigService } from './service.ts';

interface ActiveLocaleFace extends LocaleFace {
  getSnapshot(): { readonly revision: number; readonly active: string };
}

/** Preserve every official translation except the common product-title fallback. */
export function createSiteTitleLocaleFace(
  locale: ActiveLocaleFace,
  siteConfig: Pick<SiteConfigService, 'getSnapshot' | 'subscribe'>,
): LocaleFace & { dispose(): void } {
  const readTitle = (): string | undefined => {
    const { config } = siteConfig.getSnapshot();
    if (config.documentTitles === undefined) return undefined;
    const titles: Readonly<Record<string, string | undefined>> = config.documentTitles;
    return titles[locale.getSnapshot().active] ?? titles.en ?? config.brand.name;
  };
  let localeRevision = locale.getSnapshot().revision;
  let title = readTitle();
  let snapshot: { readonly revision: number } = Object.freeze({ revision: 0 });
  let disposed = false;
  const listeners = new Set<() => void>();
  const common = locale.bind('common');
  const translateCommon: Translate = (key, params) =>
    key === 'brand.localBuild' && title !== undefined ? title : common(key, params);
  const sync = (): void => {
    if (disposed) return;
    const nextRevision = locale.getSnapshot().revision;
    const nextTitle = readTitle();
    if (nextRevision === localeRevision && nextTitle === title) return;
    localeRevision = nextRevision;
    title = nextTitle;
    snapshot = Object.freeze({ revision: snapshot.revision + 1 });
    for (const listener of [...listeners]) listener();
  };
  const stopLocale = locale.subscribe(sync);
  const stopSiteConfig = siteConfig.subscribe(sync);
  return {
    bind: namespace => namespace === 'common' ? translateCommon : locale.bind(namespace),
    getSnapshot: () => snapshot,
    subscribe: listener => {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopLocale();
      stopSiteConfig();
      listeners.clear();
    },
  };
}
