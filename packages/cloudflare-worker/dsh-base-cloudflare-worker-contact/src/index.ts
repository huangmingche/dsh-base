import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { EmailService } from "@dsh-base/cloudflare-worker-email";
import { isEmailAddress } from "../../dsh-base-cloudflare-worker-email/src/config.ts";
import { budget, publicFormReady, turnstileSiteKey, verifyPublicForm, type PublicFormEnv } from "../../dsh-base-cloudflare-worker-http/src/public-form.ts";
import { digest, failure, HttpError, json, objectBody, onlyFields } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
export const name = "@dsh-base/cloudflare-worker-contact";
export const inject = ["http", "email"];
export const Config = undefined;
interface Env extends PublicFormEnv { CONTACT_ENABLED?: string; CONTACT_SUPPORT_EMAIL?: string }
export function createContactHandler(email: EmailService, send: typeof fetch = fetch): WorkerHandler {
  return async (request, input) => {
    const url = new URL(request.url), env = (input ?? {}) as Env;
    if (!["/api/saas/contact", "/api/saas/contact/status"].includes(url.pathname)) return undefined;
    try {
      const enabled = env.CONTACT_ENABLED === "true", ready = enabled && publicFormReady(env) && email.ready(env) && isEmailAddress(env.CONTACT_SUPPORT_EMAIL);
      if (url.pathname.endsWith("/status") && request.method === "GET") return json({ enabled, ready, turnstileSiteKey: ready ? turnstileSiteKey(env) : null });
      if (url.pathname !== "/api/saas/contact" || request.method !== "POST") throw new HttpError(405, "method_not_allowed");
      if (!ready) throw new HttpError(503, "contact_unavailable");
      const body = await objectBody(request); onlyFields(body, ["name", "email", "message", "turnstileToken", "locale"]);
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80 || /[\x00-\x1f\x7f]/u.test(body.name)
        || !isEmailAddress(body.email) || typeof body.message !== "string" || body.message.trim().length < 10 || body.message.length > 4000 || /[\x00\x0b\x0c\x7f]/u.test(body.message)
        || (body.locale !== undefined && (typeof body.locale !== "string" || body.locale.length > 64))) throw new HttpError(400, "invalid_contact");
      await verifyPublicForm(request, env, "contact", body.turnstileToken, send);
      await budget(env.AUTH_DB!.withSession("first-primary"), `contact:email:${body.email.toLowerCase()}`, 3, 3600000);
      const idempotencyKey = await digest(JSON.stringify([body.email.toLowerCase(), body.name.trim(), body.message.trim(), Math.floor(Date.now() / 600000)]));
      await email.sendNotice(env, { kind: "contact-message", name: body.name.trim(), email: body.email, message: body.message.trim(),
        locale: typeof body.locale === "string" ? body.locale : undefined, idempotencyKey });
      return json({ accepted: true }, 202);
    } catch (error) { return failure(error); }
  };
}
export function apply(ctx: Context): void { ctx.effect(() => ctx.http.use(createContactHandler(ctx.email), 29), "dsh-base: contact support"); }
