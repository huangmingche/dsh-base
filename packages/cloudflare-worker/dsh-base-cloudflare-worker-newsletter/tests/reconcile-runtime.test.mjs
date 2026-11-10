import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),app=root+'apps/web';
const {build}=createRequire(app+'/package.json')('esbuild');
const {Miniflare,convertV4MiniflareOptions}=createRequire(realpathSync(app+'/node_modules/@cloudflare/vite-plugin/package.json'))('miniflare');
test('administrator reconciliation unlocks only settled, version-matched newsletter operations',{timeout:60000},async t=>{
 const built=await build({stdin:{resolveDir:app,loader:'ts',contents:`import {createNewsletterHandler} from ${JSON.stringify(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-newsletter/src/index.ts')};
 export default {fetch(request,env){const auth={async session(){const id=request.headers.get('x-user');return id?{id,email:id+'@example.test',username:id,emailVerified:request.headers.get('x-unverified')!=='true'}:undefined;}};
 const mail={ready(){return false;}};return createNewsletterHandler(auth,mail)(request,env);}};`},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',logLevel:'silent'});
 let subscribed=true,fail=false;const calls=[];
 const outboundService=async request=>{calls.push(request.method);if(fail)return new Response(null,{status:503});
  if(request.method==='GET')return Response.json({email:'alice@example.test',unsubscribed:!subscribed});
  if(request.method==='PATCH'){subscribed=!(await request.json()).unsubscribed;return Response.json({id:'contact'});}throw new Error('unexpected provider write');};
 const mf=new Miniflare(convertV4MiniflareOptions({workers:['a','b'].map(name=>({name,script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-30',d1Databases:{AUTH_DB:'consent'},bindings:{NEWSLETTER_ENABLED:'true',AUTH_BASE_URL:'https://localhost',RESEND_API_KEY:'fixture-secret',SITE_ADMIN_USER_IDS:'["admin"]'},outboundService}))}));
 try{
  const db=await mf.getD1Database('AUTH_DB','a');for(const sql of readFileSync(root+'packages/cloudflare-worker/dsh-base-cloudflare-worker-newsletter/schema.sql','utf8').replace(/--[^\n]*/g,'').split(';').filter(v=>v.trim()))await db.prepare(sql).run();
  const a=await mf.getWorker('a'),b=await mf.getWorker('b');
  const req=(path='/reconcile',body,user='admin',method=body===undefined?'GET':'POST',headers={})=>new Request('https://localhost/api/saas/newsletter'+path,{method,headers:{...(user?{'x-user':user}:{}),origin:'https://localhost',...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const seed=async(state='confirming',revision=2,at=Date.now()-61000)=>db.prepare(`INSERT INTO dsh_newsletter_consent (email,token_hash,state,consent_at,expires_at,revision,operation_at)
   VALUES ('alice@example.test','token',?,?,?, ?,?) ON CONFLICT(email) DO UPDATE SET state=excluded.state,revision=excluded.revision,operation_at=excluded.operation_at`).bind(state,Date.now(),Date.now()+86400000,revision,at).run();
  const input=revision=>({email:'alice@example.test',expectedRevision:revision,reviewedProvider:true});
  await t.test('untrusted callers and active operations cannot use recovery',async()=>{
   assert.equal((await a.fetch(req('/reconcile',undefined,null))).status,401);assert.equal((await a.fetch(req('/reconcile',undefined,'alice'))).status,403);
   await seed('confirming',2,Date.now());
   const list=await(await a.fetch(req())).json();assert.equal(list.items[0].reconcilable,false);assert.ok(!JSON.stringify(list).includes('token_hash'));
   assert.equal((await a.fetch(req('/reconcile',{...input(2),reviewedProvider:false}))).status,400);
   assert.equal((await a.fetch(req('/reconcile',input(2)))).status,409);
   assert.equal((await a.fetch(req('/reconcile',input(2),'admin','POST',{origin:'https://evil.test'}))).status,403);
   assert.equal(calls.length,0);
  });
  await t.test('concurrent recovery reads provider truth but only one revision can commit',async()=>{
   await seed();calls.length=0;const responses=await Promise.all([a.fetch(req('/reconcile',input(2))),b.fetch(req('/reconcile',input(2)))]);
   assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.ok(calls.every(method=>method==='GET'));
   const row=await db.prepare('SELECT state,revision,operation_at FROM dsh_newsletter_consent').first();assert.deepEqual(row,{state:'confirmed',revision:3,operation_at:0});
   const stale=await db.prepare("UPDATE dsh_newsletter_consent SET state='revoked' WHERE email='alice@example.test' AND state='confirming' AND revision=2").run();assert.equal(stale.meta.changes,0);
  });
  await t.test('provider failure leaves the lock intact and unsubscribe is independent of email/Turnstile readiness',async()=>{
   await seed('unsubscribing',4);fail=true;assert.equal((await a.fetch(req('/reconcile',input(4)))).status,503);assert.equal((await db.prepare('SELECT state FROM dsh_newsletter_consent').first()).state,'unsubscribing');
   fail=false;subscribed=true;assert.equal((await a.fetch(req('/reconcile',input(4)))).status,200);
   assert.equal((await a.fetch(req('',undefined,'alice','DELETE',{'x-unverified':'true'}))).status,403);
   assert.equal((await a.fetch(req('',undefined,'alice','DELETE'))).status,200);assert.equal(subscribed,false);
   assert.equal((await db.prepare('SELECT state FROM dsh_newsletter_consent').first()).state,'revoked');
   assert.deepEqual(await(await a.fetch(req('',undefined,'alice'))).json(),{subscribed:false});
  });
 }finally{await mf.dispose();}
});
