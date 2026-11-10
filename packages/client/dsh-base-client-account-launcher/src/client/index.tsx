/** Anonymous account entry for the official sidebar settings seat; signed-in owners keep the official menu. */
import type { Context } from '@deepseek-ai/cordis'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import { z } from 'zod'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts'
import { createLanguageRowStore } from '@deepseek-ai/dsh-client-locale/src/client/settings-store.ts'
import { createAppearanceRowStore, createFontRowStore } from '@deepseek-ai/dsh-client-ui-theme/src/client/settings-store.ts'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'
import { DEFAULT_LINK_OPENING, DEFAULT_TRANSCRIPT_VIEW_MODE } from '@deepseek-ai/dsh-client-ui-chat/src/chat-settings.ts'
import type { ChatSettings, LinkOpening, PerformanceUsageMode, TranscriptViewMode } from '@deepseek-ai/dsh-client-ui-chat/src/chat-settings.ts'
import type { CollapseTiming, FoldedReplies } from '@deepseek-ai/dsh-client-ui-chat/src/client/presentation-policy.ts'
import { PerformanceUsagePolicy } from '@deepseek-ai/dsh-client-ui-chat/src/client/performance-usage.ts'
import { TranscriptViewPolicy } from '@deepseek-ai/dsh-client-ui-chat/src/client/transcript-view.ts'
import type { BusyEnterBehavior } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/composer-submission.ts'
import { ComposerSubmissionPolicy } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/submission-policy.ts'
import type { ConversationSettings } from '@deepseek-ai/dsh-client-ui-conversation/src/submission-settings.ts'
import type { PermissionSettingsState } from '@deepseek-ai/dsh-client-ui-permission-presets/src/client/settings-store.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UploadMutation, UploadSettings } from '@deepseek-ai/dsh-client-ui-settings-session-log/src/client/upload-preference.ts'
import type { AccountSnapshot } from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { ClientEntryState } from '@deepseek-ai/dsh-client-modules/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import { createSettingsSchemaOperations } from '@dsh-base/client-deepseek-provider/client'
import { gatewayCopy } from '@dsh-base/client-gateway-provider/client'
import { AgentPresetSectionController, type AgentPresetSectionRemote } from '@dsh-base/client-agent-preset/client'
import { FIXED_AGENT_PRESET_ID } from '@dsh-base/agent-presets'
import { fixedAgentPresetCopy } from '@dsh-base/agent-presets/availability'
import { AnonymousLauncher, type AnonymousLauncherInjected } from './AnonymousLauncher.tsx'
import { requestLogin } from '@dsh-base/client-auth-login/request'
import type { AnonymousSettingsPanelConfig } from './AnonymousSettingsPanel.tsx'
import { accountSignInCopy, assertBoundLabels, assertOfficialLabels, modelsCopy, unavailableReason } from './locales.ts'
import { launcherAction } from './reconcile.ts'

export const name = '@dsh-base/client-account-launcher'
export const Config = z.object({}).default({})
export const inject = ['slots', 'locale', 'theme', 'configForms', 'shortcuts', 'sidebarRightTabs', 'settingsSchema']

/** Minimal account view shape read from the shared remote seam. */
interface AccountViewLike {
  readonly status?: string
}

/** The remote account face provided by the session adapter. */
interface RemoteAccountLike {
  getState(): Promise<{ ok: true; value: AccountViewLike } | { ok: false; error: unknown }>
  watch(signal: AbortSignal): AsyncGenerator<AccountViewLike>
}

/** Read-only plugin inventory face provided by the session adapter. */
interface RemotePluginInventoryLike {
  list(): Promise<{ ok: true; value: PluginInventorySnapshot } | { ok: false; error: { code: string; message: string } }>
}

/** The empty client-graph state an anonymous page reports (no Host sync runs). */
const EMPTY_CLIENT_SYNC: ClientEntryState = { syncing: false, failures: [] }

const NOOP = (): void => undefined

/** Locale snapshot fields the language row mirror needs. */
interface LocaleSnapshotLike {
  readonly active: string
  readonly revision: number
  readonly locales: readonly { readonly id: string; readonly label: string }[]
}

