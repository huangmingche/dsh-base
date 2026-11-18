/** Worker auth plugin: Better Auth over D1 with product-account session gating. */
import { authPolicyResponse, isBlockedIdentity, type AuthPolicyEnv } from "./policy.ts";
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import { rejectCrossOriginRequest } from "../../dsh-base-cloudflare-worker-http/src/request-origin.ts";
import { bytes, HttpError } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
import { canonicalizeLocalePath, splitLocalePath } from "../../../boot/dsh-base-locale-path/src/index.ts";
import { isPublicDocument, isPublicResource, isPrivateDocument } from "../../../boot/dsh-base-public-pages/src/index.ts";
import type {} from "@dsh-base/cloudflare-worker-public-pages";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import { waitUntil } from "cloudflare:workers";
import type { EmailEnv, EmailService } from "@dsh-base/cloudflare-worker-email";
import { createAuthExtensions, type AuthExtension, type AuthExtensions } from "./extensions.ts";
import type { ConversionAnalyticsService } from '@dsh-base/cloudflare-worker-google-analytics';
import { recordSignupConversion } from './analytics.ts';
export type { AuthExtension } from "./extensions.ts";

export { AuthStoreObject } from "./store.ts";

export const name = "@dsh-base/cloudflare-worker-auth";
export const inject = ["http", "publicPages"];
export const Config = undefined;

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_UPDATE_SECONDS = 24 * 60 * 60;

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly name?: string;
  readonly image?: string | null;
  readonly emailVerified?: boolean;
  readonly role?: string | null;
}

export interface AuthFace {
  /** Missing/expired credentials return undefined; backend failures reject with HttpError(503). */
  session(request: Request, env?: unknown): Promise<AuthUser | undefined>;
  registerExtension(extension: AuthExtension): () => void;
  /** The same policy, origin and rate-limit checks as public auth HTTP requests. */
  handle(request: Request, env?: unknown, extensionId?: string): Promise<Response>;
  /** Trusted Worker callers only; restricted to methods exported by registered auth plugins. */
  invokeExtension(method: string, input: unknown, env?: unknown): Promise<unknown>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth: AuthFace;
  }
}

interface AuthEnv extends AuthPolicyEnv, EmailEnv {
  readonly AUTH_DB?: D1Database;
  readonly AUTH_BASE_URL?: string;
  readonly AUTH_SECRET?: string;
}

type AuthInstance = ReturnType<typeof createAuth>;
type AuthEmailData = { user: { email: string }; url: string; token: string };

