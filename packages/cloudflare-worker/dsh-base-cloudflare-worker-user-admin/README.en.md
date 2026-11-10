# Product user administration

This Worker plugin composes Better Auth 1.7.18's official `admin` plugin. Management requires `USER_ADMIN_ENABLED=true` and a cookie-authenticated user ID in the deployment binding `SITE_ADMIN_USER_IDS`, a JSON array. Stored `role=admin` is a product label and grants no deployment-administrator authority. Ordinary signup and profile updates cannot set roles. Ban/session hooks remain mounted when management is disabled, so disabling management does not restore banned accounts.

| Route | Contract |
| --- | --- |
| `GET /api/user-admin/status` | `{enabled,canManage}`, with no user-list disclosure |
| `GET /api/user-admin/users` | Administrator pagination: `limit=1..100`, `offset=0..100000`, email `search` up to 128 characters; returns `{users,total,limit,offset}` |
| `POST /api/user-admin/actions` | Administrator and same origin: `{action,userId,role?,reason?}`; actions `ban`, `unban`, `set-role`, `revoke-sessions`; roles `user/admin`; reason up to 500 characters |

Bodies are stream-limited to 4096 bytes and reject extra fields. Deployment administrators cannot be banned. Public Better Auth `/api/auth/admin/*` paths are denied; only trusted Worker wrappers with the extension scope can call mounted endpoints. Deletion, impersonation, administrator password changes and user creation are not mounted. File/private-history deletion integration is not defined.

`schema.sql` adds the pinned Better Auth role/ban/session columns. Provisioning checks existing columns before applying it; do not repeatedly execute raw ALTER statements against a migrated database. See [Better Auth admin documentation](https://better-auth.com/docs/plugins/admin). Pinned DSH `deepseek-account` and `api-account-controller` expose the current Platform account, with no product administration implementation to mount or fork. This adapter is independently authored and copies no commercial template or DSH source.

Run API-key's `tests/runtime.test.mjs` for actual local workerd, Better Auth and temporary D1 coverage of allowlist authority, role escalation denial, native-path bypass, ban/unban, persistent ban enforcement when management is off, and session revocation. No remote writes occur.
