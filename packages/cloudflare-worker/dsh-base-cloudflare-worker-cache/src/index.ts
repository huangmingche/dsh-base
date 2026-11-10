import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { AuthFace } from "@dsh-base/cloudflare-worker-auth";
import { failure, HttpError, json, sameOrigin } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
import { isSiteAdministrator } from "../../dsh-base-cloudflare-worker-site-config/src/store.ts";
export const name = "@dsh-base/cloudflare-worker-cache";
export const inject = ["http", "auth"];
export const Config = undefined;
interface Env { CACHE?: KVNamespace; CACHE_ENABLED?: string; SITE_ADMIN_USER_IDS?: string }
export interface PublicCacheService {
  status(env: unknown): { enabled: boolean; ready: boolean };
  get<T>(env: unknown, key: string): Promise<T | null>;
  put(env: unknown, key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(env: unknown, key: string): Promise<void>;
}
declare module "@deepseek-ai/cordis" { interface Context { publicCache: PublicCacheService } }
export function validateKey(key: string): string {
  if (!/^public:[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/u.test(key)) throw new HttpError(400, "invalid_cache_key");
  return `dsh-base:v1:${key}`;
}
/** KV is eventually consistent. Never use it for sessions, money, entitlements or private data. */
export function createPublicCache(): PublicCacheService {
  const binding = (input: unknown): KVNamespace => {
    const env = (input ?? {}) as Env;
    if (env.CACHE_ENABLED !== "true" || !env.CACHE) throw new HttpError(503, "cache_unavailable");
    return env.CACHE;
  };
  return {
    status(input) { const env = (input ?? {}) as Env; return { enabled: env.CACHE_ENABLED === "true", ready: env.CACHE_ENABLED === "true" && !!env.CACHE }; },
    async get<T>(env: unknown, key: string): Promise<T | null> { return binding(env).get<T>(validateKey(key), "json"); },
    async put(env, key, value, ttlSeconds) {
      const normalized = validateKey(key);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) throw new HttpError(400, "invalid_cache_ttl");
      const body = JSON.stringify(value);
      if (body === undefined || new TextEncoder().encode(body).byteLength > 262144) throw new HttpError(400, "invalid_cache_value");
      await binding(env).put(normalized, body, { expirationTtl: ttlSeconds });
    },
    async delete(env, key) { await binding(env).delete(validateKey(key)); },
  };
}
export function createCacheHandler(auth: Pick<AuthFace, "session">, cache: PublicCacheService): WorkerHandler {
  return async (request, env) => {
    const url = new URL(request.url);
    if (!["/api/saas/cache", "/api/saas/cache/status"].includes(url.pathname)) return undefined;
    try {
      if (url.pathname.endsWith("/status") && request.method === "GET") return json(cache.status(env));
      const user = await auth.session(request, env); if (!user) throw new HttpError(401, "unauthenticated");
      if (!isSiteAdministrator((env ?? {}) as Env, user.id)) throw new HttpError(403, "site_admin_required");
      if (request.method === "GET") return json(cache.status(env));
      if (request.method !== "DELETE" || url.pathname.endsWith("/status")) throw new HttpError(405, "method_not_allowed");
      sameOrigin(request);
      await cache.delete(env, url.searchParams.get("key") ?? "");
      return json({ ok: true });
    } catch (error) { return failure(error); }
  };
}
export function apply(ctx: Context): void {
  const service = createPublicCache(); ctx.provide("publicCache", service);
  ctx.effect(() => ctx.http.use(createCacheHandler(ctx.auth, service), 26), "dsh-base: bounded public KV cache");
}
