/** Worker auth plugin: Better Auth over D1 with product-account session gating. */
import { authPolicyResponse, isBlockedIdentity, type AuthPolicyEnv } from "./policy.ts";
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";

export { AuthStoreObject } from "./store.ts";

export const name = "@dsh-base/cloudflare-worker-auth";
export const inject = ["http"];
export const Config = undefined;

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_UPDATE_SECONDS = 24 * 60 * 60;

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
}

export interface AuthFace {
  session(request: Request, env?: unknown): Promise<AuthUser | undefined>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth: AuthFace;
  }
}

interface AuthEnv extends AuthPolicyEnv {
  readonly AUTH_DB?: D1Database;
  readonly AUTH_BASE_URL?: string;
  readonly AUTH_SECRET?: string;
}

type AuthInstance = ReturnType<typeof createAuth>;

let cached: { readonly database: D1Database; readonly baseURL: string; readonly secret: string; readonly auth: AuthInstance } | undefined;

function createAuth(env: AuthEnv & { AUTH_DB: D1Database; AUTH_BASE_URL: string; AUTH_SECRET: string }) {
  const base = new URL(env.AUTH_BASE_URL);
  return betterAuth({
    database: env.AUTH_DB,
    baseURL: env.AUTH_BASE_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: [base.origin],
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: SESSION_UPDATE_SECONDS,
      cookieCache: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    plugins: [username({ immutableUsername: true, displayUsername: false })],
    // The SPA calls `/get-session` on every boot and on session refreshes, so
    // Better Auth's default 100 requests / 10 s per path is easy to exhaust
    // during normal multi-tab use and makes the client retry-loop. Keep the
    // bounded window but raise the budget; credential endpoints stay tighter.
    rateLimit: {
      enabled: true,
      // Better Auth 1.7's database backend atomically consumes the budget using
      // conditional increments. The existing D1 rateLimit table shares counters
      // across isolates and restarts; errors must never fall back to memory.
      storage: "database",
      window: 60,
      max: 600,
      customRules: {
        "/get-session": { window: 60, max: 1200 },
        "/sign-in/username": { window: 60, max: 20 },
        "/sign-in/email": { window: 60, max: 20 },
        "/sign-up/email": { window: 60, max: 20 },
      },
    },
    advanced: {
      useSecureCookies: base.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: {
        sameSite: base.protocol === "https:" ? "none" : "lax",
        secure: base.protocol === "https:",
        partitioned: base.protocol === "https:",
      } as never,
    },
  });
}

function authFor(env: unknown): AuthInstance | undefined {
  const typed = env as AuthEnv;
  if (typed.AUTH_DB === undefined || typed.AUTH_BASE_URL === undefined || typed.AUTH_SECRET === undefined
    || typed.AUTH_SECRET.length < 32) return undefined;
  if (cached !== undefined && cached.database === typed.AUTH_DB
    && cached.baseURL === typed.AUTH_BASE_URL && cached.secret === typed.AUTH_SECRET) return cached.auth;
  const auth = createAuth({ ...typed, AUTH_DB: typed.AUTH_DB, AUTH_BASE_URL: typed.AUTH_BASE_URL, AUTH_SECRET: typed.AUTH_SECRET });
  cached = { database: typed.AUTH_DB, baseURL: typed.AUTH_BASE_URL, secret: typed.AUTH_SECRET, auth };
  return auth;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function sessionFor(request: Request, env: unknown): Promise<AuthUser | undefined> {
  const auth = authFor(env);
  if (auth === undefined) return undefined;
  const session = await auth.api.getSession({ headers: request.headers });
  if (session === null) return undefined;
  const user = session.user as {
    readonly id: string;
    readonly username?: string | null;
    readonly name?: string | null;
    readonly email: string;
  };
  if (isBlockedIdentity(user)) return undefined;
  return { id: user.id, username: user.username ?? user.name ?? user.email, email: user.email };
}

export function apply(ctx: Context): void {
  const handler: WorkerHandler = async (request, env) => {
    const url = new URL(request.url);
    const policyResponse = await authPolicyResponse(request, env as AuthPolicyEnv);
    if (policyResponse !== undefined) return policyResponse;
    if (url.pathname.startsWith("/api/auth/")) {
      // Better Auth initializes asynchronously. Start it only in a request that
      // awaits it; a public asset request can end before that work settles.
      const auth = authFor(env);
      if (auth === undefined) return json({ error: "auth_unavailable" }, 503);
      let response: Response;
      try {
        response = await auth.handler(request);
      } catch {
        // A missing schema or unavailable D1 must not bypass the limiter, issue
        // a cookie, or expose SQL/adapter details to the caller.
        return json({ error: "auth_unavailable" }, 503);
      }
      if (url.pathname.replace(/\/+$/u, "") === "/api/auth/get-session" && response.ok) {
        const body = await response.clone().json().catch(() => undefined) as { user?: AuthUser } | undefined;
        if (body?.user !== undefined && isBlockedIdentity(body.user)) return json(null);
      }
      return response;
    }
    // `/api/plugin-control` was removed with the owner-switch capability in Commit 1;
    // it stays in this mutating-path list only as a historical cross-origin test path.
    const protectedPath = url.pathname === "/api/session-host" || url.pathname.startsWith("/api/session-host/")
      || (url.pathname === "/api/plugin-control" && request.method !== "GET" && request.method !== "HEAD")
      || url.pathname.startsWith("/agents/");
    const acceptsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    const navigation = (request.method === "GET" || request.method === "HEAD") && acceptsHtml;
    const publicPath = url.pathname === "/login"
      || url.pathname === "/sitemap.xml" || url.pathname === "/robots.txt"
      || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/api/")
      || url.pathname === "/plugins/events"
      || url.pathname === "/favicon.svg" || url.pathname === "/favicon-dark.svg"
      || url.pathname === "/manifest.webmanifest";
    // Only the guarded APIs and private HTML navigations need a D1 session
    // read; assets and public documents must not amplify D1 or the Better Auth
    // rate limiter. Downstream API handlers resolve their own session.
    const needsUser = protectedPath || (navigation && !publicPath);
    const user = needsUser ? await sessionFor(request, env) : undefined;
    if (protectedPath) {
      if (user === undefined) return json({ error: "unauthenticated" }, 401);
      return undefined;
    }
    if (navigation && !publicPath && user === undefined) {
      const next = `${url.pathname}${url.search}`;
      return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url.origin).href, 302);
    }
    return undefined;
  };
  ctx.provide("auth", { session: sessionFor } satisfies AuthFace);
  ctx.effect(() => ctx.http.use(handler), "dsh-base: Better Auth over D1");
}
