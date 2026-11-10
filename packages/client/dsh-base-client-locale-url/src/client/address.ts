/** URL synchronization keeps the official locale runtime as the only locale owner. */
import {
  BASE_LOCALE, isLocaleId, localizePath, splitLocalePath, type LocaleId,
} from "../../../../boot/dsh-base-locale-path/src/index.ts";

/** The official locale service face this plugin composes. */
export interface LocaleFace {
  getSnapshot(): { readonly active: string };
  subscribe(listener: () => void): () => void;
  setLocale(id: string): void;
}

/** The address the runtime exposes to the synchronizer. */
export interface LocaleAddress {
  readonly location: Pick<Location, "pathname" | "search" | "hash">;
  readonly history: Pick<History, "state" | "replaceState">;
}

/** Narrow the runtime's active value to a locale id; unknown values fall back to the base locale. */
export function activeLocale(locale: LocaleFace): LocaleId {
  const active = locale.getSnapshot().active;
  return isLocaleId(active) ? active : BASE_LOCALE;
}

/** Canonical address for a locale: locale prefix from the shared module plus query and hash. */
export function addressFor(location: Pick<Location, "pathname" | "search" | "hash">, locale: LocaleId): string {
  return `${localizePath(splitLocalePath(location.pathname).path, locale)}${location.search}${location.hash}`;
}

/**
 * Boot and then mirror locale changes into the prefix.
 *
 * An explicit canonical prefix selects that locale at boot (`/zh-CN/...` opens
 * Chinese, `/ja/...` opens Japanese); a bare address keeps the saved preference
 * so a reload never forces English. Every later switch rewrites only the
 * prefix, preserving the path, query and hash.
 * @param locale - official locale service.
 * @param address - browser location/history.
 * @returns the locale subscription disposer.
 */
export function synchronizeLocaleAddress(locale: LocaleFace, address: LocaleAddress): () => void {
  const initial = splitLocalePath(address.location.pathname);
  if (initial.prefixed && !initial.needsLocaleRedirect && activeLocale(locale) !== initial.locale) {
    locale.setLocale(initial.locale);
  }
  const sync = (): void => {
    const target = addressFor(address.location, activeLocale(locale));
    const current = `${address.location.pathname}${address.location.search}${address.location.hash}`;
    if (target !== current) address.history.replaceState(address.history.state, "", target);
  };
  sync();
  return locale.subscribe(sync);
}
