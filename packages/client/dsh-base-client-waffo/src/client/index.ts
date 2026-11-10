import type {} from '@dsh-base/client-public-navigation/public-configurations';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { z } from 'zod';
import { requestLogin } from '@dsh-base/client-auth-login/request';
import { PaymentPanel } from './PaymentPanel.tsx';
import { PaymentStore } from './payment-store.ts';
import { NS, locales } from './locales.ts';
import {browserCheckoutIntents,resumeKey} from './checkout-intent.ts';
import {conversionConsentSnapshot} from '@dsh-base/client-google-analytics/consent';
export const name = '@dsh-base/client-waffo';
export const inject = ['slots', 'locale', 'publicPluginConfigurations'];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.publicPluginConfigurations.registerBundle('dsh-base:waffo'), 'waffo: public configuration');
  const signIn = (next?:string) => { requestLogin({next}); };
  const store = new PaymentStore((input, init) => fetch(input, init), signIn, url => { location.assign(url); }, () => ctx.locale.getSnapshot().active,
    {intents:browserCheckoutIntents(),currentPath:()=>location.pathname+location.search,consent:conversionConsentSnapshot});
  ctx.effect(() => ctx.locale.register(NS, locales), 'waffo: dictionaries');
  ctx.effect(() => () => { store.dispose(); }, 'waffo: requests');
  if(typeof location!=='undefined'&&resumeKey(location.pathname+location.search))store.ensure();
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-base:waffo', locale: NS,
    inject: () => ({ hooks: { payment: store }, ensure: store.ensure, reload: () => { void store.reload(); },
      checkout: (plan: string) => { void store.checkout(plan); }, portal: () => { void store.portal(); }, signIn, leave:store.leave, language: ctx.locale.getSnapshot().active }),
  }, PaymentPanel));
}
