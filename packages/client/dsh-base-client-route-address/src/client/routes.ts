/** URL address codec for Session and Workspace ids. */
import { localizePath, splitLocalePath } from "../../../../boot/dsh-base-locale-path/src/index.ts";

/** One parsed browser address. */
export type Address =
  | { readonly kind: "home" }
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "workspace"; readonly id: string };

/**
 * Parse a pathname into the address it identifies.
 *
 * The outermost language prefix is stripped by the shared module first, so
 * `/zh-CN/app/session/:id`, `/ja/app/workspace/:id` and the unprefixed forms all resolve;
 * `/app/session/zh-CN/:id` does not, because prefixes only count at the outermost segment.
 */
export function parseAddress(pathname: string): Address {
  const { path: bare } = splitLocalePath(pathname);
  const path = bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
  const session = /^\/app\/session\/([^/]+)$/u.exec(path);
  if (session?.[1] !== undefined) {
    const id = safeDecode(session[1]);
    if (id !== undefined) return { kind: "session", id };
  }
  const workspace = /^\/app\/workspace\/([^/]+)$/u.exec(path);
  if (workspace?.[1] !== undefined) {
    const id = safeDecode(workspace[1]);
    if (id !== undefined) return { kind: "workspace", id };
  }
  return { kind: "home" };
}

/**
 * Re-apply the language prefix the current address carries.
 *
 * Mirroring an official navigation must keep the reader in the language they
 * chose: with `/zh-CN/app/session/first` current, `sessionPath("second")` becomes
 * `/zh-CN/app/session/second`. English (the unprefixed base) stays bare, so an `/en/*`
 * address normalizes to the unprefixed form the server serves.
 */
export function addressInCurrentLocale(path: string, pathname: string): string {
  return localizePath(path, splitLocalePath(pathname).locale);
}

/**
 * Address written when an official navigation is mirrored into the bar.
 *
 * The locale prefix follows the current address; the query and the hash belong
 * to the page the reader opened and must survive the mirror. Dropping them
 * breaks deep links (a query or fragment disappears a few seconds after boot).
 */
export function mirroredAddress(path: string, pathname: string, search: string, hash: string): string {
  return `${addressInCurrentLocale(path, pathname)}${search}${hash}`;
}

/** Canonical Session address. */
export function sessionPath(id: string): string {
  return `/app/session/${encodeURIComponent(id)}`;
}

/** Canonical Workspace address. */
export function workspacePath(id: string): string {
  return `/app/workspace/${encodeURIComponent(id)}`;
}

function safeDecode(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === "" ? undefined : decoded;
  } catch {
    return undefined;
  }
}
