# AGENTS.md

Product identity and scope: DeepSeek Harness Base (code name `dsh-base`) is a SaaS code template built on DeepSeek Harness, designed for users to build a wide range of commercial SaaS applications. Its product vision is:

> DeepSeek Harness Base is the complete boilerplate for building profitable SaaS, packed with AI, auth, payments, database, storage, email, newsletter, blog, dashboard, SEO and more, fully deployed on Cloudflare Workers.

- Runtime and deployment: use Cloudflare Workers and Cloudflare Think, supported by Workers-native Cloudflare services for persistence, storage and other infrastructure. The application must remain fully deployable on Cloudflare Workers. Never introduce Cloudflare Containers or equivalent container/VM-backed application runtimes, including as a fallback for upstream DSH capabilities.
- Cost is an architectural constraint: minimize recurring infrastructure and operating costs. Prefer usage-based, on-demand Workers-native services; avoid always-on compute and unnecessary infrastructure. Consider request, storage, background-task and AI inference costs when adding capabilities.
- SaaS capabilities follow the same official-reuse protocol and plugin composition rules below. The product vision defines the template's target scope; it does not assert that every listed capability has already shipped. Documentation and UI must distinguish implemented and verified features from planned or unavailable capabilities.

DeepSeek Harness Base (code name `dsh-base`) is the deployable application base for DSH-based products: the upstream DeepSeek Harness is vendored under `.submodules/deepseek-harness` at a pinned release, while our own apps and packages live in `apps/` and `packages/`. Upstream is a dependency: do not edit its checkout, and pin it to official release tags rather than master heads; product changes belong to our own apps and packages.

DeepSeek Harness Base follows upstream's Everything is a Plugin principle: all functionality of our own apps is delivered by composing and managing official DSH plugins and our own DSH plugins. Apps are entry points, not feature containers. New capabilities ship as plugins with their composition entries, never as code added to an app.

UI/UX parity (highest product rule): dsh-base must reproduce the official DeepSeek Harness Web UI and UX at 100% fidelity: layout, sidebars, right sidebar, conversation and trajectory views, composer, model/effort and permission controls, settings, panels, states, empty/error/loading states, localization, and interaction behavior. The official DSH UI, its plugins, and its slots are the source of truth; do not invent, simplify, hide, or substitute custom UI where official UI exists.

- When an official UI capability cannot be mounted or implemented in this Workers-native deployment, it must remain visible and be shown greyed out / disabled with a localized explanation. Never hide an unavailable official control, never remove its entry, and never fake its behavior.
- Seams and forks may adapt Host services and data only; they must preserve the official visual and interaction contract. A custom fallback is allowed only when the official implementation cannot be used and no official component can be forked, and it must be documented in `dshBase.reuse`/`dshBase.forkOf`.
- Every UI/UX deviation from the official DSH is a tracked gap. Record it in composition metadata or package reuse metadata, surface it as a disabled state when possible, and keep it visible for review. Explicit user approval is required to keep any intentional visual or behavioral deviation.
- Acceptance must compare the rendered UI and interaction surface against the official DSH, not only check that our own components render.

Official reuse protocol (highest priority): every capability starts here, before the plugin selection order below.

- Official DSH source exists only in `.submodules/deepseek-harness` at the pinned release, read directly from that initialized submodule. Never edit it, and never copy official code from another checkout, npm, or the web.
- Find the official package first. Prefer mounting the official plugin unchanged: add its package entry to the composition and provide the Host services it declares through a seam plugin.
- A seam is our own minimal adapter that provides services an official plugin declares through `inject` (or fills a slot/config contract). A seam is not official source, not a fork, and must contain no product behavior; mark and document it as a compatibility seam.
- Reuse only surfaces declared by the official package's `exports` map. Prefer stable entrypoints (`.`, `/client`, `/remote`, locale JSON); use `./src/*` only when the stable entries do not export the needed component or type, and record it for pin-upgrade review. Never import a file the package does not export.
- If an official plugin cannot be mounted and its exported components are insufficient, fork the official package at the pinned commit. Record `dshBase.forkOf` with the upstream package, source path, commit and license; adapt only the Host seam; never paste unmarked official fragments into a custom package.
- Implement our own plugin only when no official package exists and no official exported implementation can be forked. Record the official candidates considered and why mounting and forking both failed in `dshBase.reuse`.
- Every client/worker/agent package records its reuse decision in package metadata. Acceptance verifies `origin` and active fibers; `pnpm check:reuse` verifies official exports; re-audit forks and `./src/*` uses whenever the upstream pin changes.

Plugin selection priority (within the protocol above): first try to reuse the official DSH plugin directly; if it cannot be used as-is but its source can be forked, fork the official DSH plugin and adapt it; only when neither is possible, implement our own plugin. Never start with a custom implementation before exhausting the official plugin and its fork path.

Documentation is bilingual: `README.md` is Simplified Chinese and `README.en.md` is English; update both in the same change.

The upstream harness lives only in the `.submodules/deepseek-harness` reference submodule. `pnpm dsh:init` initializes it and `pnpm dsh:verify` checks its HEAD/tree and clean working tree against `dsh-source.lock.json`; the app resolves official packages directly from it, with no generated source overlay to copy or commit.

Our own capabilities are DSH plugins, not app code:
- `packages/client/*` are client plugin packages (`dsh.client` + `dshBase.client` metadata, `/client` entry, `Config` schema). The client roster is generated into the Vite virtual module `virtual:dsh-composition` from that metadata plus `apps/web/composition.profile.json`; never hand-write a roster into the app.
- `packages/cloudflare-worker/*` are Cloudflare Worker plugin packages named `@dsh-base/cloudflare-worker-*`; `scripts/composition/generate-worker-composition.mjs` generates the Worker roster from `dshBase.worker` metadata into a gitignored file, and the Worker entry only boots it and dispatches every request through it.
- `packages/boot/plugin-loader-static` is the shared literal-plugin loader (`entries` / `modules` / inventory) used by both halves.
- Agent capabilities are Cloudflare Think plugins under `packages/cloudflare-think/dsh-base-cloudflare-think-*` (`@dsh-base/cloudflare-think-*`); `scripts/composition/generate-agent-composition.mjs` generates their roster from `dshBase.agent` metadata into a gitignored file, and `apps/web/src/agent/index.ts` only boots it.
The app is an entry point plus composition rows; capability changes belong in a plugin package, never in the app entry.

The generated client roster includes every official package that declares `dsh.client`, with non-active official rows marked
`disabled: true`. Disabled roster rows are inventory, not evaluated code: they must not carry a bundled module resolver unless
the plugin is actually adapted and enabled. A fork records `dshBase.forkOf` and `dshBase.client.replaces`; the replaced
official original stays present and disabled.

Naming: Cloudflare-specific plugins carry the `cloudflare-` package prefix (`@dsh-base/cloudflare-worker-*`, `@dsh-base/cloudflare-think-*`) and `cloudflare:worker:*` / `cloudflare:think:*` composition ids. Client plugins stay platform-neutral (`@dsh-base/client-*`) and use `client:*` composition ids; `apps/web` is the generic web application entry reserved for product-specific web apps.

`pnpm check:boundaries` enforces the runtime-plane contract: client packages cannot import Worker/Think/Node/Workers modules, Worker and Think packages cannot import browser/React/client packages, and package composition-id prefixes must match their plane.
