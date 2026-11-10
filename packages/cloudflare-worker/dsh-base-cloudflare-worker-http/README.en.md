# Worker HTTP dispatch

`http.use(handler, priority = 100)` registers a request handler. Lower priorities
run first; equal priorities retain registration order. Returning `undefined`
continues dispatch, while a Response ends it. The returned disposer removes only
that registration. Cross-origin checks always run before every handler.

Request priority is independent of composition loading order and asynchronous
plugin activation: authentication uses 0, site configuration 10, SEO 20, ordinary
APIs default to 100, and the static asset fallback uses 1000. Assets may activate
first without bypassing authentication, replacing SEO documents, or treating
robots/sitemap as missing static assets. Each request uses a handler snapshot;
registrations and removals during dispatch affect the next request.

Regression: `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-http/tests/dispatch.test.ts`.

A handler’s `HttpError` retains its declared status and public error code, passes through response hooks, and stops dispatch. Authentication service unavailability returns 503 rather than being reported as signed out or falling through to assets. Unexpected exceptions retain existing runtime error handling.
