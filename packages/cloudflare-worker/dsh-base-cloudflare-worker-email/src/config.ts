import { EmailError, type EmailConfig, type EmailEnv, type TransactionalEmail } from "./types.ts";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/u;
export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && ADDRESS.test(value)
    && !value.includes("..") && !value.startsWith(".") && !value.split("@")[0]!.endsWith(".");
}
function validFrom(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 320 || CONTROL.test(value)) return false;
  if (isEmailAddress(value)) return true;
  const named = /^([^<>"\\,;]+) <([^<>]+)>$/u.exec(value);
  return named !== null && named[1]!.trim() !== "" && isEmailAddress(named[2]);
}
function secret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 4096 && !/\s/u.test(value);
}

/** Strict explicit enablement; malformed settings never select a fallback provider. */
export function emailConfig(env: unknown): EmailConfig | undefined {
  const typed = (env ?? {}) as EmailEnv;
  if (typed.EMAIL_ENABLED !== "true" || typed.AUTH_DB === undefined || typeof typed.AUTH_DB.withSession !== "function"
    || !validFrom(typed.EMAIL_FROM) || typeof typed.AUTH_BASE_URL !== "string") return undefined;
  let base: URL;
  try { base = new URL(typed.AUTH_BASE_URL); } catch { return undefined; }
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) return undefined;
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") return undefined;
  const common = { database: typed.AUTH_DB, origin: base.origin, from: typed.EMAIL_FROM };
  if (typed.EMAIL_PROVIDER === "cloudflare" && typeof typed.EMAIL_CLOUDFLARE_ACCOUNT_ID === "string"
    && /^[a-f\d]{32}$/iu.test(typed.EMAIL_CLOUDFLARE_ACCOUNT_ID) && secret(typed.EMAIL_CLOUDFLARE_API_TOKEN)) {
    return { ...common, provider: "cloudflare", endpoint: `https://api.cloudflare.com/client/v4/accounts/${typed.EMAIL_CLOUDFLARE_ACCOUNT_ID}/email/sending/send`, secret: typed.EMAIL_CLOUDFLARE_API_TOKEN };
  }
  if (typed.EMAIL_PROVIDER === "resend" && secret(typed.RESEND_API_KEY)) {
    return { ...common, provider: "resend", endpoint: "https://api.resend.com/emails", secret: typed.RESEND_API_KEY };
  }
  return undefined;
}

/** Allow one valid mailbox and a same-origin credential link; consumers own recipient authorization. */
export function validateIntent(input: TransactionalEmail, config: EmailConfig): URL {
  if (!input || !["verify-email", "reset-password"].includes(input.kind) || !isEmailAddress(input.to)
    || typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 4096
    || CONTROL.test(input.idempotencyKey) || typeof input.actionUrl !== "string" || input.actionUrl.length > 8192
    || CONTROL.test(input.actionUrl) || (input.locale !== undefined && (typeof input.locale !== "string" || input.locale.length > 64))) {
    throw new EmailError("email_invalid_intent");
  }
  try {
    const url = new URL(input.actionUrl);
    if (url.origin !== config.origin || url.username || url.password || url.hash) throw new Error();
    const validPath = input.kind === "verify-email" ? url.pathname === "/api/auth/verify-email"
      : /^\/api\/auth\/reset-password\/[^/]+$/u.test(url.pathname);
    if (!validPath) throw new Error();
    if (input.kind === "verify-email" && !url.searchParams.get("token")) throw new Error();
    for (const callback of url.searchParams.getAll("callbackURL")) {
      const target = new URL(callback, config.origin);
      if (target.origin !== config.origin || target.username || target.password) throw new Error();
    }
    return url;
  } catch { throw new EmailError("email_invalid_intent"); }
}
