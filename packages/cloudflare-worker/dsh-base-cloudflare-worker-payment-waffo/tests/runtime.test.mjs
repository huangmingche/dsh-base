/** Real Workers crypto and D1 transactions; every provider response is a fixture. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const app=root+'apps/web';
const require=createRequire(app+'/package.json');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=createRequire(realpathSync(app+'/node_modules/@cloudflare/vite-plugin/package.json'))('miniflare');
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const sdk=require.resolve('@waffo/pancake-ts').replace(/\.cjs$/,'.js');
const code=`import {createPaymentHandler} from ${JSON.stringify(packageRoot+'src/index.ts')};
import {PaymentStore} from ${JSON.stringify(packageRoot+'src/store.ts')};
import {paymentConfig,PaymentError} from ${JSON.stringify(packageRoot+'src/config.ts')};
import {createNotifications,createNotificationsHandler} from ${JSON.stringify(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-notifications/src/index.ts')};
import {createConversionAnalytics} from ${JSON.stringify(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-google-analytics/src/conversions.ts')};
import {verifyWebhook,WaffoPancake} from ${JSON.stringify(sdk)};
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/sdk'){let signed=false;const sdk=new WaffoPancake({merchantId:env.WAFFO_MERCHANT_ID,privateKey:env.WAFFO_PRIVATE_KEY,
 fetch:async(url,init)=>{signed=Boolean(init.headers['X-Signature']);return Response.json({data:{ok:true}})}});
 await sdk.graphql.query({query:'{ __typename }'});return Response.json({signed});}
 if(path==='/allows') {const store=new PaymentStore(paymentConfig(env));return Response.json({allowed:await store.allows(request.headers.get('x-user'),['pro','lifetime']),summary:await store.summary()});}
 if(path==='/cas') { const store=new PaymentStore(paymentConfig(env));const value=await request.json();try{await store.commit(value.event,value.hash,value.row,value.previous);return new Response('ok');}catch{return new Response('retry',{status:503});}}
 const snapshots=JSON.parse(request.headers.get('x-fixture-snapshot')||'{}');
 const auth={async session(){const id=request.headers.get('x-user');return id?{id,email:id+'@example.test',username:id}:undefined;}};
 const notifier=createNotifications(async()=>{await env.AUTH_DB.prepare('INSERT INTO fixture_notification_calls (value) VALUES (1)').run();return request.headers.get('x-notification-outcome')||'accepted';});
 const metrics=createConversionAnalytics({async read(){return {values:{analytics:{conversions:{mode:'aggregate',campaigns:['launch']}}}};}},()=>{throw new Error('fixtures never send analytics externally');});
 const notificationResponse=await createNotificationsHandler(auth,notifier)(request,env);if(notificationResponse)return notificationResponse;
 const handler=createPaymentHandler(auth,config=>({
 verify(raw,sig){try{return verifyWebhook(raw,sig,{environment:config.environment,publicKeys:{test:env.FIXTURE_PUBLIC_KEY},toleranceMs:2700000,futureToleranceMs:60000});}catch{throw new PaymentError(400,'invalid_webhook_signature');}},
 async checkout(input){return {id:input.reference,url:'https://pancake.waffo.ai/store/test/checkout/'+input.reference+'#token=fixture'};},
 async portal(user){return {url:'https://pancake.waffo.ai/consumer/portal/store/'+config.storeId+'#token='+user};},
 async snapshot(id){if(snapshots.fail) throw new Error('fixture outage');return snapshots[id];}
 }),()=>notifier,()=>request.headers.get('x-conversions-unavailable')?{async recordConversion(){return {status:'unavailable'};}}:metrics);return await handler(request,env)||new Response('not found',{status:404});}};`;

test('Waffo raw signatures, authenticated checkout, persistent receipts and order races in workerd', {timeout:60000},async t=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const suffix='1234567890abcdefghijkl';
 const bindings={AUTH_BASE_URL:'https://localhost',WAFFO_ENABLED:'true',WAFFO_ENVIRONMENT:'test',WAFFO_MERCHANT_ID:'MER_'+suffix,
 NOTIFICATIONS_ENABLED:'true',DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/123456/fixture_token',SITE_ADMIN_USER_IDS:'["admin"]',WAFFO_STORE_ID:'STO_'+suffix,WAFFO_PRIVATE_KEY:keys.privateKey,FIXTURE_PUBLIC_KEY:keys.publicKey,
 WAFFO_PLANS_JSON:JSON.stringify([{id:'pro',productId:'PROD_'+suffix,type:'subscription',currency:'USD'},{id:'lifetime',productId:'PROD_abcdefghijkl1234567890',type:'one_time',currency:'USD'}])};
 const result=await build({stdin:{contents:code,resolveDir:app,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',nodePaths:[app+'/node_modules'],external:['crypto','node:*'],
  logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({workers:['payments-a','payments-b'].map(name=>({name,script:result.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:{AUTH_DB:'waffo-shared'},bindings}))}));
 try {
  const db=await mf.getD1Database('AUTH_DB','payments-a');
  for(const sql of readFileSync(packageRoot+'schema.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  for(const sql of readFileSync(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-notifications/schema.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  for(const sql of readFileSync(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-google-analytics/schema.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  await db.prepare('CREATE TABLE fixture_notification_calls (value INTEGER)').run();
  const a=await mf.getWorker('payments-a'),b=await mf.getWorker('payments-b');
  const request=(path,{user='alice',body,key=randomUUID(),headers={}}={})=>new Request('https://localhost'+path,{method:body===undefined?'GET':'POST',headers:{...(user?{'x-user':user}:{}),...(body===undefined?{}:{origin:'https://localhost','content-type':'application/json','idempotency-key':key}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const checkout=async(user='alice',planId='pro',key=randomUUID())=>a.fetch(request('/api/payments/checkout',{user,key,body:{planId,returnPath:'/?payment=return'}}));
  let reference;
  await t.test('SDK signs in Workers and checkout authority belongs to the session',async()=>{
   assert.deepEqual(await(await a.fetch(request('/sdk'))).json(),{signed:true});
   assert.equal((await checkout(null)).status,401);
   assert.equal((await a.fetch(request('/api/payments/checkout',{body:{planId:'pro',userId:'mallory'}}))).status,400);
   assert.equal((await a.fetch(request('/api/payments/checkout',{body:{planId:'pro'},headers:{origin:'https://evil.test'}}))).status,403);
   assert.equal((await a.fetch(request('/api/payments/checkout',{body:{planId:'pro',returnPath:'//evil.test'}}))).status,400);
   assert.equal((await checkout('alice','unknown')).status,400);
   const key=randomUUID();const first=await checkout('alice','pro',key);assert.equal(first.status,200);reference=(await first.json()).id;
   assert.equal((await(await checkout('alice','pro',key)).json()).id,reference);
   assert.equal((await checkout('alice','lifetime',key)).status,409);
   const own=await db.prepare('SELECT user_id FROM dsh_waffo_checkouts WHERE id=?').bind(reference).first();assert.equal(own.user_id,'alice');
  });
  const order='ORD_fixture';const now=Date.now();
  const active={id:order,status:'active',testMode:true,storeId:bindings.WAFFO_STORE_ID,buyerIdentity:'alice',checkoutId:reference,productId:'PROD_'+suffix,currency:'USD',kind:'subscription',periodStart:new Date(now-60000).toISOString(),periodEnd:new Date(now+86400000).toISOString(),originId:null,supersededBy:null,payments:[{id:'PAY_fixture',status:'succeeded',refundStatus:'none',createdAt:new Date(now).toISOString(),amount:'9.99',currency:'USD'}]};
  const event=(eventType='subscription.activated',data={})=>({id:randomUUID(),eventId:'PAY_fixture',eventType,timestamp:new Date().toISOString(),storeId:bindings.WAFFO_STORE_ID,mode:'test',data:{orderId:order,orderMerchantExternalId:reference,merchantProvidedBuyerIdentity:'alice',...data}});
  const webhook=(value,snapshot=active,{timestamp=Date.now(),raw=JSON.stringify(value),signatureBody=raw}={})=>new Request('https://localhost/api/webhooks/waffo',{method:'POST',headers:{'x-waffo-signature':'t='+timestamp+',v1='+sign('RSA-SHA256',Buffer.from(timestamp+'.'+signatureBody),keys.privateKey).toString('base64'),'x-fixture-snapshot':JSON.stringify({[order]:snapshot}),'content-type':'application/json'},body:raw});
  const account=async(user='alice')=>(await(await a.fetch(request('/api/payments/account',{user}))).json());
  await t.test('exact raw bytes, environment, scope, ownership and replay window are enforced',async()=>{
   assert.equal((await a.fetch(webhook(event(),active,{raw:' '+JSON.stringify(event()),signatureBody:'tampered'}))).status,400);
   assert.equal((await a.fetch(webhook(event(),active,{timestamp:Date.now()-46*60000}))).status,400);
   assert.equal((await a.fetch(webhook(event(),active,{timestamp:Date.now()+120000}))).status,400);
   assert.equal((await a.fetch(webhook({...event(),mode:'prod'}))).status,400);
   assert.equal((await a.fetch(webhook({...event(),storeId:'other'}))).status,400);
   assert.equal((await a.fetch(webhook(event(),{...active,buyerIdentity:'mallory'}))).status,400);
   assert.equal((await a.fetch(webhook(event(),{...active,productId:'PROD_other'}))).status,400);
   assert.equal((await account()).orders.length,0);
  });
  let firstEvent;
  await t.test('duplicate deliveries are atomic across isolates and private reads stay scoped',async()=>{
   firstEvent=event('subscription.payment_succeeded',{paymentId:'PAY_fixture',paymentStatus:'succeeded',currency:'USD',chargedAmount:'9.99'});const responses=await Promise.all([a.fetch(webhook(firstEvent)),b.fetch(webhook(firstEvent))]);assert.ok(responses.every(r=>r.status===200));
   assert.equal((await db.prepare('SELECT COUNT(*) total FROM dsh_waffo_events').first()).total,1);
   assert.equal((await db.prepare('SELECT COUNT(*) total FROM dsh_notification_outbox').first()).total,1);
   assert.equal((await db.prepare('SELECT COUNT(*) total FROM fixture_notification_calls').first()).total,1,'concurrent webhook delivery sends one notification');
   const purchase=await db.prepare("SELECT COUNT(*) total,SUM(value) value FROM dsh_analytics_conversions WHERE event_name='purchase'").first();assert.deepEqual(purchase,{total:1,value:9.99},'signed actual charged amount is counted once');
   assert.equal((await account()).orders[0].entitled,true);
   assert.equal((await account('bob')).orders.length,0);
   assert.equal((await a.fetch(webhook({...firstEvent,eventId:'different'}))).status,400);
   const copy={...firstEvent,id:randomUUID()};const copies=await Promise.all([a.fetch(webhook(copy)),b.fetch(webhook(copy))]);assert.ok(copies.every(r=>r.status===200));
   assert.deepEqual(await db.prepare("SELECT COUNT(*) total,SUM(value) value FROM dsh_analytics_conversions WHERE event_name='purchase'").first(),purchase,'another signed delivery of the same payment cannot double-count its charge');
  });
  await t.test('purchase analytics survive a post-commit outage and inherit only the checkout consent',async()=>{
   const key=randomUUID(),body={planId:'pro',analyticsConsent:true,analyticsCampaign:'launch'};
   const checkoutResponse=await a.fetch(request('/api/payments/checkout',{key,body}));assert.equal(checkoutResponse.status,200);const checkoutId=(await checkoutResponse.json()).id;
   const id='ORD_analytics',paymentId='PAY_analytics';const snapshot={...active,id,checkoutId,payments:[{...active.payments[0],id:paymentId,amount:'13.25'}]};
   const value=event('subscription.payment_succeeded',{orderId:id,orderMerchantExternalId:checkoutId,paymentId,currency:'USD',chargedAmount:'13.25'});const signed=webhook(value);signed.headers.set('x-fixture-snapshot',JSON.stringify({[id]:snapshot}));signed.headers.set('x-conversions-unavailable','1');
   assert.equal((await a.fetch(signed)).status,200);assert.equal((await db.prepare('SELECT eligible FROM dsh_waffo_orders WHERE id=?').bind(id).first()).eligible,1);
   assert.equal((await db.prepare('SELECT settled FROM dsh_waffo_conversion_outbox WHERE payment_id=?').bind(paymentId).first()).settled,0);
   const retry=webhook(value);retry.headers.set('x-fixture-snapshot',JSON.stringify({[id]:snapshot}));assert.equal((await a.fetch(retry)).status,200);
   assert.equal((await db.prepare('SELECT settled FROM dsh_waffo_conversion_outbox WHERE payment_id=?').bind(paymentId).first()).settled,1);
   const aggregate=await db.prepare("SELECT count,value FROM dsh_analytics_daily WHERE event_name='purchase' AND campaign='launch'").first();assert.deepEqual(aggregate,{count:1,value:13.25});
   const consent=await db.prepare('SELECT consent,campaign FROM dsh_waffo_checkout_consent WHERE checkout_id=?').bind(checkoutId).first();assert.deepEqual(consent,{consent:1,campaign:'launch'});
   assert.equal((await a.fetch(request('/api/payments/checkout',{key,body:{...body,analyticsConsent:false}}))).status,200);
   assert.deepEqual(await db.prepare('SELECT consent,campaign FROM dsh_waffo_checkout_consent WHERE checkout_id=?').bind(checkoutId).first(),{consent:0,campaign:null});
   assert.equal((await a.fetch(request('/api/payments/checkout',{key,body}))).status,200);
   assert.equal((await db.prepare('SELECT consent FROM dsh_waffo_checkout_consent WHERE checkout_id=?').bind(checkoutId).first()).consent,0,'same-key retry cannot turn a prior denial into permission');
  });
  await t.test('only the matching signed actual charge becomes revenue; price snapshots never substitute',async()=>{
   const cases=[
    {label:'zero',chargedAmount:'0',expected:'0'},
    {label:'credit',chargedAmount:'2.25',expected:'2.25'},
    {label:'missing'},
    {label:'invalid',chargedAmount:'9.999'},
    {label:'id_mismatch',chargedAmount:'2.25',data:{paymentId:'PAY_other'}},
    {label:'event_currency',chargedAmount:'2.25',data:{currency:'EUR'}},
    {label:'query_currency',chargedAmount:'2.25',payment:{currency:'EUR'}},
    {label:'query_currency_missing',chargedAmount:'2.25',payment:{currency:undefined}},
    {label:'failed_event',chargedAmount:'2.25',data:{paymentStatus:'failed'}},
    {label:'lifecycle',chargedAmount:'2.25',eventType:'subscription.activated'},
    {label:'one_time',chargedAmount:'1.50',expected:'1.50',kind:'one_time',eventType:'order.completed'},
   ];
   for(const row of cases){
    const kind=row.kind??'subscription',checkoutId=(await(await checkout('alice',kind==='one_time'?'lifetime':'pro')).json()).id;
    const id='ORD_charge_'+row.label,paymentId='PAY_charge_'+row.label;
    // Even an extra legacy amount on a provider fixture must never substitute
    // for chargedAmount; the real GraphQL parser drops snapshot totals entirely.
    const snapshot={...active,id,checkoutId,kind,status:kind==='one_time'?'completed':'active',productId:kind==='one_time'?'PROD_abcdefghijkl1234567890':active.productId,
     payments:[{...active.payments[0],id:paymentId,amount:'9.99',...row.payment}]};
    const value=event(row.eventType??'subscription.payment_succeeded',{orderId:id,orderMerchantExternalId:checkoutId,paymentId,paymentStatus:'succeeded',currency:'USD',
     amount:'9.99',listPrice:{total:'9.99'},...(row.chargedAmount===undefined?{}:{chargedAmount:row.chargedAmount}),...row.data});
    const signed=webhook(value);signed.headers.set('x-fixture-snapshot',JSON.stringify({[id]:snapshot}));
    assert.equal((await a.fetch(signed)).status,200,row.label);
    const outbox=await db.prepare('SELECT amount,currency,settled FROM dsh_waffo_conversion_outbox WHERE payment_id=?').bind(paymentId).first();
    assert.deepEqual(outbox,row.expected===undefined?null:{amount:row.expected,currency:'USD',settled:1},row.label);
    assert.equal((await db.prepare('SELECT eligible FROM dsh_waffo_orders WHERE id=?').bind(id).first()).eligible,1,'analytics evidence does not change entitlement: '+row.label);
   }
  });
  await t.test('trial or missing provider amount never creates a fabricated purchase conversion',async()=>{
   for(const [id,status,payments] of [['ORD_trial','trialing',[]],['ORD_no_amount','active',[{id:'PAY_no_amount',status:'succeeded',refundStatus:'none',createdAt:new Date().toISOString()}]]]){
    const checkoutId=(await(await checkout()).json()).id;const snapshot={...active,id,checkoutId,status,payments};const signed=webhook(event('subscription.activated',{orderId:id,orderMerchantExternalId:checkoutId}));signed.headers.set('x-fixture-snapshot',JSON.stringify({[id]:snapshot}));assert.equal((await a.fetch(signed)).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) total FROM dsh_waffo_conversion_outbox WHERE order_id=?').bind(id).first()).total,0);
   }
  });
  await t.test('refund is independent of subscription and portal; late activation cannot restore access',async()=>{
   const refunded={...active,payments:active.payments.map(p=>({...p,refundStatus:'refunded'}))};
   assert.equal((await a.fetch(webhook(event('refund.succeeded'),refunded))).status,200);
   assert.equal((await a.fetch(webhook(event('subscription.activated'),refunded))).status,200);
   const state=await account();assert.equal(state.orders[0].entitled,false);assert.equal(state.orders[0].refunded,true);assert.equal(state.portalAvailable,true);
   const portal=await a.fetch(request('/api/payments/portal',{body:{}}));assert.equal(portal.status,200);assert.ok((await portal.json()).url.endsWith('#token=alice'));
   assert.equal((await a.fetch(request('/api/payments/portal',{body:{userId:'bob'}}))).status,400);
  });
  await t.test('stale revision does not receive a receipt and failures can be retried',async()=>{
   const previous=await db.prepare('SELECT * FROM dsh_waffo_orders WHERE id=?').bind(order).first();
   const {scope,revision,last_event,updated_at,...row}=previous;
   const one={event:randomUUID(),hash:'first',row:{...row,status:'canceled',eligible:0},previous};
   const two={event:randomUUID(),hash:'second',row:{...row,status:'active',eligible:1},previous};
   assert.equal((await a.fetch(request('/cas',{body:one}))).status,200);
   assert.equal((await b.fetch(request('/cas',{body:two}))).status,503);
   assert.equal(await db.prepare('SELECT id FROM dsh_waffo_events WHERE id=?').bind(two.event).first(),null);
   assert.equal((await account()).orders[0].status,'canceled');
   const retry=event('subscription.renewed');const outage=webhook(retry);outage.headers.set('x-fixture-snapshot',JSON.stringify({fail:true}));
   assert.equal((await a.fetch(outage)).status,503);
   assert.equal(await db.prepare('SELECT id FROM dsh_waffo_events WHERE id=?').bind(retry.id).first(),null);
   assert.equal((await a.fetch(webhook(retry,{...active,status:'canceled'}))).status,200);
  });
  await t.test('paid access queries include historical lifetime orders and expire known periods',async()=>{
   const configScope='test:'+bindings.WAFFO_MERCHANT_ID+':'+bindings.WAFFO_STORE_ID;
   const put=async(id,kind,eligible,end,user='alice')=>db.prepare(`INSERT INTO dsh_waffo_orders
    (scope,id,user_id,checkout_id,plan_id,kind,status,period_end,refunded,eligible,superseded_by,revision,last_event,updated_at)
    VALUES (?,?,?,?,?,?,?, ?,0,?,NULL,1,?,?)`).bind(configScope,id,user,reference,kind==='one_time'?'lifetime':'pro',kind,kind==='one_time'?'completed':'active',end,eligible,id,Date.now()).run();
   await put('ORD_old_lifetime','one_time',1,null,'historic');
   for(let i=0;i<101;i++)await put('ORD_expired_'+i,'subscription',1,new Date(now-10000).toISOString(),'historic');
   const result=await(await a.fetch(request('/allows',{user:'historic'}))).json();assert.equal(result.allowed,true,'authorization is not limited to the newest 100 rows');
   await db.prepare('UPDATE dsh_waffo_orders SET eligible=0 WHERE id=?').bind('ORD_old_lifetime').run();
   assert.equal((await(await a.fetch(request('/allows',{user:'historic'}))).json()).allowed,false,'expired subscription cannot grant access');
  });
  await t.test('refund before first activation is persisted and cannot grant one-time access',async()=>{
   const lifetime=await(await checkout('alice','lifetime')).json();
   const id='ORD_lifetime_refund';
   const data={...active,id,kind:'one_time',checkoutId:lifetime.id,productId:'PROD_abcdefghijkl1234567890',status:'completed',periodStart:null,periodEnd:null,
    payments:active.payments.map(p=>({...p,refundStatus:'refunded'}))};
   const e=event('refund.succeeded',{orderId:id,orderMerchantExternalId:lifetime.id});
   const signed=webhook(e);signed.headers.set('x-fixture-snapshot',JSON.stringify({[id]:data}));
   assert.equal((await a.fetch(signed)).status,200);
   const saved=await db.prepare('SELECT eligible,refunded FROM dsh_waffo_orders WHERE id=?').bind(id).first();assert.deepEqual(saved,{eligible:0,refunded:1});
  });
  await t.test('portal replacement requires the authoritative backlink and permanently supersedes its origin',async()=>{
   const id='ORD_replacement';
   const replacement={...active,id,originId:order,checkoutId:null};
   const e=event('subscription.plan_changed',{orderId:id,orderMerchantExternalId:undefined});
   const bad=webhook(e);bad.headers.set('x-fixture-snapshot',JSON.stringify({[id]:replacement,[order]:active}));
   assert.equal((await a.fetch(bad)).status,503);
   assert.equal(await db.prepare('SELECT id FROM dsh_waffo_orders WHERE id=?').bind(id).first(),null);
   const good=webhook(e);good.headers.set('x-fixture-snapshot',JSON.stringify({[id]:replacement,[order]:{...active,supersededBy:id}}));
   assert.equal((await a.fetch(good)).status,200);
   assert.equal((await db.prepare('SELECT eligible FROM dsh_waffo_orders WHERE id=?').bind(order).first()).eligible,0);
   assert.equal((await a.fetch(webhook(event('subscription.activated'),active))).status,200);
   const original=await db.prepare('SELECT superseded_by,eligible FROM dsh_waffo_orders WHERE id=?').bind(order).first();assert.deepEqual(original,{superseded_by:id,eligible:0});
  });
  await t.test('notification ambiguity never automatically retries; explicit admin review is scoped and versioned',async()=>{
   const e=event('subscription.past_due');const signed=webhook(e,{...active,status:'past_due'});signed.headers.set('x-notification-outcome','uncertain');
   assert.equal((await a.fetch(signed)).status,200,'delivery uncertainty does not roll back verified payment state');
   const delivery=await db.prepare('SELECT * FROM dsh_notification_outbox WHERE event_key LIKE ?').bind('%:'+e.id).first();assert.equal(delivery.state,'uncertain');assert.equal(delivery.attempts,1);
   assert.equal((await a.fetch(webhook(e,{...active,status:'past_due'}))).status,200);
   assert.equal((await db.prepare('SELECT attempts FROM dsh_notification_outbox WHERE id=?').bind(delivery.id).first()).attempts,1);
   const retry=body=>a.fetch(request('/api/saas/notifications/retry',{user:'admin',body}));
   assert.equal((await retry({id:delivery.id,expectedAttempts:1})).status,409);
   assert.equal((await retry({id:delivery.id,expectedAttempts:0,reviewedUncertain:true})).status,409);
   assert.equal((await retry({id:delivery.id,expectedAttempts:1,reviewedUncertain:true})).status,200);
   const final=await db.prepare('SELECT state,attempts FROM dsh_notification_outbox WHERE id=?').bind(delivery.id).first();assert.deepEqual(final,{state:'accepted',attempts:2});
   assert.equal((await retry({id:delivery.id,expectedAttempts:2,reviewedUncertain:true})).status,409);
   const list=await(await a.fetch(request('/api/saas/notifications',{user:'admin'}))).json();assert.ok(!JSON.stringify(list).includes('fixture_token'));assert.ok(!JSON.stringify(list).includes('destination_hash'));
  });
  await t.test('an enabled missing outbox schema rolls back the financial transaction and receipt for retry',async()=>{
   await db.prepare('DROP TABLE dsh_notification_outbox').run();
   const previous=await db.prepare('SELECT revision FROM dsh_waffo_orders WHERE id=?').bind(order).first();const e=event('subscription.canceled');
   assert.equal((await a.fetch(webhook(e,{...active,status:'canceled'}))).status,503);
   assert.equal(await db.prepare('SELECT id FROM dsh_waffo_events WHERE id=?').bind(e.id).first(),null);
   assert.deepEqual(await db.prepare('SELECT revision FROM dsh_waffo_orders WHERE id=?').bind(order).first(),previous);
  });
 }finally{await mf.dispose();}
});
