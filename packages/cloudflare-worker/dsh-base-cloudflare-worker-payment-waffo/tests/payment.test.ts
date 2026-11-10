import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentConfig, paymentReturnUrl } from '../src/config.ts';
import { hostedUrl, parseSnapshot, type PaymentEvent, type ProviderSnapshot } from '../src/contracts.ts';
import { orderState, validateEvent } from '../src/reconcile.ts';
import { accountOrder } from '../src/store.ts';
import { confirmedPurchase } from '../src/analytics.ts';

const id = '1234567890abcdefghijkl';
const env = { AUTH_DB: {} as D1Database, AUTH_BASE_URL: 'https://app.example', WAFFO_ENABLED: 'true', WAFFO_ENVIRONMENT: 'test',
  WAFFO_MERCHANT_ID: `MER_${id}`, WAFFO_STORE_ID: `STO_${id}`, WAFFO_PRIVATE_KEY: 'fixture',
  WAFFO_PLANS_JSON: JSON.stringify([{id:'pro',name:'Pro',productId:`PROD_${id}`,type:'subscription',currency:'USD'}]) };
const snapshot = (snapshotAmountDetails?:unknown) => parseSnapshot({id:'ORD_example',status:'active',testMode:true,store:{id:env.WAFFO_STORE_ID},
  merchantProvidedBuyerIdentity:'alice',orderMerchantExternalId:'checkout-1',priceSnapshot:{currency:'USD'},
  subscriptionProduct:{id:`PROD_${id}`},currentPeriodStart:'2030-01-01T00:00:00Z',currentPeriodEnd:'2030-02-01T00:00:00Z',
  payments:[{id:'PAY_1',status:'succeeded',refundStatus:'none',createdAt:'2030-01-01T00:01:00Z',snapshotAmountDetails}]},'subscription');

const paymentEvent = (data: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}): PaymentEvent => ({
  id:'event-1',eventId:'provider-event-1',eventType:'subscription.payment_succeeded',timestamp:'2030-01-01T00:01:01Z',
  storeId:env.WAFFO_STORE_ID,mode:'test',...envelope,
  data:{orderId:'ORD_example',merchantProvidedBuyerIdentity:'alice',currency:'USD',paymentId:'PAY_1',chargedAmount:'2.25',...data},
} as PaymentEvent);
const monetarySnapshot = () => snapshot({currency:'USD',total:'9.99'});
const oneTimeSnapshot = (): ProviderSnapshot => ({...monetarySnapshot(),kind:'one_time',status:'completed',periodStart:null,periodEnd:null});

test('queried price snapshots never infer a charged amount or alter financial eligibility',()=>{
  for(const details of [undefined,{currency:'USD',total:'13.25'},{currency:'JPY',total:'0'},
    {currency:'USD',total:1325},{currency:'USD',total:'1e2'},{currency:'USD',total:'-1'},{currency:'usd',total:'13.25'}]){
    const current=snapshot(details),payment=current.payments[0]!;
    assert.equal(Object.hasOwn(payment,'amount'),false,'price-snapshot totals are not actual channel charges');
    assert.equal(payment.currency,details&&/^[A-Z]{3}$/u.test(details.currency)?details.currency:undefined);
    assert.deepEqual(orderState(current),{eligible:1,refunded:0},'missing analytics amounts do not change financial eligibility');
  }
});

test('purchase conversions use the verified payment event charge, including zero and partial charges',()=>{
  const current=monetarySnapshot();
  for(const amount of ['0','0.00','2.25','999999999.99']){
    assert.deepEqual(confirmedPurchase(paymentEvent({chargedAmount:amount}),current),{paymentId:'PAY_1',currency:'USD',amount});
  }
  assert.deepEqual(confirmedPurchase(paymentEvent({chargedAmount:'2.25'},{eventType:'order.completed'}),oneTimeSnapshot()),
    {paymentId:'PAY_1',currency:'USD',amount:'2.25'},'a 9.99 price snapshot must not replace a 2.25 actual charge');
  const withoutOptionalBuyer=paymentEvent({merchantProvidedBuyerIdentity:undefined});
  assert.equal(confirmedPurchase(withoutOptionalBuyer,current)?.amount,'2.25','optional event buyer identity may be absent after trusted reconciliation');
});

