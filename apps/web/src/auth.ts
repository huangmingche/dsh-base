/** Minimal cookie session auth for the rc.5 Workers surface: no external identity service. */
const encoder = new TextEncoder();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "dsh_session";

export interface AuthConfig {
  readonly username: string;
  readonly passwordHash: string;
  readonly secret: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read the deployment's auth settings; absent settings keep the login disabled and visible. */
export function authConfigFromEnv(env: Record<string, unknown>): AuthConfig | undefined {
  const username = text(env.AUTH_USERNAME);
  const passwordHash = text(env.AUTH_PASSWORD_SHA256).toLowerCase();
  const secret = text(env.AUTH_SECRET);
  if (username === "" || !/^[0-9a-f]{64}$/u.test(passwordHash) || secret.length < 16) return undefined;
  return { username, passwordHash, secret };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** SHA-256 password digest, the only form this surface stores or compares. */
export async function hashPassword(password: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(password)));
}

async function signature(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Issue a signed session value for the configured owner. */
export async function issueSession(config: AuthConfig, now = Date.now()): Promise<string> {
  const payload = `${base64url(encoder.encode(config.username).buffer)}.${now + SESSION_TTL_MS}`;
  return `${payload}.${await signature(config.secret, payload)}`;
}

/** Verify a session value and return the authenticated username. */
export async function verifySession(config: AuthConfig, value: string, now = Date.now()): Promise<string | undefined> {
  const [name, expiry, signed] = value.split(".");
  if (name === undefined || expiry === undefined || signed === undefined) return undefined;
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return undefined;
  if (signed !== await signature(config.secret, `${name}.${expiry}`)) return undefined;
  try {
    const username = atob(name.replace(/-/gu, "+").replace(/_/gu, "/"));
    return username === config.username ? username : undefined;
  } catch {
    return undefined;
  }
}

/** Read one cookie value from the request header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Set-Cookie value for an issued session. */
export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export const clearSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
