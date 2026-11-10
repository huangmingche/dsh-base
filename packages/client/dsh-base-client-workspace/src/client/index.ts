import { requestLogin } from '@dsh-base/client-auth-login/request'
import { createNavigationView } from '@dsh-base/client-session-adapter/navigation-access'
import { navigationAllowed, navigationSource, requireNavigation } from './access.ts'
// Shared service/slot declarations retain the official package identity.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IconEditOutlineRegular, IconTrashOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, IconUnarchiveOutlineRegular, IconArchiveOutlineRegular, IconBranchOutlineRegular, IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionMenu } from './session-actions/SessionMenu.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook, and each declares its
 * own `single` directory-flow child hole for the composed picker package's
 * client half. WorkspaceBrowser additionally declares the two Session row
 * action lists. Built-in Session menu actions contribute structured data to
 * ctx.contextMenus, while external React entries retain the legacy Slot. Dialogs and
 * the row-action notice register in `shell.overlay` (see the contract module doc). It also declares two
 * Session-row seats: the leading decoration a row renders only while its own
 * primary state is idle, and the section the row's hover card renders between
 * its relative time and its trailing status line. Export discipline:
 * packages/client/AGENTS.md.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionForkError } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, SessionActivity, WorkspaceArchiveError, WorkspaceId, WorkspaceSnapshot,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteEndpoint } from '@deepseek-ai/dsh-api-remote-access/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Session root standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  type ArchiveSessionInjected, type ForkSessionInjected, menuOpenStateFactory, type PinSessionInjected,
  type SessionArchiveConfirmInjected, type SessionArchiveConfirmRequest,
  type RenameSessionInjected, type RowToast, type RowToastInjected, type RowToastState, type SessionRenameDialogInjected,
  type WorkspaceActionRequest, type SessionIdInjected, type WorkspaceBrowserInjected, type WorkspacePickerInjected,
} from './contract/slots.ts'
import { createWorkspaceShortcutControls, installWorkspaceShortcuts } from './shortcuts.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import { ArchiveSessionRowButton, SessionArchiveConfirmDialog } from './session-actions/ArchiveSession.tsx'
import { derive } from './session-actions/derived.ts'
import { registerSessionMenus } from './session-actions/context-menus.tsx'
import { PinSessionRowButton } from './session-actions/PinSession.tsx'
import { SessionRenameDialog } from './session-actions/RenameSession.tsx'
import { RowActionToast } from './session-actions/RowActionToast.tsx'
import { registerToasts } from './toast/register.ts'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type WorkspaceKey } from './locales.ts'

export type { StartSessionOptions, UiWorkspace } from './navigation.ts'
export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  MenuOpenState, RowToast, SessionRenameTarget, SessionRowOwnerProps, UseMenuOpenState, WorkspaceBrowserInjected,
  SessionRowScheduleOwnerProps,
  WorkspaceBrowserProps,
  WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'





