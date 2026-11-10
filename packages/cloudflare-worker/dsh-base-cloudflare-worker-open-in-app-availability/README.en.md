# Native application availability

Provides the Host capability catalog consumed by the unchanged official open-in-app client. The pinned client constructs its own HTTP controller with no injectable catalog service. The official Host implementation requires Node filesystem and subprocess services unavailable on Workers. This adapter reuses the stable `@deepseek-ai/dsh-host-open-in-app/shared` route and response contract without copying or modifying official source.

`GET /open-in-app/apps` explicitly returns `{ "apps": [] }`; `HEAD` returns the same headers without a body. This truthfully reports the deployment's lack of desktop applications. It performs no device probing or account, session or workspace reads and never fabricates a successful launch. The client retains official controls and the existing disabled-state adapter. This plugin does not provide launch or icon routes.

The exact public route precedes navigation admission and static assets; other routes retain their existing authorization. Responses prohibit caching and indexing. Cross-origin requests, query parameters and non-read methods are rejected explicitly. There are no database, storage or background task costs, only the official controller's existing once-per-initialization request.

Run `node packages/cloudflare-worker/dsh-base-cloudflare-worker-open-in-app-availability/tests/routes.test.mjs` for method, boundary and real Cordis mount/disposal coverage. The client availability package also tests the original official controller against this adapter, including the empty catalog and single-request lifecycle.
