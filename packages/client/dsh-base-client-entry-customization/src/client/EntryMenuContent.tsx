/** Folded Conversation Views, plugin discovery while reachable, and creation. */
import {
  IconCheckOutlineRegular, IconPluginPinwheelOutlineRegular, IconPlusOutlineRegular, MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { NavigationAvailability } from '@dsh-base/client-session-adapter/navigation-access'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './EntryMenu.module.css'

/** Navigation region whose More menu hosts one registration. */
export type EntryRegion = 'sidebar' | 'conversation' | 'rightbar'

/** Region identity and footer actions injected into each registration. */
export interface EntryMenuInjected {
  /** Region of this registration; selects analytics attributes and the Creator prompt. */
  readonly region: EntryRegion
  readonly hooks: {
    /** Whether the Plugins page navigation service is present; the discovery row shows only while it is. */
    readonly pluginNavigation: HostObservable<boolean>
    readonly navigationAccess: HostObservable<NavigationAvailability>
  }
  /** Open the Plugins main list. */
  readonly browsePlugins: () => void
  /** Start a Creator draft with this region's prompt without sending it. */
  readonly createPlugin: () => void
  readonly unavailableReason: () => string
}

// The three region owners declare the same fields; the sidebar's slot names them.
export type EntryMenuContentProps = PropsRuntime<'sidebar.panellist.actions'>
  & PropsLocale<'entryCustomization'> & Omit<InjectFace<EntryMenuInjected>, 'useNavigationAccess' | 'unavailableReason'>
  & { readonly useNavigationAccess?: SnapshotSelectorHook<NavigationAvailability>; readonly unavailableReason?: () => string }

/**
 * Render folded Conversation Views followed by discovery and Creator actions, without pin controls.
 * @param props - Owner dismissal callback, injected actions, and localized copy.
 * @returns Menu rows for the region's More menu.
 */
export function EntryMenuContent({
  entries, onOpen, region, onDismiss, usePluginNavigation, useNavigationAccess, unavailableReason, browsePlugins, createPlugin, t,
}: EntryMenuContentProps) {
  const moreEntries = region === 'conversation' ? entries : []
  const hasPluginNavigation = usePluginNavigation(present => present)
  const navigation = useNavigationAccess?.(state => state)
  const restricted = navigation !== undefined && !navigation.allowed && navigation.state !== 'anonymous'
  const browsable = hasPluginNavigation || navigation !== undefined
  const reason = navigation?.reason || unavailableReason?.()
  return <>
    {moreEntries.map(entry => <MenuItemButton key={entry.id} current={entry.active === true}
      disabled={restricted} disabledReason={restricted ? reason : undefined}
      onSelect={() => { onDismiss(); onOpen(entry.id) }}>
      <span className={css.entryName}>
        <span className={css.entryTitle}>{entry.label}</span>
        {entry.active === true && <IconCheckOutlineRegular size={16} className={css.activeMark} />}
      </span>
    </MenuItemButton>)}
    {browsable && <MenuItemButton separatorBefore={moreEntries.length > 0} icon={<IconPluginPinwheelOutlineRegular size={16} />}
      disabled={restricted || !hasPluginNavigation} disabledReason={restricted || !hasPluginNavigation ? reason : undefined}
      onSelect={() => { onDismiss(); browsePlugins() }}>
      {t('install')}
    </MenuItemButton>}
    <MenuItemButton icon={<IconPlusOutlineRegular size={16} />} separatorBefore={!browsable && moreEntries.length > 0}
      disabled={restricted} disabledReason={restricted ? reason : undefined}
      onSelect={() => {
        onDismiss()
        // Let the official Menu restore its persistent trigger before the login
        // dialog captures focus; the selected menu row is about to unmount.
        if (navigation?.state === 'anonymous') requestAnimationFrame(() => { createPlugin() })
        else createPlugin()
      }}>
      {t('create')}
    </MenuItemButton>
  </>
}
