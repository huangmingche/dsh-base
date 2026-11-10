import type {} from '@dsh-base/client-public-navigation/public-configurations';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { z } from 'zod';
import { EmailPanel } from './EmailPanel.tsx';
import { EmailStatusStore } from './status-store.ts';
import { NS, locales } from './locales.ts';
export const name = '@dsh-base/client-email';
export const inject = ['slots', 'locale', 'publicPluginConfigurations'];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.publicPluginConfigurations.registerBundle('dsh-base:email'), 'email: public configuration');
  const store = new EmailStatusStore((input, init) => fetch(input, init));
  ctx.effect(() => ctx.locale.register(NS, locales), 'email: dictionaries');
  ctx.effect(() => () => { store.dispose(); }, 'email: requests');
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-base:email', locale: NS,
    inject: () => ({ hooks: { emailStatus: store }, ensure: store.ensure, reload: () => { void store.reload(); } }),
  }, EmailPanel));
}
