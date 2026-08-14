# dsh-base

Cloudflare Workers surface for DeepSeek Harness Base (upstream `dsh-0.1.0-rc.6`).

On top of the rc.5 static/auth surface this version adds the **Durable Object session host** (`SessionHostObject`, one DO per session, DO SQLite persistence), the `/api/session-host` method surface (create/append/list/state/page), and a marked fork of the rc.6 session-persistence backend (`dshBase.forkOf: @deepseek-ai/dsh-session-persistence-sqlite`) that only replaces the `node:sqlite` boundary.

**Model**: with `DEEPSEEK_API_KEY` set, `prompt` performs one real call against the official DeepSeek HTTP API and stores the turn events; without a key it returns an explicit 501 `model_not_configured`, and a provider failure returns 502 with an error turn recorded — no fabricated answer. No tool loop in this version.

**Boundaries**: the official client shell (`client-runtime`/`layout`/`conversation`) is still not mounted; real-key output must be verified on a deployment with a key.

## Run

```bash
pnpm install
pnpm check      # build + strict tsc + 18 tests (surface 9 / persistence 5 / DO 3 / worker forward 1)
```

Auth environment: `AUTH_USERNAME`, `AUTH_PASSWORD_SHA256`, `AUTH_SECRET`.
