# Server SDK dependency environment

Build, type resolution and tests only: this package contributes no runtime feature or composition row. This package and `apps/web` are the two members of the repository-root workspace and share its `pnpm-lock.yaml`. Run `pnpm install --frozen-lockfile` at the repository root; the application has no nested workspace or lockfile. Both members stay inside the repository root so Cloudflare config discovery always has an ancestor boundary.

The browser uses the pinned official DSH baseline, React / ReactDOM 18.3.1 and React 18 types. Cloudflare Think / Agents declare optional React 19 peers, so those SDKs resolve in this separate package. Its React 19 installation never enters the browser; the SDK React entrypoints are unused. Peer checks are strict, without fabricated compatibility ranges or ignored errors.

`./resolution` exposes only SDK directories and a resolver for builds and Node tests. Existing Worker / Think plugins continue to provide application capabilities. SDK or upstream-pin upgrades must recheck peers, actual composer input, separate type projects and production builds.
