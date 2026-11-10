import type { AuthFace } from "@dsh-base/cloudflare-worker-auth";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";

type AgentRouter = (request: Request, env: unknown) => Promise<Response | null | undefined>;

/** Admit only canonical, owner-scoped routes for this application's root Think agent. */
export function createAgentHandler(auth: Pick<AuthFace, "session">, route: AgentRouter): WorkerHandler {
  return async (request, env) => {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/agents" && !pathname.startsWith("/agents/")) return undefined;
    const user = await auth.session(request, env);
    if (!user) return new Response("Unauthorized", { status: 401 });
    // agents 0.33 normalizes with split('/').filter(Boolean). Reject ambiguous
    // spelling before dispatch so its binding/name must equal the ones checked
    // here. Encoded separators and descendant /sub routes are not public APIs.
    const match = /^\/agents\/dsh-agent\/([^/%\\]+)(?:\/live-stream)?$/u.exec(pathname);
    const prefix = `owner:${user.id}:`;
    if (!match || !match[1]!.startsWith(prefix) || match[1]!.length === prefix.length) {
      return new Response("Forbidden", { status: 403 });
    }
    // The generic SDK discovers every DO binding in its env. Expose only the
    // one namespace authorized above, never AuthStore, SessionHost or Subagent.
    return (await route(request, { DshAgent: (env as { DshAgent?: unknown } | undefined)?.DshAgent })) ?? undefined;
  };
}
