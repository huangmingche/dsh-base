/** Same-origin billing transport. Provider callbacks remain the authority for entitlements. */
import {readCheckoutIntent,resumeKey,resumePath,type CheckoutIntent,type CheckoutIntentStorage} from './checkout-intent.ts';
export interface PaymentPlan { readonly id: string; readonly name?: string; readonly description?:string;readonly productId: string; readonly type: 'one_time' | 'subscription'; readonly currency: string;readonly price?:{amount:string;interval?:'day'|'week'|'month'|'year';intervalCount?:number};readonly features?:readonly {id:string;label:string}[] }
export interface PaymentCatalog { readonly provider: 'waffo'; readonly ready: boolean; readonly plans: readonly PaymentPlan[];readonly priceSource?:'deployment' }
export interface PaymentOrder { readonly id: string; readonly planId: string; readonly type: PaymentPlan['type']; readonly status: string; readonly periodEnd: string | null; readonly refunded: boolean; readonly entitled: boolean }
export interface PaymentAccount { readonly orders: readonly PaymentOrder[]; readonly portalAvailable: boolean }
export interface PaymentState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly auth: 'unknown' | 'guest' | 'signed-in';
  readonly catalog?: PaymentCatalog;
  readonly account?: PaymentAccount;
  readonly accountFailed?: boolean;
  readonly busy?: string;
  readonly actionFailed?: boolean;
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const planType = (value: unknown): value is PaymentPlan['type'] => value === 'one_time' || value === 'subscription';
export function readCatalog(value: unknown): PaymentCatalog | undefined {
  const raw = record(value);
  if (raw?.provider !== 'waffo' || typeof raw.ready !== 'boolean' || !Array.isArray(raw.plans) || raw.plans.length > 100) return;
  const plans: PaymentPlan[] = [];
  for (const value of raw.plans) {
    const row = record(value);
    if (!row || !text(row.id) || !text(row.productId) || !planType(row.type) || typeof row.currency !== 'string' || !/^[A-Z]{3}$/u.test(row.currency)
      || (row.name !== undefined && !text(row.name)) || (row.description!==undefined&&(typeof row.description!=='string'||row.description.length>500)) || plans.some(plan => plan.id === row.id)) return;
    const price=record(row.price);
    if(row.price!==undefined){if(!price||typeof price.amount!=='string'||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/u.test(price.amount))return;
      if(row.type==='one_time'&&(price.interval!==undefined||price.intervalCount!==undefined))return;
      if(row.type==='subscription'&&(!['day','week','month','year'].includes(String(price.interval))||!Number.isSafeInteger(price.intervalCount)||Number(price.intervalCount)<1||Number(price.intervalCount)>120))return;
      if((price.amount.split('.')[1]?.length??0)>(new Intl.NumberFormat('en',{style:'currency',currency:row.currency}).resolvedOptions().maximumFractionDigits??2))return;}
    let features:PaymentPlan['features'];
    if(row.features!==undefined){if(!Array.isArray(row.features)||row.features.length>100)return;const list: {id:string;label:string}[]=[];for(const item of row.features){const feature=record(item);if(!feature||!text(feature.id)||!text(feature.label)||list.some(value=>value.id===feature.id))return;list.push({id:feature.id,label:feature.label});}features=list;}
    plans.push({ id: row.id, productId: row.productId, type: row.type, currency: row.currency, ...(typeof row.name === 'string' ? { name: row.name } : {}),...(typeof row.description==='string'?{description:row.description}:{}),...(price?{price:price as unknown as NonNullable<PaymentPlan['price']>}:{}),...(features?{features}:{}) });
  }
  if(raw.priceSource!==undefined&&raw.priceSource!=='deployment')return;
  return { provider: 'waffo', ready: raw.ready, plans,...(raw.priceSource==='deployment'?{priceSource:'deployment'}:{}) };
}
export function readAccount(value: unknown): PaymentAccount | undefined {
  const raw = record(value);
  if (!raw || typeof raw.portalAvailable !== 'boolean' || !Array.isArray(raw.orders) || raw.orders.length > 100) return;
  const orders: PaymentOrder[] = [];
  for (const value of raw.orders) {
    const row = record(value);
    if (!row || !text(row.id) || !text(row.planId) || !planType(row.type) || !text(row.status) || typeof row.refunded !== 'boolean' || typeof row.entitled !== 'boolean'
      || (row.periodEnd !== null && (typeof row.periodEnd !== 'string' || !Number.isFinite(Date.parse(row.periodEnd)))) || orders.some(order => order.id === row.id)) return;
    orders.push({ id: row.id, planId: row.planId, type: row.type, status: row.status, periodEnd: row.periodEnd as string | null, refunded: row.refunded, entitled: row.entitled });
  }
  return { orders, portalAvailable: raw.portalAvailable };
}
/** Only a secure provider URL returned by a successful same-origin POST can navigate. */
export function paymentDestination(value: unknown): string | undefined {
  const raw = record(value);
  if (typeof raw?.url !== 'string') return;
  try {
    const url = new URL(raw.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'pancake.waffo.ai') return;
    return url.href;
  } catch { return; }
}
export class PaymentStore {
  private state: PaymentState = { status: 'idle', auth: 'unknown' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private disposed = false;
  private checkoutKeys = new Map<string, string>();
  private readonly fetcher: typeof fetch;
  private readonly signIn: (next?:string) => void;
  private readonly navigate: (url: string) => void;
  private readonly locale: () => string;
  private readonly options:PaymentStoreOptions;
  private userId?:string;
  constructor(fetcher: typeof fetch, signIn: (next?:string) => void, navigate: (url: string) => void, locale: () => string,options:PaymentStoreOptions={}) {
    this.fetcher = fetcher; this.signIn = signIn; this.navigate = navigate; this.locale = locale;
    this.options = options;
  }
  getSnapshot = (): PaymentState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: PaymentState): void { if (!this.disposed) { this.state = value; for (const listener of this.listeners) listener(); } }
  ensure = (): void => { if (this.state.status === 'idle') void this.reload(); };
  reload = async (): Promise<void> => {
    if (this.disposed || this.state.status === 'loading' || this.state.busy) return;
    const controller = new AbortController(); this.controller = controller;
    this.userId=undefined;
    // Never leave a previous account's private billing facts visible while checking its session again.
    this.publish({ status: 'loading', auth: 'unknown', catalog: this.state.catalog });
    const init: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } };
    const sessionRead = async (): Promise<PaymentState['auth']> => {
      try {
        const response = await this.fetcher('/api/auth/get-session', init);
        if (response.status === 401) return 'guest';
        if (!response.ok) return 'unknown';
        const body: unknown = await response.json();
        if (controller.signal.aborted) return 'unknown';
        if (body === null) return 'guest';
        const id=record(record(body)?.user)?.id;if(text(id)){this.userId=id;return 'signed-in';}return 'unknown';
      } catch { return 'unknown'; }
    };
    try {
      const [response, auth] = await Promise.all([this.fetcher('/api/payments', init), sessionRead()]);
      if (controller.signal.aborted) return;
      const catalog = response.ok ? readCatalog(await response.json()) : undefined;
      if (controller.signal.aborted) return;
      if (!catalog) throw new Error('Invalid payment catalog');
      let account: PaymentAccount | undefined, accountFailed = auth === 'unknown';
      if (auth === 'signed-in' && catalog.ready) {
        try {
          const response = await this.fetcher('/api/payments/account', init);
          if (response.status === 401) { if (!controller.signal.aborted) this.publish({ status: 'ready', auth: 'guest', catalog }); return; }
          account = response.ok ? readAccount(await response.json()) : undefined;
          accountFailed = !account;
        } catch { accountFailed = true; }
      }
      if (!controller.signal.aborted) this.publish({ status: 'ready', auth, catalog, account, accountFailed });
    } catch { if (!controller.signal.aborted) this.publish({ status: 'error', auth: 'unknown' }); }
    finally { if (this.controller === controller) this.controller = undefined; }
    if(!controller.signal.aborted)await this.resumeCheckout();
  };
  private async resumeCheckout():Promise<void>{
    const intent=this.options.intents?.read();const key=resumeKey(this.options.currentPath?.()??'/');
    if(!intent||!key||key!==intent.key||this.state.auth!=='signed-in'||this.state.status!=='ready')return;
    if(!readCheckoutIntent(intent)||intent.userId&&intent.userId!==this.userId||!this.state.catalog?.plans.some(plan=>plan.id===intent.planId)){
      this.options.intents?.clear();this.publish({...this.state,actionFailed:true});return;}
    await this.performCheckout(intent);
  }
  checkout = async (planId: string): Promise<void> => {
    if (!this.state.catalog?.ready || !this.state.catalog.plans.some(plan => plan.id === planId)) return;
    if(this.disposed||this.state.busy||this.state.status!=='ready'||this.state.auth==='unknown')return;
    const previous=this.options.intents?.read();
    const intent:CheckoutIntent=previous?.planId===planId&&(!previous.userId||previous.userId===this.userId)?previous:
      {planId,key:this.checkoutKeys.get(planId)??crypto.randomUUID(),returnPath:'/?payment=return',locale:this.locale(),createdAt:Date.now(),...(this.userId?{userId:this.userId}:{})};
    this.checkoutKeys.set(planId,intent.key);
    try {this.options.intents?.write(intent);}catch{this.publish({...this.state,actionFailed:true});return;}
    if(this.state.auth==='guest'){this.signIn(this.options.intents?resumePath(this.options.currentPath?.()??'/',intent.key):undefined);return;}
    await this.performCheckout(intent);
  };
  private async performCheckout(intent:CheckoutIntent):Promise<void>{
    if(!this.state.catalog?.ready)return;
    this.checkoutKeys.set(intent.planId,intent.key);
    if(this.userId)try{this.options.intents?.write({...intent,userId:this.userId});}catch{this.publish({...this.state,actionFailed:true});return;}
    const consent=this.options.consent?.();
    await this.mutate(intent.planId,'/api/payments/checkout',{planId:intent.planId,returnPath:intent.returnPath,locale:intent.locale,...(consent?{analyticsConsent:consent.consent,...(consent.campaign?{analyticsCampaign:consent.campaign}:{})}:{})});
  }
  portal = async (): Promise<void> => {
    if (!this.state.catalog?.ready || (this.state.auth === 'signed-in' && this.state.account?.portalAvailable !== true)) return;
    await this.mutate('portal', '/api/payments/portal', {});
  };
  private async mutate(key: string, path: string, body: Record<string, unknown>): Promise<void> {
    if (this.disposed || this.state.busy || this.state.status !== 'ready' || this.state.auth === 'unknown') return;
    if (this.state.auth === 'guest') { this.signIn(); return; }
    const controller = new AbortController(); this.controller = controller;
    this.publish({ ...this.state, busy: key, actionFailed: false });
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
      if (path.endsWith('/checkout')) {
        // A retry after a network failure uses the same provider idempotency key.
        const id = this.checkoutKeys.get(key) ?? crypto.randomUUID(); this.checkoutKeys.set(key, id); headers['Idempotency-Key'] = id;
      }
      const response = await this.fetcher(path, { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers, body: JSON.stringify(body) });
      if (controller.signal.aborted) return;
      if (response.status === 401) { this.checkoutKeys.clear();this.userId=undefined; this.publish({ status: 'ready', auth: 'guest', catalog: this.state.catalog });const intent=this.options.intents?.read();this.signIn(intent?resumePath(this.options.currentPath?.()??'/',intent.key):undefined); return; }
      const url = response.ok ? paymentDestination(await response.json()) : undefined;
      if (!url) throw new Error('Invalid payment destination');
      if (!controller.signal.aborted) {if(path.endsWith('/checkout'))this.options.intents?.clear();this.navigate(url);}
      this.publish({ ...this.state, busy: undefined });
    } catch { if (!controller.signal.aborted) this.publish({ ...this.state, busy: undefined, actionFailed: true }); }
    finally { if (this.controller === controller) this.controller = undefined; }
  }
  dispose(): void { this.disposed = true; this.controller?.abort(); this.listeners.clear(); this.checkoutKeys.clear(); }
  leave = (): void => { this.controller?.abort(); this.controller=undefined; this.userId=undefined; this.publish({status:'idle',auth:'unknown'}); };
}
export interface PaymentStoreOptions {readonly intents?:CheckoutIntentStorage;readonly currentPath?:()=>string;readonly consent?:()=>{consent:boolean;campaign?:string}}
