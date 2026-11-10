/**
 * Anonymous settings panel: the official 800×800 settings shell with the
 * official General rows. Language, appearance and font stay editable through
 * the anonymous local document; account-scoped sections and rows stay visible
 * but disabled with a localized reason; the version row stays readable.
 */
import { useId, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  IconAgentPresetOutlineMedium, IconDataOutlineMedium, IconPersonalizationOutlineMedium,
  IconSettingsOutlineMedium, IconUserOutlineMedium, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { SettingsPanel, type SettingsPanelProps } from '@dsh-base/client-settings-navigation/src/client/SettingsRoot.tsx'
import type { SettingsSectionRow } from '@dsh-base/client-settings-navigation/src/client/shell-contract.ts'
import { LanguageRow } from '@deepseek-ai/dsh-client-locale/src/client/LanguageRow.tsx'
import type { LanguageRowState } from '@deepseek-ai/dsh-client-locale/src/client/settings-store.ts'
import { AppearanceRow } from '@deepseek-ai/dsh-client-ui-theme/src/client/AppearanceRow.tsx'
import { FontSettingsGroup } from '@deepseek-ai/dsh-client-ui-theme/src/client/FontSettingsGroup.tsx'
import type { AppearanceRowState, FontRowState } from '@deepseek-ai/dsh-client-ui-theme/src/client/settings-store.ts'
import { PermissionRow } from '@deepseek-ai/dsh-client-ui-permission-presets/src/client/PermissionRow.tsx'
import type { PermissionSettingsState } from '@deepseek-ai/dsh-client-ui-permission-presets/src/client/settings-store.ts'
import { TranscriptViewRow } from '@deepseek-ai/dsh-client-ui-chat/src/client/settings/TranscriptViewRow.tsx'
import { LinkOpeningRow } from '@deepseek-ai/dsh-client-ui-chat/src/client/settings/LinkOpeningRow.tsx'
import { PerformanceUsageRow } from '@deepseek-ai/dsh-client-ui-chat/src/client/settings/PerformanceUsageRow.tsx'
import type { LinkOpening, PerformanceUsageMode, TranscriptViewMode } from '@deepseek-ai/dsh-client-ui-chat/src/chat-settings.ts'
import type { CollapseTiming, FoldedReplies } from '@deepseek-ai/dsh-client-ui-chat/src/client/presentation-policy.ts'
import { EnterBehaviorRow } from '@deepseek-ai/dsh-client-ui-conversation/src/client/settings/EnterBehaviorRow.tsx'
import type { BusyEnterBehavior } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/composer-submission.ts'
import { DeveloperToolsRow } from '@deepseek-ai/dsh-client-ui-settings-general/src/client/DeveloperToolsRow.tsx'
import { CurrentVersionRow } from '@deepseek-ai/dsh-client-ui-settings-general/src/client/CurrentVersionRow.tsx'
import { ShortcutsRow } from '@deepseek-ai/dsh-client-ui-shortcuts/src/client/Reference.tsx'
import { UploadRow } from '@deepseek-ai/dsh-client-ui-settings-session-log/src/client/UploadRow.tsx'
import type { UploadMutation, UploadSettings } from '@deepseek-ai/dsh-client-ui-settings-session-log/src/client/upload-preference.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AccountSnapshot } from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'
import css from './AnonymousSettingsPanel.module.css'
import { AnonymousAccountSection } from './AnonymousAccountSection.tsx'
import { AnonymousModelsSection, type AnonymousModelsSectionProps } from './AnonymousModelsSection.tsx'
import { AnonymousPluginsSection, type AnonymousPluginsSectionProps } from './AnonymousPluginsSection.tsx'
import { AnonymousPresetsSection, type AnonymousPresetsSectionProps } from './AnonymousPresetsSection.tsx'
import type { AccountSignInCopy } from './locales.ts'

/** Official row shape for the anonymous panel: only the props the row reads. */
export interface AnonymousPanelRow<T> {
  readonly useStore: SnapshotSelectorHook<T>
  readonly t: Translate
}

/** Copy faces the panel binds from the official namespaces. */
export interface AnonymousPanelLabels {
  readonly account: Translate
  readonly settings: Translate
  readonly models: Translate
  readonly plugins: Translate
  readonly agentPreset: Translate
  readonly language: Translate
  readonly theme: Translate
  readonly permission: Translate
  readonly chat: Translate
  readonly conversation: Translate
  readonly shortcuts: Translate
  readonly sessionLog: Translate
  readonly pluginInventory: Translate
}

/** Live official preference sources and writers for the usable rows. */
export interface AnonymousPanelRows {
  readonly transcript: {
    readonly useTranscriptView: SnapshotSelectorHook<TranscriptViewMode>
    readonly setTranscriptView: (mode: TranscriptViewMode) => void
    readonly useCollapseTiming: SnapshotSelectorHook<CollapseTiming>
    readonly setCollapseTiming: (timing: CollapseTiming) => void
    readonly useFoldedReplies: SnapshotSelectorHook<FoldedReplies>
    readonly setFoldedReplies: (replies: FoldedReplies) => void
  }
  readonly developerTools: {
    readonly useDeveloperTools: SnapshotSelectorHook<boolean>
    readonly setEnabled: (enabled: boolean) => Promise<void>
  }
  readonly shortcuts: {
    readonly useCatalog: SnapshotSelectorHook<readonly ShortcutCatalogEntry[]>
    readonly open: () => void
  }
  readonly linkOpening: {
    readonly useLinkOpening: SnapshotSelectorHook<LinkOpening>
    readonly useBrowserAvailable: SnapshotSelectorHook<boolean>
    readonly setLinkOpening: (destination: LinkOpening) => void
  }
  readonly enter: {
    readonly useBusyEnter: SnapshotSelectorHook<BusyEnterBehavior>
    readonly setBusyEnter: (behavior: BusyEnterBehavior) => void
  }
  readonly performance: {
    readonly usePerformanceUsage: SnapshotSelectorHook<PerformanceUsageMode>
    readonly setPerformanceUsage: (mode: PerformanceUsageMode) => void
  }
  /** Still account-scoped while anonymous. */
  readonly permission: SnapshotSelectorHook<PermissionSettingsState>
  readonly upload: SnapshotSelectorHook<ConfigFormSnapshot<UploadSettings>>
  readonly mutation: SnapshotSelectorHook<UploadMutation>
}

/** Everything the anonymous panel renders. */
export interface AnonymousSettingsPanelConfig {
  /** Localized "available after sign-in" reason for every disabled surface. */
  readonly reason: string
  readonly labels: AnonymousPanelLabels
  readonly language: AnonymousPanelRow<LanguageRowState> & { readonly setLocale: (id: string) => void }
  readonly appearance: AnonymousPanelRow<AppearanceRowState> & { readonly setTheme: (id: string) => void }
  readonly fonts: AnonymousPanelRow<FontRowState> & {
    readonly setFontSize: (role: string, px: number) => void
    readonly setFontFamily: (role: string, value: string) => void
  }
  readonly rows: AnonymousPanelRows
  /** Read-only model declaration page (local catalog only). */
  readonly models: AnonymousModelsSectionProps
  /** Built-in plugins page: the official inventory tab over the read-only seam. */
  readonly plugins: AnonymousPluginsSectionProps
  /** Agent presets page: the official (forked) roster section, read-only. */
  readonly presets: AnonymousPresetsSectionProps
  /**
   * Live ledger counts for the guard: the anonymous page must never register a
   * settings section or General row, so acceptance reads these as zero.
   */
  readonly officialSlots: {
    readonly sections: number
    readonly generalItems: number
  }
  /** Account section: official Platform state and a separate local-account sign-in action. */
  readonly account: {
    readonly useAccount: SnapshotSelectorHook<AccountSnapshot>
    readonly useTheme: SnapshotSelectorHook<ThemeSnapshot>
    readonly signIn: () => void
    readonly copy: AccountSignInCopy
  }
}

/** Props of the anonymous settings panel. */
export interface AnonymousSettingsPanelProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly config: AnonymousSettingsPanelConfig
}

