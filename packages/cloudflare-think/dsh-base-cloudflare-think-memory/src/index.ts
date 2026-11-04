import { action } from "@cloudflare/think";
import { tool } from "ai";
import { z } from "zod";
import type { DshAgentRuntime, DshPlugin } from "@dsh-base/cloudflare-think-core";

/** Durable, model-writable memory held in the Durable Object SQLite session. */
export const memory: DshPlugin = {
  name: "memory",
  prompt: () => [{ name: "tool:memory", order: 1600, text: "Use remember_fact only for durable facts the user explicitly wants kept; recall_facts reads them back." }],
  context: () => [{
    label: "memory",
    description:
      "Important facts about the user and the conversation that should persist across turns.",
    maxTokens: 2000,
  }],
  tools: (_env, agent: DshAgentRuntime) => ({
    recall_facts: tool({
      description: "Read the durable facts the user has approved you to remember.",
      inputSchema: z.object({}),
      execute: async () => ({ facts: agent.listFacts() }),
    }),
  }),
  actions: (_env, agent: DshAgentRuntime) => ({
    remember_fact: action({
      description: "Persist one durable fact about the user. Requires explicit human approval before it is stored.",
      inputSchema: z.object({
        fact: z.string().trim().min(1).max(2000).describe("The fact to remember, phrased as a standalone statement."),
      }),
      approval: true,
      approvalSummary: "Save a durable memory",
      approvalRisk: "low",
      idempotencyKey: ({ input }: { input: { fact: string } }) => `remember:${input.fact}`,
      execute: async ({ fact }) => {
        agent.rememberFact(fact);
        return { saved: true, facts: agent.listFacts() };
      },
    }),
  }),
};
