/** Pure registration decision for the anonymous launcher cell. */

/** Facts that decide whether this plugin may occupy `sidebar.settings`. */
export interface LauncherState {
  /** The account view settled on the anonymous state. */
  readonly signedOut: boolean
  /** The single slot already holds an entry this plugin did not register. */
  readonly foreignEntry: boolean
  /** This plugin currently owns a registration. */
  readonly registered: boolean
}

/** What the reconciler must do next. */
export type LauncherAction = 'register' | 'dispose' | 'none'

/**
 * The launcher is a fallback occupant: only anonymous sessions register, and a
 * foreign entry (the signed-in settings shell) always wins.
 * @param state - current account and slot facts.
 * @returns register, dispose or none.
 */
export function launcherAction({ signedOut, foreignEntry, registered }: LauncherState): LauncherAction {
  const want = signedOut && !foreignEntry
  if (want) return registered ? 'none' : 'register'
  return registered ? 'dispose' : 'none'
}