// Official rows read only the props listed here; the owner share is empty.
type Row<Props> = (props: Props) => ReactElement
const Language = LanguageRow as unknown as Row<{ t: Translate; useStore: SnapshotSelectorHook<LanguageRowState>; setLocale: (id: string) => void }>
const Appearance = AppearanceRow as unknown as Row<{ t: Translate; useStore: SnapshotSelectorHook<AppearanceRowState>; setTheme: (id: string) => void }>
const Fonts = FontSettingsGroup as unknown as Row<{
  t: Translate
  useStore: SnapshotSelectorHook<FontRowState>
  setFontSize: (role: string, px: number) => void
  setFontFamily: (role: string, value: string) => void
}>
const Permission = PermissionRow as unknown as Row<{
  t: Translate
  usePermission: SnapshotSelectorHook<PermissionSettingsState>
  load: () => Promise<void>
  select: (preset: string) => Promise<void>
}>
const Transcript = TranscriptViewRow as unknown as Row<{
  t: Translate
  useTranscriptView: SnapshotSelectorHook<TranscriptViewMode>
  setTranscriptView: (mode: TranscriptViewMode) => void
  useCollapseTiming: SnapshotSelectorHook<CollapseTiming>
  setCollapseTiming: (timing: CollapseTiming) => void
  useFoldedReplies: SnapshotSelectorHook<FoldedReplies>
  setFoldedReplies: (replies: FoldedReplies) => void
}>
const DeveloperTools = DeveloperToolsRow as unknown as Row<{
  t: Translate
  useDeveloperTools: SnapshotSelectorHook<boolean>
  setEnabled: (enabled: boolean) => Promise<void>
}>
const Shortcuts = ShortcutsRow as unknown as Row<{
  t: Translate
  actions: { open: () => void }
  useCatalog: SnapshotSelectorHook<readonly ShortcutCatalogEntry[]>
}>
const LinkOpeningBehavior = LinkOpeningRow as unknown as Row<{
  t: Translate
  useLinkOpening: SnapshotSelectorHook<LinkOpening>
  useBrowserAvailable: SnapshotSelectorHook<boolean>
  setLinkOpening: (destination: LinkOpening) => void
}>
const EnterBehavior = EnterBehaviorRow as unknown as Row<{
  t: Translate
  useBusyEnter: SnapshotSelectorHook<BusyEnterBehavior>
  setBusyEnter: (behavior: BusyEnterBehavior) => void
}>
const PerformanceUsage = PerformanceUsageRow as unknown as Row<{
  t: Translate
  usePerformanceUsage: SnapshotSelectorHook<PerformanceUsageMode>
  setPerformanceUsage: (mode: PerformanceUsageMode) => void
}>
const Upload = UploadRow as unknown as Row<{
  t: Translate
  useUpload: SnapshotSelectorHook<ConfigFormSnapshot<UploadSettings>>
  useMutation: SnapshotSelectorHook<UploadMutation>
  setEnabled: (enabled: boolean) => Promise<void>
  dismiss: () => void
}>
const CurrentVersion = CurrentVersionRow as unknown as Row<{ t: Translate }>

