/** Durable account store for local product accounts. */

interface SqlRow {
  readonly [key: string]: unknown;
}

interface SqlCursor {
  toArray(): readonly SqlRow[];
}

interface SqlStorage {
  exec(query: string, ...bindings: readonly unknown[]): SqlCursor;
}

export interface AuthStoreState {
  readonly storage: { readonly sql: SqlStorage };
}

interface UserRow extends SqlRow {
  readonly user_id: string;
  readonly username: string;
  readonly email: string;
  readonly password_salt: string;
  readonly password_hash: string;
}

interface UserView {
  readonly id: string;
  readonly username: string;
  readonly email: string;
}

interface SessionRow extends SqlRow {
  readonly user_id: string;
  readonly username: string;
  readonly email: string;
  readonly expires_at: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const encoder = new TextEncoder();

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function token(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: fromBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256",
  }, key, 256);
  return base64(new Uint8Array(bits));
}

async function hashToken(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function userView(row: { user_id: string; username: string; email: string }): UserView {
  return { id: row.user_id, username: row.username, email: row.email };
}

function readToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

/** Persist accounts and opaque sessions in Durable Object SQLite. */
export class AuthStoreObject {
  private readonly sql: SqlStorage;

  constructor(state: AuthStoreState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS dsh_auth_users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS dsh_auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS dsh_auth_sessions_user ON dsh_auth_sessions (user_id)`);
  }

  private async createSession(userId: string): Promise<string> {
    const raw = token();
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO dsh_auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      await hashToken(raw), userId, now, now + SESSION_TTL_MS,
    );
    return raw;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/register" && request.method === "POST") return this.register(request);
    if (url.pathname === "/login" && request.method === "POST") return this.login(request);
    if (url.pathname === "/session" && request.method === "GET") return this.session(request);
    if (url.pathname === "/logout" && request.method === "POST") return this.logout(request);
    return json({ error: "not_found" }, 404);
  }

  private async body(request: Request): Promise<Record<string, unknown> | undefined> {
    try {
      const value: unknown = await request.json();
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async register(request: Request): Promise<Response> {
    const input = await this.body(request);
    const username = typeof input?.username === "string" ? input.username.trim() : "";
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (!USERNAME.test(username)) return json({ error: "invalid_username" }, 400);
    if (!EMAIL.test(email)) return json({ error: "invalid_email" }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "invalid_password" }, 400);
    const existing = this.sql.exec(`SELECT user_id FROM dsh_auth_users WHERE username = ? OR email = ?`, username, email)
      .toArray() as readonly SqlRow[];
    if (existing.length > 0) return json({ error: "account_exists" }, 409);
    const userId = `usr_${crypto.randomUUID()}`;
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt);
    try {
      this.sql.exec(
        `INSERT INTO dsh_auth_users (user_id, username, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        userId, username, email, salt, passwordHash, Date.now(),
      );
    } catch {
      return json({ error: "account_exists" }, 409);
    }
    const raw = await this.createSession(userId);
    return json({ user: { id: userId, username, email }, token: raw }, 201);
  }

  private async login(request: Request): Promise<Response> {
    const input = await this.body(request);
    const identifier = typeof input?.identifier === "string" ? input.identifier.trim() : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (identifier === "" || password === "") return json({ error: "invalid_credentials" }, 401);
    const rows = this.sql.exec(
      `SELECT * FROM dsh_auth_users WHERE username = ? OR email = ?`, identifier, identifier.toLowerCase(),
    ).toArray() as readonly UserRow[];
    const row = rows[0];
    if (row === undefined) return json({ error: "invalid_credentials" }, 401);
    const hash = await hashPassword(password, row.password_salt);
    if (hash !== row.password_hash) return json({ error: "invalid_credentials" }, 401);
    const raw = await this.createSession(row.user_id);
    return json({ user: userView(row), token: raw });
  }

  private async session(request: Request): Promise<Response> {
    const raw = readToken(request);
    if (raw === undefined) return json({ error: "unauthorized" }, 401);
    const now = Date.now();
    const rows = this.sql.exec(
      `SELECT s.user_id, s.expires_at, u.username, u.email FROM dsh_auth_sessions s
       JOIN dsh_auth_users u ON u.user_id = s.user_id WHERE s.token_hash = ?`, await hashToken(raw),
    ).toArray() as readonly SessionRow[];
    const row = rows[0];
    if (row === undefined || row.expires_at <= now) {
      if (row !== undefined) this.sql.exec(`DELETE FROM dsh_auth_sessions WHERE token_hash = ?`, await hashToken(raw));
      return json({ error: "unauthorized" }, 401);
    }
    return json({ user: userView({ user_id: row.user_id, username: row.username, email: row.email }) });
  }

  private async logout(request: Request): Promise<Response> {
    const raw = readToken(request);
    if (raw !== undefined) this.sql.exec(`DELETE FROM dsh_auth_sessions WHERE token_hash = ?`, await hashToken(raw));
    return json({ ok: true });
  }
}
