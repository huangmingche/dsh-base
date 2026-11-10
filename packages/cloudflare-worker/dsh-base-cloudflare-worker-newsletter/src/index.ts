import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { AuthFace } from "@dsh-base/cloudflare-worker-auth";
import type { EmailService } from "@dsh-base/cloudflare-worker-email";
import { isEmailAddress } from "../../dsh-base-cloudflare-worker-email/src/config.ts";
import { isSiteAdministrator } from "../../dsh-base-cloudflare-worker-site-config/src/store.ts";
import { budget, publicFormReady, turnstileSiteKey, verifyPublicForm, type PublicFormEnv } from "../../dsh-base-cloudflare-worker-http/src/public-form.ts";
import { digest, failure, HttpError, json, objectBody, onlyFields, sameOrigin } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
import { NewsletterProvider } from "./provider.ts";
export const name = "@dsh-base/cloudflare-worker-newsletter";
export const inject = ["http", "auth", "email"];
export const Config = undefined;
interface Env extends PublicFormEnv { NEWSLETTER_ENABLED?: string; RESEND_API_KEY?: string; SITE_ADMIN_USER_IDS?: string }
interface Consent { email: string; token_hash: string; state: string; expires_at: number; revision: number; operation_at: number }
const RECONCILE_DELAY = 60_000;
const providerReady = (env: Env): boolean => !!env.AUTH_DB && typeof env.RESEND_API_KEY === "string"
  && env.RESEND_API_KEY.length >= 8 && env.RESEND_API_KEY.length <= 4096 && !/\s/u.test(env.RESEND_API_KEY);
