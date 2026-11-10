# Private file library

An authenticated product-account R2 library, separate from official Session attachment uploads and workspace files. Enable `FILES_ENABLED=true`, bind `FILES` to R2 and apply `schema.sql` to `AUTH_DB` before use. Configuration readiness does not probe storage or schema.

`GET /api/saas/files/status` exposes `{enabled,ready,maxBytes}`. Authenticated `GET /api/saas/files?cursor=&limit=50` lists only the owner's ready files using an opaque UUID cursor (maximum 100 per page). `POST /api/saas/files?name=example.txt` accepts the raw file body from the same origin. Each file is limited to 10 MiB, with atomic D1 reservations enforcing 200 files and 100 MiB per account, including pending/deleting claims.

`GET`/`HEAD /api/saas/files/{id}` return an owner-only attachment; `/view` supports only PNG/JPEG/WebP with basic format signature validation. Downloads use no-store, nosniff, restrictive CSP and same-origin resource policy. SVG/HTML are not inline formats. This is not malware scanning or full image decoding.

Same-origin `DELETE /api/saas/files/{id}` marks a tombstone, clears matching profile avatars in the same D1 batch, deletes R2, then removes metadata. Failure leaves retryable deleting state; pending uploads cannot be deleted while active. Upload finalization requires the reservation still to exist, otherwise cleanup runs instead of reporting success. A process crash can leave pending reservations or R2 objects; operators must reconcile storage before removing those claims. There is no public sharing or background cleanup process.

`tests/files.test.ts` covers metadata loss during upload; root SaaS runtime tests cover ownership, quota concurrency, download headers and R2 deletion. No production storage was accessed.
