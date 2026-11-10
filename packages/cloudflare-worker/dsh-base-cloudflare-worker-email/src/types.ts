export type EmailProvider = "cloudflare" | "resend";
export type EmailKind = "verify-email" | "reset-password";

/** Credentials are Worker-only bindings, never plugin configuration or RPC data. */
export interface EmailEnv {
  readonly AUTH_DB?: D1Database;
  readonly AUTH_BASE_URL?: string;
  readonly EMAIL_ENABLED?: string;
  readonly EMAIL_PROVIDER?: string;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_CLOUDFLARE_ACCOUNT_ID?: string;
  readonly EMAIL_CLOUDFLARE_API_TOKEN?: string;
  readonly RESEND_API_KEY?: string;
  readonly CONTACT_SUPPORT_EMAIL?: string;
}

/** Only trusted authentication hooks construct this intent; never accept it from HTTP. */
export interface TransactionalEmail {
  readonly kind: EmailKind;
  readonly to: string;
  readonly actionUrl: string;
  readonly locale?: string;
  /** Stable token or logical operation ID, hashed before persistence or provider use. */
  readonly idempotencyKey: string;
}
export interface EmailResult { readonly status: "accepted" | "duplicate"; readonly provider: EmailProvider }
export type NoticeEmail = {
  readonly kind: "newsletter-confirm"; readonly to: string; readonly actionUrl: string; readonly locale?: string; readonly idempotencyKey: string;
} | {
  readonly kind: "contact-message"; readonly name: string; readonly email: string; readonly message: string; readonly locale?: string; readonly idempotencyKey: string;
};
export interface EmailStatus { readonly enabled: boolean; readonly ready: boolean; readonly provider: EmailProvider | null }
export interface EmailService {
  /** Safe projection for a caller-owned configuration/status route. */
  status(env: unknown): EmailStatus;
  /** Configuration readiness only; does not contact the provider or check schema. */
  ready(env: unknown): boolean;
  sendTransactional(env: unknown, input: TransactionalEmail): Promise<EmailResult>;
  /** Trusted plugin calls only; contact recipient is a deployment binding. */
  sendNotice(env: unknown, input: NoticeEmail): Promise<EmailResult>;
}
export interface EmailMessage { readonly to: string; readonly from: string; readonly subject: string; readonly html: string; readonly text: string }
export interface EmailConfig { readonly database: D1Database; readonly origin: string; readonly provider: EmailProvider; readonly from: string; readonly endpoint: string; readonly secret: string }

/** Safe error codes contain no recipients, links, provider bodies or credentials. */
export class EmailError extends Error {
  readonly code: "email_unavailable" | "email_invalid_intent" | "email_send_failed" | "email_delivery_uncertain" | "email_idempotency_conflict";
  constructor(code: EmailError["code"]) { super(code); this.name = "EmailError"; this.code = code; }
}
