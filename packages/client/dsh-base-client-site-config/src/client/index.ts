import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import { createSiteConfigService, type SiteConfigService } from './service.ts';
export type { SiteConfigService, SiteConfigSnapshot } from './service.ts';
export const Config = z.object({}).default({});
export const name = '@dsh-base/client-site-config';
export const inject = [];
declare module '@deepseek-ai/cordis' { interface Context { siteConfig: SiteConfigService } }
export function apply(ctx: Context): void {
  const service = createSiteConfigService();
  ctx.provide('siteConfig', service);
  ctx.effect(() => () => { service.dispose(); }, 'dsh-base: site-config lifetime');
  if (typeof location !== 'undefined' && typeof fetch === 'function') void service.refresh();
}
