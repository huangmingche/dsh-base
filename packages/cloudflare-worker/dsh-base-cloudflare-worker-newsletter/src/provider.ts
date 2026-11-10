import { HttpError, responseObject } from "../../dsh-base-cloudflare-worker-http/src/request.ts";
/** Resend contact API, read from its current public reference, without an SDK bundle. */
export class NewsletterProvider {
  private readonly key: string;
  private readonly send: typeof fetch;
  constructor(key: string, send: typeof fetch = (input, init) => fetch(input, init)) { this.key = key; this.send = (input, init) => send(input, init); }
  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    try {
      const response = await this.send(`https://api.resend.com/contacts${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("redirect_rejected"); }
      return response;
    } catch { throw new HttpError(503, "newsletter_provider_unavailable"); }
  }
  async status(email: string): Promise<boolean> {
    const response = await this.request(`/${encodeURIComponent(email)}`);
    if (response.status === 404) { await response.body?.cancel(); return false; }
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, "newsletter_provider_unavailable"); }
    try {
      const data = await responseObject(response);
      if (typeof data.unsubscribed !== "boolean" || (data.email !== undefined && data.email !== email)) throw new Error();
      return !data.unsubscribed;
    } catch { throw new HttpError(503, "newsletter_provider_unavailable"); }
  }
  async set(email: string, subscribed: boolean): Promise<void> {
    // PATCH is idempotent and does not re-subscribe on arbitrary server errors.
    const response = await this.request(`/${encodeURIComponent(email)}`, "PATCH", { unsubscribed: !subscribed });
    await response.body?.cancel();
    if (response.ok || (!subscribed && response.status === 404)) return;
    if (subscribed && response.status === 404) {
      const created = await this.request("", "POST", { email, unsubscribed: false });
      await created.body?.cancel();
      if (created.ok) return;
    }
    throw new HttpError(503, "newsletter_provider_unavailable");
  }
}
