/** Worker plugin: Think agent request routing (WebSocket + HTTP). */
import type { Context } from "@deepseek-ai/cordis";
import { routeAgentRequest } from "agents";

export const name = "@dsh-base/cloudflare-worker-agents";
export const inject = ["http", "auth"];
export const Config = undefined;

/** Prefix every Agent Durable Object name carries for its Better Auth owner. */
const AGENT_OWNER_PREFIX = "owner:";

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.http.use(async (request, env) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/agents/")) return undefined;
      // The HTTP agent route is not used by the Workers UI (it streams through
      // /api/agent-live), but it must never admit another account's Agent DO.
      const user = await ctx.auth.session(request, env);
      if (user === undefined) return new Response("Unauthorized", { status: 401 });
      const name = url.pathname.split("/")[3];
      if (typeof name === "string" && name.length > 0
        && !name.startsWith(`${AGENT_OWNER_PREFIX}${user.id}:`)) {
        return new Response("Forbidden", { status: 403 });
      }
      return (await routeAgentRequest(request, env as never)) ?? undefined;
    }),
    "dsh-base: agent routing",
  );
}
