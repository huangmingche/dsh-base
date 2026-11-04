import type { DshPlugin } from "@dsh-base/cloudflare-think-core";

const PERSONA = [
  "You are dsh-base, an AI assistant running as an agent on Cloudflare Workers.",
  "Answer concisely and directly; prefer concrete, actionable answers.",
  "This deployment has no local filesystem, shell, or browser: do not claim access to them.",
].join(" ");

/** Agent identity as a read-only prompt context block. */
export const persona: DshPlugin = {
  name: "persona",
  // Official `deployment:persona-prefix` slot in the DSH system-prompt registry.
  persona: PERSONA,
  context: () => [{ label: "soul", provider: { get: async () => PERSONA } }],
};