/**
 * Register the anonymous More launcher into `sidebar.settings`.
 *
 * The official settings shell owns that single slot only while settings access
 * is granted. The launcher therefore registers as a fallback occupant at
 * priority 1: the shell's default priority 0 always registers safely, renders
 * as the winner, and this registration stays shadowed until the shell leaves.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Public login document: no authenticated shell services exist here.
  if (location.pathname === '/login') return
  const officialLabels = ctx.locale.bind('settings.account') as unknown as Translate
  const settingsLabels = ctx.locale.bind('settings') as unknown as Translate
  const localeLabels = ctx.locale.bind('settings.locale') as unknown as Translate
  const themeLabels = ctx.locale.bind('settings.theme') as unknown as Translate
  const modelsLabels = ctx.locale.bind('settings.models') as unknown as Translate
  const pluginsLabels = ctx.locale.bind('settings.plugins') as unknown as Translate
  const agentPresetLabels = ctx.locale.bind('settings.agentPreset') as unknown as Translate
  const permissionLabels = ctx.locale.bind('settings.permission') as unknown as Translate
  const chatLabels = ctx.locale.bind('chat') as unknown as Translate
  const conversationLabels = ctx.locale.bind('conversation') as unknown as Translate
  const shortcutsLabels = ctx.locale.bind('shortcuts') as unknown as Translate
  const sessionLogLabels = ctx.locale.bind('settings.sessionLog') as unknown as Translate
  const pluginInventoryLabels = ctx.locale.bind('settings.pluginInventory') as unknown as Translate

  // The official plugins register these namespaces while booting; activation
  // order is not guaranteed, so binding is asserted right before registration.
  const assertPanelLabels = (): void => {
    assertOfficialLabels(officialLabels)
    assertBoundLabels(settingsLabels, ['title', 'close', 'general.nav', 'general.currentVersion'], 'settings')
    assertBoundLabels(localeLabels, ['language.title'], 'settings.locale')
    assertBoundLabels(themeLabels, ['appearance.title', 'fontSize.text.title', 'fontSize.unit'], 'settings.theme')
    assertBoundLabels(modelsLabels, ['nav', 'title'], 'settings.models')
    assertBoundLabels(pluginsLabels, ['nav', 'title', 'intro'], 'settings.plugins')
    assertBoundLabels(pluginInventoryLabels, ['tab', 'loading', 'error', 'retry', 'search', 'enabledTag', 'disabledTag'], 'settings.pluginInventory')
    assertBoundLabels(agentPresetLabels, ['nav', 'sectionIntro', 'builtInGroup', 'customGroup', 'inUse', 'setDefault', 'unavailableBadge', 'noDescription', 'view', 'close', 'modeExplanation', 'howToUse'], 'settings.agentPreset')
    assertBoundLabels(permissionLabels, ['title', 'description', 'unavailable'], 'settings.permission')
    assertBoundLabels(chatLabels, ['settings.transcript.title', 'settings.links.title', 'settings.performance.title'], 'chat')
    assertBoundLabels(conversationLabels, ['settings.enter.title'], 'conversation')
    assertBoundLabels(shortcutsLabels, ['settings', 'description', 'view'], 'shortcuts')
    assertBoundLabels(sessionLogLabels, ['title', 'description'], 'settings.sessionLog')
  }

  // Official row stores mirrored from the live locale/theme services, exactly
  // like the official General-section registrations do.
  const languageHandle = createLanguageRowStore()
  const language = languageHandle.create()
  const appearanceHandle = createAppearanceRowStore()
  const appearance = appearanceHandle.create()
  const fontHandle = createFontRowStore()
  const fonts = fontHandle.create()
  const useLanguageStore = bindSnapshotSelector(language)
  const useAppearanceStore = bindSnapshotSelector(appearance)
  const useFontStore = bindSnapshotSelector(fonts)
  const syncLocale = (): void => {
    const snapshot = ctx.locale.getSnapshot() as unknown as LocaleSnapshotLike
    language.actions.sync(snapshot.active, snapshot.locales.map(locale => ({ id: locale.id, label: locale.label })), snapshot.revision)
  }
  ctx.effect(() => {
    const unsubscribe = ctx.locale.subscribe(syncLocale)
    syncLocale()
    return unsubscribe
  }, 'account launcher: language row store')
  const syncTheme = (snapshot: ThemeSnapshot): void => {
    appearance.actions.sync(snapshot.preference, snapshot.revision)
    fonts.actions.sync(snapshot.fontSizes, snapshot.fontFamilies, snapshot.revision)
  }
  ctx.effect(() => {
    const off = ctx.on('theme/change', syncTheme)
    syncTheme(ctx.theme.getTheme())
    return () => { off() }
  }, 'account launcher: theme row stores')

  // The account section's signed-out snapshot and theme source live entirely on
  // this client: no account remote, no writes, no network while the panel opens.
  const anonymousAccount = createSnapshotStore<AccountSnapshot>({
    view: { status: 'signed-out', links: { usageUrl: '/', topUpUrl: '/' }, attempt: null },
    details: undefined,
    avatar: undefined,
    failed: false,
  })
  const useAnonymousAccount = bindSnapshotSelector(anonymousAccount)
  const themeSource: ObservableSnapshot<ThemeSnapshot> = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }
  const useAnonymousTheme = bindSnapshotSelector(themeSource)

  // Account-scoped rows keep their honest unavailable state.
  const usePermissionStore = bindSnapshotSelector(createSnapshotStore<PermissionSettingsState>({
    status: 'ready', error: null, writable: false, currentValue: '', options: [], revision: 0,
  }))
  const useUploadStore = bindSnapshotSelector(createSnapshotStore<ConfigFormSnapshot<UploadSettings>>({
    status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false,
  }))
  const useUploadMutationStore = bindSnapshotSelector(createSnapshotStore<UploadMutation>({ busy: false, notice: null, sequence: 0 }))

  // The official read-only inventory tab needs a client-graph snapshot only.
  // No Host sync runs on an anonymous page, so the snapshot stays empty.
  const clientSyncSource: ObservableSnapshot<ClientEntryState> = {
    getSnapshot: () => EMPTY_CLIENT_SYNC,
    subscribe: () => () => undefined,
  }
  const useClientSync = bindSnapshotSelector(clientSyncSource)
  const listPluginInventory = async (): Promise<PluginInventorySnapshot> => {
    const inventory = ctx.get('remote.pluginInventory') as RemotePluginInventoryLike | undefined
    if (inventory === undefined) throw new Error('account launcher: remote.pluginInventory is unavailable')
    const result = await inventory.list()
    if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  type InventoryPreset = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
  const presetName = (preset: InventoryPreset): string =>
    presetDisplayText(preset, agentPresetLabels as unknown as (key: string) => string).name
  const resolveText = (text: LocalizedText): string => ctx.locale.resolveText(text)

  // The six client-only rows run on the official classes over the same shared
  // config forms the chat and composer subscribe to, the official shortcuts
  // service and the store its shell overlay already registered. Built lazily:
  // a signed-in page never constructs or subscribes to any of this.
  type AnonymousRuntime = ReturnType<typeof createRuntime>
  const createRuntime = () => {
    const chatForm = ctx.configForms.get<ChatSettings>('ui-chat')
    const conversationForm = ctx.configForms.get<ConversationSettings>('ui-conversation')
    const transcript = new TranscriptViewPolicy(chatForm, 'dshDesktop' in globalThis ? 'standard' : DEFAULT_TRANSCRIPT_VIEW_MODE)
    const performance = new PerformanceUsagePolicy(chatForm)
    const submission = new ComposerSubmissionPolicy(conversationForm)
    const linkOpening = createSnapshotStore<LinkOpening>(chatForm.getSnapshot().value?.linkOpening ?? DEFAULT_LINK_OPENING)
    const stopLink = chatForm.subscribe(() => {
      const accepted = chatForm.getSnapshot().value?.linkOpening
      if (accepted !== undefined) linkOpening.set(accepted)
    })
    const tabs = ctx.sidebarRightTabs
    const browserAvailable: ObservableSnapshot<boolean> = {
      getSnapshot: () => tabs.get('browser') !== undefined,
      subscribe: listener => tabs.subscribe(listener),
    }
    const overlayStore = ctx.slots.entries('shell.overlay').find(entry => entry.options.id === 'shortcuts')?.store
    const shortcutsStore = overlayStore !== undefined && 'create' in overlayStore
      ? (overlayStore as unknown as { create: () => { actions: { open: () => void } } }).create()
      : undefined
    // The forked official section controller reads the local `remote.agentPresets`
    // seam only; its default-preset write stays unreachable (see makeDefault).
    // `ctx` here carries no `remote` injection (this plugin must keep working
    // without the remote seam), so the roster face is handed over explicitly.
    const presetRemote = ctx.get('remote.agentPresets') as AgentPresetSectionRemote | undefined
    const presetController = new AgentPresetSectionController(ctx, presetRemote)
    return {
      transcript: {
        useTranscriptView: bindSnapshotSelector(transcript.mode),
        setTranscriptView: (mode: TranscriptViewMode) => { transcript.setMode(mode) },
        useCollapseTiming: bindSnapshotSelector(transcript.collapseTiming),
        setCollapseTiming: (timing: CollapseTiming) => { transcript.setCollapseTiming(timing) },
        useFoldedReplies: bindSnapshotSelector(transcript.foldedReplies),
        setFoldedReplies: (replies: FoldedReplies) => { transcript.setFoldedReplies(replies) },
      },
      developerTools: {
        useDeveloperTools: bindSnapshotSelector(ctx.configForms.developerTools.enabled),
        setEnabled: (enabled: boolean) => ctx.configForms.developerTools.setEnabled(enabled),
      },
      shortcuts: {
        useCatalog: bindSnapshotSelector(ctx.shortcuts.catalog),
        open: () => { shortcutsStore?.actions.open() },
      },
      linkOpening: {
        useLinkOpening: bindSnapshotSelector(linkOpening),
        useBrowserAvailable: bindSnapshotSelector(browserAvailable),
        setLinkOpening: (destination: LinkOpening) => {
          linkOpening.set(destination)
          void chatForm.set('linkOpening', destination)
        },
      },
      enter: {
        useBusyEnter: bindSnapshotSelector(submission.busyEnter),
        setBusyEnter: (behavior: BusyEnterBehavior) => { submission.setBusyEnter(behavior) },
      },
      performance: {
        usePerformanceUsage: bindSnapshotSelector(performance.mode),
        setPerformanceUsage: (mode: PerformanceUsageMode) => { performance.setMode(mode) },
      },
      presets: {
        controller: presetController,
        useSection: bindSnapshotSelector(presetController.store),
      },
      dispose: () => {
        transcript.dispose(); performance.dispose(); submission.dispose(); stopLink()
        presetController.closeView()
      },
    }
  }
  let runtime: AnonymousRuntime | undefined
  const anonymousRuntime = (): AnonymousRuntime => (runtime ??= createRuntime())
  ctx.effect(() => () => { runtime?.dispose() }, 'account launcher: anonymous preference runtime')

  const panel = (): AnonymousSettingsPanelConfig => {
    const activeLocale = ctx.locale.getSnapshot().active
    const runtimeFace = anonymousRuntime()
    return {
    reason: unavailableReason(activeLocale),
    labels: {
      account: officialLabels,
      settings: settingsLabels,
      models: modelsLabels,
      plugins: pluginsLabels,
      agentPreset: agentPresetLabels,
      language: localeLabels,
      theme: themeLabels,
      permission: permissionLabels,
      chat: chatLabels,
      conversation: conversationLabels,
      shortcuts: shortcutsLabels,
      sessionLog: sessionLogLabels,
      pluginInventory: pluginInventoryLabels,
    },
    language: {
      useStore: useLanguageStore as never,
      t: localeLabels,
      setLocale: (id) => { ctx.locale.setLocale(id) },
    },
    appearance: {
      useStore: useAppearanceStore as never,
      t: themeLabels,
      setTheme: (id) => { ctx.theme.setTheme(id) },
    },
    fonts: {
      useStore: useFontStore as never,
      t: themeLabels,
      setFontSize: (role, px) => { ctx.theme.setFontSize(role as never, px) },
      setFontFamily: (role, value) => { ctx.theme.setFontFamily(role as never, value) },
    },
    rows: {
      ...runtimeFace,
      permission: usePermissionStore,
      upload: useUploadStore,
      mutation: useUploadMutationStore,
    },
    models: {
      t: modelsLabels,
      copy: modelsCopy(activeLocale),
      schema: createSettingsSchemaOperations(ctx.settingsSchema),
      gatewayT: (key: string) => (gatewayCopy[activeLocale as keyof typeof gatewayCopy] ?? gatewayCopy.en)[key as keyof typeof gatewayCopy.en] ?? key,
      signIn: () => { requestLogin() },
    },
    plugins: {
      t: pluginsLabels,
      tabT: pluginInventoryLabels,
      useClientSync,
      list: listPluginInventory,
      presetName,
      resolveText,
      retryClient: NOOP,
    },
    presets: {
      t: agentPresetLabels,
      useAgentPresetSection: runtimeFace.presets.useSection,
      useDeveloperTools: runtimeFace.developerTools.useDeveloperTools,
      load: () => runtimeFace.presets.controller.load(),
      view: (id) => runtimeFace.presets.controller.view(id),
      closeView: () => { runtimeFace.presets.controller.closeView() },
      // The default-preset write needs the Host settings namespace, which stays
      // account-scoped. Every roster row is already unavailable or the current
      // default, so this refusal is a guard, never a silent no-op.
      makeDefault: async () => {
        const state = runtimeFace.presets.controller.store.getSnapshot()
        runtimeFace.presets.controller.store.set({
          ...state, error: fixedAgentPresetCopy(ctx.locale.getSnapshot().active).selectUnavailable,
        })
      },
      close: NOOP,
      viewUnavailableReason: (id) => id === FIXED_AGENT_PRESET_ID
        ? fixedAgentPresetCopy(ctx.locale.getSnapshot().active).readUnavailable
        : undefined,
    },
    officialSlots: {
      sections: ctx.slots.entries('settings.section').length,
      generalItems: ctx.slots.entries('settings.general.item').length,
    },
    account: {
      useAccount: useAnonymousAccount,
      useTheme: useAnonymousTheme,
      signIn: () => { requestLogin() },
      copy: accountSignInCopy(activeLocale),
    },
    }
  }

  let view: AccountViewLike | undefined
  let registered: (() => void) | undefined
  let remoteStarted = false
  let stopped = false

  const foreignEntry = (): boolean => ctx.slots.entries('sidebar.settings').some(entry => entry.component !== AnonymousLauncher)

  /** Reconcile one registration against the current account and slot facts. */
  const sync = (): void => {
    if (stopped) return
    const action = launcherAction({ signedOut: view?.status === 'signed-out', foreignEntry: foreignEntry(), registered: registered !== undefined })
    if (action === 'dispose') {
      registered?.()
      registered = undefined
      return
    }
    if (action !== 'register') return
    assertPanelLabels()
    const injectFace = (): AnonymousLauncherInjected => ({
      unavailableReason: () => unavailableReason(ctx.locale.getSnapshot().active),
      activeLocale: () => ctx.locale.getSnapshot().active,
      settingsPanel: panel(),
    })
    registered = ctx.slots.register({
      name: 'sidebar.settings',
      priority: 1,
      locale: 'settings.account',
      inject: injectFace,
    }, AnonymousLauncher)
  }

  const unsubscribeSlots = ctx.slots.subscribe('sidebar.settings', () => { sync() })

  // Fallback only when the shared remote service never appears: read the public
  // session endpoint directly. No access-policy change and no new endpoint.
  const fallbackTimer = setTimeout(() => {
    if (remoteStarted || stopped) return
    void (async () => {
      try {
        const response = await fetch('/api/auth/get-session', { headers: { accept: 'application/json' } })
        const body = await response.json().catch(() => null) as { user?: unknown } | null
        view = body !== null && typeof body === 'object' && body.user != null ? { status: 'credential-stored' } : { status: 'signed-out' }
        sync()
      } catch {
        // Keep the unknown state; never guess signed-out on a failed read.
      }
    })()
  }, 1500)

  ctx.effect(() => () => {
    stopped = true
    clearTimeout(fallbackTimer)
    unsubscribeSlots()
    registered?.()
    registered = undefined
  }, 'account launcher: anonymous registration lifetime')

  ctx.inject(['remote.account'], scope => {
    remoteStarted = true
    clearTimeout(fallbackTimer)
    const remote = scope.get('remote.account') as RemoteAccountLike
    scope.effect(() => {
      const abort = new AbortController()
      void (async () => {
        try {
          const state = await remote.getState()
          if (abort.signal.aborted) return
          view = state.ok ? state.value : undefined
          sync()
          for await (const next of remote.watch(abort.signal)) {
            if (abort.signal.aborted) break
            view = next
            sync()
          }
        } catch (error) {
          if (!abort.signal.aborted) {
            ctx.logger.warn(`account launcher: account state read failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      })()
      return () => { abort.abort() }
    }, 'account launcher: remote account state')
  })

  sync()
}
