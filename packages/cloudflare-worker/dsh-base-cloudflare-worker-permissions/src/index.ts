/** Worker composition entry for the official permission service's R2 Host seam. */
import type { Context } from '@deepseek-ai/cordis';
import { createPermissionRuntime } from './runtime.ts';
export { createPermissionRuntime } from './runtime.ts';
export type { PermissionRuntime, PermissionChange } from './runtime.ts';
export * from './executor.ts';
export type { PermissionCatalog, PermissionSelection, PresetOption } from './types.ts';

export const name = '@dsh-base/cloudflare-worker-permissions';
export const Config = undefined;
export function apply(ctx: Context): void {
  ctx.provide('workerPermissions', { createRuntime: createPermissionRuntime });
}
declare module '@deepseek-ai/cordis' {
  interface Context { workerPermissions: { createRuntime: typeof createPermissionRuntime } }
}
