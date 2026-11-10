import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dsh-base/client-site-config/client';
import { startPublishedPageViews } from './pageviews.ts';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { ConversionConsent } from './consent.ts';
import { ConsentRow, NS, consentLocales } from './ConsentRow.tsx';
export const name = '@dsh-base/client-google-analytics';
export const Config = z.object({}).default({});
export const inject = ['siteConfig'];
export function apply(ctx: Context): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  ctx.effect(() => startPublishedPageViews(ctx.siteConfig, window, (input, init) => fetch(input, init)), 'dsh-base: public Google Analytics page counts');
  const consent = new ConversionConsent(() => new URL(window.location.href));
  ctx.provide('siteAnalyticsConsent', consent);
  ctx.effect(() => {
    const update = () => consent.configure(ctx.siteConfig.getSnapshot().config.analytics);
    update(); const unsubscribe = ctx.siteConfig.subscribe(update); const unmount = consent.mount();
    return () => { unsubscribe(); unmount(); };
  }, 'dsh-base: explicit analytics consent');
  ctx.inject(['slots', 'locale'], scope => {
    scope.effect(() => scope.locale.register(NS, consentLocales));
    scope.slots.inject('settings.general.item', () => scope.slots.register({ name: 'settings.general.item', id: 'dsh-base.analytics-consent', order: 90, locale: NS,
      inject: () => ({ hooks: { consent }, setConsent: consent.setConsent }),
    }, ConsentRow));
  });
}

declare module '@deepseek-ai/cordis' { interface Context { siteAnalyticsConsent: ConversionConsent } }
