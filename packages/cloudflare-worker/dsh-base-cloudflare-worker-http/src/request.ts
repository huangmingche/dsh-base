/** Bounded HTTP primitives shared by Worker plugins; no feature routing. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export const json = (value: unknown, status = 200): Response => Response.json(value, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
export function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "untrusted_origin");
  }
}
export async function bytes(request: Pick<Request, "headers" | "body">, maximum: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) throw new HttpError(413, "body_too_large");
  if (!request.body) throw new HttpError(400, "empty_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new HttpError(413, "body_too_large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function objectBody(request: Request, maximum = 16_384): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new HttpError(415, "unsupported_media_type");
  const raw = await bytes(request, maximum);
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "invalid_json"); }
}
export function onlyFields(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new HttpError(400, "invalid_request");
}
export const failure = (error: unknown): Response => json({ error: error instanceof HttpError ? error.code : "service_unavailable" }, error instanceof HttpError ? error.status : 503);
export const digest = async (value: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Bound external JSON as well as inbound requests; malformed providers fail closed. */
export async function responseObject(response: Response, maximum = 32_768): Promise<Record<string, unknown>> {
  const raw = await bytes(response, maximum);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_provider_response");
  return value as Record<string, unknown>;
}
