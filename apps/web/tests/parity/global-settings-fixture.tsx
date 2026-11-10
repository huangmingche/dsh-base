/** Exercise the actual plugin registration; compare shared controls with unmodified official exports. */
import React, { useMemo, useEffect, useSyncExternalStore } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives';
import modelCss from '@deepseek-ai/dsh-client-ui-settings-models/src/client/ModelsSection.module.css';
import { SITE_SETTINGS_PUBLIC_PATHS } from '@dsh-base/site-config/settings';
import { apply } from '../../../../packages/client/dsh-base-client-global-settings/src/client/index.ts';
import { locales } from '../../../../packages/client/dsh-base-client-global-settings/src/client/locales.ts';
import { GlobalSettingsStore, readDraft } from '../../../../packages/client/dsh-base-client-global-settings/src/client/settings-store.ts';

export function GlobalSettingsFixture({ locale, adapted }: { locale: 'en' | 'zh'; adapted: boolean }) {
  const setup = useMemo(() => {
    let refreshes = 0;
    const ctx = new Context();
    const dictionaries = new Map<string, any>();
    ctx.provide('locale', { getSnapshot: () => ({ active: locale, revision: 1 }), subscribe: () => () => {}, register: (ns: string, value: any) => { dictionaries.set(ns, value); return () => dictionaries.delete(ns); } } as never);
    ctx.provide('siteConfig', { getSnapshot: () => ({ config: { brand: { name: 'Fixture' }, links: {} } }), subscribe: () => () => {}, refresh: async () => { refreshes++; return true; } } as never);
    new SlotRegistry(ctx);
    ctx.slots.register({ name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } } } as never, (() => null) as never);
    apply(ctx);
    const entries = ctx.slots.entriesOfSlot('plugins.bundle.config');
    const entry = entries.find(item => item.options.key === 'dsh-base:global');
    if (!entry) throw new Error('The actual global settings plugin did not register its bundle configuration');
    const injection = entry.inject!() as any;
    const store = adapted ? injection.hooks.globalSettings as GlobalSettingsStore : new GlobalSettingsStore();
    const t = (key: keyof typeof locales.en) => locales[locale][key];
    (window as any).__GLOBAL_SETTINGS_TEST__ = { store, registrations: entries.length, refreshes: () => refreshes };
    return { entry, injection, store, t };
  }, [locale, adapted]);
  const state = useSyncExternalStore(setup.store.subscribe, setup.store.getSnapshot);
  useEffect(() => { if (!adapted) setup.store.ensure(); }, [setup, adapted]);
  const Component = setup.entry.component as React.ComponentType<any>;
  const selectReference = !adapted && new URLSearchParams(window.location.search).get('globalControls') === 'selects';
  const selectClass = `${modelCss.input} ${modelCss.selectInput}`;
  const languages = { en: 'English', zh: '简体中文', ja: '日本語', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский', pt: 'Português' };
  return <main style={{ width: 'calc(100% - 64px)', maxWidth: 720, margin: '0 auto', paddingBlock: 32, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
    {selectReference ? <div data-reference-select-host style={{ display: 'flex', flexDirection: 'column' }}>
      <div data-reference-before-select />
      <select data-reference-select="page" className={selectClass} disabled={!state.baseline?.canEdit}>{SITE_SETTINGS_PUBLIC_PATHS.map(path => <option key={path} value={path}>{path}</option>)}</select>
      <select data-reference-select="language" className={selectClass} defaultValue={locale}>{Object.entries(languages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select data-reference-select="frequency" className={selectClass} disabled={!state.baseline?.canEdit}><option value="">{setup.t('default')}</option>{(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const).map(value => <option key={value} value={value}>{setup.t(value)}</option>)}</select>
      <div data-reference-after-select />
    </div> : adapted ? <Component {...setup.injection} view="page" t={setup.t} useGlobalSettings={(select: any) => select(state)} />
      : <div data-reference-form><SettingsForm labels={{ unavailable: setup.t('loading'), readOnly: setup.t('readOnly'), saveFailed: setup.t('saveFailed'), save: setup.t('save'), saving: setup.t('saving') }}
        state={{ available: Boolean(state.baseline), writable: state.baseline?.canEdit === true, dirty: state.dirty, invalid: !state.baseline?.canEdit, saving: state.saving, failed: false }}
        onSave={() => { void setup.store.save(); }} onDiscard={setup.store.discard}>
        <div data-reference-before-field /><div data-global-field="seo.site.name"><SettingsValueField id="reference-name" label={setup.t('name')} text={String(readDraft(state.draft, ['seo', 'site', 'name']) ?? '')}
          disabled={!state.baseline?.canEdit} invalid={false} overridden={false} overriddenLabel={setup.t('saved')} resetLabel={setup.t('default')} invalidLabel={setup.t('invalid')}
          onEdit={text => setup.store.edit(['seo', 'site', 'name'], text)} onReset={() => {}} /></div><div data-reference-after-field />
      </SettingsForm></div>}
  </main>;
}
