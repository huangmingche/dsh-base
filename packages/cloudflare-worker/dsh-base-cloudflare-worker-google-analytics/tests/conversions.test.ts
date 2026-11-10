import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createConversionAnalytics, type ConversionEvent } from '../src/conversions.ts';
import { createConversionSummaryHandler } from '../src/summary.ts';
import { recordSignupConversion } from '../../dsh-base-cloudflare-worker-auth/src/analytics.ts';
import { resolveDeploymentSiteSettings } from '../../../boot/dsh-base-site-config/src/settings.ts';
const SECRET = 'test-only-google-secret', PRIVATE = 'private-account-id-do-not-forward';
function fixture(mode: 'off'|'aggregate'|'google' = 'aggregate') {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const db = {
    withSession() { return this; },
    prepare(query: string) {
      let args: (string|number)[] = [];
      return { bind(...values: (string|number)[]) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return {results: sql.prepare(query).all(...args)}; },
        async run() { return sql.prepare(query).run(...args); },
        runSync() { return sql.prepare(query).run(...args); } };
    },
    async batch(statements: {runSync(): unknown}[]) { sql.exec('BEGIN'); try { const result = statements.map(s => s.runSync()); sql.exec('COMMIT'); return result; } catch(error) { sql.exec('ROLLBACK'); throw error; } },
  };
  let values = {...resolveDeploymentSiteSettings({}), analytics: {google: {enabled: false, measurementId:'G-TEST1234'}, conversions: {mode, campaigns:['launch']}}};
  const settings = {async read() { return {revision:1, source:'saved' as const, values}; }};
  const env = {AUTH_DB: db as unknown as D1Database, GOOGLE_ANALYTICS_API_SECRET: SECRET, SITE_ADMIN_USER_IDS: '["admin"]'};
  const sent: {url:string; init:RequestInit; body: any}[] = []; let failure = false;
  const service = createConversionAnalytics(settings, async (url,init) => {
    sent.push({url:String(url), init:init!, body:JSON.parse(String(init!.body))});
    if (failure) throw new Error(SECRET);
    return new Response(null,{status:204});
  });
  return {sql, env, service, sent, set failure(value:boolean){failure=value;}, set mode(value:typeof mode){values.analytics.conversions.mode=value;}};
}
const signup: ConversionEvent = {name:'sign_up',dedupeKey:`signup:${PRIVATE}`};
const purchase: ConversionEvent = {name:'purchase',dedupeKey:`payment:${PRIVATE}`,value:12.34,currency:'USD',itemId:'pro_monthly'};

test('off is default, aggregate counts once with an atomic receipt and never exports identity', async () => {
  const f=fixture('off'); assert.equal((await f.service.recordConversion(f.env,signup)).status,'disabled');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dsh_analytics_conversions').get()!.n,0);
  f.mode='aggregate';
  const results=await Promise.all(Array.from({length:8},()=>f.service.recordConversion(f.env,signup)));
  assert.equal(results.filter(r=>r.status==='recorded').length,1);
  assert.equal(results.filter(r=>r.status==='duplicate').length,7);
  const rows=await f.service.conversionSummary(f.env); assert.equal(rows.length,1);assert.equal(rows[0]!.count,1);
  assert.equal(rows[0]!.campaign,''); assert.equal(f.sent.length,0);
  const stored=JSON.stringify(f.sql.prepare('SELECT * FROM dsh_analytics_conversions').all());
  assert.ok(!stored.includes(PRIVATE));assert.ok(!stored.includes('signup:'));
});

