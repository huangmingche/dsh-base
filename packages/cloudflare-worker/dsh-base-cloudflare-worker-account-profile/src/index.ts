import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { AuthFace } from "@dsh-base/cloudflare-worker-auth";
import { failure, HttpError, json, objectBody, onlyFields, sameOrigin } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
export const name = "@dsh-base/cloudflare-worker-account-profile";
export const inject = ["http", "auth"];
export const Config = undefined;
interface Env { AUTH_DB?: D1Database }
export function createProfileHandler(auth: AuthFace): WorkerHandler {
  return async (request, input) => {
    const url = new URL(request.url), base = "/api/saas/account-profile";
    if (url.pathname !== base && url.pathname !== `${base}/password`) return undefined;
    try {
      const env = (input ?? {}) as Env;
      const user = await auth.session(request, env); if (!user) throw new HttpError(401, "unauthenticated");
      if (!env.AUTH_DB) throw new HttpError(503, "profile_unavailable");
      const db = env.AUTH_DB.withSession("first-primary");
      if (url.pathname === base && request.method === "GET") {
        const row = await db.prepare('SELECT id,name,username,email,emailVerified,image FROM "user" WHERE id = ?').bind(user.id).first<Record<string, unknown>>();
        if (!row) throw new HttpError(401, "unauthenticated");
        const credential = await db.prepare('SELECT id FROM account WHERE userId = ? AND providerId = ? AND password IS NOT NULL').bind(user.id, "credential").first();
        const avatarFileId = typeof row.image === "string" ? /^\/api\/saas\/files\/([^/]+)\/view$/u.exec(row.image)?.[1] ?? null : null;
        return json({ user: { ...row, emailVerified: !!row.emailVerified, image: row.image ?? null, avatarFileId }, canChangePassword: !!credential });
      }
      if ((url.pathname === base && request.method !== "PUT") || (url.pathname === `${base}/password` && request.method !== "POST")) throw new HttpError(405, "method_not_allowed");
      sameOrigin(request);
      const body = await objectBody(request);
      if (url.pathname === `${base}/password` && request.method === "POST") {
        onlyFields(body, ["currentPassword", "newPassword"]);
        if (typeof body.currentPassword !== "string" || body.currentPassword.length > 128 || typeof body.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 128) throw new HttpError(400, "invalid_password");
        const target = new URL("/api/auth/change-password", url);
        const headers = new Headers(request.headers); headers.delete("content-length");
        const response = await auth.handle(new Request(target, { method: "POST", headers,
          body: JSON.stringify({ ...body, revokeOtherSessions: true }) }), env);
        if (!response.ok) return response;
        // Better Auth rotates the current session when revoking other sessions.
        // Preserve every Set-Cookie value while keeping the token out of JSON.
        const result = json({ ok: true });
        for (const cookie of response.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
        return result;
      }
      if (url.pathname !== base || request.method !== "PUT") throw new HttpError(405, "method_not_allowed");
      onlyFields(body, ["name", "avatarFileId"]);
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || /[\x00-\x1f\x7f]/u.test(body.name)) throw new HttpError(400, "invalid_name");
      if (body.avatarFileId !== undefined && body.avatarFileId !== null && typeof body.avatarFileId !== "string") throw new HttpError(400, "invalid_avatar");
      let image: string | null = null;
      if (body.avatarFileId !== undefined && body.avatarFileId !== null) {
        const file = await db.prepare("SELECT id FROM dsh_user_files WHERE id = ? AND user_id = ? AND state = 'ready' AND content_type IN ('image/png','image/jpeg','image/webp')").bind(body.avatarFileId, user.id).first<{id: string}>();
        if (!file) throw new HttpError(400, "invalid_avatar");
        image = `/api/saas/files/${file.id}/view`;
      }
      if (body.avatarFileId === undefined) await db.prepare('UPDATE "user" SET name = ?, updatedAt = ? WHERE id = ?').bind(body.name.trim(), Date.now(), user.id).run();
      else if (body.avatarFileId === null) await db.prepare('UPDATE "user" SET name = ?, image = NULL, updatedAt = ? WHERE id = ?').bind(body.name.trim(), Date.now(), user.id).run();
      else {
        const saved = await db.prepare(`UPDATE "user" SET name = ?, image = ?, updatedAt = ? WHERE id = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM dsh_user_files WHERE id = ? AND user_id = ? AND state = 'ready'
            AND content_type IN ('image/png','image/jpeg','image/webp')))`)
          .bind(body.name.trim(), image, Date.now(), user.id, body.avatarFileId, body.avatarFileId, user.id).run();
        if (saved.meta.changes !== 1) throw new HttpError(409, "avatar_changed");
      }
      return json({ ok: true });
    } catch (error) { return failure(error); }
  };
}
export function apply(ctx: Context): void { ctx.effect(() => ctx.http.use(createProfileHandler(ctx.auth), 24), "dsh-base: product account profile"); }
