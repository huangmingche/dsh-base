export type Channel = 'discord' | 'feishu';
export type DeliveryState = 'pending' | 'sending' | 'accepted' | 'rejected' | 'uncertain';
export interface NotificationEnv {
  readonly AUTH_DB?: D1Database;
  readonly AUTH_BASE_URL?: string;
  readonly SITE_ADMIN_USER_IDS?: unknown;
  readonly NOTIFICATIONS_ENABLED?: string;
  readonly DISCORD_WEBHOOK_URL?: string;
  readonly FEISHU_WEBHOOK_URL?: string;
}
export interface Destination { readonly channel: Channel; readonly url: string }
export class NotificationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function destination(channel: Channel, value: string): Destination | undefined {
  try {
    const url = new URL(value);
    if (value !== value.trim() || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search) return undefined;
    if (channel === 'discord' && (url.hostname !== 'discord.com' || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname))) return undefined;
    if (channel === 'feishu' && (url.hostname !== 'open.feishu.cn' || !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname))) return undefined;
    return {channel, url: url.href};
  } catch { return undefined; }
}
export function notificationConfig(env: NotificationEnv): {db: D1Database; destinations: Destination[]} | undefined {
  if (env.NOTIFICATIONS_ENABLED !== 'true' || !env.AUTH_DB) return undefined;
  const destinations: Destination[] = [];
  for (const [channel, value] of [['discord', env.DISCORD_WEBHOOK_URL], ['feishu', env.FEISHU_WEBHOOK_URL]] as const) {
    if (value === undefined || value === '') continue;
    const target = destination(channel, value);
    if (!target) return undefined;
    destinations.push(target);
  }
  return destinations.length ? {db: env.AUTH_DB, destinations} : undefined;
}
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
