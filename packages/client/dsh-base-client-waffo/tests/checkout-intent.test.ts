import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PaymentStore,readCatalog} from '../src/client/payment-store.ts';
import {CHECKOUT_INTENT_TTL,readCheckoutIntent,safePaymentPath,resumePath,type CheckoutIntent} from '../src/client/checkout-intent.ts';
const plan={id:'pro',productId:'p',type:'subscription',currency:'USD'},catalog={provider:'waffo',ready:true,plans:[plan]};
const json=(value:unknown,status=200)=>Response.json(value,{status});
const storage=()=>{let value:CheckoutIntent|undefined;return {read:()=>value,write:(next:CheckoutIntent)=>{value=next;},clear:()=>{value=undefined;}};};
test('guest purchase intent survives login, preserving plan, return path and idempotency without granting access',async()=>{
 const intents=storage();let next='',destination='',posts=0;const requests:RequestInit[]=[];
 const guest=new PaymentStore(async url=>json(String(url).endsWith('get-session')?null:catalog),path=>{next=path??'';},()=>assert.fail(),()=> 'zh',{intents,currentPath:()=>'/zh-CN'});
 await guest.reload();await guest.checkout('pro');const saved=intents.read()!;assert.equal(posts,0);assert.equal(next,resumePath('/zh-CN',saved.key));guest.dispose();
 const signed=new PaymentStore(async(url,init)=>{const path=String(url);if(path.endsWith('get-session'))return json({user:{id:'alice'}});if(path.endsWith('/account'))return json({orders:[],portalAvailable:true});if(path.endsWith('/checkout')){posts++;requests.push(init!);return json({url:'https://pancake.waffo.ai/store/test#token=fixture'});}return json(catalog);},()=>assert.fail('session is verified'),url=>{destination=url;},()=> 'en',{intents,currentPath:()=>next});
 await signed.reload();assert.equal(posts,1);assert.equal(new Headers(requests[0]!.headers).get('Idempotency-Key'),saved.key);
 assert.deepEqual(JSON.parse(String(requests[0]!.body)),{planId:'pro',locale:'zh',returnPath:'/?payment=return'});assert.match(destination,/^https:\/\/pancake\.waffo\.ai/);assert.equal(intents.read(),undefined);assert.deepEqual(signed.getSnapshot().account?.orders,[]);
});
test('expired, forged, wrong-owner and unknown-plan intents cannot resume a checkout',async()=>{
 for(const change of [{createdAt:Date.now()-CHECKOUT_INTENT_TTL-1000},{userId:'bob'},{planId:'missing'}]){
  const intents=storage();const intent={planId:'pro',key:'0123456789abcdef',locale:'en',returnPath:'/',createdAt:Date.now(),...change};intents.write(intent);let posts=0;
  const store=new PaymentStore(async(url)=>{const path=String(url);if(path.endsWith('/checkout'))posts++;return json(path.endsWith('get-session')?{user:{id:'alice'}}:path.endsWith('/account')?{orders:[],portalAvailable:true}:catalog);},()=>assert.fail(),()=>assert.fail(),()=> 'en',{intents,currentPath:()=>resumePath('/',intent.key)});
  await store.reload();assert.equal(posts,0);assert.equal(intents.read(),undefined);
 }
 const intents=storage();intents.write({planId:'pro',key:'0123456789abcdef',locale:'en',returnPath:'/',createdAt:Date.now()});let posts=0;
 const store=new PaymentStore(async(url)=>{const path=String(url);if(path.endsWith('/checkout'))posts++;return json(path.endsWith('get-session')?{user:{id:'alice'}}:path.endsWith('/account')?{orders:[],portalAvailable:true}:catalog);},()=>{},()=>{},()=> 'en',{intents,currentPath:()=>'/?checkout_intent=forged'});
 await store.reload();assert.equal(posts,0);
});
test('navigation and declared price parsers fail closed on external paths and malformed amounts',()=>{
 for(const path of ['//evil.test','/\\evil.test','https://evil.test','/%2f%2fevil.test'])assert.throws(()=>safePaymentPath(path));
 assert.equal(readCheckoutIntent({planId:'p',key:'0123456789abcdef',returnPath:'//evil.test',locale:'en',createdAt:Date.now()}),undefined);
 for(const price of [{amount:'NaN',interval:'month',intervalCount:1},{amount:'1.111',interval:'month',intervalCount:1},{amount:'12',interval:'month',intervalCount:0},{amount:'12'}])assert.equal(readCatalog({...catalog,plans:[{...plan,price}]}),undefined);
});
test('a canceled session read cannot replace a newer account or bind its checkout intent to the previous owner',async()=>{
 const intents=storage();let release!:(response:Response)=>void,reads=0,accounts=0;
 const oldSession=new Promise<Response>(resolve=>{release=resolve;});
 const store=new PaymentStore(async url=>{
  const path=String(url);
  if(path.endsWith('get-session'))return ++reads===1?oldSession:json({user:{id:'current-owner'}});
  if(path.endsWith('/account')){accounts++;return json({orders:[],portalAvailable:true});}
  if(path.endsWith('/checkout'))return json({error:'provider_unavailable'},503);
  return json(catalog);
 },()=>assert.fail('the current session is verified'),()=>assert.fail('failed checkout must not navigate'),()=> 'en',{intents});
 const previous=store.reload();store.leave();await store.reload();
 release(json({user:{id:'previous-owner'}}));await previous;
 assert.equal(accounts,1,'a canceled read must not start a private billing request');
 await store.checkout('pro');
 assert.equal(intents.read()?.userId,'current-owner','late results must not corrupt the owner binding');
 assert.equal(store.getSnapshot().auth,'signed-in');
});
