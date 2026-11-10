import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { registerPanel } from '@dsh-base/client-saas-ui';
import { definition } from './definition.ts';
import { descriptions } from './copy.ts';
export const name = '@dsh-base/client-contact';
export const inject = ['slots', 'locale', 'publicPluginConfigurations'];
export const Config = z.object({}).default({});
export function apply(ctx: Context): void { registerPanel(ctx, definition, descriptions); }
