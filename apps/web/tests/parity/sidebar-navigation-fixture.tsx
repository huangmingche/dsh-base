/** Official SidebarRoot and marked fork, selected through their real slot registrations. */
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { apply as officialSidebar } from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { apply as officialEntries } from '@deepseek-ai/dsh-client-ui-entry-customization/client';
import { IconClockOutlineRegular, IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { AccountMenu } from '@deepseek-ai/dsh-client-ui-settings-account/src/client/AccountMenu.tsx';
import * as commonCopy from '@deepseek-ai/dsh-client-locale/src/locales/index.ts';
import * as accountCopy from '@deepseek-ai/dsh-client-ui-settings-account/src/client/locales.ts';
import * as pluginCopy from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/locales.ts';
import * as scheduleCopy from '@deepseek-ai/dsh-client-ui-schedule/src/client/task-manager-locales.ts';
import * as workspaceCopy from '@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts';
import { WorkspaceBrowser as OfficialWorkspaceBrowser } from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/WorkspaceBrowser.tsx';
import { createWorkspaceViewStore } from '@deepseek-ai/dsh-client-ui-workspace/src/client/stores.ts';
import { createWorkspaceShortcutControls } from '@deepseek-ai/dsh-client-ui-workspace/src/client/shortcuts.ts';
import { apply as adaptedSidebar } from '../../../../packages/client/dsh-base-client-sidebar/src/client/index.ts';
import { apply as adaptedEntries } from '../../../../packages/client/dsh-base-client-entry-customization/src/client/index.ts';
import { WorkspaceBrowser as AdaptedWorkspaceBrowser } from '../../../../packages/client/dsh-base-client-workspace/src/client/rows/WorkspaceBrowser.tsx';
import { createNavigationView } from '../../../../packages/client/dsh-base-client-session-adapter/src/client/navigation-access.ts';

type Language = 'en' | 'zh';
const watch = (source: any, select: (value: any) => any) => select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));

