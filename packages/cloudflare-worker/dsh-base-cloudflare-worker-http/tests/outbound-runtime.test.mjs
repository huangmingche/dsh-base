/** Real workerd fetch to Miniflare's outbound fixture, not injected JS fetch stubs. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),app=root+'apps/web';
const require=createRequire(app+'/package.json');const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=createRequire(realpathSync(app+'/node_modules/@cloudflare/vite-plugin/package.json'))('miniflare');
const source=(name,file='index.ts')=>JSON.stringify(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-'+name+'/src/'+file);
test('native Worker fetch supports all provider paths and never follows credential-bearing redirects',{timeout:60000},async t=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const code=`import {NewsletterProvider} from ${source('newsletter','provider.ts')};
 import {verifyPublicForm} from ${source('http','public-form.ts')};
 import {sendProvider} from ${source('email','providers.ts')};
 import {createNotificationTransport} from ${source('notifications','provider.ts')};
 import {providerFor} from ${source('payment-waffo','provider.ts')};
 import {createAnalyticsHandler} from ${source('google-analytics')};
 import {resolveDeploymentSiteSettings} from ${JSON.stringify(root+'packages/boot/dsh-base-site-config/src/settings.ts')};
 export default {async fetch(request,env){const path=new URL(request.url).pathname;try{
  if(path==='/newsletter'){await new NewsletterProvider('fixture-secret',fetch).set('alice@example.test',true);return Response.json({ok:true});}
  if(path==='/newsletter-status')return Response.json({subscribed:await new NewsletterProvider('fixture-secret',fetch).status('alice@example.test')});
  if(path==='/turnstile'){await verifyPublicForm(request,env,'contact',crypto.randomUUID());return Response.json({ok:true});}
  if(path==='/email')return Response.json({outcome:await sendProvider({provider:'resend',endpoint:'https://api.resend.com/emails',secret:'fixture'}, {to:'alice@example.test',from:'sender@example.test',subject:'Fixture',text:'Fixture',html:'Fixture'},'fixture',(input,init)=>fetch(input,init))});
  if(path==='/discord')return Response.json({outcome:await createNotificationTransport()({channel:'discord',url:'https://discord.com/api/webhooks/123/token'},{eventType:'order.completed',orderId:'ORD_test',planId:'pro',status:'completed',refunded:false})});
  if(path.startsWith('/waffo')){const provider=providerFor({merchantId:'MER_1234567890abcdefghijkl',storeId:'STO_1234567890abcdefghijkl',privateKey:env.PRIVATE_KEY,environment:'test'});
   if(path==='/waffo-portal')return Response.json(await provider.portal('alice'));
   if(path==='/waffo-checkout')return Response.json(await provider.checkout({userId:'alice',email:'alice@example.test',plan:{id:'pro',productId:'PROD_1234567890abcdefghijkl',type:'one_time',currency:'USD'},reference:'fixture',returnUrl:'https://localhost/'}));
   return Response.json({id:(await provider.snapshot('ORD_fixture','one_time')).id});}
  if(path==='/ga'){const values=resolveDeploymentSiteSettings({SITE_BRAND_NAME:'Fixture'});values.analytics={google:{enabled:true,measurementId:'G-TEST1234'}};const handler=createAnalyticsHandler({async read(){return {values,revision:0,source:'deployment'};}});return handler(new Request('https://localhost/api/site-analytics/google',{method:'POST',headers:{origin:'https://localhost','content-type':'application/json'},body:JSON.stringify({path:'/'})}),{GOOGLE_ANALYTICS_API_SECRET:'fixture-secret',SITE_ANALYTICS_LIMITER:{async limit(){return {success:true};}}});}
  return new Response('missing',{status:404});}catch{return new Response('provider failed',{status:503});}}};`;
 const built=await build({stdin:{contents:code,resolveDir:app,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',nodePaths:[app+'/node_modules'],external:['crypto','node:*'],logLevel:'silent'});
 let redirect=false,unexpected=0,waffoStatus=200;const requests=[];
 const outboundService=async request=>{const url=new URL(request.url);requests.push(url.hostname+url.pathname);
  if(url.hostname==='evil.example'){unexpected++;return Response.json({id:'stolen'});}
  if(redirect)return new Response(null,{status:307,headers:{location:'https://evil.example/steal'}});
  if(url.hostname==='challenges.cloudflare.com')return Response.json({success:true,hostname:'localhost',action:'contact'});
  if(url.hostname==='api.resend.com'){
   if(url.pathname==='/emails')return Response.json({id:'email-accepted'});
   if(url.pathname.startsWith('/contacts/')&&request.method==='PATCH')return new Response(null,{status:404});
   if(url.pathname==='/contacts'&&request.method==='POST')return Response.json({id:'contact-created'},{status:201});
   if(url.pathname.startsWith('/contacts/')&&request.method==='GET')return Response.json({email:'alice@example.test',unsubscribed:false});
  }
  if(url.hostname==='discord.com')return Response.json({id:'123456'});
  if(url.hostname==='www.google-analytics.com')return new Response(null,{status:204});
  if(url.hostname==='api.waffo.ai'){
   const data=url.pathname==='/v1/graphql'?{onetimeOrder:{id:'ORD_fixture',status:'completed',testMode:true,store:{id:'STO_fixture'},merchantProvidedBuyerIdentity:'alice',orderMerchantExternalId:'checkout',priceSnapshot:{currency:'USD'},onetimeProduct:{id:'PROD_fixture'},payments:[]}}:
    url.pathname==='/v1/actions/auth/issue-session-token'?{token:'fixture',portalUrl:'https://pancake.waffo.ai/consumer/portal/store/STO_fixture'}:
    {sessionId:'fixture',checkoutUrl:'https://pancake.waffo.ai/store/fixture/checkout/fixture'};
   return Response.json({data},{status:waffoStatus,headers:waffoStatus<400?{location:'https://evil.example/steal'}:{}});
  }
  throw new Error('unexpected outbound '+url.hostname);
 };
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'providers',script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:{AUTH_DB:'outbound'},bindings:{PRIVATE_KEY:keys.privateKey,AUTH_BASE_URL:'https://localhost',TURNSTILE_SITE_KEY:'fixture-site-key',TURNSTILE_SECRET_KEY:'fixture-secret-key'},outboundService}]}));
 try{
  const db=await mf.getD1Database('AUTH_DB');for(const sql of readFileSync(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-http/schema.sql','utf8').split(';').filter(v=>v.trim()))await db.prepare(sql).run();
  const call=path=>mf.dispatchFetch('https://localhost'+path,{method:'POST',headers:{origin:'https://localhost'}});
  await t.test('actual signed/provider/challenge fetches succeed through the native runtime',async()=>{
   for(const path of ['/newsletter','/newsletter-status','/turnstile','/email','/discord','/waffo','/waffo-checkout','/waffo-portal']){const response=await call(path);assert.equal(response.status,200,path+': '+await response.clone().text());}
   assert.equal((await call('/ga')).status,204);
   assert.ok(requests.includes('api.resend.com/contacts'),'PATCH 404 legitimately creates a new contact');
  });
  await t.test('Waffo rejects non-2xx responses even when their data envelopes look successful',async()=>{
   for(const status of [301,307,400,403,429,500,503]){
    waffoStatus=status;
    for(const path of ['/waffo','/waffo-checkout','/waffo-portal'])assert.equal((await call(path)).status,503,path+' HTTP '+status);
   }
   waffoStatus=200;assert.equal(unexpected,0);
  });
  await t.test('redirect responses cannot forward API secrets or challenge credentials',async()=>{
   redirect=true;
   for(const path of ['/newsletter','/newsletter-status','/turnstile','/waffo'])assert.equal((await call(path)).status,503,path);
   assert.deepEqual(await(await call('/email')).json(),{outcome:'unknown'});
   assert.deepEqual(await(await call('/discord')).json(),{outcome:'uncertain'});
   assert.equal((await call('/ga')).status,502);assert.equal(unexpected,0);
  });
 }finally{await mf.dispose();}
});
