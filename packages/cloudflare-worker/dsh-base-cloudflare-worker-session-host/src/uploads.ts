/** R2-backed immutable files with durable, session-scoped prompt receipts. */
import type { SqlStorage } from "./sqlite-storage.ts";
import type { R2BucketLike } from "./workspace-files.ts";
import { SessionRpcFault } from "./remote-contract.ts";

export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_GC_BATCH = 50;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const DISABLED_IMAGE_LIMITS = { maxImageBytes: 0, maxImagesPerMessage: 0, maxMessageImageBytes: 0, maxImagePixels: 0, maxImageDimension: 0, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] };
export interface FileRef { attachmentId: string; name: string; bytes: number }
export interface UploadRow { receipt_id: string; session_id: string; attachment_id: string; name: string; bytes: number; object_key: string; request_id: string | null; created_at: number }
export function uploadError(message: string, reason: string): SessionRpcFault { return new SessionRpcFault("session/attachment-invalid", message, { reason }); }
export function uploadName(value?: string): string {
  const leaf = (value ?? "file").split(/[\\/]/u).at(-1) ?? "file";
  const safe = leaf.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/[<>:"|?*]/gu, "_").trim().replace(/[. ]+$/u, "").slice(0, 180);
  return safe === "" || /^\.+$/u.test(safe) ? "file" : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(safe) ? `_${safe}` : safe;
}
export async function uploadBytes(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > MAX_UPLOAD_BYTES) throw uploadError("File exceeds this deployment's 8 MiB upload limit", "FILE_TOO_LARGE");
    parts.push(chunk);
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export function base64Bytes(data: string): Uint8Array {
  if (data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) throw uploadError("File exceeds this deployment's 8 MiB upload limit", "FILE_TOO_LARGE");
  try {
    if (data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) throw new Error();
    const decoded = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    if (btoa(atob(data)) !== data) throw new Error();
    return decoded;
  } catch { throw uploadError("File data must be canonical base64", "INVALID_BASE64"); }
}
export function encodeBytes(data: Uint8Array): string {
  let text = ""; for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
export class UploadStore {
  private readonly sql: SqlStorage;
  private readonly bucket: R2BucketLike | undefined;
  private readonly owner: string;
  constructor(sql: SqlStorage, bucket: R2BucketLike | undefined, owner: string) {
    this.sql = sql; this.bucket = bucket; this.owner = owner;
    sql.exec("CREATE TABLE IF NOT EXISTS dsh_session_host_upload_gc (object_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, attempted_at INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE INDEX IF NOT EXISTS dsh_session_host_upload_gc_age ON dsh_session_host_upload_gc (created_at, attempted_at)");
    sql.exec("CREATE TABLE IF NOT EXISTS dsh_session_host_uploads (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, attachment_id TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL, object_key TEXT NOT NULL, request_id TEXT, created_at INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS dsh_session_host_uploads_object ON dsh_session_host_uploads (object_key)");
    sql.exec("CREATE INDEX IF NOT EXISTS dsh_session_host_uploads_expiry ON dsh_session_host_uploads (request_id, created_at)");
  }
  resolve(sessionId: string, receiptId: string): UploadRow {
    const row = this.sql.exec("SELECT * FROM dsh_session_host_uploads WHERE receipt_id = ? AND session_id = ?", receiptId, sessionId).toArray().at(0) as unknown as UploadRow | undefined;
    if (!row || (row.request_id === null && row.created_at <= Date.now() - UPLOAD_TTL_MS)) throw uploadError("Upload receipt is unknown, expired, or belongs to another Session", "FILE_NOT_STAGED");
    return row;
  }
  admittedReference(sessionId: string, file: FileRef): { receiptId: string; file: FileRef } {
    const row = this.sql.exec("SELECT receipt_id FROM dsh_session_host_uploads WHERE session_id = ? AND attachment_id = ? AND name = ? AND bytes = ? AND request_id IS NOT NULL LIMIT 1", sessionId, file.attachmentId, file.name, file.bytes).toArray().at(0);
    if (!row) throw uploadError("File history reference is unavailable", "FILE_NOT_ADMITTED");
    return { receiptId: String(row.receipt_id), file };
  }
  async save(sessionId: string, bytes: Uint8Array, name?: string, signal?: AbortSignal): Promise<{ receiptId: string; file: FileRef }> {
    if (!this.bucket) throw uploadError("Attachment storage is unavailable", "STORAGE_UNAVAILABLE");
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw uploadError("File exceeds this deployment's 8 MiB upload limit", "FILE_TOO_LARGE");
    signal?.throwIfAborted();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
    const attachmentId = `sha256:${digest}`;
    const receiptId = crypto.randomUUID();
    // Keep the public content hash stable, while giving each staging attempt its
    // own immutable object. GC cannot race a concurrent re-upload of equal bytes.
    const objectKey = `owner/${this.owner}/attachments/${digest}/${receiptId}`;
    const createdAt = Date.now();
    this.sql.exec("INSERT INTO dsh_session_host_upload_gc (object_key, created_at, attempted_at) VALUES (?, ?, 0)", objectKey, createdAt);
    try {
      await this.bucket.put(objectKey, bytes);
      signal?.throwIfAborted();
      if (Date.now() - createdAt >= UPLOAD_TTL_MS) throw uploadError("Upload expired before completion", "FILE_NOT_STAGED");
      const session = this.sql.exec("SELECT archived FROM dsh_session_host_sessions WHERE session_id = ?", sessionId).toArray().at(0);
      if (!session || session.archived === 1) throw new SessionRpcFault("session/archived", "Session no longer accepts uploads", { sessionId });
      const file = { attachmentId, name: uploadName(name), bytes: bytes.byteLength };
      // The intent precedes R2 I/O, and no usable receipt precedes its completion.
      this.sql.exec("INSERT INTO dsh_session_host_uploads (receipt_id, session_id, attachment_id, name, bytes, object_key, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)", receiptId, sessionId, attachmentId, file.name, file.bytes, objectKey, createdAt);
      // A leftover intent is harmless: GC rechecks references before deletion.
      try { this.sql.exec("DELETE FROM dsh_session_host_upload_gc WHERE object_key = ?", objectKey); } catch { /* Retry through maintenance. */ }
      return { receiptId, file };
    } catch (error) {
      // This also covers R2 success followed by SQL failure/abort. If either
      // deletion or SQL is unavailable, the prewritten intent survives restart.
      await this.discardOrphan(objectKey).catch(() => undefined);
      throw error;
    }
  }

  private async discardOrphan(objectKey: string): Promise<boolean> {
    if (this.sql.exec("SELECT receipt_id FROM dsh_session_host_uploads WHERE object_key = ? LIMIT 1", objectKey).toArray().length) return false;
    if (!this.bucket) return false;
    await this.bucket.delete(objectKey);
    this.sql.exec("DELETE FROM dsh_session_host_upload_gc WHERE object_key = ?", objectKey);
    return true;
  }

  /** Expired receipts cannot be admitted; delete bytes before removing metadata. */
  async cleanup(options: { now?: number; olderThanMs?: number; limit?: number } = {}) {
    const now = options.now ?? Date.now();
    const age = Math.max(UPLOAD_TTL_MS, options.olderThanMs ?? UPLOAD_TTL_MS);
    const limit = Math.min(UPLOAD_GC_BATCH, Math.max(1, Math.floor(options.limit ?? UPLOAD_GC_BATCH)));
    const cutoff = now - age;
    const result = { examined: 0, deletedReceipts: 0, deletedObjects: 0, deletedIntents: 0, failed: 0, hasMore: false };
    if (!this.bucket) return result;
    const attempted = new Set<string>();
    const failed = (key: string, createdAt: number) => {
      result.failed += 1;
      this.sql.exec("INSERT INTO dsh_session_host_upload_gc (object_key, created_at, attempted_at) VALUES (?, ?, ?) ON CONFLICT(object_key) DO UPDATE SET attempted_at = excluded.attempted_at", key, createdAt, now);
    };
    const expired = this.sql.exec("SELECT u.* FROM dsh_session_host_uploads u LEFT JOIN dsh_session_host_upload_gc g ON g.object_key = u.object_key WHERE u.request_id IS NULL AND u.created_at <= ? ORDER BY COALESCE(g.attempted_at, 0), u.created_at, u.receipt_id LIMIT ?", cutoff, limit).toArray() as unknown as UploadRow[];
    for (const row of expired) {
      result.examined += 1;
      attempted.add(row.object_key);
      try {
        // Any other staged/admitted/fork receipt keeps the shared bytes alive.
        const referenced = this.sql.exec("SELECT receipt_id FROM dsh_session_host_uploads WHERE object_key = ? AND receipt_id <> ? LIMIT 1", row.object_key, row.receipt_id).toArray().length > 0;
        if (!referenced) { await this.bucket.delete(row.object_key); result.deletedObjects += 1; }
        this.sql.exec("DELETE FROM dsh_session_host_uploads WHERE receipt_id = ? AND request_id IS NULL AND created_at <= ?", row.receipt_id, cutoff);
        result.deletedReceipts += 1;
        this.sql.exec("DELETE FROM dsh_session_host_upload_gc WHERE object_key = ?", row.object_key);
      } catch { failed(row.object_key, row.created_at); }
    }
    const intents = this.sql.exec("SELECT object_key, created_at FROM dsh_session_host_upload_gc WHERE created_at <= ? ORDER BY attempted_at, created_at LIMIT ?", cutoff, limit).toArray();
    for (const row of intents) {
      if (result.examined >= limit) break;
      const key = String(row.object_key);
      if (attempted.has(key)) continue;
      result.examined += 1;
      try {
        if (this.sql.exec("SELECT receipt_id FROM dsh_session_host_uploads WHERE object_key = ? LIMIT 1", key).toArray().length) {
          this.sql.exec("DELETE FROM dsh_session_host_upload_gc WHERE object_key = ?", key);
        } else if (await this.discardOrphan(key)) result.deletedObjects += 1;
        result.deletedIntents += 1;
      } catch { failed(key, Number(row.created_at)); }
    }
    result.hasMore = this.sql.exec("SELECT 1 FROM dsh_session_host_uploads WHERE request_id IS NULL AND created_at <= ? LIMIT 1", cutoff).toArray().length > 0
      || this.sql.exec("SELECT 1 FROM dsh_session_host_upload_gc WHERE created_at <= ? LIMIT 1", cutoff).toArray().length > 0;
    return result;
  }
  async read(sessionId: string, receiptId: string, offset = 0, limit = 64 * 1024) {
    const row = this.resolve(sessionId, receiptId);
    if (row.request_id === null) throw uploadError("File is not admitted to a prompt", "FILE_NOT_ADMITTED");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024) throw uploadError("Invalid file read range", "INVALID_RANGE");
    const object = await this.bucket?.get(row.object_key);
    if (!object) throw uploadError("Attachment object is unavailable", "ATTACHMENT_READ_FAILED");
    const data = new Uint8Array(await object.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(value => value.toString(16).padStart(2, "0")).join("");
    if (data.byteLength !== row.bytes || `sha256:${digest}` !== row.attachment_id) throw uploadError("Attachment integrity check failed", "ATTACHMENT_READ_FAILED");
    const page = data.subarray(offset, offset + limit);
    let text: string | undefined;
    try { if (!page.includes(0)) text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(page); } catch { /* Binary remains available byte-for-byte. */ }
    return { attachment: { attachmentId: row.attachment_id, name: row.name, bytes: row.bytes }, offset, ...(offset + page.byteLength >= data.byteLength ? {} : { nextOffset: offset + page.byteLength }), encoding: text === undefined ? "base64" : "utf-8", content: text ?? encodeBytes(page) };
  }
}
