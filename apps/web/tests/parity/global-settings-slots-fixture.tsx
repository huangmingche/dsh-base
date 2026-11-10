/** Real configuration slots mounted on both the pinned official and adapted Plugins pages. */
import React, { useEffect, useSyncExternalStore } from 'react';
import { Context } from '@deepseek-ai/cordis';
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { configLedgerSource } from '@deepseek-ai/dsh-client-ui-plugin-manager/src/client/config-ledger.ts';
import { SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import fieldCss from '@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css';
import { apply } from '../../../../packages/client/dsh-base-client-global-settings/src/client/index.ts';
import type { GlobalSettingsStore } from '../../../../packages/client/dsh-base-client-global-settings/src/client/settings-store.ts';

function Entry({ entry, owner, t }: { entry: any; owner: any; t: any }) {
  const face = entry.inject();
  const state = useSyncExternalStore(face.hooks.globalSettings.subscribe, face.hooks.globalSettings.getSnapshot);
  const Component = entry.component;
  if (face.scope === 'googleAnalytics' && new URLSearchParams(window.location.search).has('controlReference')) return <Reference store={face.hooks.globalSettings} t={t} />;
  return <Component {...face} {...owner} t={t} useGlobalSettings={(select: any) => select(state)} />;
}
function Reference({ store, t }: { store: GlobalSettingsStore; t: any }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.ensure(), [store]);
  const disabled = !state.baseline?.canEdit;
  const google = (state.draft?.analytics as any)?.google;
  return <div data-site-reference data-global-settings data-global-scope="googleAnalytics">
    <SettingsForm labels={{ unavailable: t('loadFailed'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}
      state={{ available: !!state.baseline, writable: !disabled, dirty: state.dirty, invalid: disabled || state.issues.length > 0, saving: state.saving, failed: false }}
      onSave={() => { void store.save(); }} onDiscard={store.discard}>
      <div data-reference-before />
      <div data-reference-control="switch" className={fieldCss.field}><div className={fieldCss.head}><span className={fieldCss.label}>{t('googleEnabled')}</span><Switch label={t('googleEnabled')} checked={google?.enabled === true} disabled={disabled} onChange={next => store.edit(['analytics', 'google', 'enabled'], next)} /></div></div>
      <div data-reference-control="field"><SettingsValueField id="reference-id" label={t('measurementId')} hint={t('measurementHint')} text={google?.measurementId ?? ''}
        disabled={disabled} invalid={false} overridden={false} overriddenLabel={t('saved')} resetLabel={t('default')} invalidLabel={t('invalid')}
        onEdit={text => store.edit(['analytics', 'google', 'measurementId'], text)} onReset={() => store.edit(['analytics', 'google', 'measurementId'], undefined)} /></div>
    </SettingsForm>
    <div data-reference-after />
  </div>;
}
export function createGlobalSettingsSlotsFixture(locale: 'en' | 'zh') {
  const ctx = new Context(), dictionaries = new Map<string, any>();
  const localeStore = createSnapshotStore({ active: locale, revision: 1 });
  const bind = (namespace: string) => (key: string) => dictionaries.get(namespace)?.[locale]?.[key] ?? key;
  ctx.provide('locale', { ...localeStore, bind, register: (namespace: string, dictionary: any) => {
    dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace);
  } } as never);
  ctx.provide('siteConfig', { refresh: async () => true } as never);
  new SlotRegistry(ctx);
  ctx.slots.register({ name: 'root', children: {
    'plugins.item': { kind: 'list', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
  } } as never, (() => null) as never);
  apply(ctx);
  const bundle = ctx.slots.entriesOfSlot('plugins.bundle.config')[0]!;
  const store = (bundle.inject!() as any).hooks.globalSettings as GlobalSettingsStore;
  (window as any).__SITE_SETTINGS_SCOPES__ = { store, rowKeys: ctx.slots.entriesOfSlot('plugins.row.config').map(entry => entry.options.key) };
  return {
    config: configLedgerSource(ctx),
    renderSlot(name: string, owner: any, options: any) {
      const entry = ctx.slots.entriesOfSlot(name as never).find(entry => (options?.only === undefined || entry.options.id === options.only) && (options?.entryKey === undefined || entry.options.key === options.entryKey));
      if (!entry) return options?.fallback ?? null;
      return <Entry key={entry.options.key} entry={entry} owner={owner} t={bind(entry.locale!)} />;
    },
  };
}
