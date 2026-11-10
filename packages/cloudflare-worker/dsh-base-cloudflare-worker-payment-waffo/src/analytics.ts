import type {ConversionAnalyticsService} from '@dsh-base/cloudflare-worker-google-analytics';
import type {PaymentConfig} from './config.ts';
import type {PaymentEvent,ProviderSnapshot} from './contracts.ts';
import {validPrice} from './catalog.ts';
export type PaymentAnalytics=Pick<ConversionAnalyticsService,'recordConversion'>;
export interface PaymentConsent {readonly consent:boolean;readonly campaign?:string}
/** SDK 0.28 chargedAmount is an actual display-currency string, unlike price snapshots. */
export function confirmedPurchase(event:PaymentEvent,snapshot:ProviderSnapshot):{paymentId:string;currency:string;amount:string}|undefined {
  if(event.eventType!==(snapshot.kind==='one_time'?'order.completed':'subscription.payment_succeeded')
    ||event.data.orderId!==snapshot.id||event.storeId!==snapshot.storeId||event.mode!==(snapshot.testMode?'test':'prod')
    ||event.data.merchantProvidedBuyerIdentity!==undefined&&event.data.merchantProvidedBuyerIdentity!==snapshot.buyerIdentity
    ||typeof event.data.paymentId!=='string'||!event.data.paymentId
    ||event.data.paymentStatus!==undefined&&event.data.paymentStatus!=='succeeded'
    ||event.data.currency!==snapshot.currency||!/^[A-Z]{3}$/u.test(event.data.currency)
    ||!validPrice({amount:event.data.chargedAmount},'one_time',event.data.currency))return undefined;
  const matches=snapshot.payments.filter(payment=>payment.id===event.data.paymentId);
  if(matches.length!==1)return undefined;
  const payment=matches[0]!;
  if(payment.status!=='succeeded'||!['none','failed'].includes(payment.refundStatus)||payment.currency!==event.data.currency
    ||snapshot.kind==='subscription'&&(snapshot.periodStart===null||Date.parse(payment.createdAt)<Date.parse(snapshot.periodStart)
      ||snapshot.periodEnd!==null&&Date.parse(payment.createdAt)>=Date.parse(snapshot.periodEnd)))return undefined;
  return {paymentId:payment.id,currency:event.data.currency,amount:event.data.chargedAmount!};
}
export class PaymentConversions {
  private readonly db:D1DatabaseSession;readonly config:PaymentConfig;
  constructor(config:PaymentConfig){this.config=config;this.db=config.db.withSession('first-primary');}
  async consent(checkoutId:string):Promise<PaymentConsent>{const row=await this.db.prepare('SELECT consent,campaign FROM dsh_waffo_checkout_consent WHERE scope=? AND checkout_id=?').bind(this.config.scope,checkoutId).first<{consent:number;campaign:string|null}>();return {consent:row?.consent===1,...(row?.consent===1&&row.campaign?{campaign:row.campaign}:{})};}
  async saveConsent(checkoutId:string,value:PaymentConsent):Promise<void>{
    // A retry can revoke permission, but cannot turn an earlier denial into a grant for the same purchase intent.
    await this.db.prepare(`INSERT INTO dsh_waffo_checkout_consent(scope,checkout_id,consent,campaign) VALUES(?,?,?,?)
      ON CONFLICT(scope,checkout_id) DO UPDATE SET consent=MIN(consent,excluded.consent),campaign=CASE WHEN consent=1 AND excluded.consent=1 THEN campaign ELSE NULL END`)
      .bind(this.config.scope,checkoutId,value.consent?1:0,value.consent?value.campaign??null:null).run();
  }
  purchaseStatements(event:PaymentEvent,payloadHash:string,checkoutId:string,planId:string,snapshot:ProviderSnapshot):readonly D1PreparedStatement[]{
    const payment=confirmedPurchase(event,snapshot);
    if(!payment)return [];
    return [this.db.prepare(`INSERT INTO dsh_waffo_conversion_outbox(scope,payment_id,order_id,checkout_id,plan_id,currency,amount)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM dsh_waffo_events WHERE scope=? AND id=? AND payload_hash=?) ON CONFLICT(scope,payment_id) DO NOTHING`)
        .bind(this.config.scope,payment.paymentId,snapshot.id,checkoutId,planId,payment.currency,payment.amount,this.config.scope,event.id,payloadHash)];
  }
  async flush(env:unknown,orderId:string,analytics:PaymentAnalytics):Promise<void>{
    const rows=await this.db.prepare('SELECT payment_id,checkout_id,plan_id,currency,amount FROM dsh_waffo_conversion_outbox WHERE scope=? AND order_id=? AND settled=0 LIMIT 100')
      .bind(this.config.scope,orderId).all<{payment_id:string;checkout_id:string;plan_id:string;currency:string;amount:string}>();
    for(const row of rows.results){
      const outcome=await analytics.recordConversion(env,{name:'purchase',dedupeKey:`waffo:${this.config.scope}:payment:${row.payment_id}`,itemId:row.plan_id,currency:row.currency,value:Number(row.amount),...await this.consent(row.checkout_id)});
      if(outcome.status!=='unavailable')await this.db.prepare('UPDATE dsh_waffo_conversion_outbox SET settled=1 WHERE scope=? AND payment_id=?').bind(this.config.scope,row.payment_id).run();
    }
  }
}
