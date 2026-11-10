import { useEffect, useId, useState } from 'react';
import { Button, SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { SITE_SETTINGS_PUBLIC_PATHS } from '@dsh-base/site-config/settings';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import selectCss from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css';
import css from './GlobalSettings.module.css';
import { readDraft, type GlobalSettingsStore } from './settings-store.ts';
import { ANALYTICS_FIELDS, LANGUAGES, LLMS_FIELDS, ROBOT_FIELDS, SCOPE_DESCRIPTIONS, imageFields, siteFields, localeFields, pageFields, resetPageFields, type FieldSpec, type SettingsScope } from './fields.ts';
import { NS } from './locales.ts';
import { ConversionSummary } from './ConversionSummary.tsx';
export interface GlobalSettingsFace {
  readonly hooks: { readonly globalSettings: Pick<GlobalSettingsStore, 'getSnapshot' | 'subscribe'> };
  readonly ensure: GlobalSettingsStore['ensure'];
  readonly edit: GlobalSettingsStore['edit'];
  readonly save: () => void;
  readonly reload: () => void;
  readonly discard: GlobalSettingsStore['discard'];
  readonly initialLocale: string;
  readonly scope?: SettingsScope;
}
type Props = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<GlobalSettingsFace>;
export function GlobalSettings(props: Props) {
  // A row change leaves the previous official form, which discards its staged edits.
  return <SettingsEditor key={props.scope ?? 'global'} {...props} />;
}
function SettingsEditor(props: Props) {
  const { t } = props;
  const scope = props.scope ?? 'global';
  const state = props.useGlobalSettings(value => value);
  const [language, setLanguage] = useState(Object.hasOwn(LANGUAGES, props.initialLocale) ? props.initialLocale : 'en');
  const [newPage, setNewPage] = useState(SITE_SETTINGS_PUBLIC_PATHS[0] ?? '');
  const id = useId();
  useEffect(() => { if (props.view === 'page') props.ensure(); }, [props.view, props.ensure]);
  if (props.view === 'summary') return t(SCOPE_DESCRIPTIONS[scope]);
  const disabled = state.baseline?.canEdit !== true || state.saving || state.status === 'loading';
  const pagesValue = readDraft(state.draft, ['seo', 'pages']);
  const publicPaths = state.baseline?.publicPagePaths ?? SITE_SETTINGS_PUBLIC_PATHS;
  const selectedPage = publicPaths.includes(newPage) ? newPage : publicPaths[0] ?? '';
  const pages = pagesValue && typeof pagesValue === 'object' && !Array.isArray(pagesValue) ? Object.keys(pagesValue) : [];
  const field = (spec: FieldSpec) => {
    const key = spec.path.join('.'), fieldId = `${id}-${encodeURIComponent(key)}`;
    const value = readDraft(state.draft, spec.path);
    const text = spec.kind === 'list' ? Array.isArray(value) ? value.join('\n') : '' : value === undefined ? '' : String(value);
    const invalid = state.issues.some(issue => issue.startsWith(`${key}:`) || issue.startsWith(`${key}[`));
    const edit = (next: string) => props.edit(spec.path, spec.kind === 'list' ? next === '' ? [] : next.split('\n') : spec.optional && next === '' ? undefined : spec.kind === 'number' && /^\d+$/u.test(next) ? Number(next) : next);
    const hint = spec.hint ? t(spec.hint) : spec.optional ? t('optional') : undefined;
    const blocked = disabled || spec.locked === true;
    if (spec.kind === 'boolean') return <div key={key} data-global-field={key} className={fieldCss.field}>
      <div className={fieldCss.head}><span className={fieldCss.label}>{t(spec.label)}</span>
        <Switch label={t(spec.label)} checked={typeof value === 'boolean' ? value : spec.defaultValue === true} disabled={blocked} onChange={next => props.edit(spec.path, next)} />
      </div>{hint ? <p className={fieldCss.hint}>{hint}</p> : null}
    </div>;
    if (spec.kind === 'list' || spec.kind === 'multiline' || spec.kind === 'frequency' || spec.kind === 'conversion') return <div key={key} data-global-field={key} className={fieldCss.field}>
      <div className={fieldCss.head}><label htmlFor={fieldId} className={fieldCss.label}>{t(spec.label)}</label>
        {spec.kind === 'list' && spec.optional && value !== undefined ? <button type="button" className={fieldCss.reset} disabled={blocked} onClick={() => props.edit(spec.path, undefined)}>{t('default')}</button> : null}
      </div>
      {spec.kind === 'frequency' || spec.kind === 'conversion' ? <select id={fieldId} className={`${selectCss.input} ${selectCss.selectInput}`} value={spec.kind === 'conversion' ? text || 'off' : text} disabled={blocked} aria-invalid={invalid || undefined} aria-describedby={hint || invalid ? `${fieldId}-hint` : undefined} onChange={event => edit(event.target.value)}>
        {spec.kind === 'conversion' ? (['off', 'aggregate', 'google'] as const).map(value => <option key={value} value={value}>{t(`conversion${value}`)}</option>) : <><option value="">{t('default')}</option>{(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</>}
      </select> : <textarea id={fieldId} className={`${fieldCss.input} ${css.multiline}`} value={text} disabled={blocked} aria-invalid={invalid || undefined} aria-describedby={hint || invalid ? `${fieldId}-hint` : undefined} onChange={event => edit(event.target.value)} />}
      {hint || invalid ? <p id={`${fieldId}-hint`} className={invalid ? fieldCss.invalid : fieldCss.hint}>{invalid ? t('invalid') : hint}</p> : null}
    </div>;
    return <div key={key} data-global-field={key}><SettingsValueField id={fieldId} label={t(spec.label)} {...(hint ? { hint } : {})} text={text} numeric={spec.kind === 'number'} invalid={invalid} disabled={blocked}
      overridden={false} overriddenLabel={t('saved')} resetLabel={t('default')} invalidLabel={t('invalid')} onEdit={edit} onReset={() => props.edit(spec.path, undefined)} /></div>;
  };
  const heading = (key: 'site' | 'pageInfo' | 'icons' | 'indexing' | 'pages' | 'manifest' | 'llms' | 'analytics') => <h4 className={`${fieldCss.label} ${css.sectionHeading}`}>{t(key)}</h4>;
  const errorCopy = state.failure === 'conflict' ? t('conflict') : state.failure === 'forbidden' ? t('readOnly') : state.failure === 'load' ? t('loadFailed') : state.failure === 'invalid' ? t('checkFields') : t('saveFailed');
  return <div data-global-settings data-global-scope={scope} data-state={state.status} aria-busy={state.status === 'loading' || state.saving}>
    <div className={css.actions}>
      {state.baseline ? <p className={fieldCss.hint}>{t(state.baseline.source === 'saved' ? 'savedSource' : 'deployment')}</p> : null}
      <Button size="sm" variant="outline" disabled={state.saving || state.status === 'loading'} onClick={props.reload}>{t(state.dirty ? 'reloadDiscard' : state.status === 'error' ? 'retry' : 'reload')}</Button>
    </div>
    {state.status === 'loading' ? <p className={fieldCss.hint} role="status">{t('loading')}</p> : null}
    {state.failure ? <p className={`${fieldCss.invalid} ${css.notice}`} role="alert">{errorCopy}</p> : null}
    {state.saved ? <p className={fieldCss.hint} role="status">{t('saved')}</p> : null}
    {state.baseline && state.draft ? <SettingsForm labels={{ unavailable: t('loadFailed'), readOnly: t('readOnly'), saveFailed: errorCopy, save: t('save'), saving: t('saving') }}
      state={{ available: true, writable: state.baseline.canEdit, dirty: state.dirty, invalid: state.issues.length > 0 || disabled, saving: state.saving, failed: false }} onSave={props.save} onDiscard={props.discard}>
      {siteFields(scope).length ? <>{heading('site')}{siteFields(scope).map(field)}</> : null}
      {scope === 'global' || scope === 'seo' ? <>{heading('pageInfo')}
      <div className={fieldCss.field}><label htmlFor={`${id}-language`} className={fieldCss.label}>{t('language')}</label>
        <select id={`${id}-language`} data-global-language className={`${selectCss.input} ${selectCss.selectInput}`} value={language} onChange={event => setLanguage(event.target.value)}>{Object.entries(LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      {localeFields(language).map(field)}</> : null}
      {imageFields(scope).length ? <>{heading(scope === 'manifest' ? 'manifest' : 'icons')}{imageFields(scope).map(field)}</> : null}
      {scope === 'global' || scope === 'robots' ? <>{heading('indexing')}{ROBOT_FIELDS.map(field)}</> : null}
      {scope === 'global' || scope === 'llms' ? <>{heading('llms')}{LLMS_FIELDS.map(field)}</> : null}
      {scope === 'global' || scope === 'googleAnalytics' ? <>{heading('analytics')}{ANALYTICS_FIELDS.map(field)}{state.baseline?.canEdit === true ? <ConversionSummary t={t} locale={props.initialLocale} /> : null}</> : null}
      {scope === 'global' || scope === 'seo' || scope === 'sitemap' ? <>{heading('pages')}<p className={fieldCss.hint}>{t('pageHint')}</p>
      {pages.map(path => <section key={path} data-global-page={path} aria-label={path}>
        <div className={css.actions}><h5 className={fieldCss.label}>{path}</h5><Button size="sm" variant="ghost" disabled={disabled} onClick={() => props.edit(['seo', 'pages', path], resetPageFields(readDraft(state.draft, ['seo', 'pages', path]), path, scope))}>{t(scope === 'global' ? 'removePage' : 'resetPage')}</Button></div>
        {pageFields(path, scope).map(field)}
      </section>)}
      <div className={fieldCss.field}><label htmlFor={`${id}-page`} className={fieldCss.label}>{t('pagePath')}</label>
        <div className={css.actions}><select id={`${id}-page`} data-global-page-path className={`${selectCss.input} ${selectCss.selectInput}`} value={selectedPage} disabled={disabled} onChange={event => setNewPage(event.target.value)}>{publicPaths.map(path => <option key={path} value={path}>{path}</option>)}</select>
          <Button size="sm" variant="outline" disabled={disabled || !selectedPage || pages.includes(selectedPage)} onClick={() => props.edit(['seo', 'pages', selectedPage], {})}>{t('addPage')}</Button></div>
      </div></> : null}
      {state.issues.length > 0 ? <p className={fieldCss.invalid} role="status">{t('checkFields')}</p> : null}
    </SettingsForm> : null}
  </div>;
}
