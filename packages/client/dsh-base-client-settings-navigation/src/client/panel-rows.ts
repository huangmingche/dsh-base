/**
 * Nav-row state shared by the official settings shell and the anonymous panel.
 *
 * Official registrations never set `disabled`, so the projection below returns
 * an all-empty state for them and their cells keep the exact attributes and
 * activation path they had before the anonymous-panel extension.
 */
import type { SettingsSectionRow } from './shell-contract.ts'

/** Projected cell state for one nav row. */
export interface SettingsSectionNavState {
  /** True only when the row opts into the anonymous-panel extension. */
  readonly disabled: boolean
  /** Localized reason; only meaningful while `disabled` is true. */
  readonly disabledReason: string | undefined
}

/**
 * Derive the nav-cell disabled state.
 * @param row - projected settings section row.
 * @returns disabled flag and the optional reason.
 */
export function sectionNavState(row: SettingsSectionRow): SettingsSectionNavState {
  const disabled = row.disabled === true
  return { disabled, disabledReason: disabled ? row.disabledReason : undefined }
}
