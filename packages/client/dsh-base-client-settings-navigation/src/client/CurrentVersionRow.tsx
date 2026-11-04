/** Installed release version in General Settings for Web and Desktop. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CurrentVersionRow.module.css'

/**
 * Render the version embedded by the client build; partial builds without metadata omit the row.
 * @param props - runtime share and localized copy.
 * @returns the current release label, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const version = process.env.DSH_CLIENT_VERSION
  const upstream = process.env.DSH_CLIENT_UPSTREAM_VERSION
  const repository = process.env.DSH_CLIENT_UPSTREAM_REPOSITORY
  const release = process.env.DSH_CLIENT_UPSTREAM_RELEASE_URL
  if (version === undefined) return null
  return <div className={css.row}>
    {t('general.currentVersion', { version })}
    {upstream === undefined || repository === undefined || release === undefined ? null : <span className={css.upstream}>
      {t('general.upstreamLabel')}
      <a className={css.link} href={repository} target="_blank" rel="noopener noreferrer">DeepSeek Harness</a>
      {t('general.upstreamSeparator')}
      <a className={css.link} href={release} target="_blank" rel="noopener noreferrer">{upstream}</a>
    </span>}
  </div>
}
