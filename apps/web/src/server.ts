import type { Env } from "./env";
import { handleWorkerRequest } from "./worker/runtime";

export { DshAgent } from "./agent";
export { AuthStoreObject } from "@dsh-base/cloudflare-worker-auth";
export { PluginControl } from "@dsh-base/cloudflare-worker-control";
export { SessionHostObject } from "@dsh-base/cloudflare-worker-session-host";
export { DshSubagent } from "@dsh-base/cloudflare-think-subagent";

/**
 * Worker entry: export the Durable Object class and delegate every request to
 * the Worker plugin composition (agents routing, then static assets).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleWorkerRequest(request, env);
    } catch (error) {
      // Never leak internal diagnostics to the browser; keep them in logs.
      console.error("dsh-base worker plugin error", error);
      return new Response("internal_error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
