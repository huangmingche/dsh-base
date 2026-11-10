/** Explicit, memory-only consent. No cookie, storage identifier or automatic grant. */
import type { SiteAnalyticsConfig } from '@dsh-base/site-config';
export interface ConsentSnapshot { readonly consent: boolean; readonly campaign?: string }
export interface ConsentState extends ConsentSnapshot { readonly available: boolean }
let current: (() => ConsentSnapshot) | undefined;
/** Only a mounted plugin can expose a grant to account/payment request adapters. */
export const conversionConsentSnapshot = (): ConsentSnapshot => current?.() ?? { consent: false };
export const conversionConsentHeaders = (): Record<string, string> => {
  const snapshot = conversionConsentSnapshot();
  return snapshot.consent ? { 'x-dsh-analytics-consent': 'granted', ...(snapshot.campaign ? { 'x-dsh-analytics-campaign': snapshot.campaign } : {}) } : {};
};
export class ConversionConsent {
  private state: ConsentState = { consent: false, available: false };
  private listeners = new Set<() => void>();
  private config: SiteAnalyticsConfig | undefined;
  private readonly url: () => URL;
  constructor(url: () => URL) { this.url = url; }
  getSnapshot = (): ConsentState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: ConsentState) { this.state = next; for (const listener of this.listeners) listener(); }
  configure(config: SiteAnalyticsConfig | undefined) {
    this.config = config;
    const available = config?.conversions?.mode === 'google' && config.google?.ready === true;
    this.publish(available ? { ...this.state, available, ...(this.state.campaign && !config?.conversions?.campaigns?.includes(this.state.campaign) ? { campaign: undefined } : {}) } : { consent: false, available });
  }
  setConsent = (consent: boolean) => {
    if (!consent || !this.state.available) { this.publish({ consent: false, available: this.state.available }); return; }
    // Only an explicitly approved public campaign label can be retained. No full
    // URL, referrer, query string or account identifier enters the state.
    const candidates = this.url().searchParams.getAll('utm_campaign');
    const campaign = candidates.length === 1 && this.config?.conversions?.campaigns?.includes(candidates[0]!) ? candidates[0] : undefined;
    this.publish({ consent: true, available: true, ...(campaign ? { campaign } : {}) });
  };
  mount(): () => void {
    const read = () => { const { consent, campaign } = this.state; return { consent, ...(consent && campaign ? { campaign } : {}) }; };
    current = read;
    return () => { this.setConsent(false); if (current === read) current = undefined; this.listeners.clear(); };
  }
}
