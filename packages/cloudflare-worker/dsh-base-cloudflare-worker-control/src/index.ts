/** Global composition control: public boot reads, explicit administrator-only mutations. */
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { StaticPluginInspection } from "@dsh-base/plugin-loader-static";
import { PluginControl } from "./control.ts";

export { PluginControl };

export const name = "@dsh-base/cloudflare-worker-control";
export const inject = ["http", "auth"];
export const Config = undefined;

interface ControlEnv {
  PluginControl: DurableObjectNamespace;
  /** Required for mutations; absent means read-only. Reads serve boot composition. */
  PLUGIN_CONTROL_TOKEN?: string;
}

const PATH = "/api/plugin-control";
const MANAGER_PATH = "/api/plugin-manager";
const INVENTORY_PATH = "/api/plugin-manager/inventory";

export const controlHandler = async (
  request: Request,
  env: unknown,
  auth: { session(request: Request, env?: unknown): Promise<{ readonly id: string } | undefined> } | undefined,
  inventory?: () => readonly StaticPluginInspection[],
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  const manager = url.pathname === MANAGER_PATH && (request.method === "GET" || request.method === "PUT" || request.method === "PATCH");
  const inventoryRoute = url.pathname === INVENTORY_PATH && (request.method === "GET" || request.method === "HEAD");
  if (url.pathname !== PATH && !manager && !inventoryRoute) return undefined;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }
  const typed = env as ControlEnv;
  if (typed.PluginControl === undefined) {
    return Response.json({ error: "control_binding_missing" }, { status: 500 });
  }
  if (manager || inventoryRoute) {
    const user = await auth?.session(request, env);
    if (user === undefined) return Response.json({ error: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
    if (inventoryRoute) return Response.json({ entries: [...(inventory?.() ?? [])] }, { headers: { "cache-control": "no-store" } });
    const id = typed.PluginControl.idFromName(`owner:${user.id}:plugins`);
    const response = await typed.PluginControl.get(id).fetch(request);
    if (!response.ok) return response;
    if (request.method === 'HEAD') return response;
    // Include the authenticated owner on successful reads/writes so a stale
    // page for account A cannot apply its intent under account B's cookie.
    const body = await response.clone().json().catch(() => undefined) as Record<string, unknown> | undefined;
    return body === undefined ? response : Response.json({ ...body, ownerId: user.id }, { status: response.status, headers: { 'cache-control': 'no-store' } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const user = await auth?.session(request, env);
    if (user === undefined) return Response.json({ error: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (typed.PLUGIN_CONTROL_TOKEN === undefined || typed.PLUGIN_CONTROL_TOKEN === "") return Response.json({ error: "control_read_only" }, { status: 403, headers: { "cache-control": "no-store" } });
    if (request.headers.get("authorization") !== `Bearer ${typed.PLUGIN_CONTROL_TOKEN}`) return Response.json({ error: "admin_required" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const id = typed.PluginControl.idFromName("default");
  const stub = typed.PluginControl.get(id);
  const forwarded = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: request.body, duplex: "half" } as RequestInit),
  });
  return stub.fetch(forwarded);
};

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.http.use((request, env) => controlHandler(request, env, ctx.auth, () =>
    (ctx.get("staticPluginLoader") as { entries?: () => readonly StaticPluginInspection[] } | undefined)?.entries?.() ?? [],
  )), "dsh-base: plugin control API");
}
