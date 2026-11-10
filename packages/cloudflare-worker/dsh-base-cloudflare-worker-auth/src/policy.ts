/** Explicit account-provisioning policy; public templates do not open registration. */
export interface AuthPolicyEnv {
  readonly AUTH_SIGNUP_ENABLED?: string;
  readonly AUTH_REGISTRATION_TOKEN?: string;
  readonly AUTH_EMAIL_VERIFICATION_REQUIRED?: string;
}
export interface AuthCapabilities {
  readonly email: { readonly enabled: boolean; readonly ready: boolean; readonly provider: "cloudflare" | "resend" | null };
  readonly extensions?: Record<string, boolean>;
}
const DISABLED_CAPABILITIES: AuthCapabilities = { email: { enabled: false, ready: false, provider: null } };

/** Retired public fixture credentials must never authorize existing cookies either. */
export function isBlockedIdentity(user: { username?: string | null; email?: string | null; name?: string | null }): boolean {
  const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : undefined;
  return normalize(user.username) === "dshbaseacceptance" || normalize(user.email) === "dshbaseacceptance@example.com";
}

function tokenMatches(actual: string | null, expected: string | undefined): boolean {
  if (actual === null || expected === undefined || expected.length < 32) return false;
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) difference |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  return difference === 0;
}

/** Only capability flags are public; provisioning credentials never reach browser state. */
export function authPolicy(env: AuthPolicyEnv, capabilities: AuthCapabilities = DISABLED_CAPABILITIES) {
  return { googleEnabled: false, ...capabilities.extensions, signUpEnabled: env.AUTH_SIGNUP_ENABLED === "true",
    email: capabilities.email, passwordResetEnabled: capabilities.email.ready, emailVerificationEnabled: capabilities.email.ready,
    emailVerificationRequired: env.AUTH_EMAIL_VERIFICATION_REQUIRED === "true" };
}

/** Return a denial/policy response before initializing Better Auth, otherwise continue. */
export async function authPolicyResponse(request: Request, env: AuthPolicyEnv, capabilities: AuthCapabilities = DISABLED_CAPABILITIES, internalExtension?: string): Promise<Response | undefined> {
  const path = new URL(request.url).pathname.replace(/\/+$/u, "");
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  let namespacePath: string;
  try { namespacePath = decodeURIComponent(path).replace(/\/{2,}/gu, "/").replace(/\/+$/u, "").toLowerCase(); } catch { return json({ error: "invalid_path" }, 400); }
  // Product profile updates enforce name rules and owned R2 avatar references.
  // They write D1 directly, so no caller needs the permissive native updater.
  if (namespacePath === "/api/auth/update-user") return json({ error: "not_found" }, 404);
  // Only trusted Worker services may enter these native plugin namespaces. An
  // HTTP client cannot bypass the product wrapper's ownership, fields or limits.
  if ((namespacePath.startsWith("/api/auth/admin/") && (internalExtension !== "user-admin" || namespacePath !== path))
    || (namespacePath.startsWith("/api/auth/api-key/") && (internalExtension !== "api-keys" || namespacePath !== path))) return json({ error: "not_found" }, 404);
  if (path === "/api/auth-policy") return request.method === "GET" || request.method === "HEAD"
    ? request.method === "HEAD" ? new Response(null, { headers: { "cache-control": "no-store", "content-type": "application/json" } }) : json(authPolicy(env, capabilities)) : json({ error: "method_not_allowed" }, 405);
  if (request.method === "POST" && ["/api/auth/request-password-reset", "/api/auth/send-verification-email", "/api/auth/reset-password"].includes(path) && !capabilities.email.ready) return json({ error: "email_unavailable" }, 503);
  if (path === "/api/auth/sign-in/social" && request.method === "POST" && capabilities.extensions?.googleEnabled !== true) return json({ error: "social_login_unavailable" }, 503);
  if (path === "/api/auth/sign-in/social" && request.method === "POST") {
    const social = await request.clone().json().catch(() => undefined) as { provider?: unknown; idToken?: unknown } | undefined;
    if (social?.provider !== "google" || social.idToken !== undefined) return json({ error: "unsupported_social_flow" }, 400);
  }
  if (path === "/api/auth/sign-up/email" && request.method === "POST" && env.AUTH_EMAIL_VERIFICATION_REQUIRED === "true" && !capabilities.email.ready) return json({ error: "email_unavailable" }, 503);
  if (request.method !== "POST" || !["/api/auth/sign-up/email", "/api/auth/sign-in/username", "/api/auth/sign-in/email"].includes(path)) return undefined;
  const formSignup = path === "/api/auth/sign-up/email" && request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
  const body = formSignup ? Object.fromEntries(new URLSearchParams(await request.clone().text())) : await request.clone().json().catch(() => undefined);
  if (path === "/api/auth/sign-up/email" && typeof body === "object" && body !== null && Object.hasOwn(body, "image")) return json({ error: "profile_image_requires_owned_file" }, 400);
  if (typeof body === "object" && body !== null && isBlockedIdentity(body)) return json({ error: "account_unavailable", message: "This retired public test account is disabled" }, 403);
  if (path === "/api/auth/sign-up/email" && !authPolicy(env).signUpEnabled && !tokenMatches(request.headers.get("x-dsh-registration-token"), env.AUTH_REGISTRATION_TOKEN)) {
    return json({ error: "registration_disabled", message: "Public registration is disabled" }, 403);
  }
  return undefined;
}
