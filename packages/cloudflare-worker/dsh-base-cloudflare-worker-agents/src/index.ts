/** Worker plugin: Think agent request routing (WebSocket + HTTP). */
import type { Context } from "@deepseek-ai/cordis";
import { routeAgentRequest } from "agents";
import { createAgentHandler } from "./route.ts";

export const name = "@dsh-base/cloudflare-worker-agents";
export const inject = ["http", "auth"];
export const Config = undefined;

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.http.use(createAgentHandler(ctx.auth, (request, env) => routeAgentRequest(request, env as never))),
    "dsh-base: agent routing",
  );
}
