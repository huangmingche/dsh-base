import { registerPublicConfiguration } from '@dsh-base/client-saas-ui';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { PanelStore } from '@dsh-base/client-saas-ui/transport';
import { requestLogin } from '@dsh-base/client-auth-login/request';
import { definition } from './definition.ts';
import { descriptions } from './copy.ts';
import { mountConfirmation } from './confirmation.tsx';
import { NewsletterPanel } from './NewsletterPanel.tsx';
export const name = '@dsh-base/client-newsletter';
export const inject: string[] = [];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void {
  mountConfirmation(ctx);
  ctx.inject(['slots', 'locale', 'publicPluginConfigurations'], scope => mountPanel(scope));
}
function mountPanel(ctx: Context): void {
  registerPublicConfiguration(ctx, 'dsh-base:newsletter');
  const signIn=()=>{requestLogin();},store=new PanelStore(definition,(input,init)=>fetch(input,init),signIn);
  ctx.effect(()=>()=>store.dispose(),'newsletter: requests');
  ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'dsh-base:newsletter',inject:()=>({hooks:{panel:store,language:ctx.locale},definition,descriptions,ensure:store.ensure,reload:()=>{void store.reload();},run:store.run,clearResult:store.clearResult,leave:store.leave,signIn})},NewsletterPanel));
}
