import type { PluginGroupSummaryProps } from '@dsh-base/client-plugin-manager/group-summary'

/** Totals for one displayed category, never a sum of overlapping categories. */
export interface GroupCounts {
  readonly count: number
  readonly components: number
}

/** Keep package identity and component identity distinct without reading runtime state. */
export function countGroup(entries: PluginGroupSummaryProps['entries']): GroupCounts {
  const components = new Map<string, Set<string>>()
  for (const entry of entries) {
    let rows = components.get(entry.key)
    if (rows === undefined) {
      rows = new Set()
      components.set(entry.key, rows)
    }
    for (const row of entry.components) rows.add(row)
  }
  return {
    count: components.size,
    components: [...components.values()].reduce((total, rows) => total + rows.size, 0),
  }
}