export function createNewsletterHandler(auth: Pick<AuthFace, "session">, mail: EmailService, send: typeof fetch = fetch): WorkerHandler {
  return async (request, input) => {
    const url = new URL(request.url), base = "/api/saas/newsletter";
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return undefined;
    const env = (input ?? {}) as Env;
    try {
      const enabled = env.NEWSLETTER_ENABLED === "true", ready = enabled && providerReady(env) && publicFormReady(env) && mail.ready(env);
      if (url.pathname === `${base}/status` && request.method === "GET") return json({ enabled, ready, provider: "resend", turnstileSiteKey: ready ? turnstileSiteKey(env) : null });
      if (url.pathname === `${base}/reconcile`) {
        const administrator = await auth.session(request, env);
        if (!administrator) throw new HttpError(401, "unauthenticated");
        if (!isSiteAdministrator(env, administrator.id)) throw new HttpError(403, "site_admin_required");
        if (!env.AUTH_DB) throw new HttpError(503, "newsletter_unavailable");
        const db = env.AUTH_DB.withSession("first-primary");
        if (request.method === "GET") {
          const rows = await db.prepare("SELECT email,state,revision,operation_at FROM dsh_newsletter_consent WHERE state IN ('confirming','unsubscribing') ORDER BY operation_at LIMIT 100").all<Consent>();
          return json({ items: rows.results.map(row => ({ email: row.email, state: row.state, revision: row.revision,
            operationAt: row.operation_at, reconcilable: Date.now() - row.operation_at >= RECONCILE_DELAY })) });
        }
        if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
        sameOrigin(request);
        const body = await objectBody(request); onlyFields(body, ["email", "expectedRevision", "reviewedProvider"]);
        if (!isEmailAddress(body.email) || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || body.reviewedProvider !== true) throw new HttpError(400, "invalid_reconciliation");
        if (!providerReady(env)) throw new HttpError(503, "newsletter_unavailable");
        const row = await db.prepare("SELECT * FROM dsh_newsletter_consent WHERE email = ?").bind(body.email.toLowerCase()).first<Consent>();
        if (!row || !["confirming", "unsubscribing"].includes(row.state) || row.revision !== body.expectedRevision) throw new HttpError(409, "newsletter_revision_conflict");
        if (Date.now() - row.operation_at < RECONCILE_DELAY) throw new HttpError(409, "newsletter_operation_in_flight");
        // Operators must first establish that the ambiguous original request has
        // settled. This endpoint only reads the provider; it never changes consent.
        const subscribed = await new NewsletterProvider(env.RESEND_API_KEY!, send).status(row.email);
        const state = subscribed ? "confirmed" : "revoked";
        const saved = await db.prepare(`UPDATE dsh_newsletter_consent SET state=?,revision=revision+1,operation_at=0
          WHERE email=? AND state=? AND revision=? AND operation_at=?`)
          .bind(state, row.email, row.state, row.revision, row.operation_at).run();
        if (saved.meta.changes !== 1) throw new HttpError(409, "newsletter_revision_conflict");
        return json({ email: row.email, subscribed, state, revision: row.revision + 1 });
      }
      const owner = url.pathname === base ? await auth.session(request, env) : undefined;
      if (url.pathname === base && !owner) throw new HttpError(401, "unauthenticated");
      // Confirmation and authenticated opt-out do not depend on the mail sender
      // or Turnstile still being available after the confirmation email was sent.
      if (!enabled || !providerReady(env)) throw new HttpError(503, "newsletter_unavailable");
      const db = env.AUTH_DB!.withSession("first-primary"), provider = new NewsletterProvider(env.RESEND_API_KEY!, send);
      if (url.pathname === `${base}/subscribe` && request.method === "POST") {
        if (!ready) throw new HttpError(503, "newsletter_unavailable");
        const body = await objectBody(request); onlyFields(body, ["email", "consent", "turnstileToken", "locale"]);
        if (!isEmailAddress(body.email) || body.consent !== true || (body.locale !== undefined && (typeof body.locale !== "string" || body.locale.length > 64))) throw new HttpError(400, "invalid_subscription");
        await verifyPublicForm(request, env, "newsletter", body.turnstileToken, send);
        const email = body.email.toLowerCase();
        await budget(db, `newsletter:email:${email}`, 1, 600000);
        await db.prepare("DELETE FROM dsh_newsletter_consent WHERE expires_at < ? AND state NOT IN ('confirming','unsubscribing')").bind(Date.now()).run();
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
        const key = await digest(token), now = Date.now();
        const claim = await db.prepare(`INSERT INTO dsh_newsletter_consent (email,token_hash,state,consent_at,expires_at,revision,operation_at) VALUES (?,?,'pending',?,?,1,0)
          ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,state='pending',consent_at=excluded.consent_at,expires_at=excluded.expires_at,revision=revision+1,operation_at=0
          WHERE state NOT IN ('confirming','unsubscribing') RETURNING email`).bind(email, key, now, now + 86400000).first();
        if (claim) {
          const action = new URL("/", env.AUTH_BASE_URL); action.searchParams.set("newsletterToken", token);
          await mail.sendNotice(env, { kind: "newsletter-confirm", to: email, actionUrl: action.href,
            locale: typeof body.locale === "string" ? body.locale : undefined, idempotencyKey: key });
        }
        return json({ accepted: true }, 202);
      }
      if (url.pathname === `${base}/confirm` && request.method === "POST") {
        sameOrigin(request);
        const body = await objectBody(request); onlyFields(body, ["token"]);
        if (typeof body.token !== "string" || !/^[a-f\d]{64}$/u.test(body.token)) throw new HttpError(400, "invalid_confirmation");
        const hash = await digest(body.token);
        const row = await db.prepare("SELECT * FROM dsh_newsletter_consent WHERE token_hash = ? AND expires_at > ?").bind(hash, Date.now()).first<Consent>();
        if (!row || row.state === "revoked" || row.state === "unsubscribing") throw new HttpError(400, "invalid_confirmation");
        if (row.state === "confirmed") return json({ subscribed: await provider.status(row.email) });
        const claim = await db.prepare("UPDATE dsh_newsletter_consent SET state='confirming',revision=revision+1,operation_at=? WHERE token_hash=? AND state='pending' AND expires_at>? RETURNING revision")
          .bind(Date.now(), hash, Date.now()).first<{revision: number}>();
        if (!claim) throw new HttpError(409, "confirmation_in_progress");
        await provider.set(row.email, true);
        const saved = await db.prepare("UPDATE dsh_newsletter_consent SET state='confirmed',operation_at=0 WHERE token_hash=? AND state='confirming' AND revision=?")
          .bind(hash, claim.revision).run();
        if (saved.meta.changes !== 1) throw new HttpError(409, "newsletter_revision_conflict");
        return json({ subscribed: true });
      }
      if (url.pathname !== base) throw new HttpError(404, "not_found");
      const user = owner!;
      if (user.emailVerified !== true) throw new HttpError(403, "email_verification_required");
      if (request.method === "GET") return json({ subscribed: await provider.status(user.email.toLowerCase()) });
      if (request.method !== "DELETE") throw new HttpError(405, "method_not_allowed");
      sameOrigin(request);
      const email = user.email.toLowerCase(), now = Date.now();
      const claim = await db.prepare(`INSERT INTO dsh_newsletter_consent (email,token_hash,state,consent_at,expires_at,revision,operation_at) VALUES (?,?,'unsubscribing',?,?,1,?)
        ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,state='unsubscribing',expires_at=excluded.expires_at,revision=revision+1,operation_at=excluded.operation_at
        WHERE state NOT IN ('confirming','unsubscribing') RETURNING revision`)
        .bind(email, await digest(crypto.randomUUID()), now, now + 86400000, now).first<{revision: number}>();
      if (!claim) throw new HttpError(409, "confirmation_in_progress");
      await provider.set(email, false);
      const saved = await db.prepare("UPDATE dsh_newsletter_consent SET state='revoked',operation_at=0 WHERE email=? AND state='unsubscribing' AND revision=?")
        .bind(email, claim.revision).run();
      if (saved.meta.changes !== 1) throw new HttpError(409, "newsletter_revision_conflict");
      return json({ ok: true });
    } catch (error) { return failure(error); }
  };
}
export function apply(ctx: Context): void { ctx.effect(() => ctx.http.use(createNewsletterHandler(ctx.auth, ctx.email), 28), "dsh-base: confirmed subscriptions"); }
