# Google product-account sign-in

This Worker plugin configures the Better Auth 1.7.18 Google provider through `ctx.auth.registerExtension()`. It defaults off. Public auth policy reports `googleEnabled: true` only with `AUTH_GOOGLE_ENABLED=true` and valid `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `AUTH_BASE_URL`. Secrets stay in Worker bindings. Register `${AUTH_BASE_URL}/api/auth/callback/google` in Google Console.

The client starts an authorization-code flow at `/api/auth/sign-in/social`. Unchanged Better Auth owns state, PKCE, the fixed Google token endpoint, callbacks and D1 sessions. Automatic account linking is disabled; closed public registration also prevents new Google users from registering. Direct client ID-token submission is rejected. Unconfigured Google remains visibly disabled; Apple and phone remain unavailable. See [Better Auth Google documentation](https://better-auth.com/docs/authentication/google).

The reuse audit read the pinned DSH `deepseek-account` plugin and its `account` Remote. Their DeepSeek Platform account protocol cannot provide local Google product accounts through mounting or a Host-only fork. This independently authored configuration adapter copies no commercial template or DSH source; the commercial template was a behavioral reference only.

`tests/config.test.ts` covers defaults, configuration changes and extension collisions. Auth's `tests/email-google-runtime.test.mjs` uses actual workerd, Better Auth, temporary D1 and a local outboundService for state, PKCE, token exchange, 302 refusal, callback and session checks. Tests never contact Google. Real credentials, Google Console configuration and production callbacks remain deployment acceptance work.
