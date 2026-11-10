import type { Context } from "@deepseek-ai/cordis";
import type { AuthExtension } from "@dsh-base/cloudflare-worker-auth";
import { googleConfig } from "./config.ts";
export { googleConfig, type GoogleAuthEnv } from "./config.ts";
export const name = "@dsh-base/cloudflare-worker-google-auth";
export const Config = undefined;
export const inject = ["auth"];
export const googleAuthExtension: AuthExtension = {
  id: "google-auth",
  cacheKey: env => JSON.stringify(googleConfig(env) ?? null),
  options(env) { const google = googleConfig(env); return google ? { socialProviders: { google } } : {}; },
  policy: env => ({ googleEnabled: googleConfig(env) !== undefined }),
};
export function apply(ctx: Context): void { ctx.effect(() => ctx.auth.registerExtension(googleAuthExtension), "dsh-base: Google OAuth provider"); }