function createAuth(env: AuthEnv & { AUTH_DB: D1Database; AUTH_BASE_URL: string; AUTH_SECRET: string }, email: EmailService | undefined, extensions: ReturnType<AuthExtensions["resolve"]>, analyticsFor: () => ConversionAnalyticsService | undefined) {
  const base = new URL(env.AUTH_BASE_URL);
  const emailReady = email?.ready(env) === true;
  const enqueueEmail = (kind: "verify-email" | "reset-password", data: AuthEmailData, request?: Request) => {
    if (!email || !emailReady) return;
    // Provider latency and failure must not expose whether an anonymous account exists.
    // waitUntil keeps the bounded send alive after the response without an extra queue.
    waitUntil(email.sendTransactional(env, { kind, to: data.user.email, actionUrl: data.url, idempotencyKey: data.token,
      locale: request?.headers.get("accept-language")?.split(",")[0]?.split(";")[0] }).catch(() => {
      console.warn("auth.email.delivery_failed", kind);
    }));
  };
  return betterAuth({
    database: env.AUTH_DB,
    baseURL: env.AUTH_BASE_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    // Upstream diagnostics can include OAuth state and vendor error objects.
    // Keep request credentials out of logs; delivery failures use fixed codes.
    logger: { disabled: true },
    trustedOrigins: [base.origin],
    emailAndPassword: {
      enabled: true,
      autoSignIn: env.AUTH_EMAIL_VERIFICATION_REQUIRED !== "true",
      requireEmailVerification: env.AUTH_EMAIL_VERIFICATION_REQUIRED === "true",
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      ...(emailReady ? { sendResetPassword: async (data: AuthEmailData, request?: Request) => { enqueueEmail("reset-password", data, request); } } : {}),
    },
    ...(emailReady ? { emailVerification: { sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false,
      sendVerificationEmail: async (data: AuthEmailData, request?: Request) => { enqueueEmail("verify-email", data, request); } } } : {}),
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: SESSION_UPDATE_SECONDS,
      cookieCache: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    plugins: [username({ immutableUsername: true, displayUsername: false }), ...extensions.plugins],
    socialProviders: extensions.socialProviders,
    databaseHooks: { user: { create: { after: async (user, context) => {
      waitUntil(recordSignupConversion(analyticsFor(), env, user.id, context?.headers));
    } } } },
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
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 10 },
        "/sign-in/social": { window: 60, max: 20 },
        "/api-key/create": { window: 60, max: 5 },
        "/api-key/delete": { window: 60, max: 20 },
        "/api-key/list": { window: 60, max: 60 },
        "/admin/*": { window: 60, max: 60 },
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

function createAuthResolver(emailFor: () => EmailService | undefined, registry: AuthExtensions, analyticsFor: () => ConversionAnalyticsService | undefined) {
  let cached: { readonly database: D1Database; readonly email: EmailService | undefined; readonly key: string; auth?: AuthInstance } | undefined;
  return async (env: unknown): Promise<AuthInstance | undefined> => {
    const typed = (env ?? {}) as AuthEnv;
    if (typed.AUTH_DB === undefined || typed.AUTH_BASE_URL === undefined || typed.AUTH_SECRET === undefined || typed.AUTH_SECRET.length < 32) return undefined;
    const email = emailFor();
    const extensions = registry.resolve(env);
    const key = JSON.stringify([typed.AUTH_BASE_URL, typed.AUTH_SECRET, typed.AUTH_EMAIL_VERIFICATION_REQUIRED, typed.EMAIL_ENABLED, typed.EMAIL_PROVIDER,
      typed.EMAIL_FROM, typed.EMAIL_CLOUDFLARE_ACCOUNT_ID, typed.EMAIL_CLOUDFLARE_API_TOKEN, typed.RESEND_API_KEY, extensions.key]);
    if (cached?.database !== typed.AUTH_DB || cached.email !== email || cached.key !== key) {
      cached = { database: typed.AUTH_DB, email, key };
    }
    const config = cached;
    if (config.auth) return config.auth;
    // Better Auth starts D1 schema validation during initialization. Its promise
    // belongs to this Worker request; only publish an instance after success.
    // Overlapping cold requests each initialize independently. Warm ones reuse
    // the completed check, without storing an identity or bypassing D1.
    const auth = createAuth({ ...typed, AUTH_DB: typed.AUTH_DB, AUTH_BASE_URL: typed.AUTH_BASE_URL, AUTH_SECRET: typed.AUTH_SECRET }, email, extensions, analyticsFor);
    try {
      const context = await auth.$context;
      await context.checkSchema?.();
    } catch (error) {
      throw authFailure("initialize", error);
    }
    config.auth ??= auth;
    return auth;
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function authFailure(stage: "configuration" | "initialize" | "session" | "http", error?: unknown): HttpError {
  if (error instanceof HttpError && error.code === "auth_unavailable") return error;
  const causes = [error, error instanceof Error ? error.cause : undefined];
  let reason = stage === "configuration" ? "missing_binding" : "unknown";
  for (const cause of causes) {
    if (!(cause instanceof Error)) continue;
    if ("code" in cause && cause.code === "SCHEMA_MISMATCH") { reason = "schema_mismatch"; break; }
    if (/different request|request context|I\/O on behalf/i.test(cause.message)) { reason = "request_context"; break; }
    if (/D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(cause.message)) { reason = "database"; break; }
    if (cause instanceof TypeError) reason = "type_error";
  }
  // Cloudflare correlates this event with the request. Raw exceptions can
  // contain SQL parameters, OAuth state, cookies or user identifiers.
  console.warn("auth.unavailable", { stage, reason });
  return new HttpError(503, "auth_unavailable");
}

async function sessionFor(request: Request, env: unknown, authFor: ReturnType<typeof createAuthResolver>): Promise<AuthUser | undefined> {
  const auth = await authFor(env);
  if (auth === undefined) throw authFailure("configuration");
  // Authorization cannot forward refreshed Set-Cookie headers. The public auth
  // endpoint owns renewal; these checks only read the authoritative session.
  const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
  if (session === null) return undefined;
  const user = session.user as {
    readonly id: string;
    readonly username?: string | null;
    readonly name?: string | null;
    readonly email: string;
    readonly image?: string | null;
    readonly emailVerified?: boolean;
    readonly role?: string | null;
  };
  if (isBlockedIdentity(user)) return undefined;
  return { id: user.id, username: user.username ?? user.name ?? user.email, email: user.email,
    ...(typeof user.name === "string" ? { name: user.name } : {}), ...(user.image === undefined ? {} : { image: user.image }),
    ...(typeof user.emailVerified === "boolean" ? { emailVerified: user.emailVerified } : {}), ...(user.role === undefined ? {} : { role: user.role }) };
}

export function apply(ctx: Context): void {
  const registry = createAuthExtensions();
  let analytics: ConversionAnalyticsService | undefined;
  ctx.inject(['siteAnalytics'], scope => scope.effect(() => {
    analytics = scope.siteAnalytics as ConversionAnalyticsService;
    return () => { analytics = undefined; };
  }));
  // Pinned Cordis inject maps contain intercept config, not optional flags.
  // Its documented get() reads an optional service; resolve it on every request
  // so late activation/removal invalidates auth hooks instead of retaining mail.
  const emailFor = () => ctx.get("email") as EmailService | undefined;
  const authFor = createAuthResolver(emailFor, registry, () => analytics);
  // Middleware and the owning API authorize the same incoming Request. Reuse
  // that single decision, never a cookie/user cache shared by later requests.
  const sessions = new WeakMap<Request, { env: unknown; value: Promise<AuthUser | undefined> }>();
  const session = (request: Request, env: unknown): Promise<AuthUser | undefined> => {
    const previous = sessions.get(request);
    if (previous !== undefined && previous.env === env) return previous.value;
    const value = sessionFor(request, env, authFor).catch(error => { throw authFailure("session", error); });
    sessions.set(request, { env, value });
    return value;
  };
  const handle = async (request: Request, env: unknown, extensionId?: string): Promise<Response> => {
    try {
      const rejected = rejectCrossOriginRequest(request);
      if (rejected) return rejected;
      if (request.method === "POST" && new URL(request.url).pathname.replace(/\/+$/u, "") === "/api/auth/sign-up/email") {
        // Bound the original stream before policy and Better Auth clone/parse it.
        // Reading a bounded clone alone can leave its tee buffering the body.
        request = new Request(request, { body: await bytes(request, 16_384) });
      }
      const capabilities = { email: emailFor()?.status(env) ?? { enabled: false, ready: false, provider: null }, extensions: registry.resolve(env).policy };
      const denied = await authPolicyResponse(request, (env ?? {}) as AuthPolicyEnv, capabilities, extensionId);
      if (denied) return denied;
      const auth = await authFor(env);
      if (!auth) throw authFailure("configuration");
      const response = await auth.handler(request);
      if (new URL(request.url).pathname.replace(/\/+$/u, "") === "/api/auth/get-session" && response.ok) {
        const body = await response.clone().json().catch(() => undefined) as { user?: AuthUser } | undefined;
        if (body?.user !== undefined && isBlockedIdentity(body.user)) return json(null);
      }
      const headers = new Headers(response.headers); headers.set("cache-control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const failure = error instanceof HttpError ? error : authFailure("http", error);
      return json({ error: failure.code }, failure.status);
    }
  };
  const handler: WorkerHandler = async (request, env) => {
    const url = new URL(request.url);
    // Keep the private build inventory out of both auth redirects and the SPA fallback.
    if (url.pathname === "/third-party-notices.txt" || url.pathname === "/third-party/document-preview.txt") {
      return new Response(request.method === "HEAD" ? null : "Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (url.pathname.replace(/\/+$/u, "") === "/api/auth-policy" || url.pathname.startsWith("/api/auth/")) return handle(request, env);
    // `/api/plugin-control` was removed with the owner-switch capability in Commit 1;
    // it stays in this mutating-path list only as a historical cross-origin test path.
    const protectedPath = url.pathname === "/api/session-host" || url.pathname.startsWith("/api/session-host/")
      || (url.pathname === "/api/plugin-control" && request.method !== "GET" && request.method !== "HEAD")
      || url.pathname.startsWith("/agents/");
    const acceptsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    const navigation = (request.method === "GET" || request.method === "HEAD") && acceptsHtml;
    // Canonical spelling is decided before any auth decision: `/ZH-CN`, `/JA`
    // and `/en/*` are 301s even for anonymous visitors, and the shared module
    // owns the target (never a hand-joined prefix).
    if (navigation) {
      const canonical = canonicalizeLocalePath(url.pathname);
      const split = splitLocalePath(url.pathname);
      const target = canonical !== url.pathname ? canonical : split.needsLocaleRedirect ? split.canonicalPath : undefined;
      if (target !== undefined) {
        const location = new URL(url.href);
        location.pathname = target;
        return new Response(null, { status: 301, headers: { location: location.href } });
      }
    }
    const documentAddress = splitLocalePath(url.pathname);
    const neutral = documentAddress.path;
    let published = isPublicDocument(neutral);
    if (navigation && !neutral.startsWith("/api/") && !neutral.startsWith("/assets/")) {
      try { published = ctx.get("publicPages") ? !!await ctx.publicPages.resolve(env, neutral, documentAddress.locale) : published; }
      catch { return new Response(null, {status: 503, headers: {"cache-control": "no-store", "x-robots-tag": "noindex"}}); }
    }
    const publicPath = published
      || neutral === "/login"
      || isPublicResource(url.pathname)
      || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/api/")
      || url.pathname === "/plugins/events"
      || url.pathname === "/favicon.svg" || url.pathname === "/favicon-dark.svg";
    // Unknown documents are not private documents: return 404 without querying a session.
    if (navigation && !publicPath && !isPrivateDocument(neutral)) {
      return new Response(request.method === "HEAD" ? null : "Not found", {status: 404,
        headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex"}});
    }
    // Only the guarded APIs and private HTML navigations need a D1 session
    // read; assets and public documents must not amplify D1 or the Better Auth
    // rate limiter. Downstream API handlers resolve their own session.
    const needsUser = protectedPath || (navigation && !publicPath);
    let user: AuthUser | undefined;
    try { user = needsUser ? await session(request, env) : undefined; }
    catch { return json({ error: "auth_unavailable" }, 503); }
    if (protectedPath) {
      if (user === undefined) return json({ error: "unauthenticated" }, 401);
      return undefined;
    }
    if (navigation && !publicPath && user === undefined) {
      const next = `${url.pathname}${url.search}`;
      // Build a mutable response: Response.redirect() headers are immutable.
      return new Response(null, {
        status: 302,
        headers: {
          location: new URL(`/login?next=${encodeURIComponent(next)}`, url.origin).href,
          "x-robots-tag": "noindex, nofollow",
        },
      });
    }
    return undefined;
  };
  ctx.provide("auth", { session, registerExtension: extension => registry.register(extension), handle,
    async invokeExtension(method, input, env) {
      if (!registry.resolve(env).plugins.some(plugin => Object.hasOwn(plugin.endpoints ?? {}, method))) throw new Error("auth_extension_method_unavailable");
      const auth = await authFor(env);
      const action = (auth?.api as Record<string, ((input: unknown) => Promise<unknown>)> | undefined)?.[method];
      if (!action) throw new Error("auth_extension_method_unavailable");
      return action(input);
    },
  } satisfies AuthFace);
  ctx.effect(() => ctx.http.use(handler, 0), "dsh-base: Better Auth over D1");
}
