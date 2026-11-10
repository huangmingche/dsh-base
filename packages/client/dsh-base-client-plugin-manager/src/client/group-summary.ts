/** Stable, type-only contribution point for optional plugin category summaries. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** One visible card and the component identities declared by that card. */
export interface PluginGroupSummaryEntry {
  readonly key: string
  readonly components: readonly string[]
}

/** The same visible rows and read status used by the surrounding official page. */
export interface PluginGroupSummaryProps {
  readonly group: 'basic' | 'extensions' | 'bundles' | 'more'
  readonly entries: readonly PluginGroupSummaryEntry[]
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  /** Existing official secondary-count typography; the contribution adds no layout chrome. */
  readonly className: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional inline summary; the page supplies data and the contributing plugin owns its presentation. */
    'dsh-base.plugins.group.summary': {
      kind: 'single'
      scope: 'root'
      inline: true
      owner: PluginGroupSummaryProps
    }
  }
}
