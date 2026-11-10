export interface GoogleAuthEnv {
  readonly AUTH_GOOGLE_ENABLED?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly AUTH_SIGNUP_ENABLED?: string;
  readonly AUTH_BASE_URL?: string;
}
/** Credentials remain in Worker bindings; no endpoint override or client ID-token fast path. */
export function googleConfig(env: unknown) {
  const typed = (env ?? {}) as GoogleAuthEnv;
  if (typed.AUTH_GOOGLE_ENABLED !== "true" || typeof typed.GOOGLE_CLIENT_ID !== "string"
    || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/u.test(typed.GOOGLE_CLIENT_ID)
    || typeof typed.GOOGLE_CLIENT_SECRET !== "string" || typed.GOOGLE_CLIENT_SECRET.length < 8 || typed.GOOGLE_CLIENT_SECRET.length > 4096
    || /\s/u.test(typed.GOOGLE_CLIENT_SECRET) || typeof typed.AUTH_BASE_URL !== "string") return undefined;
  try {
    const origin = new URL(typed.AUTH_BASE_URL);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
      || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) return undefined;
  } catch { return undefined; }
  return { clientId: typed.GOOGLE_CLIENT_ID, clientSecret: typed.GOOGLE_CLIENT_SECRET,
    disableSignUp: typed.AUTH_SIGNUP_ENABLED !== "true", accessType: "online" as const, includeGrantedScopes: false };
}
