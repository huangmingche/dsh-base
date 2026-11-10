/** Official-shaped anonymous account launcher; signed-in owners keep the official menu. */
import { useRef, useState } from 'react'
import {
  Menu, MenuItemButton, IconEllipsisOutlineMedium, IconSettingsOutlineMedium, IconPaperPlaneOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import css from '@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.module.css'
import { requestLogin } from '@dsh-base/client-auth-login/request'
import { AnonymousSettingsPanel, type AnonymousSettingsPanelConfig } from './AnonymousSettingsPanel.tsx'

/** Business face supplied by the plugin registration. */
export interface AnonymousLauncherInjected {
  /** Localized "available after sign-in" reason for disabled menu rows and settings. */
  readonly unavailableReason: () => string
  /** Active locale id, forwarded to the login document. */
  readonly activeLocale: () => string
  /** Anonymous settings panel configuration (official shell + rows). */
  readonly settingsPanel: AnonymousSettingsPanelConfig
}

/** Composed props for the `sidebar.settings` occupant. */
export type AnonymousLauncherProps = PropsRuntime<'sidebar.settings'> & PropsLocale<'settings.account'> & InjectFace<AnonymousLauncherInjected>

/**
 * Render the official signed-out More row, its three-row menu and the
 * anonymous settings panel.
 * @param props - sidebar geometry, official labels and the plugin business face.
 * @returns the slot occupant.
 */
export function AnonymousLauncher({ wide, t, unavailableReason, activeLocale, settingsPanel }: AnonymousLauncherProps) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const reason = unavailableReason()
  const signIn = (): void => {
    setOpen(false);
    requestAnimationFrame(() => { trigger.current?.focus({ preventScroll: true }); requestLogin() })
  }
  // The one settings click point: the menu closes and the panel owns the rest.
  const openSettings = (): void => { setOpen(false); setSettingsOpen(true) }
  const closeSettings = (): void => {
    setSettingsOpen(false)
    // Return focus to the launcher once the modal layer releases it.
    requestAnimationFrame(() => { trigger.current?.focus() })
  }
  return <div className={css.root} data-inset={false}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={css.signedOutMenu}
      onClose={() => { setOpen(false) }}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out="true"
        aria-haspopup="menu" aria-expanded={open} aria-label={t('menu')}
        onClick={() => { setOpen(value => !value) }}>
        <IconEllipsisOutlineMedium size={14} />
        {wide && <span className={css.label}>{t('more')}</span>}
      </button>}>
      <MenuItemButton icon={<IconSettingsOutlineMedium size={16} />}
        onSelect={openSettings}>{t('settings')}</MenuItemButton>
      <MenuItemButton disabled disabledReason={reason} icon={<IconPaperPlaneOutlineMedium size={16} />}
        onSelect={() => undefined}>{t('contactUs')}</MenuItemButton>
      <MenuItemButton icon={<IconUserOutlineMedium size={16} />} onSelect={signIn}>{t('signIn')}</MenuItemButton>
    </Menu>
    <AnonymousSettingsPanel open={settingsOpen} onClose={closeSettings} config={settingsPanel} />
  </div>
}
