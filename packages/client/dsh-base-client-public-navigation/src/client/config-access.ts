import type { ReactNode } from 'react'
import type { PluginManagerPageProps } from '@dsh-base/client-plugin-manager/src/client/PluginManagerPage.tsx'
import type { PublicPluginConfigurations } from './public-configurations.ts'

/** Descriptors stay visible; only explicitly registered, action-gated bundle seats mount for guests. */
export function publicConfigurationRenderer(
  renderSlot: PluginManagerPageProps['renderSlot'],
  renderGuest: (view: 'summary' | 'page') => ReactNode,
  configurations?: Pick<PublicPluginConfigurations, 'hasBundle'>,
): PluginManagerPageProps['renderSlot'] {
  return (...args) => {
    if (args[0] === 'plugins.bundle.config' && typeof args[2]?.entryKey === 'string' && configurations?.hasBundle(args[2].entryKey)) return renderSlot(...args)
    if (args[0] === 'plugins.bundle.config' || args[0] === 'plugins.row.config') {
      const input = args[1]
      return renderGuest(input !== undefined && 'view' in input && input.view === 'summary' ? 'summary' : 'page')
    }
    return renderSlot(...args)
  }
}
