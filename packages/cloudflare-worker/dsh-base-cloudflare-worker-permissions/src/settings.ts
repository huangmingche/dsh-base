/** The actual configured table consumed by the pinned official preset service. */
import type { PresetSpec } from './presets.ts';

export const PERMISSION_PRESETS: Record<string, PresetSpec> = {
  'read-only': { sandbox: 'read-only', approval: 'ask', name: 'read-only', description: 'Read files without modifying them; actions requiring approval still ask.' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask', name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', name: 'danger-full-access', description: 'Full file access without approval prompts.' },
};
export const DEFAULT_PERMISSION_PRESET = 'workspace-write';
export const PERMISSION_DEFAULT_OPTIONS: readonly string[] = Object.freeze(Object.keys(PERMISSION_PRESETS));

/** Default settings admit configured presets only, as the official service does. */
export function validatePermissionSettings(section: Readonly<Record<string, unknown>>): void {
  if (section.defaultPreset === undefined) return;
  if (typeof section.defaultPreset !== 'string' || !Object.hasOwn(PERMISSION_PRESETS, section.defaultPreset)) {
    throw new Error(`permission.defaultPreset must name a configured preset (${PERMISSION_DEFAULT_OPTIONS.join(', ')})`);
  }
}