export function SidebarNavigationFixture({ locale, adapted }: { locale: Language; adapted: boolean }) {
  const query = new URLSearchParams(location.search);
  const mode = query.get('mode') ?? 'wide', scheme = query.get('scheme') ?? 'light';
  document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark');
  document.documentElement.style.colorScheme = scheme;
  const [collapsed, setCollapsed] = useState(mode === 'collapsed');
  const setup = useMemo(() => {
    const ctx = new Context(), calls: string[] = [];
    const dictionaries = new Map<string, any>([['common', commonCopy], ['settings.account', accountCopy], ['workspace', workspaceCopy]]);
    const localeStore = createSnapshotStore({ active: locale, revision: 1 });
    const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>();
    const bind = (namespace: string) => {
      if (!translators.has(namespace)) translators.set(namespace, (key: string, values: Record<string, unknown> = {}) =>
        String(dictionaries.get(namespace)?.[locale]?.[key] ?? (commonCopy as any)[locale]?.[key] ?? key).replace(/\{([^}]+)\}/gu, (_, token) => String(values[token] ?? '')));
      return translators.get(namespace)!;
    };
    ctx.provide('locale', { ...localeStore, bind, register: (namespace: string, data: any) => { dictionaries.set(namespace, data); return () => dictionaries.delete(namespace); } } as never);
    const navigationAccess = createSnapshotStore('authenticated');
    ctx.provide('navigationAccess', navigationAccess as never);
    const panelInfo = createSnapshotStore({ activePanelId: null });
    ctx.provide('layout', { panelInfo, toggleSidebar: () => setCollapsed(value => !value), selectPanel: (id: string) => { calls.push(`panel:${id}`); panelInfo.set({ activePanelId: id } as never); } } as never);
    ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never);
    ctx.provide('uiWorkspace', { startSession: (_id: unknown, options: unknown) => { calls.push(options ? 'plugin:create' : 'session:new'); } } as never);
    ctx.provide('pluginNavigation', { openList: () => calls.push('plugin:browse') } as never);
    new SlotRegistry(ctx); const slots = ctx.get('slots')!;
    slots.register({ name: 'root', children: { sidebar: { kind: 'single', scope: 'root' }, 'shell.leading': { kind: 'single', scope: 'root' } } } as never, (() => null) as never);
    (adapted ? adaptedSidebar : officialSidebar)(ctx);
    slots.register({ name: 'sidebar.panellist', id: 'plugins', order: 0, label: () => pluginCopy[locale].panel } as never, (({ size }: { size: number }) => <IconPluginPinwheelOutlineRegular size={size} />) as never);
    slots.register({ name: 'sidebar.panellist', id: 'schedules', order: 10, label: () => scheduleCopy[locale].panel } as never, (({ size }: { size: number }) => <IconClockOutlineRegular size={size} />) as never);
    (adapted ? adaptedEntries : officialEntries)(ctx);
    const workspaceStore = createWorkspaceViewStore().create(), controls = createWorkspaceShortcutControls();
    const availability = createNavigationView(navigationAccess as never, localeStore);
    const WorkspaceBrowser = adapted ? AdaptedWorkspaceBrowser : OfficialWorkspaceBrowser;
    const emptyShortcuts: unknown[] = [], sessionState = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} };
    const workspaceState = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null };
    const sessionStatus = new Map(), hostInfo = { home: '/', isLoopback: false };
    const workspaceProps: any = {
      useWorkspaceActionRequest: (select: any) => select(null), useContextMenuTarget: (select: any) => select(null),
      useShortcuts: (select: any) => select(emptyShortcuts), useWorkspaceShortcuts: (select: any) => watch(controls.state, select),
      useSessions: (select: any) => select(sessionState),
      useSessionStatus: (select: any) => select(sessionStatus), useSessionRetainInfo: () => undefined,
      useContextMenu: () => ({}), useResource: () => ({ status: 'none', value: undefined }),
      useWorkspaces: (select: any) => select(workspaceState),
      useStore: (select: any) => watch(workspaceStore, select), actions: workspaceStore.actions,
      useSessionAccess: () => true, useWorkspaceAccess: () => true,
      useDirectoryFlow: (select: any) => select(true), useHostInfo: (select: any) => select(hostInfo),
      useNavigationAccess: (select: any) => watch(availability, select),
      requestSearch: controls.search, requestAddWorkspace: controls.add, closeAddWorkspace: controls.closeAdd,
      setDirectoryBusy: controls.directoryBusy, requestSessionRename: controls.rename,
      startSession: () => calls.push('workspace:new'), open: () => calls.push('workspace:open'),
      searchSessions: async () => ({ items: [], hasMore: false }), searchResultLimit: 20,
      createWorkspace: async () => { throw new Error('fixture must not create a workspace'); },
      openWorkspaceMenu: () => {}, openSessionMenu: () => {}, settleWorkspaceAction: () => {},
      notifyArchivedNotOpenable: () => {}, renameWorkspace: async () => {}, deleteWorkspace: async () => {},
      unarchiveSession: async () => {}, insertWorkspaceBefore: async () => {},
    };
    slots.register({ name: 'sidebar.workspaces', locale: 'workspace' } as never,
      ((props: any) => <WorkspaceBrowser {...workspaceProps} {...props} />) as never);
    // The account child is identical; actual anonymous account composition is
    // covered by the real Worker acceptance instead of this signed-in fixture.
    const account = { view: { status: 'credential-stored' }, details: { profile: { status: 'ready', value: { name: 'Local User' } } } };
    slots.register({ name: 'sidebar.settings', locale: 'settings.account' } as never, ((props: any) => <AccountMenu {...props}
      useAccount={(select: any) => select(account)} useTheme={(select: any) => select({ active: { colorScheme: scheme } })}
      settingsOpen={false} openSettings={() => calls.push('settings:open')} refreshAccount={async () => {}}
      contactUs={() => calls.push('feedback:open')} hasRunningAccountTasks={async () => false} avatarFailed={() => {}}
      start={async () => {}} cancel={async () => {}} signOut={async () => {}} showLogin={() => {}}
      openOnboarding={() => {}} bonusNoticeShown={() => {}} bonusNoticeDismissed={() => {}} />) as never);
    const registration = slots.entriesOfSlot('sidebar')[0]!;
    (window as any).__SIDEBAR_NAV_PARITY__ = { calls, ready: true, labels: { plugins: pluginCopy[locale].panel, schedules: scheduleCopy[locale].panel },
      registered: slots.entriesOfSlot('sidebar.panellist').map(row => row.options.id),
      setAccess: (state: string) => navigationAccess.set(state), access: () => navigationAccess.getSnapshot() };
    return { ctx, slots, bind, registration, panelInfo };
  }, [locale, adapted, scheme]);
  const renderSlot = (name: string, owner: any, options: any = {}): React.ReactNode => {
    const entries = setup.slots.entriesOfSlot(name as never).filter(entry => options.only === undefined || entry.options.id === options.only);
    return entries.length === 0 ? options.fallback ?? null : entries.map((entry, index) => <Registered key={`${name}:${entry.options.id ?? index}`} entry={entry} owner={owner} />);
  };
  function Registered({ entry, owner }: { entry: any; owner: any }) {
    const injected = entry.inject?.() ?? {}, bound: any = {};
    for (const [key, source] of Object.entries(injected.hooks ?? {})) bound[`use${key[0]!.toUpperCase()}${key.slice(1)}`] = (select: any) => watch(source, select);
    const Component = entry.component;
    return <Component {...injected} {...bound} {...owner} renderSlot={renderSlot} t={setup.bind(entry.locale ?? '')}
      usePanelInfo={(select: any) => watch(setup.panelInfo, select)} useRemoteAccess={() => true} />;
  }
  const width = collapsed && mode !== 'mobile' ? 56 : 300;
  return <aside data-sidebar-parity style={{ width, height: '100vh', background: 'var(--dsw-alias-bg-sidebar, var(--dsw-alias-bg-base))' }}>
    <Registered entry={setup.registration} owner={{ collapsed, width: 300, drawer: mode === 'mobile' }} />
  </aside>;
}
