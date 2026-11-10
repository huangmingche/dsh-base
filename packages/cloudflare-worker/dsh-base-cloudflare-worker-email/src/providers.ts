import type { EmailConfig, EmailMessage } from "./types.ts";

export type ProviderOutcome = "accepted" | "rejected" | "unknown";
export type EmailFetch = (input: string, init: RequestInit) => Promise<Response>;

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (response.body === null) throw new Error();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 32 * 1024) { await reader.cancel(); throw new Error(); }
      parts.push(part.value);
    }
    const value = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) { value.set(part, offset); offset += part.length; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}

/** One bounded request, fixed vendor origins, no redirects and no automatic retries. */
export async function sendProvider(config: EmailConfig, message: EmailMessage, key: string, send: EmailFetch): Promise<ProviderOutcome> {
  try {
    const response = await send(config.endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}`,
        ...(config.provider === "resend" ? { "idempotency-key": `dsh-email/${key}` } : {}) },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // A timeout/conflict/server failure may have occurred after acceptance.
      return response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status) ? "rejected" : "unknown";
    }
    const data = await boundedJson(response);
    if (config.provider === "resend") return typeof data.id === "string" && data.id.length > 0 && data.id.length <= 256 ? "accepted" : "unknown";
    if (data.success === false) return "rejected";
    if (data.success !== true || !data.result || typeof data.result !== "object") return "unknown";
    const result = data.result as Record<string, unknown>;
    const contains = (value: unknown): boolean => Array.isArray(value) && value.includes(message.to);
    if (contains(result.delivered) || contains(result.queued)) return "accepted";
    return contains(result.permanent_bounces) ? "rejected" : "unknown";
  } catch { return "unknown"; }
}
