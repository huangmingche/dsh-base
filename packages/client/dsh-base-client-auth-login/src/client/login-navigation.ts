import { hreflangFor, localizePath, splitLocalePath } from '../../../../boot/dsh-base-locale-path/src/index.ts';
import { resolveLoginLocale } from './locales.ts';
import { loginReturnPath } from './return-url.ts';

/** Server redirects preserve next, so its safe locale also labels the public login document. */
export function loginNavigation(url: URL, documentLocale: string) {
  const next = new URL(loginReturnPath(url.searchParams.get('next'), url.origin), url.origin);
  const path = splitLocalePath(next.pathname);
  const locale = resolveLoginLocale(url.searchParams.get('locale')
    ?? (url.pathname === '/login' && path.prefixed ? path.locale : documentLocale));
  return { locale, language: hreflangFor(locale), home: localizePath('/', locale) };
}
