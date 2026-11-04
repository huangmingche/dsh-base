import { composeAgent } from "@dsh-base/cloudflare-think-core";
import { agentPlugins } from "./generated-composition";

/** Worker Durable Object class: only the generated agent composition. */
export class DshAgent extends composeAgent(agentPlugins) {}
