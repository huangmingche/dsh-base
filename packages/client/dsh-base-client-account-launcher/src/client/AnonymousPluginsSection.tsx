/**
 * Anonymous built-in plugins section: the official read-only inventory tab.
 *
 * The official Plugins section owns the `settings.plugins.tab` ledger, which
 * only exists under the settings access gate, so nothing renders while
 * anonymous. The tab component itself needs a narrow injected face only, and
 * our session adapter already exposes the read-only `remote.pluginInventory`
 * seam (real client Loader entries plus the pinned Think declaration rows, no
 * network). This page therefore mounts the official tab directly and keeps
 * the official title/intro copy from the `settings.plugins` dictionary.
 */
import type { ReactElement } from 'react'
import type { ClientEntryState } from '@deepseek-ai/dsh-client-modules/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import { PluginInventorySettingsTab } from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AnonymousPluginsSection.module.css'

type AgentPresetGroup = NonNullable<PluginInventorySnapshot['agentPresets']>[number]

/** Props the official tab reads from its composed face. */
type TabProps = {
  readonly t: Translate
  readonly useClientSync: SnapshotSelectorHook<ClientEntryState>
  readonly list: () => Promise<PluginInventorySnapshot>
  readonly presetName: (preset: AgentPresetGroup) => string
  readonly resolveText: (text: LocalizedText) => string
  readonly retryClient: () => void
}

const Tab = PluginInventorySettingsTab as unknown as (props: TabProps) => ReactElement

/** Props of the anonymous built-in plugins section. */
export interface AnonymousPluginsSectionProps {
  /** Official `settings.plugins` copy (`title` / `intro`). */
  readonly t: Translate
  /** Official `settings.pluginInventory` copy for the tab body. */
  readonly tabT: Translate
  /** Anonymous client-graph state; a stable empty snapshot, never a Host read. */
  readonly useClientSync: SnapshotSelectorHook<ClientEntryState>
  /** Read-only inventory seam over the local client composition. */
  readonly list: () => Promise<PluginInventorySnapshot>
  /** Official preset display-name fold over the agent-preset dictionary. */
  readonly presetName: (preset: AgentPresetGroup) => string
  /** Official package-text resolver for the active locale. */
  readonly resolveText: (text: LocalizedText) => string
  /** No client graph retry exists while anonymous. */
  readonly retryClient: () => void
}

/**
 * Render the official read-only plugin inventory inside our section header.
 * @param props - official copy, the read-only seam and the anonymous graph stub.
 * @returns the built-in plugins section content.
 */
export function AnonymousPluginsSection({
  t, tabT, useClientSync, list, presetName, resolveText, retryClient,
}: AnonymousPluginsSectionProps): ReactElement {
  return <section className={css.section} data-anonymous-plugins="true">
    <h2 className={css.heading}>{t('title')}</h2>
    <p className={css.intro}>{t('intro')}</p>
    <div className={css.panel}>
      <Tab t={tabT} useClientSync={useClientSync} list={list} presetName={presetName}
        resolveText={resolveText} retryClient={retryClient} />
    </div>
  </section>
}
