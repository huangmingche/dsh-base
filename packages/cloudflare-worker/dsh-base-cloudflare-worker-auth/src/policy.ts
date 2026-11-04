/** Explicit account-provisioning policy; public templates do not open registration. */
export interface AuthPolicyEnv {
  readonly AUTH_SIGNUP_ENABLED?: string;
  readonly AUTH_REGISTRATION_TOKEN?: string;
}

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

/** Only the enabled boolean is public; provisioning credentials never reach browser state. */
export function authPolicy(env: AuthPolicyEnv): { signUpEnabled: boolean } {
  return { signUpEnabled: env.AUTH_SIGNUP_ENABLED === "true" };
}

/** Return a denial/policy response before initializing Better Auth, otherwise continue. */
export async function authPolicyResponse(request: Request, env: AuthPolicyEnv): Promise<Response | undefined> {
  const path = new URL(request.url).pathname.replace(/\/+$/u, "");
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  if (path === "/api/auth-policy") return request.method === "GET" || request.method === "HEAD"
    ? json(authPolicy(env)) : json({ error: "method_not_allowed" }, 405);
  if (request.method !== "POST" || !["/api/auth/sign-up/email", "/api/auth/sign-in/username", "/api/auth/sign-in/email"].includes(path)) return undefined;
  const body = await request.clone().json().catch(() => undefined);
  if (typeof body === "object" && body !== null && isBlockedIdentity(body)) return json({ error: "account_unavailable", message: "This retired public test account is disabled" }, 403);
  if (path === "/api/auth/sign-up/email" && !authPolicy(env).signUpEnabled && !tokenMatches(request.headers.get("x-dsh-registration-token"), env.AUTH_REGISTRATION_TOKEN)) {
    return json({ error: "registration_disabled", message: "Public registration is disabled" }, 403);
  }
  return undefined;
}