test('missing actual charge never falls back to legacy, list, plan or original payment figures',()=>{
  for(const fallback of [{},{amount:'9.99'},{total:'9.99'},{listPrice:{total:'9.99',taxAmount:'0.00'}},
    {planPrice:{total:'9.99',taxAmount:'0.00'}},{originalChargedAmount:'9.99',originalPayment:{total:'9.99',taxAmount:'0.00'}}]){
    assert.equal(confirmedPurchase(paymentEvent({chargedAmount:undefined,...fallback}),monetarySnapshot()),undefined);
  }
});

test('charge strings require bounded major-currency values with the currency precision',()=>{
  for(const chargedAmount of [null,0,225,'',' 2.25','2.25 ','+2.25','-1','01.00','1e2','NaN','Infinity','1000000000','1.001','0.0000']){
    assert.equal(confirmedPurchase(paymentEvent({chargedAmount}),monetarySnapshot()),undefined,String(chargedAmount));
  }
  const inCurrency=(currency:string):ProviderSnapshot=>({...monetarySnapshot(),currency,
    payments:monetarySnapshot().payments.map(payment=>({...payment,currency}))});
  assert.deepEqual(confirmedPurchase(paymentEvent({currency:'JPY',chargedAmount:'0'}),inCurrency('JPY')),{paymentId:'PAY_1',currency:'JPY',amount:'0'});
  assert.equal(confirmedPurchase(paymentEvent({currency:'JPY',chargedAmount:'0.1'}),inCurrency('JPY')),undefined);
  assert.deepEqual(confirmedPurchase(paymentEvent({currency:'KWD',chargedAmount:'2.125'}),inCurrency('KWD')),{paymentId:'PAY_1',currency:'KWD',amount:'2.125'});
});

test('subscription lifecycle and refund events cannot become purchase conversions',()=>{
  for(const eventType of ['subscription.activated','subscription.renewed','subscription.recovered','subscription.plan_changed',
    'subscription.canceling','subscription.canceled','subscription.past_due','refund.succeeded','refund.failed','order.completed']){
    assert.equal(confirmedPurchase(paymentEvent({chargedAmount:'9.99',planPrice:{total:'9.99',taxAmount:'0.00'}},{eventType}),monetarySnapshot()),undefined,eventType);
  }
  assert.equal(confirmedPurchase(paymentEvent(),oneTimeSnapshot()),undefined,'subscription charges cannot be attributed to a one-time order');
});

test('purchase conversion requires one matching authoritative successful and unrefunded payment',()=>{
  const current=monetarySnapshot(),payment=current.payments[0]!;
  for(const paymentId of [undefined,'','PAY_missing']) assert.equal(confirmedPurchase(paymentEvent({paymentId}),current),undefined);
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[]}),undefined);
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[payment,{...payment}]}),undefined,'ambiguous duplicate payment IDs fail closed');
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,id:'PAY_other',status:'failed'},payment]})?.paymentId,'PAY_1','other queried payments are never attributed to this event');
  for(const paymentStatus of ['pending','failed','canceled']) assert.equal(confirmedPurchase(paymentEvent({paymentStatus}),current),undefined,paymentStatus);
  for(const status of ['pending','failed','canceled']) assert.equal(confirmedPurchase(paymentEvent({paymentStatus:'succeeded'}),{...current,payments:[{...payment,status}]}),undefined,status);
  for(const refundStatus of ['pending','refunded']) assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,refundStatus}]}),undefined,refundStatus);
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,refundStatus:'failed'}]})?.amount,'2.25');
});

test('purchase conversion keeps event, order, buyer, currency, store and environment scope aligned',()=>{
  const current=monetarySnapshot(),payment=current.payments[0]!;
  for(const data of [{orderId:'ORD_other'},{merchantProvidedBuyerIdentity:'bob'},{currency:'EUR'},{currency:'usd'},{currency:undefined}]){
    assert.equal(confirmedPurchase(paymentEvent(data),current),undefined,JSON.stringify(data));
  }
  for(const envelope of [{storeId:'STO_other'},{mode:'prod'},{mode:'unknown'}]){
    assert.equal(confirmedPurchase(paymentEvent({},envelope),current),undefined,JSON.stringify(envelope));
  }
  assert.equal(confirmedPurchase(paymentEvent(),{...current,currency:'EUR'}),undefined);
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,currency:'EUR'}]}),undefined);
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,currency:undefined}]}),undefined);
});

