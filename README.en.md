# dsh-base

Minimal Cloudflare Workers surface for DeepSeek Harness Base (upstream `dsh-0.1.0-rc.5`).

This version contains only the Workers trunk that rc.5 can support: a Worker entry, thin routes, static assets and a cookie session. rc.5 has no session-persistence package and no Workers-compatible `host/webserver`, so the session host, model wiring and the official client UI are deferred to the next version; the client entry only reflects the session state and signs out.

## Run

```bash
pnpm install
pnpm check      # builds client + Worker, strict types, 9 smoke tests
```

Auth comes from the deployment environment: `AUTH_USERNAME`, `AUTH_PASSWORD_SHA256`, `AUTH_SECRET`. When unset, the login page stays visible but disabled with the reason shown.
