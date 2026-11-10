import {parsePlans,type PaymentPlan} from './catalog.ts';
export type {PaymentPlan} from './catalog.ts';
export interface PaymentEnv {
  readonly AUTH_DB?: D1Database;
  readonly AUTH_BASE_URL?: string;
  readonly WAFFO_ENABLED?: string;
  readonly WAFFO_ENVIRONMENT?: string;
  readonly WAFFO_MERCHANT_ID?: string;
  readonly WAFFO_PRIVATE_KEY?: string;
  readonly WAFFO_STORE_ID?: string;
  readonly WAFFO_PLANS_JSON?: string;
}
export interface PaymentConfig {
  readonly db: D1Database;
  readonly origin: string;
  readonly environment: 'test' | 'prod';
  readonly merchantId: string;
  readonly privateKey: string;
  readonly storeId: string;
  readonly scope: string;
  readonly plans: readonly PaymentPlan[];
}
export class PaymentError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function nonempty(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;
}
/** Misconfiguration never selects a test/prod environment or product implicitly. */
export function paymentConfig(env: PaymentEnv): PaymentConfig | undefined {
  if (env.WAFFO_ENABLED !== 'true') return undefined;
  try {
    if (!env.AUTH_DB || !env.AUTH_BASE_URL || !nonempty(env.WAFFO_MERCHANT_ID)
      || !/^MER_[0-9A-Za-z]{22}$/.test(env.WAFFO_MERCHANT_ID)
      || !nonempty(env.WAFFO_STORE_ID) || !/^STO_[0-9A-Za-z]{22}$/.test(env.WAFFO_STORE_ID) || !nonempty(env.WAFFO_PRIVATE_KEY?.trim(), 16000)
      || !['test', 'prod'].includes(env.WAFFO_ENVIRONMENT ?? '')) return undefined;
    const base = new URL(env.AUTH_BASE_URL);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/') return undefined;
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) return undefined;
    const plans=parsePlans(JSON.parse(env.WAFFO_PLANS_JSON??'null'));
    if(!plans?.length)return undefined;
    const environment = env.WAFFO_ENVIRONMENT as 'test' | 'prod';
    return { db: env.AUTH_DB, origin: base.origin, environment, merchantId: env.WAFFO_MERCHANT_ID,
      privateKey: env.WAFFO_PRIVATE_KEY!, storeId: env.WAFFO_STORE_ID,
      scope: `${environment}:${env.WAFFO_MERCHANT_ID}:${env.WAFFO_STORE_ID}`, plans };
  } catch { return undefined; }
}
/** Only a path on the configured application origin can be a checkout return. */
export function paymentReturnUrl(origin: string, value: unknown): string {
  if (value === undefined) return origin + '/';
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020\u007f]/u.test(value) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) throw new PaymentError(400, 'invalid_return_path');
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password) throw new PaymentError(400, 'invalid_return_path');
  return url.href;
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Bounded streaming read preserves the exact UTF-8 bytes used by RSA verification. */
export async function readBody(request: Request, maximum: number): Promise<string> {
  if (Number(request.headers.get('content-length')) > maximum) throw new PaymentError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError(400, 'invalid_body');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new PaymentError(413, 'body_too_large'); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError(400, 'invalid_body'); }
  finally { reader.releaseLock(); }
}
