/** Anonymous launcher rows: same order and ids as the official Menu. */

/** Row ids mirror the official `AccountMenu` items. */
export type LauncherItemId = 'settings' | 'contact' | 'signin'

/** Visible state of one anonymous launcher row. */
export interface LauncherItemState {
  readonly id: LauncherItemId
  readonly disabled: boolean
}

/**
 * The anonymous menu exposes three official-shaped rows. Settings opens the
 * anonymous panel (language / appearance / font preferences only); feedback
 * stays disabled until the external form is cleared by legal.
 * @returns rows in official order with their disabled state.
 */
export function launcherItemStates(): readonly LauncherItemState[] {
  return [
    { id: 'settings', disabled: false },
    { id: 'contact', disabled: true },
    { id: 'signin', disabled: false },
  ]
}