const NOOP = (): void => undefined
const NOOP_ASYNC = async (): Promise<void> => undefined

/** Section rows in the official registration order, all labels official copy. */
function sectionRows(labels: AnonymousPanelLabels): SettingsSectionRow[] {
  return [
    { id: 'account', order: -10, label: labels.account('nav'), icon: <IconUserOutlineMedium size={16} /> },
    { id: 'general', order: 0, label: labels.settings('general.nav'), icon: <IconSettingsOutlineMedium size={16} /> },
    { id: 'models', order: 10, label: labels.models('nav'), icon: <IconDataOutlineMedium size={16} /> },
    { id: 'plugins', order: 15, label: labels.plugins('nav'), icon: <IconPersonalizationOutlineMedium size={16} /> },
    { id: 'agent-presets', order: 20, label: labels.agentPreset('nav'), icon: <IconAgentPresetOutlineMedium size={16} /> },
  ]
}

/** One disabled fieldset: official rows stay rendered but cannot be changed. */
function DisabledGroup({ id, reason, prefix, children }: {
  readonly id: string
  readonly reason: string
  readonly prefix: string
  readonly children: ReactNode
}) {
  const reasonId = `${prefix}-${id}`
  return (
    <Tooltip label={reason} side="top">
      <fieldset className={css.disabledGroup} disabled aria-disabled="true" aria-describedby={reasonId}
        data-anonymous-row={id} data-disabled="true">
        {children}
        <span id={reasonId} className={css.srOnly}>{reason}</span>
      </fieldset>
    </Tooltip>
  )
}

/**
 * Render the official settings shell for an anonymous session.
 * @param props - open state, close path and the official-copy configuration.
 * @returns the settings dialog, or nothing while closed.
 */
