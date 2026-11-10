/** DeepSeek Chat Completions parameters for the durable per-turn selection. */
export type DeepSeekReasoningEffort = "off" | "low" | "high" | "max";

/** Match the official Harness effort names and the provider's documented wire format. */
export function deepSeekRequestOptions(effort: string | undefined): {
  thinking: { type: "enabled" | "disabled" };
  reasoning_effort?: "low" | "high" | "max";
} {
  const selected = effort ?? "high";
  if (selected === "off") return { thinking: { type: "disabled" } };
  if (selected === "low" || selected === "high" || selected === "max") {
    return { thinking: { type: "enabled" }, reasoning_effort: selected };
  }
  throw new Error(`Unsupported DeepSeek reasoning effort: ${selected}`);
}

/** The Host's admitted selection wins over optional SDK call-level defaults. */
export function deepSeekRequestBody(effort: string | undefined) {
  const selected = deepSeekRequestOptions(effort);
  return (body: Record<string, unknown>): Record<string, unknown> => {
    const { thinking: _thinking, reasoning_effort: _effort, ...rest } = body;
    return { ...rest, ...selected };
  };
}
