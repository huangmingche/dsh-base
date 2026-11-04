# apps/web

[简体中文](README.md) | English

The generic DSH Base Web entry deploys the official DSH Web UI on Cloudflare Workers. The app owns entry points, deployment configuration and composition; capabilities live in the repository's `packages/`.

## Composition and source

- `src/client/main.tsx` passes `virtual:dsh-composition` to the client boot seam, reusing the official BootPage, loader and mount flow. Package metadata and `composition.profile.json` generate the roster.
- The root `scripts/composition/generate-worker-composition.mjs` and `generate-agent-composition.mjs` generate Worker and Think rosters. Generated files are not committed.
- Official source is read only from the pinned `.submodules/deepseek-harness`. Disabled official plugins remain in inventory without executable module resolvers.
- `window.__DSH_BASE_PLUGINS__` joins actual Loader fiber states to declared origins and replacement relationships. Inventory membership does not imply activation.
- Official plugins are mounted unchanged wherever possible. Seams and forks record reviewed source exports and the upstream commit in package metadata.

## Host and storage

Better Auth uses `AUTH_DB` D1 with per-instance in-memory rate limiting. `AUTH_SECRET` is a deployment secret; `AUTH_BASE_URL` must match the public origin. Email verification, password reset and Google sign-in are not enabled.

Session Host uses a stable `owner:<userId>:default-v49` Durable Object identity for each user, storing the session directory, workspaces, settings and tasks. Think owns the execution ledger; request IDs, per-session serialization and recovery coordinate the two. Code updates must not bypass migrations by changing storage identity. Legacy migration validates and commits the snapshot, sidecar and completion marker atomically after successful restoration.

`FILES` R2 stores workspace file versions; `CREDENTIALS_KEY` encrypts per-user credentials. The Think AI Gateway plugin provides models. Unavailable capabilities, including the complete official session permission runtime, process/PTY and log uploads, retain visible official controls with localized disabled explanations.

English uses `/`; Chinese uses `/zh-CN`. The official locale runtime controls UI language, while URL and SEO plugins own addresses and public document metadata.

## Development and acceptance

The repository root owns one pnpm workspace containing this app and `packages/build/dsh-base-build-server-dependencies`. A single root `pnpm-lock.yaml` and one frozen install cover root tools and both members. Run from the repository root:

```sh
pnpm dsh:init
pnpm install --frozen-lockfile
pnpm dsh:verify
pnpm check
pnpm --dir apps/web build
pnpm acceptance:local
pnpm acceptance:parity
pnpm acceptance:browser-compat
```

- `build` must pass root checks before generating rosters and build output.
- `acceptance:local` runs built assets with isolated local D1/R2/Durable Objects and Chromium, checking authentication, actual plugin states and English/Chinese UI without deployed data or model calls. Evidence goes to the root `.artifacts/acceptance/local-ui/` directory.
- `acceptance:parity` compares rendered text, controls, layout, screenshots and interaction contracts with pinned official components. See the [comparison scope](tests/parity/README.en.md). Evidence goes to `dist/parity-evidence/`. Its controlled Host does not replace real Host acceptance.
- `acceptance:browser-compat` checks real PDF.js/Excel Workers, fonts/data resources, styles and failure states, plus English/Chinese registration-policy messages.
- `CHROME_PATH` selects Chromium. `DSH_LOCAL_COMPATIBILITY_DATE` overrides only the local simulator date; if bundled workerd is older than the deployment date, the override must be explicit and recorded in evidence. This machine used `2026-10-30`; deployment remains configured for `2026-11-06`.

```sh
DSH_LOCAL_COMPATIBILITY_DATE=2026-10-30 pnpm acceptance:local
```

See [completion status](../../docs/completion-status.md) and [runtime contracts](../../docs/runtime-parity.md) for current capabilities and remaining differences. Inventory coverage and scoped screenshot equality do not prove 100% product UI/UX or execution equivalence.

## Deployment

`cloudflare.config.ts` owns Worker, D1, R2, Durable Object, compatibility date and non-secret configuration. Cloudflare manages secrets outside the repository. Deployment requires Cloudflare API authorization, authentication and credential secrets, a configured model Gateway and the D1 migrations in `migrations/`.

```sh
cd apps/web
pnpm verify:release   # root checks, build, local browser and official component comparison
pnpm deploy           # rerun release gates, then cf deploy --prebuilt
```

