/** Worker-only transactional email service. It deliberately registers no HTTP handler. */
import type { Context } from "@deepseek-ai/cordis";
import { createEmailService } from "./service.ts";
import type { EmailService } from "./types.ts";

export { createEmailService } from "./service.ts";
export { EmailError, type EmailEnv, type EmailKind, type EmailProvider, type EmailResult, type EmailService, type EmailStatus, type TransactionalEmail } from "./types.ts";
export { emailLocale } from "./templates.ts";
export const name = "@dsh-base/cloudflare-worker-email";
export const inject: readonly string[] = [];
export const Config = undefined;
declare module "@deepseek-ai/cordis" { interface Context { email: EmailService } }
export function apply(ctx: Context): void { ctx.provide("email", createEmailService()); }
