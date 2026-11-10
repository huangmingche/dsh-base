import type { Context } from "@deepseek-ai/cordis";
import type { WorkerHandler } from "@dsh-base/cloudflare-worker-http";
import type { AuthFace } from "@dsh-base/cloudflare-worker-auth";
import { bytes, failure, HttpError, json, sameOrigin } from "../../dsh-base-cloudflare-worker-http/src/request.ts";

export const name = "@dsh-base/cloudflare-worker-files";
export const inject = ["http", "auth"];
export const Config = undefined;
export const MAX_BYTES = 10 * 1024 * 1024;
interface Env { AUTH_DB?: D1Database; FILES?: R2Bucket; FILES_ENABLED?: string }
interface Row { id: string; name: string; content_type: string; size: number; object_key: string; state: string; created_at: number }
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
const mimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/csv", "application/json", "application/octet-stream"]);
export function validatedMime(type: string | null, data: Uint8Array): string {
  const mime = type?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
  if (!mimeTypes.has(mime)) throw new HttpError(415, "unsupported_file_type");
  const ascii = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
  if (mime === "image/png" && !(data.length >= 24 && data.slice(0, 8).every((b, i) => b === [137,80,78,71,13,10,26,10][i]))) throw new HttpError(415, "invalid_image");
  if (mime === "image/jpeg" && !(data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255)) throw new HttpError(415, "invalid_image");
  if (mime === "image/webp" && !(data.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")) throw new HttpError(415, "invalid_image");
  return mime;
}
const project = (row: Row) => ({ id: row.id, name: row.name, contentType: row.content_type, size: row.size, createdAt: row.created_at, url: `/api/saas/files/${row.id}` });
export function createFilesHandler(auth: Pick<AuthFace, "session">): WorkerHandler {
  return async (request, input) => {
    const url = new URL(request.url), base = "/api/saas/files";
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return undefined;
    const env = (input ?? {}) as Env, enabled = env.FILES_ENABLED === "true", ready = enabled && !!env.FILES && !!env.AUTH_DB;
    try {
      if (url.pathname === `${base}/status` && request.method === "GET") return json({ enabled, ready, maxBytes: MAX_BYTES });
      const user = await auth.session(request, env); if (!user) throw new HttpError(401, "unauthenticated");
      if (!ready) throw new HttpError(503, "files_unavailable");
      const db = env.AUTH_DB!.withSession("first-primary"), bucket = env.FILES!;
      if (url.pathname === base) {
        if (request.method === "GET") {
          const cursor = url.searchParams.get("cursor") ?? "", rawLimit = url.searchParams.get("limit") ?? "50";
          const limit = Number(rawLimit);
          if ((cursor && !uuid.test(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "invalid_pagination");
          const found = await db.prepare("SELECT * FROM dsh_user_files WHERE user_id = ? AND state = 'ready' AND id > ? ORDER BY id LIMIT ?").bind(user.id, cursor, limit + 1).all<Row>();
          const items = found.results.slice(0, limit);
          return json({ items: items.map(project), nextCursor: found.results.length > limit ? items.at(-1)!.id : null });
        }
        if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
        sameOrigin(request);
        const filename = url.searchParams.get("name")?.normalize("NFC").trim();
        if (!filename || filename.length > 180 || /[\x00-\x1f\x7f/\\]/u.test(filename)) throw new HttpError(400, "invalid_filename");
        const data = await bytes(request, MAX_BYTES);
        if (data.byteLength === 0) throw new HttpError(400, "empty_file");
        const mime = validatedMime(request.headers.get("content-type"), data);
        const id = crypto.randomUUID(), key = `saas-files/${encodeURIComponent(user.id)}/${id}`, now = Date.now();
        // Single primary SQL statement reserves quota across concurrent isolates.
        const claim = await db.prepare(`INSERT INTO dsh_user_files (id,user_id,name,content_type,size,object_key,state,created_at)
          SELECT ?,?,?,?,?,?,'pending',? WHERE (SELECT COUNT(*) FROM dsh_user_files WHERE user_id = ?) < 200
          AND (SELECT COALESCE(SUM(size),0) FROM dsh_user_files WHERE user_id = ?) + ? <= 104857600 RETURNING id`)
          .bind(id, user.id, filename, mime, data.byteLength, key, now, user.id, user.id, data.byteLength).first();
        if (!claim) throw new HttpError(409, "file_quota_exceeded");
        try {
          await bucket.put(key, data, { httpMetadata: { contentType: mime }, customMetadata: { owner: user.id } });
          const saved = await db.prepare("UPDATE dsh_user_files SET state = 'ready' WHERE id = ? AND user_id = ? AND state = 'pending'").bind(id, user.id).run();
          if (saved.meta.changes !== 1) throw new HttpError(409, "file_changed");
        } catch (error) {
          // Remove object first; retaining a reservation is safer than an untracked object.
          await bucket.delete(key).then(() => db.prepare("DELETE FROM dsh_user_files WHERE id = ? AND user_id = ?").bind(id, user.id).run()).catch(() => undefined);
          throw error;
        }
        return json({ file: project({ id, name: filename, content_type: mime, size: data.byteLength, object_key: key, created_at: now, state: "ready" }) }, 201);
      }
      const match = /^\/api\/saas\/files\/([^/]+)(\/view)?$/u.exec(url.pathname);
      if (!match || !uuid.test(match[1]!)) throw new HttpError(404, "file_not_found");
      const row = await db.prepare("SELECT * FROM dsh_user_files WHERE id = ? AND user_id = ?").bind(match[1], user.id).first<Row>();
      if (!row) throw new HttpError(404, "file_not_found");
      if (request.method === "DELETE" && !match[2]) {
        sameOrigin(request);
        if (row.state === "pending") throw new HttpError(409, "file_busy");
        await db.batch([
          db.prepare("UPDATE dsh_user_files SET state = 'deleting' WHERE id = ? AND user_id = ?").bind(row.id, user.id),
          db.prepare('UPDATE "user" SET image = NULL, updatedAt = ? WHERE id = ? AND image = ?')
            .bind(Date.now(), user.id, `/api/saas/files/${row.id}/view`),
        ]);
        await bucket.delete(row.object_key);
        await db.prepare("DELETE FROM dsh_user_files WHERE id = ? AND user_id = ? AND state = 'deleting'").bind(row.id, user.id).run();
        return json({ ok: true });
      }
      if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "method_not_allowed");
      if (row.state !== "ready") throw new HttpError(404, "file_not_found");
      const inline = !!match[2];
      if (inline && !["image/png", "image/jpeg", "image/webp"].includes(row.content_type)) throw new HttpError(415, "not_an_image");
      const object = await bucket.get(row.object_key); if (!object) throw new HttpError(404, "file_not_found");
      return new Response(request.method === "HEAD" ? null : object.body, { headers: {
        "content-type": row.content_type, "content-length": String(object.size), "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox", "cross-origin-resource-policy": "same-origin",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()]/gu, c => `%${c.charCodeAt(0).toString(16)}`)}`,
      } });
    } catch (error) { return failure(error); }
  };
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.http.use(createFilesHandler(ctx.auth), 25), "dsh-base: private R2 file center");
}
