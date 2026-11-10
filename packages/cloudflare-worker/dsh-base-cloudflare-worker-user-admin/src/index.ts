import type { Context } from "@deepseek-ai/cordis";
import type { AuthExtension, AuthFace, AuthUser } from "@dsh-base/cloudflare-worker-auth";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { admin } from "better-auth/plugins/admin";
import { userAc } from "better-auth/plugins/admin/access";
import { objectBody, HttpError } from "../../dsh-base-cloudflare-worker-http/src/request.ts";

export const name = "@dsh-base/cloudflare-worker-user-admin";
export const Config = undefined;
export const inject = ["http", "auth"];
export interface UserAdminEnv { readonly USER_ADMIN_ENABLED?: string; readonly SITE_ADMIN_USER_IDS?: string }
export function administratorIds(env: unknown): string[] {
  const value = (env ?? {}) as UserAdminEnv;
  if (value.USER_ADMIN_ENABLED !== "true" || typeof value.SITE_ADMIN_USER_IDS !== "string") return [];
  try {
    const ids: unknown = JSON.parse(value.SITE_ADMIN_USER_IDS);
    return Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 256 && id === id.trim()) ? [...new Set(ids)] : [];
  } catch { return []; }
}
const enabled = (env: unknown): boolean => (env as UserAdminEnv | undefined)?.USER_ADMIN_ENABLED === "true";
const canManage = (env: unknown, user: AuthUser | undefined): boolean => user !== undefined && administratorIds(env).includes(user.id);

export const userAdminExtension: AuthExtension = {
  id: "user-admin", cacheKey: env => JSON.stringify([enabled(env), administratorIds(env)]),
  policy: env => ({ userAdminEnabled: enabled(env) }),
  options(env) {
    // Keep ban enforcement mounted even when management is disabled. Only the
    // deployment allowlist can manage users; stored role labels grant no powers.
    const plugin = admin({ adminUserIds: administratorIds(env), defaultRole: "user", adminRoles: [], roles: { user: userAc, admin: userAc } });
    const { listUsers, setRole, banUser, unbanUser, revokeUserSessions } = plugin.endpoints;
    return { plugins: [{ ...plugin, endpoints: { listUsers, setRole, banUser, unbanUser, revokeUserSessions } }] };
  },
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
function userSummary(value: unknown) {
  const user = value as Record<string, unknown>;
  return { id: user.id, name: user.name, email: user.email, role: typeof user.role === "string" ? user.role : "user",
    emailVerified: user.emailVerified === true, banned: user.banned === true,
    ...(typeof user.banReason === "string" ? { banReason: user.banReason } : {}), createdAt: user.createdAt };
}

export function createUserAdminHandler(auth: AuthFace): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url);
    if (!["/api/user-admin/status", "/api/user-admin/users", "/api/user-admin/actions"].includes(url.pathname)) return undefined;
    const user = request.headers.has("cookie") ? await auth.session(request, env) : undefined;
    if (url.pathname === "/api/user-admin/status") return request.method === "GET" ? json({ enabled: enabled(env), canManage: canManage(env, user) }) : json({ error: "method_not_allowed" }, 405);
    if (!enabled(env)) return json({ error: "user_admin_unavailable" }, 503);
    if (!user) return json({ error: "unauthenticated" }, 401);
    if (!canManage(env, user)) return json({ error: "site_admin_required" }, 403);
    try {
      if (url.pathname === "/api/user-admin/users") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0), search = url.searchParams.get("search") ?? "";
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000 || search.length > 128) return json({ error: "invalid_request" }, 400);
        const target = new URL("/api/auth/admin/list-users", url.origin);
        target.searchParams.set("limit", String(limit)); target.searchParams.set("offset", String(offset));
        if (search) { target.searchParams.set("searchValue", search); target.searchParams.set("searchField", "email"); target.searchParams.set("searchOperator", "contains"); }
        const response = await auth.handle(new Request(target, { headers: request.headers }), env, "user-admin");
        if (!response.ok) return json({ error: "user_admin_failed" }, response.status);
        const result = await response.json() as { users: unknown[]; total: number };
        return json({ users: result.users.map(userSummary), total: result.total, limit, offset });
      }
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "untrusted_origin" }, 403);
      const body = await objectBody(request, 4096);
      if (typeof body.userId !== "string" || body.userId.length < 1 || body.userId.length > 256 || Object.keys(body).some(key => !["action", "userId", "role", "reason"].includes(key))) return json({ error: "invalid_request" }, 400);
      if (administratorIds(env).includes(body.userId) && body.action === "ban") return json({ error: "cannot_ban_administrator" }, 400);
      const actions = { ban: "ban-user", unban: "unban-user", "set-role": "set-role", "revoke-sessions": "revoke-user-sessions" } as const;
      if (typeof body.action !== "string" || !Object.hasOwn(actions, body.action)) return json({ error: "invalid_request" }, 400);
      if (body.action === "set-role" && body.role !== "user" && body.role !== "admin") return json({ error: "invalid_request" }, 400);
      if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) return json({ error: "invalid_request" }, 400);
      const payload = { userId: body.userId, ...(body.action === "set-role" ? { role: body.role } : {}), ...(body.action === "ban" ? { banReason: body.reason ?? "Administrator action" } : {}) };
      const response = await auth.handle(new Request(new URL(`/api/auth/admin/${actions[body.action as keyof typeof actions]}`, url.origin), { method: "POST", headers: request.headers, body: JSON.stringify(payload) }), env, "user-admin");
      return response.ok ? json({ ok: true }) : json({ error: "user_admin_failed" }, response.status);
    } catch (error) { return error instanceof HttpError ? json({ error: error.code }, error.status) : json({ error: "user_admin_unavailable" }, 503); }
  };
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.auth.registerExtension(userAdminExtension), "dsh-base: product user administration");
  ctx.effect(() => ctx.http.use(createUserAdminHandler(ctx.auth), 12), "dsh-base: user administration routes");
}