The root commands `pnpm acceptance:host` and `pnpm acceptance:browser` separately verify deployed model calls and transport recovery. They target the configured real deployment; local acceptance without a model does not replace them.

### Template configuration and first deployment

Run `pnpm template:init --worker-name my-dsh-app --auth-base-url https://your-real-domain` at the root to generate ignored `deployment.local.json` and random local development secrets. `scripts/deployment-config.mjs` validates configuration and `DSH_*` environment overrides; environment values take precedence. Unknown fields, including secrets, are rejected. The template never inherits the maintainer’s cloud resources.

1. Create D1 and R2 resources in your Cloudflare account and configure their names and D1 id. Existing deployments must keep the Worker name, resource ids, and `default-v49` identity stable.
2. Set the real HTTPS `authBaseUrl`. For a platform provider, configure your own Gateway DeepSeek provider credentials, set `aiGatewayId`, and explicitly enable `platformAiEnabled`. Otherwise leave it disabled and use owner BYOK.
3. Prepare independent production secrets with Cloudflare secret management: `AUTH_SECRET` (at least 32 characters), `CREDENTIALS_KEY` (32 random bytes encoded as Base64), `AUTH_REGISTRATION_TOKEN`, and `PLUGIN_CONTROL_TOKEN` (at least 32 random characters each). Never place them in deployment configuration, the repository, or the client.
4. In `apps/web`, run `pnpm exec cf d1 migrations apply <your-D1-id> --dir migrations`, then the release gates. For first deployment, place production secrets in a permission-restricted, Git-ignored JSON file and run `pnpm exec cf deploy --prebuilt --secrets-file /absolute/path/production-secrets.json`. `--prebuilt` publishes the exact verified output; the preceding gates are required.
5. Subsequent `pnpm deploy` validates deployment configuration and reruns the gates. Manage added secrets through the Cloudflare CLI. Do not rotate `CREDENTIALS_KEY` to resolve a code deployment problem: existing BYOK data would become unreadable.

Public `GET /api/auth-policy` only reveals whether registration is enabled. When closed, administrators can provision a first/review account by adding `x-dsh-registration-token` to standard `POST /api/auth/sign-up/email`. This token belongs in operator scripts, never browser UI. Ordinary users cannot mutate global plugin composition; writes require both authentication and `PLUGIN_CONTROL_TOKEN`. Foreign-origin mutations and WebSocket upgrades are rejected. The historical shared acceptance account is disabled; its data is retained.

### Deployed acceptance

Remote scripts have no default server or shared account. Explicitly set `DSH_BASE_URL` and private credentials, or run `pnpm acceptance:provision` with the administrator token to create an isolated account. Credentials are stored in a restricted file under root `.artifacts/acceptance/`; only the path is printed.

```sh
# At the root; inject AUTH_REGISTRATION_TOKEN from local secret management.
DSH_BASE_URL=https://your-real-domain pnpm acceptance:provision
DSH_ACCEPTANCE_CONFIG=/absolute/path/from-provisioning.json DSH_EXPECTED_DEPLOYMENT_VERSION='<actual-deployment-UUID>' pnpm acceptance:all
DSH_ACCEPTANCE_CONFIG=/absolute/path/from-provisioning.json DSH_EXPECTED_DEPLOYMENT_VERSION='<actual-deployment-UUID>' pnpm acceptance:files
```

Replace the version placeholder with the UUID returned by this deployment command. Model acceptance first reads the Host's deployment version and lifecycle capability and submits model input only after an exact match, waiting at most 360 seconds for deferred Durable Object code updates. Omitting the version checks capability only; it cannot prove that this deployment has taken effect.

`acceptance:files` verifies official upload, atomic session receipt consumption and replay, cross-session rejection, file history and complete byte integrity. One real model call proves that the read tool can access content beyond the truncated preview.

Acceptance creates sessions, workspaces, and test files in the selected account; some flows call real models. Use a dedicated account. Normal runs do not register accounts automatically; in-script registration requires explicit `DSH_ACCEPTANCE_REGISTER=true` and the administrator token. Logs, screenshots, local configuration, secrets, and generated output stay out of Git.

Repository CI caches the single root lockfile, runs one root `pnpm install --frozen-lockfile` and workspace dependency audit, initializes the pinned submodule, and runs the same `verify:release` gates. It does not read deployment secrets, deploy, or call paid models. Deployed assets include `/third-party-notices.txt` retaining upstream and dependency licenses.
