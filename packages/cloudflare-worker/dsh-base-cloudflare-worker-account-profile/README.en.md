# Product account profile

This Worker plugin manages the authenticated local Better Auth account. Official DeepSeek Platform account controls remain separate. No additional schema or credentials are required beyond `AUTH_DB` and the existing auth service.

- `GET /api/saas/account-profile` returns only the current account's name, username, email, verification flag and image, plus `canChangePassword` and an owned `avatarFileId` when available.
- `PUT` accepts same-origin JSON `{name,avatarFileId?}`. Names are limited to 80 characters. Omitted avatar keeps the current image; `null` clears it. A selected avatar must still be a ready PNG/JPEG/WebP belonging to this user when the update commits.
- `POST /api/saas/account-profile/password` accepts `{currentPassword,newPassword}` and delegates to the same Better Auth policy/rate-limited handler with `revokeOtherSessions:true`. All newly rotated session cookies are forwarded, while the session token is omitted from the response body.

Username/email changes and arbitrary remote avatar URLs are not accepted. File deletion atomically removes the matching avatar reference; concurrent avatar updates fail safely. Responses are private and uncached. Tests in `tests/profile.test.ts` cover rotated cookies and avatar deletion races; root SaaS runtime tests exercise real D1 behavior.

New signup rejects a client `image` field and native Better Auth `update-user` is closed. Custom avatars must use the owner's R2 files. Existing avatars and images returned by the official Google provider are not migrated. Name-only updates preserve those values; explicit clearing/replacement follows the rules above.