export function AnonymousSettingsPanel({ open, onClose, config }: AnonymousSettingsPanelProps): ReactElement | null {
  const [activeId, setActiveId] = useState('general')
  const reasonPrefix = useId()
  if (!open) return null
  const { labels, rows } = config
  const disabled = (id: string, children: ReactNode): ReactElement =>
    <DisabledGroup key={id} id={id} reason={config.reason} prefix={reasonPrefix}>{children}</DisabledGroup>
  // Editable rows carry a data marker wrapper; the three rows that never had a
  // wrapper stay flat so the official `:last-child` separator rules keep working.
  const editable = (id: string, children: ReactNode): ReactElement =>
    <div key={id} className={css.rowGroup} data-anonymous-row={id} data-editable="true">{children}</div>
  const general = <div className={css.general}
    data-anonymous-settings-sections={config.officialSlots.sections}
    data-anonymous-settings-general-items={config.officialSlots.generalItems}>
    {disabled('permission', <Permission t={labels.permission} usePermission={rows.permission} load={NOOP_ASYNC} select={NOOP_ASYNC} />)}
    <Language t={config.language.t} useStore={config.language.useStore} setLocale={config.language.setLocale} />
    <Appearance t={config.appearance.t} useStore={config.appearance.useStore} setTheme={config.appearance.setTheme} />
    <Fonts t={config.fonts.t} useStore={config.fonts.useStore} setFontSize={config.fonts.setFontSize} setFontFamily={config.fonts.setFontFamily} />
    {editable('transcript-view', <Transcript t={labels.chat}
      useTranscriptView={rows.transcript.useTranscriptView} setTranscriptView={rows.transcript.setTranscriptView}
      useCollapseTiming={rows.transcript.useCollapseTiming} setCollapseTiming={rows.transcript.setCollapseTiming}
      useFoldedReplies={rows.transcript.useFoldedReplies} setFoldedReplies={rows.transcript.setFoldedReplies} />)}
    {editable('developer-tools', <DeveloperTools t={labels.settings} useDeveloperTools={rows.developerTools.useDeveloperTools} setEnabled={rows.developerTools.setEnabled} />)}
    {editable('shortcuts', <Shortcuts t={labels.shortcuts} actions={{ open: rows.shortcuts.open }} useCatalog={rows.shortcuts.useCatalog} />)}
    {editable('link-opening', <LinkOpeningBehavior t={labels.chat}
      useLinkOpening={rows.linkOpening.useLinkOpening} useBrowserAvailable={rows.linkOpening.useBrowserAvailable} setLinkOpening={rows.linkOpening.setLinkOpening} />)}
    {editable('composer-enter', <EnterBehavior t={labels.conversation} useBusyEnter={rows.enter.useBusyEnter} setBusyEnter={rows.enter.setBusyEnter} />)}
    {editable('performance-usage', <PerformanceUsage t={labels.chat}
      usePerformanceUsage={rows.performance.usePerformanceUsage} setPerformanceUsage={rows.performance.setPerformanceUsage} />)}
    {disabled('session-log', <Upload t={labels.sessionLog}
      useUpload={rows.upload} useMutation={rows.mutation} setEnabled={NOOP_ASYNC} dismiss={NOOP} />)}
    <div className={css.rowGroup} data-anonymous-row="current-version" data-readonly="true">
      <CurrentVersion t={labels.settings} />
    </div>
  </div>
  const account = <AnonymousAccountSection t={labels.account} useAccount={config.account.useAccount}
    useTheme={config.account.useTheme} signIn={config.account.signIn} copy={config.account.copy} />
  const renderSlot = ((name: string, _props: unknown, options?: { readonly only?: string }) => {
    if (name === 'settings.header') return labels.settings('title')
    if (name === 'settings.close') return labels.settings('close')
    if (name === 'settings.action') return null
    if (name === 'settings.section') {
      const section = options?.only ?? activeId
      if (section === 'general') return general
      if (section === 'account') return account
      if (section === 'models') return <AnonymousModelsSection {...config.models} />
      if (section === 'plugins') return <AnonymousPluginsSection {...config.plugins} />
      if (section === 'agent-presets') return <AnonymousPresetsSection {...config.presets} />
      return null
    }
    return null
  }) as SettingsPanelProps['renderSlot']
  return <SettingsPanel rows={sectionRows(labels)} renderSlot={renderSlot}
    activeId={activeId} onSelect={setActiveId} onClose={onClose} />
}
