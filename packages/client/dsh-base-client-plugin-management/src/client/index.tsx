/** Official plugin-detail section: precise management scope for this Worker-native deployment. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/slot-contract.ts'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createFetchConfigStore, type CurrentSessionSource } from './fetch-config.ts'
import { isManageableClientModule, isManageableThinkModule } from '../../../../boot/dsh-base-plugin-management/src/index.ts'
import { GATEWAY_PANEL_COPY, MANAGEMENT_PANEL_COPY, panelKey } from './panel-copy.ts'
import { installUnavailableBuiltins } from './builtin-availability.tsx'
import styles from './Panel.module.css'

export const name = '@dsh-base/client-plugin-management'
export const inject = ['slots', 'locale', 'uiSession', 'configForms']
export const Config = z.object({}).default({})
const NS = 'pluginManagementScope'
const TEXT = {
  en: {
    ...GATEWAY_PANEL_COPY.en,
    ...MANAGEMENT_PANEL_COPY.en,
    fetchHint: "Limit which web addresses the Agent can fetch. Entries must stay within the site’s allowed range; leave blank to use the default.",
    fetchLabel: "Allowed web addresses",
    save: "Save",
    restore: "Restore default",
    saved: "Saved",
    saveFailed: "Save failed",
    fetchPlaceholder: "Enter HTTPS addresses or patterns, separated by commas or newlines.",
    ownerScope: "Account default",
    sessionScope: "This session",
  },
  zh: {
    ...GATEWAY_PANEL_COPY.zh,
    ...MANAGEMENT_PANEL_COPY.zh,
    fetchHint: "设置 Agent 可抓取的网页范围。不能超出站点允许的范围；留空使用默认设置。",
    fetchLabel: "网页访问范围",
    save: "保存",
    restore: "恢复默认",
    saved: "已保存",
    saveFailed: "保存失败",
    fetchPlaceholder: "输入 HTTPS 地址或匹配模式，使用逗号或换行分隔。",
    ownerScope: "账号默认",
    sessionScope: "当前会话",
  },
  ja: {
    ...GATEWAY_PANEL_COPY.ja,
    ...MANAGEMENT_PANEL_COPY.ja,
    fetchHint: "Agent が取得できるウェブアドレスを制限します。サイトで許可された範囲内で指定してください。空欄の場合は既定の設定を使います。",
    fetchLabel: "許可するウェブアドレス",
    save: "保存",
    restore: "既定に戻す",
    saved: "保存しました",
    saveFailed: "保存できませんでした",
    fetchPlaceholder: "HTTPS アドレスまたはパターンをカンマか改行で区切って入力してください。",
    ownerScope: "アカウントの既定",
    sessionScope: "このセッション",
  },
  es: {
    ...GATEWAY_PANEL_COPY.es,
    ...MANAGEMENT_PANEL_COPY.es,
    fetchHint: "Limita las direcciones web que puede consultar el Agent. Deben estar dentro del rango permitido por el sitio; déjalo vacío para usar el valor predeterminado.",
    fetchLabel: "Direcciones web permitidas",
    save: "Guardar",
    restore: "Restaurar valor predeterminado",
    saved: "Guardado",
    saveFailed: "No se pudo guardar",
    fetchPlaceholder: "Introduce direcciones HTTPS o patrones separados por comas o saltos de línea.",
    ownerScope: "Predeterminado de la cuenta",
    sessionScope: "Esta sesión",
  },
  fr: {
    ...GATEWAY_PANEL_COPY.fr,
    ...MANAGEMENT_PANEL_COPY.fr,
    fetchHint: "Limitez les adresses web que l’Agent peut consulter. Elles doivent rester dans le périmètre autorisé par le site. Laissez ce champ vide pour utiliser le réglage par défaut.",
    fetchLabel: "Adresses web autorisées",
    save: "Enregistrer",
    restore: "Rétablir le réglage par défaut",
    saved: "Enregistré",
    saveFailed: "Échec de l’enregistrement",
    fetchPlaceholder: "Saisissez des adresses HTTPS ou des motifs séparés par des virgules ou des retours à la ligne.",
    ownerScope: "Par défaut pour le compte",
    sessionScope: "Cette session",
  },
  de: {
    ...GATEWAY_PANEL_COPY.de,
    ...MANAGEMENT_PANEL_COPY.de,
    fetchHint: "Begrenzt die Webadressen, die der Agent abrufen darf. Die Einträge müssen im erlaubten Bereich der Website liegen. Leer lassen, um die Vorgabe zu verwenden.",
    fetchLabel: "Erlaubte Webadressen",
    save: "Speichern",
    restore: "Vorgabe wiederherstellen",
    saved: "Gespeichert",
    saveFailed: "Speichern fehlgeschlagen",
    fetchPlaceholder: "HTTPS-Adressen oder Muster durch Kommas oder Zeilenumbrüche getrennt eingeben.",
    ownerScope: "Kontovorgabe",
    sessionScope: "Diese Sitzung",
  },
  ru: {
    ...GATEWAY_PANEL_COPY.ru,
    ...MANAGEMENT_PANEL_COPY.ru,
    fetchHint: "Ограничьте веб-адреса, к которым может обращаться Agent. Они должны входить в разрешённую сайтом область. Оставьте поле пустым, чтобы использовать настройку по умолчанию.",
    fetchLabel: "Разрешённые веб-адреса",
    save: "Сохранить",
    restore: "Восстановить значение по умолчанию",
    saved: "Сохранено",
    saveFailed: "Не удалось сохранить",
    fetchPlaceholder: "Введите HTTPS-адреса или шаблоны через запятую или с новой строки.",
    ownerScope: "По умолчанию для аккаунта",
    sessionScope: "Этот сеанс",
  },
  pt: {
    ...GATEWAY_PANEL_COPY.pt,
    ...MANAGEMENT_PANEL_COPY.pt,
    fetchHint: "Limite os endereços web que o Agent pode consultar. As entradas devem estar dentro do âmbito permitido pelo site; deixe em branco para usar a predefinição.",
    fetchLabel: "Endereços web permitidos",
    save: "Guardar",
    restore: "Restaurar predefinição",
    saved: "Guardado",
    saveFailed: "Não foi possível guardar",
    fetchPlaceholder: "Introduza endereços HTTPS ou padrões, separados por vírgulas ou mudanças de linha.",
    ownerScope: "Predefinição da conta",
    sessionScope: "Esta sessão",
  },
} as const
type Copy = Record<keyof typeof TEXT.en, string>
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'pluginManagementScope': keyof Copy }
}
type PanelProps = PropsRuntime<'plugins.detail.section'> & PropsLocale<typeof NS>
function ManagementScope({ subject, t }: PanelProps) {
  const key = panelKey(subject, isManageableThinkModule, isManageableClientModule)
  if (key === undefined) return null
  return <section className={styles['section']} data-plugin-management-scope>
    <p className={styles['title']}>{t(key.title)}</p>
    <p className={styles['body']}>{t(key.body)}</p>
  </section>
}
type RowConfigProps = PropsRuntime<'plugins.row.config'> & PropsLocale<typeof NS> & { currentSession: CurrentSessionSource }
const THINK_FETCH = '@dsh-base/cloudflare-think-fetch'
const THINK_FETCH_ROW = `${THINK_FETCH}#cloudflare:think:fetch`
/** Official row-configuration slot, bound to the official current Session store. */
function ThinkFetchConfig({ view, t, currentSession }: RowConfigProps) {
  const store = useMemo(() => createFetchConfigStore(currentSession), [currentSession])
  const { scope, sessionId, text, status, busy, ready } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => store.connect(), [store])
  if (view === 'summary') return <>{t('fetchHint')}</>
  return <section className={styles['config']} data-think-fetch-config>
    <p className={styles['title']}>{t('fetchLabel')}</p>
    <p className={styles['body']}>{t('fetchHint')}</p>
    {sessionId === undefined && scope !== 'session' ? null : <div className={styles['configActions']} role="radiogroup">
      <label><input type="radio" checked={scope === 'owner'} onChange={() => store.setScope('owner')} /> {t('ownerScope')}</label>
      <label><input type="radio" checked={scope === 'session'} disabled={sessionId === undefined} onChange={() => store.setScope('session')} /> {t('sessionScope')}</label>
    </div>}
    <textarea className={styles['configInput']} value={text} placeholder={t('fetchPlaceholder')} disabled={busy || !ready} onChange={event => store.setText(event.target.value)} rows={4} />
    <div className={styles['configActions']}>
      <button type="button" className={styles['configButton']} disabled={busy || !ready} onClick={() => { void store.save() }}>{t('save')}</button>
      <button type="button" className={styles['configButtonSecondary']} disabled={busy || !ready} onClick={() => { void store.restore() }}>{t('restore')}</button>
    </div>
    {status === undefined ? null : <p className={'saved' in status ? styles['configOk'] : styles['configError']} role="status">{'saved' in status ? t('saved') : status.error}</p>}
  </section>
}

export function apply(ctx: ClientContext): void {
  installUnavailableBuiltins(ctx)
  ctx.effect(() => ctx.locale.register(NS, TEXT), 'plugin-management-scope: dictionaries')
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', id: 'dsh-base-management-scope', locale: NS, order: 10,
  }, ManagementScope))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: THINK_FETCH_ROW, locale: NS,
    inject: () => ({ currentSession: ctx.uiSession.adapter.current }),
  }, ThinkFetchConfig))
}
