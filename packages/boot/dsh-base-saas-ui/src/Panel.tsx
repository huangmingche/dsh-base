import { useEffect, useId, useState } from 'react';
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import selectCss from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css';
import { translator, type Descriptions, type Language } from './locales.ts';
import css from './Panel.module.css';
import { Challenge } from './Challenge.tsx';
import type { Fact, PanelAction, PanelDefinition, PanelStore, Values } from './transport.ts';
export interface PanelFace { readonly hooks: { readonly panel: Pick<PanelStore, 'getSnapshot' | 'subscribe'>; readonly language: { getSnapshot: () => {active: string}; subscribe: (callback: () => void) => () => void } }; readonly definition: PanelDefinition; readonly descriptions: Descriptions; readonly ensure: () => void; readonly reload: () => void; readonly run: (id: string, values: Values) => Promise<void>; readonly clearResult: () => void; readonly leave: () => void; readonly signIn: () => void }
export type PanelProps = PropsRuntime<'plugins.bundle.config'> & InjectFace<PanelFace>;
function FactView({ fact, t }: { readonly fact: Fact; readonly t: (key: string) => string }) {
  const safeHref = fact.href?.startsWith('/api/') && !/[\\\u0000-\u001f]/u.test(fact.href) ? fact.href : undefined;
  return <div className={fieldCss.field}><span className={fieldCss.label}>{t(fact.label)}</span>
    {fact.sensitive ? <><Input readOnly value={fact.value} aria-label={t(fact.label)} autoComplete="off" /><p className={fieldCss.hint}>{t('secretNotice')}</p></>
      : safeHref ? <a href={safeHref} className={fieldCss.hint} download>{fact.value}</a> : <span className={fieldCss.hint}>{fact.value}</span>}
  </div>;
}
function ActionForm({ action, blocked, guest, run, t }: { readonly action: PanelAction; readonly blocked: boolean; readonly guest: boolean; readonly run: (id: string, values: Values) => Promise<void>; readonly t: (key: string) => string }) {
  const id = useId(), [values, setValues] = useState<Record<string, string | File>>(() => Object.fromEntries(action.fields?.filter(field => field.type !== 'file').map(field => [field.id, field.value ?? '']) ?? []));
  const [challenge, setChallenge] = useState(''), [attempt, setAttempt] = useState(0);
  const set = (key: string, value: string | File) => { setValues(previous => ({ ...previous, [key]: value })); };
  const disabled = blocked || action.disabled === true || (!!action.challenge && !action.challengeAction);
  const authBlocked=guest&&action.needsAuth===true;
  return <form className={fieldCss.field} data-saas-action={action.id} onSubmit={event => { event.preventDefault(); if (disabled) return; void run(action.id, { ...values, turnstileToken: challenge }).finally(() => { setChallenge(''); setAttempt(value => value + 1); }); }}>
    {action.fields?.map(field => <div className={fieldCss.field} key={field.id}>
      {field.type === 'checkbox' ? <div className={fieldCss.head}><label className={fieldCss.label} htmlFor={`${id}-${field.id}`}>{t(field.label)}</label><Switch label={t(field.label)} checked={values[field.id] === 'true'} disabled={disabled||authBlocked} onChange={value => set(field.id, String(value))} /></div>
        : <><label className={fieldCss.label} htmlFor={`${id}-${field.id}`}>{t(field.label)}</label>
          {field.type === 'file' ? <Input id={`${id}-${field.id}`} type="file" required={field.required} accept={field.accept} disabled={disabled||authBlocked} onChange={event => { const file = event.target.files?.[0]; if (file) set(field.id, file); }} />
            : field.type === 'select' ? <select id={`${id}-${field.id}`} className={`${selectCss.input} ${selectCss.selectInput}`} disabled={disabled||authBlocked} value={String(values[field.id] ?? '')} onChange={event => set(field.id, event.target.value)}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.translated ? t(option.label) : option.label}</option>)}</select>
              : field.type === 'textarea' ? <textarea id={`${id}-${field.id}`} className={`${fieldCss.input} ${css.multiline}`} required={field.required} minLength={field.minLength} maxLength={field.maxLength} disabled={disabled||authBlocked} value={String(values[field.id] ?? '')} onChange={event => set(field.id, event.target.value)} />
                : <Input id={`${id}-${field.id}`} type={field.type ?? 'text'} required={field.required} minLength={field.minLength} maxLength={field.maxLength} disabled={disabled||authBlocked} value={String(values[field.id] ?? '')} autoComplete={field.type === 'password' ? 'off' : undefined} onChange={event => set(field.id, event.target.value)} />}</>}
    </div>)}
    {action.challenge && action.challengeAction && !disabled ? <Challenge key={attempt} siteKey={action.challenge} action={action.challengeAction} onToken={setChallenge} failedLabel={t('challengeFailed')} /> : null}
    <div className={fieldCss.head}><Button size="sm" variant={action.fields?.length ? 'primary' : 'outline'} type={authBlocked?'button':'submit'} onClick={authBlocked?()=>{void run(action.id,{});}:undefined}
      disabled={disabled || (!authBlocked&&((!!action.challenge && !challenge) || action.fields?.some(field => field.type === 'checkbox' && field.required && values[field.id] !== 'true')))}>{t(authBlocked ? 'signIn' : action.label)}</Button></div>
  </form>;
}
/** Reusable rendering and lifecycle only. Each client plugin supplies its own schema and actions. */
export function Panel(props: PanelProps) {
  const language = props.useLanguage(value => value.active), t = translator(language), state = props.usePanel(value => value);
  useEffect(() => { if (props.view === 'page') {props.ensure();return props.leave;} }, [props.view, props.ensure,props.leave]);
  if (props.view === 'summary') return props.descriptions[language as Language] ?? props.descriptions.en;
  const loading = state.status === 'idle' || state.status === 'loading';
  const view = state.data !== undefined ? props.definition.view(state.data, t) : undefined;
  const actions = state.data !== undefined ? props.definition.actions?.(state.data) ?? [] : [];
  const blocked = loading || !!state.busy || state.status !== 'ready' || view?.available === false;
  const guest = state.auth === 'guest';
  return <div data-saas-panel={props.definition.bundle} data-state={state.status} aria-busy={loading || !!state.busy}>
    <div className={fieldCss.field}><div className={fieldCss.head}><span className={fieldCss.label} role="status">{t(loading ? 'loading' : state.status === 'error' ? 'failed' : state.status === 'denied' ? 'denied' : view?.available === false ? 'unavailable' : 'ready')}</span>
      <Button size="sm" variant="outline" disabled={loading || !!state.busy} onClick={props.reload}>{t('refresh')}</Button></div>
      {state.status === 'error' || state.failed ? <p className={fieldCss.invalid} role="alert">{t(state.failed ? 'actionFailed' : 'failed')}</p> : null}
      {state.refreshFailed?<p className={fieldCss.invalid} role="alert">{t('failed')}</p>:null}
      {view?.notice ? <p className={fieldCss.hint}>{view.notice}</p> : null}
      {state.saved ? <p className={fieldCss.hint} role="status">{t('saved')}</p> : null}
      {guest && (props.definition.access === 'account' || props.definition.checkSession) ? <><p className={fieldCss.hint}>{t('guest')}</p><div className={fieldCss.head}><Button size="sm" variant="primary" onClick={props.signIn}>{t('signIn')}</Button></div></> : null}
    </div>
    {view?.facts?.map((fact, index) => <FactView key={index} fact={fact} t={t} />)}
    {actions.map(action => <ActionForm key={`${state.revision}-${action.id}`} action={action} blocked={blocked} guest={guest} run={props.run} t={t} />)}
    {view?.empty ? <p className={fieldCss.hint}>{t('empty')}</p> : null}
    {view?.rows?.map(row => <section className={fieldCss.field} key={row.id} data-saas-row={row.id}>{row.facts.map((fact, index) => <FactView key={index} fact={fact} t={t} />)}{row.actions?.map(action => <ActionForm key={`${state.revision}-${action.id}`} action={action} blocked={blocked} guest={guest} run={props.run} t={t} />)}</section>)}
    {state.result?.length ? <section className={fieldCss.field} data-saas-result>{state.result.map((fact, index) => <FactView key={index} fact={fact} t={t} />)}<div className={fieldCss.head}><Button size="sm" variant="ghost" onClick={props.clearResult}>{t('clear')}</Button></div></section> : null}
  </div>;
}
