# SaaS browser compatibility support

`@dsh-base/client-saas-ui` is a `browser-support` library with no composition entry. Each client plugin owns its API contracts, fields, product decisions and composition metadata. This library supplies only same-origin requests, lifetime management, registration in the official `plugins.bundle.config` seat and unchanged official Button/Input/Switch rendering. Fields and selects use pinned exported official styles recorded in package metadata.

Private reads first verify a real session. A 401/403 clears private state; leaving a page aborts requests and clears one-time secrets. A successfully created key remains visible if refreshing the list fails, avoiding false creation failures or duplicate creates. Server routes independently authorize operations. Turnstile loads only in configured, mounted public forms; expiry/errors clear its token, submission resets it, and unmount removes its widget. The library contains no secret configuration or standalone product entry.

Check: `node --experimental-strip-types --test packages/boot/dsh-base-saas-ui/tests/transport.test.ts`. Isolated browser verification is `tests/run-browser.mjs`, using local fixtures and request interception only. No real mail, payment, support chat or notification is sent.

Callers explicitly register their public bundle configuration with the compatibility service; plugin disposal removes registration without changing action authorization.
