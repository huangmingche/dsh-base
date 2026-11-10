import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import css from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import type { ConversionConsent } from './consent.ts';
export const NS = 'dshBase.analyticsConsent';
export const consentLocales = {
  en: { unavailable: 'Conversion sharing is not enabled for this site.', label: 'Share conversion statistics', hint: 'Allow Google Analytics for registration and payment actions in this tab. No account details are shared. Resets on refresh.' },
  zh: { unavailable: '此站点尚未启用转化分享。', label: '分享转化统计', hint: '允许向 Google Analytics 发送本标签页的注册和付款操作统计，不包含账号资料。刷新后重置。' },
  ja: { unavailable: 'このサイトではコンバージョン共有が有効になっていません。', label: 'コンバージョン統計を共有', hint: 'このタブの登録・決済操作を Google Analytics に送信します。アカウント情報は含まず、再読み込みでリセットします。' },
  es: { unavailable: 'Este sitio no ha activado el uso compartido de conversiones.', label: 'Compartir estadísticas de conversión', hint: 'Permite enviar registros y pagos de esta pestaña a Google Analytics, sin datos de la cuenta. Se restablece al recargar.' },
  fr: { unavailable: 'Le partage des conversions n’est pas activé sur ce site.', label: 'Partager les statistiques de conversion', hint: 'Autoriser Google Analytics pour les inscriptions et paiements de cet onglet, sans données du compte. Réinitialisé au rechargement.' },
  de: { unavailable: 'Das Teilen von Konversionen ist für diese Website nicht aktiviert.', label: 'Konversionsstatistiken teilen', hint: 'Registrierungen und Zahlungen dieses Tabs an Google Analytics senden, ohne Kontodaten. Wird beim Neuladen zurückgesetzt.' },
  ru: { unavailable: 'На этом сайте передача конверсий не включена.', label: 'Делиться статистикой конверсий', hint: 'Отправлять регистрации и платежи этой вкладки в Google Analytics без данных аккаунта. Сбрасывается при обновлении.' },
  pt: { unavailable: 'A partilha de conversões não está ativada neste site.', label: 'Partilhar estatísticas de conversão', hint: 'Permite enviar registos e pagamentos desta aba ao Google Analytics, sem dados da conta. Reinicia ao atualizar.' },
};
interface Face { readonly hooks: { readonly consent: Pick<ConversionConsent, 'getSnapshot' | 'subscribe'> }; readonly setConsent: ConversionConsent['setConsent'] }
export function ConsentRow({ useConsent, setConsent, t }: PropsRuntime<'settings.general.item'> & PropsLocale<typeof NS> & InjectFace<Face>) {
  const state = useConsent(value => value);
  const label = t('label');
  return <div className={css.field} data-analytics-consent>
    <div className={css.head}>
      <span className={css.label}>{label}</span>
      <Switch label={label} checked={state.consent} disabled={!state.available}
        title={state.available ? undefined : t('unavailable')} onChange={setConsent} />
    </div>
    <p className={css.hint}>{t(state.available ? 'hint' : 'unavailable')}</p>
  </div>;
}
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'dshBase.analyticsConsent': keyof typeof consentLocales.en } }
