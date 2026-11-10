import { z } from 'zod'
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-base/client-session-adapter/navigation-access'
import { requestLogin } from '@dsh-base/client-auth-login/request'
import { PluginManagerPage, type PluginManagerPageProps } from '@dsh-base/client-plugin-manager/src/client/PluginManagerPage.tsx'
import { PluginManagerController, type PluginManagerFace } from '@dsh-base/client-plugin-manager/src/client/manager-store.ts'
import { configLedgerSource } from '@dsh-base/client-plugin-manager/src/client/config-ledger.ts'
import { tabLedgerSource } from '@dsh-base/client-plugin-manager/src/client/tab-ledger.ts'
import { createNavigationStore } from '@dsh-base/client-plugin-manager/src/client/navigation-store.ts'
import { createPluginHeaderRef } from '@dsh-base/client-plugin-manager/src/client/header-scroll.ts'
import { PluginsPanelIcon } from '@dsh-base/client-plugin-manager/src/client/PluginsPanelIcon.tsx'
import type {} from '@dsh-base/client-plugin-manager/client'
import type {} from '@dsh-base/client-plugin-manager/group-summary'
import { TaskManagerPage, type TaskManagerPageProps } from '@dsh-base/client-schedule/src/client/TaskManagerPage.tsx'
import { TaskManagerIcon } from '@dsh-base/client-schedule/src/client/TaskManagerIcon.tsx'
import { createEditorStore } from '@dsh-base/client-schedule/src/client/editor-store.ts'
import type {} from '@deepseek-ai/dsh-client-ui-schedule/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { publicTaskFace } from './task-face.ts'
import { publicCopy } from './public-copy.ts'
import { publicConfigurationRenderer } from './config-access.ts'
import { createPublicPluginConfigurations, type PublicPluginConfigurations } from './public-configurations.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

export const name = '@dsh-base/client-public-navigation'
export const Config = z.object({}).default({})
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.pluginManager', 'remote.pluginInventory', 'remote.pluginRegistryProbe', 'configForms', 'navigationAccess']
const PLUGINS = 'plugins' as MainPanelId
const TASKS = 'schedules' as MainPanelId
// Let the official creation menu restore focus before the modal captures its opener.
const requestTaskLogin = () => { requestAnimationFrame(() => requestLogin()) }

function PublicPlugins(props: PluginManagerPageProps & { publicConfigurations: PublicPluginConfigurations }) {
  useSyncExternalStore(props.publicConfigurations.subscribe, props.publicConfigurations.getSnapshot, props.publicConfigurations.getSnapshot)
  const locale = props.useLocale(value => value.active)
  const copy = publicCopy(locale)
  const renderSlot = publicConfigurationRenderer(props.renderSlot, view => view === 'summary'
    ? <>{copy.configure}</>
    : <div data-public-plugin-configuration><p>{copy.configure}</p><Button variant="outline" onClick={() => requestLogin()}>{copy.signIn}</Button></div>, props.publicConfigurations)
  return <PluginManagerPage {...props} renderSlot={renderSlot} t={(key, values) => key === 'intro' || key === 'infoDescription' ? copy.plugins
    : key === 'partOff' || key === 'rowStateIdle' ? copy.declared : props.t(key, values)} />
}
function PublicTasks(props: TaskManagerPageProps) {
  // The task component receives an honest guest state through its existing copy contract.
  const copy = publicCopy(document.documentElement.lang)
  return <TaskManagerPage {...props} t={(key, values) => ['list.empty', 'list.emptyActive', 'list.emptyPaused', 'list.emptyInactive', 'list.noMatches'].includes(key)
    ? copy.tasks : props.t(key, values)} />
}

