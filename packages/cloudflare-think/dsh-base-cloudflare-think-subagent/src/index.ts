/** Unavailable delegation capability plus a read-compatible historical class export. */
import { Think, type TurnContext, type PrepareStepContext, type ToolCallContext } from "@cloudflare/think";
import type { ToolSet } from "ai";
import type { DshPlugin } from "@dsh-base/cloudflare-think-core";

/** Bindings formerly used by created facets; kept so the export resolves. */
export interface SubagentEnv {
  AI: Ai;
  AI_GATEWAY_ID?: string;
}

/** One reason for the model, the UI and the tests; never a claim of availability. */
export const SUBAGENT_UNAVAILABLE_REASON = "Subagent delegation is unavailable: owner credentials and Host session lifecycle are not mapped to dynamic-agent facets.";

function unavailable(): never { throw new Error(SUBAGENT_UNAVAILABLE_REASON); }

/**
 * Keep the original export and Think storage identity so persisted facet rows
 * can still be addressed. The bare Think base deliberately excludes
 * ComposedAgent's owner-name Host adapters: a facet id is not a durable owner
 * Session address. Commit 1's deleted migration cleared this storage, so there
 * is no history to verify — the compatibility read path stays resolvable, it
 * does not restore execution.
 */
export class DshSubagent extends Think<SubagentEnv> {
  override getModel(): never { return unavailable(); }
  override getTools(): ToolSet { return {}; }
  override beforeTurn(_ctx?: TurnContext): never { return unavailable(); }
  override async beforeStep(_ctx?: PrepareStepContext): Promise<never> { return unavailable(); }
  override async beforeToolCall(_ctx?: ToolCallContext): Promise<never> { return unavailable(); }
}

/** Keep the capability inventory and tell the parent model the actual limitation. */
export const subagentTools: DshPlugin<SubagentEnv> = {
  name: "subagent",
  prompt: () => [{
    name: "tool:subagent", order: "TOOL_SUBAGENT",
    text: `${SUBAGENT_UNAVAILABLE_REASON} Complete the work in the current session; do not claim that a subagent was launched.`,
  }],
  tools: () => ({}),
};
