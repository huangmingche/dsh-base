/** Additional checked-account prerequisite; the official RemoteAccess gate remains authoritative. */
import type { NavigationAccess } from '@dsh-base/client-session-adapter/navigation-access'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

export function navigationAllowed(access: NavigationAccess): boolean {
  return access.getSnapshot() === 'authenticated'
}

export function requireNavigation(access: NavigationAccess): void {
  if (!navigationAllowed(access)) throw new Error('auth/required: Sign in to use workspaces and sessions.')
}

/** Hide owner data synchronously when the checked account is unavailable. */
export function navigationSource<T>(access: NavigationAccess, source: HostObservable<T>, empty: T): HostObservable<T> {
  return {
    getSnapshot: () => navigationAllowed(access) ? source.getSnapshot() : empty,
    subscribe(listener) {
      const releaseSource = source.subscribe(listener)
      const releaseAccess = access.subscribe(listener)
      return () => { releaseSource(); releaseAccess() }
    },
  }
}