/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = ['contextMenus',
  'navigationAccess', 'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts', 'remoteAccess',
]

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const access = ctx.navigationAccess
  const availability = createNavigationView(access, ctx.locale)
  const allowed = () => navigationAllowed(access)
  // Public controls remain reachable; account-bound work starts only after sign-in.
  const accountAction = (action: () => void): void => {
    if (access.getSnapshot() === 'anonymous') requestLogin()
    else if (allowed()) action()
  }
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  // One viewing-store instance, created here as ui-layout does for its layout
  // store: the browser declares the handle, and the UiWorkspace service writes
  // view order through the same instance the renderer hands the browser.
  const viewHandle = createWorkspaceViewStore()
  const viewInstance = viewHandle.create()
  const viewStore: typeof viewHandle = { ...viewHandle, create: () => viewInstance }
  const rowToast = createSnapshotStore<RowToastState | null>(null)
  let toastSeq = 0
  const notify = (toast: RowToast): void => { if (allowed()) rowToast.set({ ...toast, seq: ++toastSeq }) }
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions, viewInstance.actions, notify,
  )
  const visibleWorkspaces = navigationSource<WorkspaceSnapshot>(access, workspaces.list, {
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'pending', error: null,
  })
  ctx.slots.provideRoot({
    hooks: { workspaces: visibleWorkspaces },
    keyedHooks: {
      workspaceAccess: (workspaceId, action) => action === undefined
        ? undefined
        : navigationSource(access, ctx.remoteAccess.source('workspace', workspaceId, action), false),
    },
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-workspace: dictionaries')
  const shortcutControls = createWorkspaceShortcutControls(allowed)

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    requireNavigation(access)
    const result = await sessions.search(query, signal)
    requireNavigation(access)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const openSession: WorkspaceBrowserInjected['open'] = (sessionId) => {
    uiWorkspace.openSession(sessionId)
  }
  // Registry-global sets as Sets, rebuilt only when the Workspace snapshot changes.
  const pinnedSet = derive(visibleWorkspaces, snapshot => new Set<SessionId>(snapshot.pinnedSessionIds))
  const archivedSet = derive(visibleWorkspaces, snapshot => new Set<SessionId>(snapshot.archivedSessionIds))
  // Plugin-private facts the row actions and their overlay surfaces share:
  // the pending rename request and the notice on display. Each business
  // writes through its own injected callback and the surface reads through
  // its bound hook.
  const renameRequest = derive(shortcutControls.state, state => state.renameTarget)
  const archiveRequest = createSnapshotStore<SessionArchiveConfirmRequest | null>(null)
  const requestSessionRename = shortcutControls.rename
  const unarchiveSession = (sessionId: SessionId): void => {
    uiWorkspace.unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }
  const renameSession: SessionRenameDialogInjected['renameSession'] = async (sessionId, title) => {
    requireNavigation(access)
    const result = await sessions.using(
      sessionId,
      { source: 'workspaceOperation' },
      reference => { requireNavigation(access); return reference.binding.session.rename(title) },
    )
    if (!result.ok) throw new Error(result.error.message)
  }
  const pinInjected = (): PinSessionInjected => ({
    hooks: { pinned: pinnedSet, archived: archivedSet },
    // Pin failures surface as a notice: nothing else on the surface moves, so
    // a silent failure would read as a dead action.
    pinSession: (sessionId) => {
      uiWorkspace.pinSession(sessionId).catch(() => { notify({ kind: 'pinFailed' }) })
    },
    unpinSession: (sessionId) => {
      uiWorkspace.unpinSession(sessionId).catch(() => { notify({ kind: 'unpinFailed' }) })
    },
  })
  const archiveInjected = (): ArchiveSessionInjected => ({
    hooks: { archived: archivedSet },
    // Archive preserves the log and the account position, so a quiet Session
    // needs no confirmation; the notice offers undo and the archived filter.
    // The Host's refusal for running work is the one case that asks first:
    // the confirmation names that work and offers to stop it.
    archiveSession: (sessionId) => {
      uiWorkspace.archiveSession(sessionId).then(() => {
        notify({ kind: 'archived', sessionId })
      }).catch((reason: unknown) => {
        if (!allowed()) return
        const activity = activeSessionRefusal(reason)
        if (activity === undefined) {
          console.warn('session archive rejected:', reason)
          return
        }
        const displayTitle = sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? sessionId
        archiveRequest.set({ sessionId, displayTitle, activity })
      })
    },
    unarchiveSession,
  })
  installWorkspaceShortcuts(ctx, uiWorkspace, shortcutControls, archiveInjected().archiveSession,
    (reason) => { notify({ kind: 'shortcutForkFailed', reason }) })
  const archiveConfirmInjected = (): SessionArchiveConfirmInjected => ({
    hooks: { archiveRequest },
    settleSessionArchive: () => { archiveRequest.set(null) },
    stopAndArchiveSession: async (sessionId) => {
      await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      notify({ kind: 'stoppedAndArchived', sessionId })
    },
  })
  const forkInjected = (): ForkSessionInjected => ({
    forkSession: (sessionId) => {
      uiWorkspace.forkSession(sessionId, (childId) => {
        ctx.get('productAnalytics')?.track('branch_session_click', { session_id: childId, parent_session_id: sessionId, click_position: 'sidebar' })
      }, { allowMigration: false }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'SessionForkError'
          && (error as SessionForkError).rpcError.code === 'session/migration-required') {
          notify({ kind: 'forkRequiresOpen', sessionId })
        }
      })
    },
  })
  const sessionIdInjected = (): SessionIdInjected => ({
    copySessionId: async (sessionId) => {
      requireNavigation(access)
      const copied = await writeClipboard(sessionId)
      notify({ kind: copied ? 'sessionIdCopied' : 'sessionIdCopyFailed' })
    },
  })
  const renameInjected = (): RenameSessionInjected => ({ requestSessionRename })
  const renameDialogInjected = (): SessionRenameDialogInjected => ({
    hooks: { renameRequest },
    settleSessionRename: shortcutControls.closeRename,
    renameSession,
  })
  const toastActions = {
    undoArchive: unarchiveSession,
    showArchived: () => { if (allowed()) viewInstance.actions.setArchivedFilter('show') },
    openForkSource: (sessionId: SessionId) => {
      if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
        notify({ kind: 'archivedNotOpenable' })
        return
      }
      openSession(sessionId)
    },
  }
  registerToasts(ctx, viewStore, toastActions)
  const rowToastInjected = (): Pick<RowToastInjected, 'hooks' | 'dismissToast'> => ({
    hooks: { toast: rowToast },
    dismissToast: () => { rowToast.set(null) },
  })
  const workspaceActionRequest = createSnapshotStore<WorkspaceActionRequest | null>(null)
  const requestWorkspaceAction = (workspaceId: WorkspaceId, displayTitle: string, action: 'rename' | 'delete'): void => {
    if (!allowed()) return
    const workspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === workspaceId)
    if (workspace === undefined || !ctx.remoteAccess.source('workspace', workspaceId, `workspace/${action}`).getSnapshot()) return
    workspaceActionRequest.set({ action, workspaceId, displayTitle, storedTitle: workspace.title })
  }
  ctx.slots.inject('contextMenu.icon', function* () {
    for (const [key, Icon] of Object.entries({
      'workspace.rename': IconEditOutlineRegular, 'workspace.delete': IconTrashOutlineRegular,
      'workspace.pin': IconPinOutlineRegular, 'workspace.unpin': IconPinFillRegular,
      'workspace.archive': IconArchiveOutlineRegular, 'workspace.unarchive': IconUnarchiveOutlineRegular,
      'workspace.fork': IconBranchOutlineRegular, 'workspace.copy': IconCopyOutlineRegular,
    })) yield ctx.slots.register({ name: 'contextMenu.icon', key }, Icon)
  })
  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace.rename', target: 'workspace', order: 100,
    resolve: ({ workspaceId, displayTitle }) => allowed() && ctx.remoteAccess.source('workspace', workspaceId, 'workspace/rename').getSnapshot()
      ? [{ id: 'rename', label: ctx.locale.bind(NS)('rename'), icon: { key: 'workspace.rename' }, run: () => { requestWorkspaceAction(workspaceId, displayTitle, 'rename') } }] : [],
  }), 'workspace: rename menu action')
  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace.delete', target: 'workspace', order: 300,
    resolve: ({ workspaceId, displayTitle }) => allowed() && ctx.remoteAccess.source('workspace', workspaceId, 'workspace/delete').getSnapshot()
      ? [{ id: 'delete', label: ctx.locale.bind(NS)('delete.workspace'), icon: { key: 'workspace.delete' }, danger: true, separatorBefore: true,
        run: () => { requestWorkspaceAction(workspaceId, displayTitle, 'delete') } }] : [],
  }), 'workspace: delete menu action')
  ctx.effect(() => access.subscribe(() => {
    if (allowed()) return
    shortcutControls.closeAdd()
    shortcutControls.closeRename()
    shortcutControls.directoryBusy(false)
    archiveRequest.set(null)
    workspaceActionRequest.set(null)
    rowToast.set(null)
    ctx.contextMenus.close()
  }), 'dsh-base: withdraw unavailable workspace actions')
  const browserInjected = (): WorkspaceBrowserInjected => ({
    openWorkspaceMenu: (workspaceId, path, displayTitle, point, mode) => {
      if (!allowed()) return
      const target = ctx.contextMenus.active.getSnapshot()
      if (mode === 'toggle' && target?.kind === 'workspace' && target.value.workspaceId === workspaceId) ctx.contextMenus.close()
      else ctx.contextMenus.open({ kind: 'workspace', value: { workspaceId, path, displayTitle } }, point)
    },
    settleWorkspaceAction: () => { workspaceActionRequest.set(null) },
    openSessionMenu: (sessionId, displayTitle, point, mode) => {
      if (!allowed()) return
      const target = ctx.contextMenus.active.getSnapshot()
      if (mode === 'toggle' && target?.kind === 'session' && target.value.sessionId === sessionId) ctx.contextMenus.close()
      else ctx.contextMenus.open({ kind: 'session', value: { sessionId, displayTitle } }, point)
    },
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId, options) => { uiWorkspace.startSession(workspaceId, options) },
    open: openSession,
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    requestSessionRename,
    notifyArchivedNotOpenable: () => { notify({ kind: 'archivedNotOpenable' }) },
    renameWorkspace: async (workspaceId, title) => { requireNavigation(access); await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { requireNavigation(access); await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      requireNavigation(access)
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    unarchiveSession: async (sessionId) => { await uiWorkspace.unarchiveSession(sessionId) },
    createWorkspace: async input => { requireNavigation(access); const created = await workspaces.create(input); requireNavigation(access); return created },
    requestSearch: () => accountAction(shortcutControls.search),
    requestAddWorkspace: () => accountAction(shortcutControls.add),
    closeAddWorkspace: shortcutControls.closeAdd,
    setDirectoryBusy: shortcutControls.directoryBusy,
    hooks: { navigationAccess: availability, workspaceActionRequest, contextMenuTarget: ctx.contextMenus.active, directoryFlow: browserFlowSource, hostInfo,
      workspaceShortcuts: shortcutControls.state, shortcuts: ctx.shortcuts.catalog },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: async input => { requireNavigation(access); const created = await workspaces.create(input); requireNavigation(access); return created },
    hooks: { directoryFlow: pickerFlowSource, navigationAccess: availability },
  })
  // Each registration declares its owned children in the same call; slot
  // injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: {
        'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
        'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
        'sidebar.session.row.leading': { kind: 'list', scope: 'root', inline: true },
        'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
        'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
      },
      store: viewStore,
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('contextMenu.content', () => ctx.slots.register({
    name: 'contextMenu.content', key: 'session',
    children: { 'sidebar.workspaces.session.menu.item': {
      kind: 'list', scope: 'root', inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: ctx.shortcuts.catalog } },
    } },
  }, SessionMenu))
  registerSessionMenus(ctx, {
    ...pinInjected(), ...archiveInjected(), ...renameInjected(), ...forkInjected(), ...sessionIdInjected(),
  })
  ctx.slots.inject('sidebar.workspaces.session.row.action', function* () {
    yield ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'archive', order: 100, locale: NS, inject: archiveInjected }, ArchiveSessionRowButton)
    yield ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'pin', order: 200, locale: NS, inject: pinInjected }, PinSessionRowButton)
  })
  // The surfaces the actions raise live in the frame-wide layer: they must
  // outlive the row menu the action sat in.
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({
      name: 'shell.overlay', id: 'workspace.session-rename', locale: NS, inject: renameDialogInjected,
    }, SessionRenameDialog)
    yield ctx.slots.register({
      name: 'shell.overlay', id: 'workspace.session-archive', locale: NS, inject: archiveConfirmInjected,
    }, SessionArchiveConfirmDialog)
    yield ctx.slots.register({
      name: 'shell.overlay', id: 'workspace.row-toast', inject: rowToastInjected,
      children: { 'workspace.toast': { kind: 'keyed', scope: 'root' } },
    }, RowActionToast)
  })
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}

/**
 * The activity a Host `workspace/session-active` refusal reported, or nothing
 * for any other failure. The class identity check goes by name: client plugin
 * bundles do not share error-class identity.
 */
function activeSessionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const { rpcError } = reason as WorkspaceArchiveError
  return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
}