test('explicit consent gates Google, allowlisted campaign only, fresh identity and a non-identifying transaction receipt',async()=>{
  const f=fixture('google');
  assert.equal((await f.service.recordConversion(f.env,{...signup,campaign:'launch'})).status,'recorded');assert.equal(f.sent.length,0);
  assert.equal((await f.service.recordConversion(f.env,{...purchase,consent:true,campaign:'launch'})).status,'accepted');
  const call=f.sent[0]!;const url=new URL(call.url);assert.equal(url.origin,'https://www.google-analytics.com');assert.equal(url.pathname,'/mp/collect');assert.equal(url.searchParams.get('api_secret'),SECRET);
  assert.equal(call.init.redirect,'manual');assert.deepEqual([...new Headers(call.init.headers)],[['content-type','application/json']]);
  assert.deepEqual(Object.keys(call.body).sort(),['client_id','consent','events']);assert.match(call.body.client_id,/^[1-9]\d*\.[1-9]\d*$/u);
  assert.deepEqual(call.body.consent,{ad_user_data:'DENIED',ad_personalization:'DENIED'});
  assert.deepEqual(call.body.events[0].params.items,[{item_id:'pro_monthly',price:12.34,quantity:1}]);assert.equal(call.body.events[0].params.campaign_id,'launch');
  assert.equal(call.body.events[0].params.transaction_id,f.sql.prepare("SELECT receipt FROM dsh_analytics_conversions WHERE event_name='purchase'").get()!.receipt);
  for(const token of [PRIVATE,SECRET,'email','user_id','session_id','page_location','page_referrer','ip_override'])assert.ok(!String(call.init.body).includes(token));
  await f.service.recordConversion(f.env,{name:'begin_checkout',dedupeKey:'checkout:new',itemId:'pro_monthly',consent:true,campaign:'not_allowed'});
  assert.equal(f.sent[1]!.body.events[0].params.campaign_id,undefined);assert.equal(f.sent[1]!.body.events[0].params.value,undefined);
  assert.notEqual(f.sent[0]!.body.client_id,f.sent[1]!.body.client_id);
});

test('invalid events, missing trusted payment amounts, arbitrary fields and duplicate amount conflicts fail closed',async()=>{
  const f=fixture();
  for(const invalid of [{...purchase,value:undefined},{...purchase,currency:'usd'},{...purchase,value:NaN},{...purchase,itemId:'private/user'},{...signup,email:'private@example.test'},{...signup,name:'page_view'},{...signup,consent:'true'},{...signup,campaign:'user@email.test'}])assert.equal((await f.service.recordConversion(f.env,invalid as ConversionEvent)).status,'unavailable');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dsh_analytics_daily').get()!.n,0);
  assert.equal((await f.service.recordConversion(f.env,purchase)).status,'recorded');
  assert.equal((await f.service.recordConversion(f.env,{...purchase,value:99})).status,'unavailable');
  assert.equal((await f.service.conversionSummary(f.env))[0]!.value,12.34);
});

test('delivery failure is not retried; first-party counts survive; absence of infrastructure cannot interrupt business hooks',async()=>{
  const f=fixture('google');f.failure=true;
  const event={...purchase,consent:true};assert.equal((await f.service.recordConversion(f.env,event)).status,'failed');
  assert.equal((await f.service.recordConversion(f.env,event)).status,'duplicate');assert.equal(f.sent.length,1);
  assert.equal((await f.service.conversionSummary(f.env))[0]!.count,1);
  assert.equal((await f.service.recordConversion({},signup)).status,'unavailable');
  const payloads:unknown[]=[];await recordSignupConversion({async recordConversion(_env,event){payloads.push(event);throw new Error('unavailable');}},f.env,PRIVATE,new Headers({'x-dsh-analytics-consent':'granted','x-dsh-analytics-campaign':'launch'}));
  assert.deepEqual(payloads,[{name:'sign_up',dedupeKey:`signup:${PRIVATE}`,consent:true,campaign:'launch'}]);
});

test('admin summary rejects anonymous, other users, cross-origin and query expansion; reports only aggregates',async()=>{
  const f=fixture();await f.service.recordConversion(f.env,signup);let user:string|undefined;
  const handler=createConversionSummaryHandler({async session(){return user?{id:user}:undefined;}},f.service);
  const request=(suffix='',headers:HeadersInit={})=>new Request('https://app.test/api/site-analytics/conversions'+suffix,{headers});
  assert.equal((await handler(request(),f.env))!.status,401);user='other';assert.equal((await handler(request(),f.env))!.status,403);
  user='admin';assert.equal((await handler(request('',{origin:'https://other.test'}),f.env))!.status,403);
  assert.equal((await handler(request('?owner=other'),f.env))!.status,400);
  const result=(await handler(request(),f.env))!;assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');
  const body=await result.text();assert.ok(body.includes('sign_up'));for(const token of [PRIVATE,'event_key','receipt','fingerprint',SECRET])assert.ok(!body.includes(token));
});

test('activation is first-party even if a trusted caller mistakenly carries browser consent',async()=>{
 const f=fixture('google');assert.equal((await f.service.recordConversion(f.env,{name:'activation',dedupeKey:'first-completed-account',consent:true,campaign:'launch'})).status,'recorded');
 assert.equal(f.sent.length,0);assert.equal((await f.service.conversionSummary(f.env))[0]!.campaign,'');
});