/** Mount existing exported pages without granting any private RemoteAccess capability. */
function mountPublicPages(ctx: Context): void {
  const controller = new PluginManagerController(ctx)
  ctx.effect(() => () => controller.dispose(), 'public-navigation: dispose public catalog')
  const ledger = configLedgerSource(ctx)
  const base = controller.inject(ledger, tabLedgerSource(ctx), text => ctx.locale.resolveText(text))
  const settings = { status: 'ready' as const, view: undefined, error: null }
  const face: PluginManagerFace = {
    ...base,
    hooks: {
      ...base.hooks,
      // Public descriptors never subscribe to an owner configuration mirror.
      configurations: { getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {}, acceptView: () => {} },
      // Descriptor visibility remains unchanged. Rendering account fields is gated below.
      configLedger: ledger,
    },
    openInstall: requestLogin, installFrom: () => requestLogin(), setEnabled: () => requestLogin(), setRowEnabled: () => requestLogin(),
    update: () => requestLogin(), uninstall: () => requestLogin(), openUpdate: () => requestLogin(), runUpdate: requestLogin,
    runInstall: requestLogin, enableInstalled: requestLogin,
  }
  ctx.slots.inject('main', function* () {
    const handle = createNavigationStore(), instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    yield ctx.slots.register({
      name: 'main', key: PLUGINS, locale: 'pluginManager', priority: 1, store,
      inject: () => ({ ...face, createHeaderRef: createPluginHeaderRef, publicConfigurations: ctx.publicPluginConfigurations }),
      children: {
        'plugins.add.actions': { kind: 'list', scope: 'root' }, 'plugins.tab': { kind: 'list', scope: 'root' },
        'plugins.item': { kind: 'list', scope: 'root' }, 'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
        'plugins.bundle.config': { kind: 'keyed', scope: 'root' }, 'plugins.row.config': { kind: 'keyed', scope: 'root' },
        'plugins.detail.actions': { kind: 'list', scope: 'root' }, 'plugins.detail.badge': { kind: 'list', scope: 'root' },
        'plugins.detail.section': { kind: 'list', scope: 'root' }, 'dsh-base.plugins.group.summary': { kind: 'single', scope: 'root', inline: true },
      },
    }, PublicPlugins)
    const dispose = ctx.reflect.provide('pluginNavigation', {
      openList: () => { ctx.layout.selectPanel(PLUGINS); instance.actions.setTab('installed'); instance.actions.setView({ kind: 'list' }) },
      openBundle: (packageName: string) => { ctx.layout.selectPanel(PLUGINS); instance.actions.setTab('installed'); instance.actions.setView({ kind: 'package', name: packageName }) },
    })
    yield () => { void dispose() }
    yield ctx.slots.register({ name: 'main', key: TASKS, locale: 'schedule.manager', priority: 1, store: createEditorStore(), inject: () => publicTaskFace(requestTaskLogin) }, PublicTasks)
  })
  ctx.slots.inject('sidebar.panellist', function* () {
    yield ctx.slots.register({ name: 'sidebar.panellist', id: PLUGINS, order: 0, locale: 'pluginManager', label: () => ctx.locale.bind('pluginManager')('panel') }, PluginsPanelIcon)
    yield ctx.slots.register({ name: 'sidebar.panellist', id: TASKS, order: 10, locale: 'schedule.manager', label: () => ctx.locale.bind('schedule.manager')('panel') }, TaskManagerIcon)
  })
}

export function apply(ctx: Context): void {
  ctx.provide('publicPluginConfigurations', createPublicPluginConfigurations())
  let publicPages: ReturnType<Context['plugin']> | undefined
  const update = () => {
    if (ctx.navigationAccess.getSnapshot() === 'anonymous') publicPages ??= ctx.plugin({ inject: [...inject, 'publicPluginConfigurations'], apply: mountPublicPages })
    else { void publicPages?.dispose(); publicPages = undefined }
  }
  ctx.effect(() => { update(); const stop = ctx.navigationAccess.subscribe(update); return () => { stop(); void publicPages?.dispose(); publicPages = undefined } }, 'public-navigation: account boundary')
}
