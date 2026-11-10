import { digest, HttpError, responseObject, sameOrigin } from "./request.ts";
export interface PublicFormEnv {
  AUTH_DB?: D1Database; AUTH_BASE_URL?: string; TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string;
}
export const turnstileSiteKey = (env: PublicFormEnv): string | null => typeof env.TURNSTILE_SITE_KEY === "string" && /^[A-Za-z0-9_-]{10,100}$/u.test(env.TURNSTILE_SITE_KEY) ? env.TURNSTILE_SITE_KEY : null;
export function publicFormReady(env: PublicFormEnv): boolean {
  try {
    const base = new URL(env.AUTH_BASE_URL!);
    const secure = base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
    return secure && !!env.AUTH_DB && !!turnstileSiteKey(env) && typeof env.TURNSTILE_SECRET_KEY === "string"
      && env.TURNSTILE_SECRET_KEY.length >= 10 && env.TURNSTILE_SECRET_KEY.length <= 4096 && !/\s/u.test(env.TURNSTILE_SECRET_KEY)
      && base.origin === env.AUTH_BASE_URL!.replace(/\/$/u, "");
  } catch { return false; }
}
export async function budget(db: D1DatabaseSession, key: string, limit: number, windowMs: number): Promise<void> {
  const now = Date.now(), bucket = Math.floor(now / windowMs), hash = await digest(`${key}:${bucket}`);
  const accepted = await db.prepare(`INSERT INTO dsh_public_form_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(hash, (bucket + 2) * windowMs, limit).first();
  if (!accepted) throw new HttpError(429, "rate_limited");
}
/** No IP address or challenge token is stored; D1 prevents concurrent token reuse. */
export async function verifyPublicForm(request: Request, env: PublicFormEnv, action: "newsletter" | "contact", token: unknown,
  send: typeof fetch = fetch): Promise<void> {
  sameOrigin(request);
  if (!publicFormReady(env) || new URL(request.url).origin !== new URL(env.AUTH_BASE_URL!).origin) throw new HttpError(503, "form_unavailable");
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) throw new HttpError(400, "verification_required");
  const db = env.AUTH_DB!.withSession("first-primary");
  await db.prepare("DELETE FROM dsh_public_form_limits WHERE expires_at < ?").bind(Date.now()).run();
  await budget(db, `form:${action}:ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 5, 600000);
  await budget(db, `form:${action}:global`, 1000, 86400000);
  const claimed = await db.prepare("INSERT INTO dsh_public_form_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO NOTHING RETURNING key")
    .bind(`token:${await digest(token)}`, Date.now() + 600000).first();
  if (!claimed) throw new HttpError(400, "verification_required");
  let data: { success?: unknown; hostname?: unknown; action?: unknown };
  try {
    const response = await send("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }) });
    if (!response.ok) throw new Error();
    data = await responseObject(response, 16_384);
  } catch { throw new HttpError(503, "verification_unavailable"); }
  if (data.success !== true || data.hostname !== new URL(env.AUTH_BASE_URL!).hostname || data.action !== action) throw new HttpError(400, "verification_failed");
}
