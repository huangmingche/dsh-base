/** Public configuration readiness, never a claim that a message was delivered. */
export interface EmailStatus { readonly enabled: boolean; readonly ready: boolean; readonly provider: 'resend' | 'cloudflare' | null }
export interface EmailState { readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly email?: EmailStatus }
export function readEmailStatus(value: unknown): EmailStatus | undefined {
  const email = value !== null && typeof value === 'object' && 'email' in value ? value.email : undefined;
  if (email === null || typeof email !== 'object' || !('enabled' in email) || typeof email.enabled !== 'boolean' || !('ready' in email) || typeof email.ready !== 'boolean'
    || !('provider' in email) || ![null, 'resend', 'cloudflare'].includes(email.provider as string | null) || (email.ready && (!email.enabled || email.provider === null))) return;
  return { enabled: email.enabled, ready: email.ready, provider: email.provider as EmailStatus['provider'] };
}
export class EmailStatusStore {
  private state: EmailState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private disposed = false;
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch) { this.fetcher = fetcher; }
  getSnapshot = (): EmailState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: EmailState): void { if (!this.disposed) { this.state = state; for (const listener of this.listeners) listener(); } }
  ensure = (): void => { if (this.state.status === 'idle') void this.reload(); };
  reload = async (): Promise<void> => {
    if (this.disposed || this.state.status === 'loading') return;
    const controller = new AbortController(); this.controller = controller;
    this.publish({ status: 'loading' });
    try {
      const response = await this.fetcher('/api/auth-policy', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } });
      const email = response.ok ? readEmailStatus(await response.json()) : undefined;
      if (!email) throw new Error('Invalid email policy');
      if (!controller.signal.aborted) this.publish({ status: 'ready', email });
    } catch { if (!controller.signal.aborted) this.publish({ status: 'error' }); }
    finally { if (this.controller === controller) this.controller = undefined; }
  };
  dispose(): void { this.disposed = true; this.controller?.abort(); this.listeners.clear(); }
}
