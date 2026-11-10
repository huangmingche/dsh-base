import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@dsh-base/client-site-config/client';
import { z } from 'zod';
import { GlobalSettings } from './GlobalSettings.tsx';
import { GlobalSettingsStore } from './settings-store.ts';
import { locales, NS } from './locales.ts';
import { SETTINGS_ROWS, type SettingsScope } from './fields.ts';
export const name = '@dsh-base/client-global-settings';
export const inject = ['slots', 'locale', 'siteConfig'];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void {
  const store = new GlobalSettingsStore((input, init) => fetch(input, init), () => ctx.siteConfig.refresh());
  ctx.effect(() => ctx.locale.register(NS, locales), 'global-settings: dictionaries');
  ctx.effect(() => () => { store.dispose(); }, 'global-settings: lifetime');
  const face = (scope: SettingsScope) => ({ scope, hooks: { globalSettings: store }, ensure: store.ensure, edit: store.edit,
    save: () => { void store.save(); }, reload: () => { void store.reload(); }, discard: store.discard, initialLocale: ctx.locale.getSnapshot().active });
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-base:global', locale: NS,
    inject: () => face('global'),
  }, GlobalSettings));
  ctx.slots.inject('plugins.row.config', () => {
    const offs = SETTINGS_ROWS.map(({ scope, key }) => ctx.slots.register({
      name: 'plugins.row.config', key, locale: NS, inject: () => face(scope),
    }, GlobalSettings));
    return () => { for (const off of offs) off(); };
  });
}
