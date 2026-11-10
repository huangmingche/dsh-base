import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@dsh-base/client-plugin-manager/group-summary'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { z } from 'zod'
import { countGroup } from './counts.ts'
import { COUNT_LOCALES, NS } from './locales.ts'
import css from './PluginGroupCount.module.css'

export { COUNT_LOCALES, NS } from './locales.ts'
export const name = '@dsh-base/client-plugin-counts'
export const inject = ['slots', 'locale']
export const Config = z.object({}).default({})

export type PluginGroupCountProps = PropsRuntime<'dsh-base.plugins.group.summary'> & PropsLocale<typeof NS>

/** Keep the original text class; spacing belongs to this optional contribution. */
export function PluginGroupCount({ group, entries, status, className, t }: PluginGroupCountProps) {
  if (status !== 'ready') return null
  const counts = countGroup(entries)
  const count = { count: String(counts.count) }
  const label = group === 'bundles'
    ? t('installed', {
      bundles: t(counts.count === 1 ? 'bundleOne' : 'bundleMany', count),
      components: t(counts.components === 1 ? 'componentOne' : 'componentMany', { count: String(counts.components) }),
    })
    : group === 'basic'
      ? t(counts.count === 1 ? 'configurationOne' : 'configurationMany', count)
      : t(counts.count === 1 ? 'pluginOne' : 'pluginMany', count)
  return createElement('span', {
    className: `${className} ${css.summary}`,
    'data-plugin-category-count': group,
    'data-count': counts.count,
    'data-component-count': counts.components,
    'aria-label': label,
  }, group === 'bundles' ? label : String(counts.count))
}

/** Framework-owned registration follows page slot availability and plugin disposal. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, COUNT_LOCALES), 'plugin-counts: dictionaries')
  ctx.slots.inject('dsh-base.plugins.group.summary', () => ctx.slots.register({
    name: 'dsh-base.plugins.group.summary', locale: NS,
  }, PluginGroupCount))
}
