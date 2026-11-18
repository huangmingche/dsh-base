/** Folded Conversation Views, plugin discovery while reachable, and creation. */
import {
  Button, IconCheckOutlineRegular, IconPinOutlineRegular, IconPluginPinwheelOutlineRegular, IconPlusOutlineRegular, MenuItemButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
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
  & PropsRenderFactories & PropsLocale<'entryCustomization'> & Omit<InjectFace<EntryMenuInjected>, 'useNavigationAccess' | 'unavailableReason'>
  & { readonly useNavigationAccess?: SnapshotSelectorHook<NavigationAvailability>; readonly unavailableReason?: () => string }

/**
 * Render unpinned sidebar entries or folded Conversation Views, followed by discovery and Creator actions.
 * @param props - Owner dismissal callback, injected actions, and localized copy.
 * @returns Menu rows for the region's More menu.
 */
export function EntryMenuContent({
  entries, onOpen, onPinnedChange, region, onDismiss, usePluginNavigation, useNavigationAccess, unavailableReason, browsePlugins, createPlugin, t, renderFactorySlot,
}: EntryMenuContentProps) {
  const moreEntries = region === 'sidebar' ? entries.filter(entry => !entry.pinned) : region === 'conversation' ? entries : []
  const hasPluginNavigation = usePluginNavigation(present => present)
  const navigation = useNavigationAccess?.(state => state)
  const restricted = navigation !== undefined && !navigation.allowed && navigation.state !== 'anonymous'
  const browsable = hasPluginNavigation || navigation !== undefined
  const reason = navigation?.reason || unavailableReason?.()
  return <>
    {moreEntries.map(entry => <div key={entry.id} className={region === 'sidebar' ? css.sidebarEntry : undefined}>
      <MenuItemButton current={entry.active === true} icon={region === 'sidebar' ? (
        <span className={css.entryIcon} aria-hidden="true">
          {renderFactorySlot('sidebar.panel.icon', { id: entry.id, size: 16, active: entry.active === true })}
        </span>
      ) : undefined}
      disabled={restricted} disabledReason={restricted ? reason : undefined}
      onSelect={() => { onDismiss(); onOpen(entry.id) }}>
        <span className={css.entryName}>
          <span className={css.entryTitle}>{entry.label}</span>
          {entry.active === true && <IconCheckOutlineRegular size={16} className={css.activeMark} />}
        </span>
      </MenuItemButton>
      {region === 'sidebar' && <span className={css.pinAnchor}>
        <Tooltip label={t('pinTooltip')} side="bottom" align="end" delayMs={500} portal>
          <Button size="sm" role="menuitem" className={css.pinButton} aria-label={t('pin', { name: entry.label })}
            onClick={() => { onDismiss(); onPinnedChange(entry.id, true) }}>
            <IconPinOutlineRegular size={14} />
          </Button>
        </Tooltip>
      </span>}
    </div>)}
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
