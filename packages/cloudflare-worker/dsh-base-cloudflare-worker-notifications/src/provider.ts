import type { Destination, DeliveryState } from './config.ts';
export interface PaymentNotice { readonly eventType: string; readonly orderId: string; readonly planId: string; readonly status: string; readonly refunded: boolean }
export type NotificationTransport = (target: Destination, notice: PaymentNotice) => Promise<Extract<DeliveryState, 'accepted' | 'rejected' | 'uncertain'>>;
/** Fixed provider contracts, no arbitrary URL, mention injection, user email or amount. */
export function createNotificationTransport(fetcher: typeof fetch = fetch): NotificationTransport {
  return async (target, notice) => {
    const text = `Payment update\nEvent: ${notice.eventType}\nOrder: ${notice.orderId}\nPlan: ${notice.planId}\nStatus: ${notice.status}\nRefunded: ${notice.refunded ? 'yes' : 'no'}`;
    const body = target.channel === 'discord' ? {content: text, allowed_mentions: {parse: []}} : {msg_type: 'text', content: {text}};
    const url = new URL(target.url);
    if (target.channel === 'discord') url.searchParams.set('wait', 'true');
    try {
      const response = await fetcher(url.href, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10_000)});
      // HTTP 408/5xx can occur after a provider accepted the message.
      if (!response.ok) return response.status >= 400 && response.status < 500 && response.status !== 408 ? 'rejected' : 'uncertain';
      const reader = response.body?.getReader();
      if (!reader) return 'uncertain';
      let bytes = 0; const parts: Uint8Array[] = [];
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
          if (bytes > 16_384) { await reader.cancel(); return 'uncertain'; } parts.push(chunk.value); }
      } finally { reader.releaseLock(); }
      const buffer = new Uint8Array(bytes); let offset = 0;
      for (const part of parts) { buffer.set(part, offset); offset += part.length; }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(buffer));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'uncertain';
      const data = value as Record<string, unknown>;
      if (target.channel === 'discord') return typeof data.id === 'string' && /^\d+$/.test(data.id) ? 'accepted' : 'uncertain';
      const code = data.code ?? data.StatusCode;
      return typeof code === 'number' ? code === 0 ? 'accepted' : 'rejected' : 'uncertain';
    } catch { return 'uncertain'; }
  };
}
