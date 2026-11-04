/**
 * Canonical Agent preset identities for this Workers-native deployment.
 *
 * The deployment runs one fixed Think composition. Official DSH preset ids keep
 * their official meanings and are never silently aliased to that composition.
 */

/** Canonical id of the fixed Think composition this deployment actually runs. */
export const FIXED_AGENT_PRESET_ID = "dsh-base-think" as const;

/** Official shipped preset ids, in official order. */
export const OFFICIAL_AGENT_PRESET_IDS = ["standard", "ptc", "minimal", "cordis"] as const;

/** One official shipped preset id. */
export type OfficialAgentPresetId = typeof OFFICIAL_AGENT_PRESET_IDS[number];

/** One preset id this deployment can compose. */
export type SupportedAgentPresetId = typeof FIXED_AGENT_PRESET_ID;

/** Whether an id names an official DSH preset. */
export function isOfficialAgentPresetId(id: string): id is OfficialAgentPresetId {
  return (OFFICIAL_AGENT_PRESET_IDS as readonly string[]).includes(id);
}

/** Whether an id names the fixed composition this deployment can create. */
export function isSupportedAgentPresetId(id: string): id is SupportedAgentPresetId {
  return id === FIXED_AGENT_PRESET_ID;
}
