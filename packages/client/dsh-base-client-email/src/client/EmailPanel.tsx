import { useEffect } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import type { EmailStatusStore } from './status-store.ts';
import { NS } from './locales.ts';
export interface EmailFace { readonly hooks: { readonly emailStatus: Pick<EmailStatusStore, 'getSnapshot' | 'subscribe'> }; readonly ensure: EmailStatusStore['ensure']; readonly reload: () => void }
export type EmailProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<EmailFace>;
export function EmailPanel(props: EmailProps) {
  const state = props.useEmailStatus(value => value), { t } = props;
  useEffect(() => { if (props.view === 'page') props.ensure(); }, [props.view, props.ensure]);
  if (props.view === 'summary') return t('description');
  const loading = state.status === 'idle' || state.status === 'loading';
  return <div data-email-panel data-state={state.status} aria-busy={loading}>
    <div className={fieldCss.field}>
      <div className={fieldCss.head}><span className={fieldCss.label} role="status">{t(loading ? 'loading' : state.status === 'error' ? 'failed' : state.email?.ready ? 'ready' : state.email?.enabled ? 'unconfigured' : 'disabled')}</span>
        <Button size="sm" variant="outline" disabled={loading} onClick={props.reload}>{t('refresh')}</Button></div>
      {state.status === 'error' ? <p className={fieldCss.invalid} role="alert">{t('failed')}</p> : null}
      <p className={fieldCss.hint}>{t('scope')}</p>
    </div>
    <div className={fieldCss.field}><span className={fieldCss.label}>{t('provider')}</span><p className={fieldCss.hint}>{state.email?.provider === 'resend' ? 'Resend' : state.email?.provider === 'cloudflare' ? 'Cloudflare Email Service' : t('none')}</p></div>
    <div className={fieldCss.field}><p className={fieldCss.hint}>{t('setup')}</p><p className={fieldCss.hint}>{t('actions')}</p></div>
  </div>;
}
