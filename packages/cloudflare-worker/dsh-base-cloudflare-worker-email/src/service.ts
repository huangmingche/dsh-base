import { renderNotice } from "./notices.ts";
import { emailConfig, validateIntent } from "./config.ts";
import { renderEmail } from "./templates.ts";
import { sendProvider, type EmailFetch, type ProviderOutcome } from "./providers.ts";
import { EmailError, type EmailConfig, type EmailMessage, type EmailEnv, type EmailResult, type EmailService, type TransactionalEmail } from "./types.ts";

const digest = async (value: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
interface DeliveryRow { payload_hash: string; provider: string; state: string }

/** D1 is the concurrency boundary across isolates; an in-memory dedupe is insufficient. */
export function createEmailService(send: EmailFetch = (input, init) => fetch(input, init)): EmailService {
  async function deliver(config: EmailConfig, kind: string, idempotencyKey: string, message: EmailMessage): Promise<EmailResult> {
      const key = await digest(JSON.stringify(["dsh-email-v1", kind, idempotencyKey]));
      const payload = await digest(JSON.stringify([config.provider, config.origin, message]));
      try {
        const db = config.database.withSession("first-primary");
        const now = Date.now();
        const claimed = await db.prepare(`INSERT INTO dsh_email_deliveries
          (delivery_key, payload_hash, provider, state, created_at, updated_at)
          VALUES (?, ?, ?, 'sending', ?, ?) ON CONFLICT(delivery_key) DO NOTHING RETURNING delivery_key`)
          .bind(key, payload, config.provider, now, now).first<{ delivery_key: string }>();
        if (claimed === null) {
          const prior = await db.prepare("SELECT payload_hash, provider, state FROM dsh_email_deliveries WHERE delivery_key = ?")
            .bind(key).first<DeliveryRow>();
          if (prior === null) throw new EmailError("email_unavailable");
          if (prior.payload_hash !== payload || prior.provider !== config.provider) throw new EmailError("email_idempotency_conflict");
          if (prior.state === "accepted") return { status: "duplicate", provider: config.provider };
          throw new EmailError(prior.state === "rejected" ? "email_send_failed" : "email_delivery_uncertain");
        }
        const outcome: ProviderOutcome = await sendProvider(config, message, key, send);
        const saved = await db.prepare("UPDATE dsh_email_deliveries SET state = ?, updated_at = ? WHERE delivery_key = ? AND state = 'sending'")
          .bind(outcome, Date.now(), key).run();
        if (saved.meta.changes !== 1) throw new EmailError("email_delivery_uncertain");
        if (outcome !== "accepted") throw new EmailError(outcome === "rejected" ? "email_send_failed" : "email_delivery_uncertain");
        return { status: "accepted", provider: config.provider };
      } catch (error) {
        if (error instanceof EmailError) throw error;
        // The original error may contain SQL, a recipient or an auth token.
        throw new EmailError("email_unavailable");
      }
  }
  return {
    status(env) {
      const typed = (env ?? {}) as EmailEnv;
      return { enabled: typed.EMAIL_ENABLED === "true", ready: emailConfig(env) !== undefined,
        provider: typed.EMAIL_PROVIDER === "cloudflare" || typed.EMAIL_PROVIDER === "resend" ? typed.EMAIL_PROVIDER : null };
    },
    ready: env => emailConfig(env) !== undefined,
    async sendNotice(env, input) {
      const config = emailConfig(env);
      if (!config) throw new EmailError("email_unavailable");
      const message = renderNotice((env ?? {}) as EmailEnv, config, input);
      return deliver(config, input.kind, input.idempotencyKey, message);
    },
    async sendTransactional(env: unknown, input: TransactionalEmail): Promise<EmailResult> {
      const config = emailConfig(env);
      if (config === undefined) throw new EmailError("email_unavailable");
      const action = validateIntent(input, config);
      const message = { from: config.from, to: input.to, ...renderEmail(input.kind, action.href, input.locale) };
      return deliver(config, input.kind, input.idempotencyKey, message);
    },
  };
}
