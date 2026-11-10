/**
 * Anonymous agent-presets section: the official (forked) preset section.
 *
 * The forked official `AgentPresetSection` reads only a roster store plus the
 * shared Developer-tools observable, so it mounts without the settings slot
 * graph. The roster comes from our local read-only `remote.agentPresets` seam:
 * the four pinned official modes arrive with their localized `unavailable`
 * reason, and the canonical Cloudflare Think composition is the current
 * default. Every "use as default" control is therefore disabled or
 * aria-disabled with a visible reason; the composition of the canonical row is
 * not readable here, so its viewer is disabled with the official copy too.
 */
import type { ReactElement } from 'react'
import { AgentPresetSection, type AgentPresetSectionState } from '@dsh-base/client-agent-preset/client'
import type { SnapshotSelectorHook, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AnonymousPresetsSection.module.css'

/** Props the forked official section reads from its composed face. */
type SectionProps = {
  readonly t: Translate
  readonly useAgentPresetSection: SnapshotSelectorHook<AgentPresetSectionState>
  readonly useDeveloperTools: SnapshotSelectorHook<boolean>
  readonly load: () => Promise<void>
  readonly view: (id: string) => Promise<void>
  readonly closeView: () => void
  readonly makeDefault: (id: string) => Promise<void>
  readonly close: () => void
  readonly viewUnavailableReason: (id: string) => string | undefined
}

const Section = AgentPresetSection as unknown as (props: SectionProps) => ReactElement

/** Props of the anonymous agent-presets section. */
export interface AnonymousPresetsSectionProps extends SectionProps {}

/**
 * Render the official agent-preset roster read-only.
 * @param props - official copy, the roster store and the anonymous refusal paths.
 * @returns the agent-presets section content.
 */
export function AnonymousPresetsSection(props: AnonymousPresetsSectionProps): ReactElement {
  return <div className={css.wrap} data-anonymous-presets="true">
    <Section {...props} />
  </div>
}
