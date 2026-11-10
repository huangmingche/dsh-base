/** Public-page counting only. No third-party browser code or account identifiers. */
import { GOOGLE_MEASUREMENT_ID, type SiteConfig } from '@dsh-base/site-config';
import { canonicalizeLocalePath, splitLocalePath } from '@dsh-base/locale-path';
import { PUBLIC_PAGES, hasPageLocale, isNoIndexDocument, type PublicPage } from '@dsh-base/public-pages';

export interface AnalyticsSource {
  getSnapshot(): { readonly config: Pick<SiteConfig, 'analytics'> };
  subscribe(listener: () => void): () => void;
}
export type NavigationWindow = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;
const ENDPOINT = '/api/site-analytics/google';

/** Resolve only published public documents; never emit query, fragment or an arbitrary path. */
export function publicAnalyticsPath(pathname: string, pages: readonly PublicPage[] = PUBLIC_PAGES): string | undefined {
  if (!pathname.startsWith('/') || /[?#\\\u0000-\u0020]/u.test(pathname)) return undefined;
  const route = splitLocalePath(canonicalizeLocalePath(pathname));
  return pages.some(page => page.path === route.path && hasPageLocale(page, route.locale)) && !isNoIndexDocument(route.path) ? route.canonicalPath : undefined;
}

/** Observe native navigation without replacing it or changing official DSH UI. */
export function startPublicPageViews(source: AnalyticsSource, target: NavigationWindow, fetcher: typeof fetch, pages: readonly PublicPage[] = PUBLIC_PAGES): () => void {
  let disposed = false;
  let lastView: string | undefined;
  const pending = new Set<AbortController>();
  const abortPending = (): void => { for (const controller of pending) controller.abort(); pending.clear(); };
  const observe = (): void => {
    if (disposed) return;
    const google = source.getSnapshot().config.analytics?.google;
    const path = publicAnalyticsPath(target.location.pathname, pages);
    if (!google?.enabled || google.ready !== true || !google.measurementId || !GOOGLE_MEASUREMENT_ID.test(google.measurementId) || path === undefined) {
      lastView = undefined;
      abortPending();
      return;
    }
    const key = `${google.measurementId}:${path}`;
    if (lastView === key) return;
    lastView = key;
    const controller = new AbortController();
    pending.add(controller);
    // Invocation is detached so native browser fetch never receives this service as its receiver.
    void (async () => {
      try {
        await fetcher(ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path }), credentials: 'omit', referrerPolicy: 'no-referrer',
          cache: 'no-store', signal: controller.signal,
        });
      } catch { /* Statistics are best-effort; failures never retry or interrupt navigation. */ }
      finally { pending.delete(controller); }
    })();
  };
  const notify = (): void => { try { observe(); } catch { /* Analytics cannot change navigation outcomes. */ } };
  const originalPush = target.history.pushState;
  const originalReplace = target.history.replaceState;
  const push: History['pushState'] = function(this: History, ...args: Parameters<History['pushState']>) {
    const result = Reflect.apply(originalPush, this, args);
    notify();
    return result;
  };
  const replace: History['replaceState'] = function(this: History, ...args: Parameters<History['replaceState']>) {
    const result = Reflect.apply(originalReplace, this, args);
    notify();
    return result;
  };
  target.history.pushState = push;
  target.history.replaceState = replace;
  target.addEventListener('popstate', notify);
  target.addEventListener('hashchange', notify);
  const unsubscribe = source.subscribe(notify);
  notify();
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    target.removeEventListener('popstate', notify);
    target.removeEventListener('hashchange', notify);
    if (target.history.pushState === push) target.history.pushState = originalPush;
    if (target.history.replaceState === replace) target.history.replaceState = originalReplace;
    abortPending();
  };
}

/** Production only: an unavailable registry disables counting instead of widening the public allowlist. */
export function startPublishedPageViews(source: AnalyticsSource, target: NavigationWindow, fetcher: typeof fetch): () => void {
  const controller = new AbortController(); let stop: (() => void) | undefined;
  void (async () => {
    try {
      const result = await fetcher('/api/public-pages', { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
      if (!result.ok) return;
      const value = await result.json() as {pages?: PublicPage[]};
      if (!Array.isArray(value.pages) || value.pages.some(page => !page || typeof page.path !== 'string' || !Array.isArray(page.availableLocales))) return;
      if (!controller.signal.aborted) stop = startPublicPageViews(source, target, fetcher, value.pages);
    } catch { /* An unavailable public inventory never causes fallback collection. */ }
  })();
  return () => { controller.abort(); stop?.(); };
}
