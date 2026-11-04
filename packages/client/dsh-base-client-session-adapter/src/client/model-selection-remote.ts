/** Model and effort selection follow the durable Host acknowledgement. */
export const REASONING_UNAVAILABLE_REASON = "This Host does not advertise configurable reasoning effort.";

type Selection = { readonly provider: string; readonly model: string; readonly reasoningEffort?: string };
type Input = { readonly sessionId: string; readonly provider?: string; readonly model: string; readonly reasoningEffort?: string };
type Result = { readonly ok: true; readonly value: { readonly selected: Selection } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

export function createModelSelectionRemote(
  select: (input: Input) => Promise<Result>,
  onSelected: (sessionId: string, selection: Selection) => void,
) {
  return async (input: Input): Promise<Result> => {
    const result = await select(input);
    if (result.ok && input.reasoningEffort !== undefined && result.value.selected.reasoningEffort === undefined) {
      return { ok: false, error: { code: "gateway/endpoint-unavailable", message: "The Host did not acknowledge the requested reasoning effort.",
        details: { capability: "reasoning-effort" } } };
    }
    if (result.ok) onSelected(input.sessionId, result.value.selected);
    return result;
  };
}
