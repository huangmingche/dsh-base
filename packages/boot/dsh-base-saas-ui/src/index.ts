import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@dsh-base/client-public-navigation/public-configurations';
import { requestLogin } from '@dsh-base/client-auth-login/request';
import { Panel } from './Panel.tsx';
import { PanelStore, type PanelDefinition } from './transport.ts';
import type { Descriptions } from './locales.ts';
export * from './transport.ts';
export * from './locales.ts';
export { Panel } from './Panel.tsx';
/** A caller owns its explicit public bundle seat; private actions remain session gated. */
export function registerPublicConfiguration(ctx: Context, bundle: string): void {
  ctx.effect(() => ctx.publicPluginConfigurations.registerBundle(bundle), `${bundle}: public configuration`);
}
/** Register a caller-owned capability in the unchanged official detail configuration seat. */
export function registerPanel(ctx: Context, definition: PanelDefinition, descriptions: Descriptions): void {
  registerPublicConfiguration(ctx, definition.bundle);
  const signIn = () => { requestLogin(); };
  const store = new PanelStore(definition, (input, init) => fetch(input, init), signIn);
  ctx.effect(() => () => { store.dispose(); }, `${definition.bundle}: requests`);
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: definition.bundle,
    inject: () => ({ hooks: { panel: store, language: ctx.locale }, definition, descriptions, ensure: store.ensure,
      reload: () => { void store.reload(); }, run: store.run, clearResult: store.clearResult, leave:store.leave, signIn }),
  }, Panel));
}
