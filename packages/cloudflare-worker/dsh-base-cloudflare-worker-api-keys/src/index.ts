import type { Context } from "@deepseek-ai/cordis";
import type { AuthExtension, AuthFace } from "@dsh-base/cloudflare-worker-auth";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { apiKey } from "@better-auth/api-key";
import { objectBody, HttpError } from "../../dsh-base-cloudflare-worker-http/src/request.ts";

export const name = "@dsh-base/cloudflare-worker-api-keys";
export const Config = undefined;
export const inject = ["http", "auth"];
export interface ApiKeysEnv { readonly API_KEYS_ENABLED?: string; readonly AUTH_DB?: D1Database }
export interface ApiKeyIdentity { readonly id: string; readonly email: string }
export interface ApiKeysService { verify(env: unknown, key: string): Promise<ApiKeyIdentity | undefined> }
declare module "@deepseek-ai/cordis" { interface Context { apiKeys: ApiKeysService } }
const enabled = (env: unknown): boolean => (env as ApiKeysEnv | undefined)?.API_KEYS_ENABLED === "true";

export const apiKeysExtension: AuthExtension = {
  id: "api-keys", cacheKey: env => String(enabled(env)), policy: env => ({ apiKeysEnabled: enabled(env) }),
  options(env) {
    if (!enabled(env)) return {};
    const plugin = apiKey({ defaultPrefix: "dsh_", defaultKeyLength: 64, requireName: true, maximumNameLength: 64,
      enableSessionForAPIKeys: false, enableMetadata: false, storage: "database", disableKeyHashing: false, deferUpdates: false,
      keyExpiration: { defaultExpiresIn: 30 * 86400, minExpiresIn: 1, maxExpiresIn: 365 },
      permissions: { defaultPermissions: { profile: ["read"] } }, rateLimit: { enabled: true, timeWindow: 60000, maxRequests: 60 },
      startingCharactersConfig: { shouldStore: true, charactersLength: 12 } });
    const { createApiKey, listApiKeys, deleteApiKey, verifyApiKey } = plugin.endpoints;
    return { plugins: [{ ...plugin, endpoints: { createApiKey, listApiKeys, deleteApiKey, verifyApiKey } }] };
  },
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
function summary(value: Record<string, unknown>) {
  return { id: value.id, name: value.name, start: value.start, enabled: value.enabled === true,
    expiresAt: value.expiresAt, createdAt: value.createdAt, permissions: value.permissions };
}
export function createApiKeysService(auth: AuthFace): ApiKeysService {
  return { async verify(env, key) {
    const typed = (env ?? {}) as ApiKeysEnv;
    if (!enabled(env) || !typed.AUTH_DB || typeof key !== "string" || !/^dsh_[a-zA-Z]{64}$/u.test(key)) return undefined;
    try {
      const result = await auth.invokeExtension("verifyApiKey", { body: { key, permissions: { profile: ["read"] } } }, env) as { valid?: boolean; key?: { referenceId?: string } };
      if (result.valid !== true || typeof result.key?.referenceId !== "string") return undefined;
      const user = await typed.AUTH_DB.withSession("first-primary").prepare('SELECT * FROM "user" WHERE id = ?').bind(result.key.referenceId)
        .first<{ id: string; email: string; banned?: number | boolean; banExpires?: number | null }>();
      if (!user || (user.banned && (!user.banExpires || user.banExpires > Date.now()))) return undefined;
      return { id: user.id, email: user.email };
    } catch { return undefined; }
  } };
}
export function createApiKeysHandler(auth: AuthFace, service: ApiKeysService): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url), path = url.pathname;
    if (path !== "/api/api-keys" && !path.startsWith("/api/api-keys/")) return undefined;
    if (path === "/api/api-keys/whoami") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!enabled(env)) return json({ error: "api_keys_unavailable" }, 503);
      const authorization = request.headers.get("authorization") ?? "";
      const identity = authorization.startsWith("Bearer ") ? await service.verify(env, authorization.slice(7)) : undefined;
      return identity ? json(identity) : json({ error: "invalid_api_key" }, 401);
    }
    const user = request.headers.has("cookie") ? await auth.session(request, env) : undefined;
    if (path === "/api/api-keys/status") return request.method === "GET" ? json({ enabled: enabled(env), authenticated: user !== undefined, scopes: ["profile:read"] }) : json({ error: "method_not_allowed" }, 405);
    if (!enabled(env)) return json({ error: "api_keys_unavailable" }, 503);
    if (!user) return json({ error: "unauthenticated" }, 401);
    try {
      if (path === "/api/api-keys" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 100), offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) return json({ error: "invalid_request" }, 400);
        const target = new URL("/api/auth/api-key/list", url.origin);
        target.searchParams.set("limit", String(limit)); target.searchParams.set("offset", String(offset));
        const response = await auth.handle(new Request(target, { headers: request.headers }), env, "api-keys");
        if (!response.ok) return json({ error: "api_keys_failed" }, response.status);
        const result = await response.json() as { apiKeys: Record<string, unknown>[]; total: number };
        return json({ keys: result.apiKeys.map(summary), total: result.total, limit, offset });
      }
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "untrusted_origin" }, 403);
      if (path === "/api/api-keys" && request.method === "POST") {
        const body = await objectBody(request, 2048), days = body.expiresInDays ?? 30;
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 64 || typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365
          || Object.keys(body).some(key => !["name", "expiresInDays"].includes(key))) return json({ error: "invalid_request" }, 400);
        const response = await auth.handle(new Request(new URL("/api/auth/api-key/create", url.origin), { method: "POST", headers: request.headers, body: JSON.stringify({ name: body.name.trim(), expiresIn: days * 86400 }) }), env, "api-keys");
        if (!response.ok) return json({ error: "api_keys_failed" }, response.status);
        const result = await response.json() as Record<string, unknown>;
        return json({ key: summary(result), secret: result.key }, 201);
      }
      if (request.method === "DELETE" && /^\/api\/api-keys\/[^/]+$/u.test(path)) {
        const keyId = decodeURIComponent(path.slice("/api/api-keys/".length));
        if (keyId.length < 1 || keyId.length > 256) return json({ error: "invalid_request" }, 400);
        const headers = new Headers(request.headers); headers.set("content-type", "application/json");
        const response = await auth.handle(new Request(new URL("/api/auth/api-key/delete", url.origin), { method: "POST", headers, body: JSON.stringify({ keyId }) }), env, "api-keys");
        return response.ok ? json({ ok: true }) : json({ error: "api_keys_failed" }, response.status);
      }
      return json({ error: "method_not_allowed" }, 405);
    } catch (error) { return error instanceof HttpError ? json({ error: error.code }, error.status) : json({ error: "api_keys_unavailable" }, 503); }
  };
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.auth.registerExtension(apiKeysExtension), "dsh-base: user-owned API keys");
  const service = createApiKeysService(ctx.auth);
  ctx.provide("apiKeys", service);
  ctx.effect(() => ctx.http.use(createApiKeysHandler(ctx.auth, service), 12), "dsh-base: API key management");
}
