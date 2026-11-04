/**
 * Agent preset roster for the fixed Workers-native Think composition.
 *
 * The four official modes are real declarations from the pinned upstream
 * bundle; each is shown as the official built-in row (no name override) with a
 * truthful `unavailable` reason because this deployment cannot start their Host
 * composition. This is distinct from a real `broken` declaration read failure. The composition that actually runs is a separate canonical row
 * with no official declaration to read.
 */
import { FIXED_AGENT_PRESET_ID, OFFICIAL_AGENT_PRESET_IDS } from "../../../../boot/dsh-base-agent-presets/src/index.ts";
import type { FixedAgentPresetCopy } from "../../../../boot/dsh-base-agent-presets/src/availability.ts";
import { OFFICIAL_PRESET_DECLARATIONS } from "./official-preset-declarations.generated.ts";

/** Official declarations keyed by id for direct reads. A Map keeps inherited
 * object keys such as `constructor`/`toString`/`__proto__` from resolving. */
const OFFICIAL_DOCUMENTS = new Map<string, { readonly agentPreset: string; readonly content: string }>(
  OFFICIAL_AGENT_PRESET_IDS.map((id) => [id, { agentPreset: id, content: OFFICIAL_PRESET_DECLARATIONS[id].content }]),
);

/** Failure shared by every unavailable preset operation. */
function unavailable(copy: FixedAgentPresetCopy) {
  return { ok: false as const, error: {
    code: "agent-preset/unavailable", message: copy.selectUnavailable, details: {},
  } };
}

/**
 * Build the fixed roster and declaration reader.
 * @param labels - localized fixed-composition copy; called per operation so a locale change is observed.
 * @returns official `remote.agentPresets` face.
 */
export function createFixedAgentPresets(labels: () => FixedAgentPresetCopy) {
  return {
    list: async () => {
      const copy = labels();
      return { ok: true as const, value: { presets: [
        ...OFFICIAL_AGENT_PRESET_IDS.map((id) => ({ id, isDefault: false, unavailable: copy.unavailableReason })),
        { id: FIXED_AGENT_PRESET_ID, name: copy.thinkName, description: copy.thinkDescription, isDefault: true },
      ] } };
    },
    read: async (id: string) => {
      const document = OFFICIAL_DOCUMENTS.get(id);
      if (document !== undefined) return { ok: true as const, value: document };
      if (id === FIXED_AGENT_PRESET_ID) {
        return { ok: false as const, error: {
          code: "agent-preset/unavailable", message: labels().readUnavailable,
          details: { agentPreset: id, available: [...OFFICIAL_AGENT_PRESET_IDS] },
        } };
      }
      return { ok: false as const, error: {
        code: "agent-preset/not-found", message: `Unknown agent preset: ${id}`,
        details: { agentPreset: id, available: [...OFFICIAL_AGENT_PRESET_IDS, FIXED_AGENT_PRESET_ID] },
      } };
    },
    select: async (id: string) => {
      const copy = labels();
      if (id === FIXED_AGENT_PRESET_ID || OFFICIAL_AGENT_PRESET_IDS.includes(id as never)) return unavailable(copy);
      return { ok: false as const, error: {
        code: "agent-preset/not-found", message: `Unknown agent preset: ${id}`,
        details: { agentPreset: id, available: [...OFFICIAL_AGENT_PRESET_IDS, FIXED_AGENT_PRESET_ID] },
      } };
    },
  };
}
