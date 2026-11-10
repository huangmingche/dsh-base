import { registerPublicConfiguration } from '@dsh-base/client-saas-ui';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { PanelStore } from '@dsh-base/client-saas-ui/transport';
import { definition } from './definition.ts';
import { CrispSupport } from './support.ts';
import { CrispPanel } from './CrispPanel.tsx';
export const name = '@dsh-base/client-crisp';
export const inject = ['slots', 'locale', 'publicPluginConfigurations'];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void {
  registerPublicConfiguration(ctx, 'dsh-base:crisp');
  const store=new PanelStore(definition,(input,init)=>fetch(input,init),()=>{}),support=new CrispSupport();
  ctx.effect(()=>()=>{store.dispose();support.dispose();},'crisp: request and chat lifecycle');
  ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'dsh-base:crisp',inject:()=>({hooks:{status:store,language:ctx.locale},ensure:store.ensure,reload:()=>{void store.reload();},support})},CrispPanel));
}