test('only a charge inside the queried current subscription period can be converted',()=>{
  const current=monetarySnapshot(),payment=current.payments[0]!;
  assert.equal(confirmedPurchase(paymentEvent(),{...current,periodStart:null}),undefined);
  for(const createdAt of ['2029-12-31T23:59:59Z','2030-02-01T00:00:00Z','2030-02-01T00:00:01Z']){
    assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,createdAt}]}),undefined,createdAt);
  }
  assert.equal(confirmedPurchase(paymentEvent(),{...current,payments:[{...payment,createdAt:'2030-01-01T00:00:00Z'}]})?.amount,'2.25');
  assert.equal(confirmedPurchase(paymentEvent(),{...current,periodEnd:null})?.amount,'2.25','open period end keeps the existing authoritative reconciliation contract');
});

test('configuration fails closed and checkout accepts only same-origin paths', () => {
  assert.equal(paymentConfig({}), undefined);
  assert.ok(paymentConfig(env));
  for (const change of [{WAFFO_ENABLED:'false'},{WAFFO_ENVIRONMENT:'auto'},{WAFFO_PLANS_JSON:'[]'},
    {WAFFO_MERCHANT_ID:'MER_wrong'},{AUTH_BASE_URL:'https://user:pass@app.example'},
    {WAFFO_PLANS_JSON:JSON.stringify([{id:'pro',productId:'PROD_wrong',type:'subscription',currency:'USD'}])}]) {
    assert.equal(paymentConfig({...env,...change}), undefined);
  }
  assert.equal(paymentReturnUrl('https://app.example','/zh-CN/?payment=return'),'https://app.example/zh-CN/?payment=return');
  for (const path of ['//evil.test','https://evil.test','/\\evil.test','/\n/evil','/%2f%2fevil.test','/%5cevil.test']) {
    assert.throws(() => paymentReturnUrl('https://app.example',path));
  }
  assert.equal(hostedUrl('https://pancake.waffo.ai/store/test#token=secret'),'https://pancake.waffo.ai/store/test#token=secret');
  for (const url of ['http://pancake.waffo.ai/','https://pancake.waffo.ai.evil.test/','https://user@pancake.waffo.ai/','https://pancake.waffo.ai:123/']) assert.throws(() => hostedUrl(url));
});

test('refunds revoke the affected period and lifecycle never comes from payment events', () => {
  const active = snapshot();
  assert.deepEqual(orderState(active),{refunded:0,eligible:1});
  assert.deepEqual(orderState({...active,status:'canceled'}),{refunded:0,eligible:0});
  assert.deepEqual(orderState({...active,status:'past_due'}),{refunded:0,eligible:0});
  assert.deepEqual(orderState({...active,status:'unknown'}),{refunded:0,eligible:0});
  const refunded = {...active,payments:active.payments.map(payment=>({...payment,refundStatus:'refunded'}))};
  assert.deepEqual(orderState(refunded),{refunded:1,eligible:0});
  const renewal = {...refunded,payments:[...refunded.payments.map(payment=>({...payment,createdAt:'2029-12-01T00:01:00Z'})),...active.payments]};
  assert.deepEqual(orderState(renewal),{refunded:0,eligible:1},'old refunded period does not erase a later paid renewal');
  const row = {id:'o',user_id:'alice',checkout_id:'c',plan_id:'pro',kind:'subscription' as const,status:'active',period_end:'2030-02-01T00:00:00Z',refunded:0,eligible:1,superseded_by:null,revision:1,last_event:'e',updated_at:1};
  assert.equal(accountOrder(row,Date.parse('2030-03-01')).entitled,false,'known period expires without a webhook');
  assert.equal(accountOrder({...row,superseded_by:'new'},Date.parse('2030-01-02')).entitled,false);
});

test('signed event envelope remains scoped to store and environment', () => {
  const config=paymentConfig(env)!;
  const event={id:'e',eventId:'p',eventType:'order.completed',timestamp:new Date().toISOString(),storeId:env.WAFFO_STORE_ID,mode:'test',data:{orderId:'o'}};
  assert.doesNotThrow(()=>validateEvent(event,config));
  for(const change of [{mode:'prod'},{storeId:'different'},{timestamp:'bad'},{data:{}}]) assert.throws(()=>validateEvent({...event,...change},config));
});
