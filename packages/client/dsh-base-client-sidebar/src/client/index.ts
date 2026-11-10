/** Registers the sidebar shell and global panel navigation. */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from './contract/slots.ts'
import { createPanelPins } from './panel-pins.ts'
import { HeaderLeadingControls } from './HeaderLeadingControls.tsx'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'
import { requestLogin } from '@dsh-base/client-auth-login/request'
import { createNavigationView, navigationUnavailableReason } from '@dsh-base/client-session-adapter/navigation-access'
import { PluginsPanelIcon } from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/PluginsPanelIcon.tsx'
import { TaskManagerIcon } from '@deepseek-ai/dsh-client-ui-schedule/src/client/TaskManagerIcon.tsx'
import * as pluginCopy from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts'
import * as scheduleCopy from '@deepseek-ai/dsh-client-ui-schedule/src/client/task-manager-locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarPanelActionEntry, SidebarPanelActionsOwnerProps, SidebarPanelIconOwnerProps, SidebarPanelMetadata,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

// Public namespace and slot type identities remain owned by the official package.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(workspaceId?: Parameters<SidebarRootInjected['startSession']>[0]): void
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'shortcuts', 'navigationAccess']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  const navigationAccess = createNavigationView(ctx.navigationAccess, ctx.locale)
  const authenticated = (): boolean => ctx.navigationAccess.getSnapshot() === 'authenticated'
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-sidebar: dictionaries')
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const syncPanels = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options, component }) => {
      // The list registration requires an id; StoredEntry erases the slot kind.
      const id = options.id as MainPanelId
      const unavailable = options.priority === 1 && (component === PluginsPanelIcon || component === TaskManagerIcon)
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id, ...(unavailable ? { unavailable: true } : {}) }
    }).sort((a, b) => a.order - b.order)
    const previous = panels.getSnapshot()
    if (previous.length === next.length && previous.every((panel, index) => {
      const candidate = next[index] as SidebarPanelMetadata
      return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label && panel.unavailable === candidate.unavailable
    })) return
    panels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'ui-sidebar: panel entries')
  ctx.effect(() => ctx.locale.subscribe(syncPanels), 'ui-sidebar: panel labels')
  const panelPins = createPanelPins()
  const entryActions = {
    getSnapshot: () => ctx.slots.entriesOfSlot('sidebar.panellist.actions').length > 0,
    subscribe: (listener: () => void) => ctx.slots.subscribe('sidebar.panellist.actions', listener),
  }

  const injectProps = () => ({
    // The shell's New Session button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId?: Parameters<SidebarRootInjected['startSession']>[0]) => {
      if (ctx.navigationAccess.getSnapshot() === 'anonymous') requestLogin()
      else if (authenticated()) workspaceNavigation.startSession(workspaceId)
    },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    selectPanel: (id: MainPanelId) => {
      if (panels.getSnapshot().some(panel => panel.id === id && !panel.unavailable)) ctx.layout.selectPanel(id)
    },
    setPinned: panelPins.setPinned,
    trackEntryClick: (attributes: Parameters<SidebarRootInjected['trackEntryClick']>[0]) => { ctx.get('productAnalytics')?.track('sidebar_menu_click', attributes) },
    unavailableReason: () => navigationUnavailableReason(ctx.locale.getSnapshot().active),
    hooks: { panels, shortcuts: ctx.shortcuts.catalog, entryPins: panelPins.unpinned, entryActions, navigationAccess },
  })
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
    inject: injectProps,
  }, SidebarRoot))
  // macOS desktop hides the collapsed sidebar entirely, so the open/New
  // Session controls move into the frame's window-chrome seat beside the
  // traffic lights; the occupant reuses the shell's injected actions, and
  // the AppFrame mounts the seat only while the column is fully hidden.
  ctx.slots.inject('shell.leading', () => ctx.slots.register({
    name: 'shell.leading',
    locale: NS,
    inject: injectProps,
  }, HeaderLeadingControls))
  // Public declarations retain the official entries while their private panels
  // are unavailable. A real, permission-gated priority-0 entry always wins.
  ctx.slots.inject('sidebar.panellist', function* () {
    const language = (): keyof Pick<typeof pluginCopy, 'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt'> => {
      const active = ctx.locale.getSnapshot().active
      return active in pluginCopy ? active as ReturnType<typeof language> : 'en'
    }
    yield ctx.slots.register({ name: 'sidebar.panellist', id: 'plugins' as MainPanelId, order: 0, priority: 1,
      label: () => pluginCopy[language()].panel }, PluginsPanelIcon)
    yield ctx.slots.register({ name: 'sidebar.panellist', id: 'schedules' as MainPanelId, order: 10, priority: 1,
      label: () => scheduleCopy[language()].panel }, TaskManagerIcon)
  })
  syncPanels()
}
