/** Real Worker/D1/R2/KV regression; all outbound vendor traffic is a fixture. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPluginSchema, pluginSchemas } from '../../scripts/plugin-schemas.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url)), app = join(root, 'apps/web');
const {build} = createRequire(join(app, 'package.json'))('esbuild');
const {Miniflare, convertV4MiniflareOptions} = createRequire(realpathSync(join(app, 'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const src = name => JSON.stringify(join(root, `packages/cloudflare-worker/dsh-base-cloudflare-worker-${name}/src/index.ts`));
test('SaaS owner boundaries, quota concurrency, consent and provider failures in workerd', {timeout: 120000}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-saas-')), bundle = join(directory, 'worker.mjs');
  const buildResult = await build({stdin: {resolveDir: app, loader: 'ts', contents: `
    import {createFilesHandler} from ${src('files')};
    import {createProfileHandler} from ${src('account-profile')};
    import {createPublicCache,createCacheHandler} from ${src('cache')};
    import {createContactHandler} from ${src('contact')};
    import {createNewsletterHandler} from ${src('newsletter')};
    import {createEmailService} from ${src('email')};
    import {crispConfig} from ${src('crisp')};
    const auth={async session(request,env){const id=request.headers.get('x-fixture-user'); if(!id)return undefined;
      const user=await env.AUTH_DB.prepare('SELECT * FROM user WHERE id = ?').bind(id).first();return user?{...user,emailVerified:!!user.emailVerified}:undefined;},
      async handle(request){const body=await request.json();return Response.json({delegated:body.revokeOtherSessions===true},{status:body.currentPassword==='correct-password'?200:400});}};
    const email=createEmailService(); const cache=createPublicCache();
    const handlers=[createFilesHandler(auth),createProfileHandler(auth),createCacheHandler(auth,cache),createContactHandler(email),createNewsletterHandler(auth,email)];
    export default {async fetch(request,env){
      if(new URL(request.url).pathname==='/fixture/cache'){const {key,value,ttl}=await request.json();try{await cache.put(env,key,value,ttl);return Response.json(await cache.get(env,key));}catch(e){return Response.json({error:e.message},{status:e.status??503});}}
      if(new URL(request.url).pathname==='/fixture/crisp')return Response.json(crispConfig(env));
      for(const handler of handlers){const response=await handler(request,env);if(response)return response;}return new Response('',{status:404});
    }};`}, bundle:true, write:false, format:'esm', platform:'neutral', target:'es2022', logLevel:'silent', nodePaths:[join(app,'node_modules')]});
  writeFileSync(bundle, buildResult.outputFiles[0].text);
  const messages=[], contacts=new Map(); let contactWrites=0;
  const outboundService=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://challenges.cloudflare.com'){
      const body=await request.json(); return Response.json({success:body.response!=='bad',hostname:body.response==='wrong-host'?'attacker.test':'localhost',action:body.response.startsWith('contact')?'contact':'newsletter'});
    }
    if(url.origin==='https://api.resend.com'&&url.pathname==='/emails'){const body=await request.json();messages.push(body);return Response.json({id:crypto.randomUUID()});}
    if(url.origin==='https://api.resend.com'&&url.pathname.startsWith('/contacts')){
      const email=decodeURIComponent(url.pathname.slice('/contacts/'.length));
      if(request.method==='GET')return contacts.has(email)?Response.json({unsubscribed:!contacts.get(email)}):new Response('',{status:404});
      if(request.method==='PATCH'){if(!contacts.has(email))return new Response('',{status:404});const body=await request.json();contactWrites++;contacts.set(email,!body.unsubscribed);return Response.json({id:'contact'});}
      if(request.method==='POST'){const body=await request.json();contactWrites++;contacts.set(body.email,!body.unsubscribed);return Response.json({id:'contact'});}
    }
    throw new Error(`Unexpected fixture outbound host ${url.hostname}`);
  };
  const bindings={AUTH_BASE_URL:'https://localhost',FILES_ENABLED:'true',CACHE_ENABLED:'true',SITE_ADMIN_USER_IDS:'["admin"]',
    EMAIL_ENABLED:'true',EMAIL_PROVIDER:'resend',EMAIL_FROM:'hello@example.test',RESEND_API_KEY:'fixture-only-secret',
    NEWSLETTER_ENABLED:'true',CONTACT_ENABLED:'true',CONTACT_SUPPORT_EMAIL:'support@example.test',TURNSTILE_SITE_KEY:'fixture-public-key',TURNSTILE_SECRET_KEY:'fixture-only-secret'};
  const mf=new Miniflare(convertV4MiniflareOptions({resourcePersistencePath:join(directory,'resources'), workers:['a','b'].map(name=>({name,modulesRoot:directory,modules:[{type:'ESModule',path:bundle}],compatibilityDate:'2026-10-30',bindings,
    d1Databases:{AUTH_DB:'shared'},r2Buckets:{FILES:'shared-files'},kvNamespaces:{CACHE:'shared-cache'},outboundService}))}));
  try {
    const db=await mf.getD1Database('AUTH_DB','a');
    for(const file of ['0001_better_auth.sql','0002_username_password.sql'])for(const statement of readFileSync(join(app,'migrations',file),'utf8').replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
    for(const schema of pluginSchemas().filter(row=>['http','files','email','newsletter'].some(name=>row.name===`@dsh-base/cloudflare-worker-${name}`)))await applyPluginSchema(schema,async sql=>(await db.prepare(sql).all()).results);
    for(const id of ['alice','bob','admin'])await db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,username) VALUES (?,?,?,1,?,?,?)').bind(id,id,`${id}@example.test`,Date.now(),Date.now(),id).run();
    const workers=[await mf.getWorker('a'),await mf.getWorker('b')]; let i=0;
    const call=async(path,method='GET',body,owner,headers={})=>workers[i++%2].fetch(new Request(`https://localhost${path}`,{method,headers:{origin:'https://localhost',...(owner?{'x-fixture-user':owner}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)})}));
    await t.test('anonymous and cross-owner operations fail before private reads',async()=>{
      for(const path of ['/api/saas/files','/api/saas/account-profile','/api/saas/cache','/api/saas/newsletter'])assert.equal((await call(path)).status,401);
      assert.equal((await call('/api/saas/cache','GET',undefined,'alice')).status,403);
      assert.equal((await call('/api/saas/files?name=note.txt','POST','private content','alice',{'content-type':'text/plain',origin:'https://evil.test'})).status,403);
      const uploaded=await call('/api/saas/files?name=note.txt','POST','private content','alice',{'content-type':'text/plain'});assert.equal(uploaded.status,201);
      const {file}=await uploaded.json();assert.equal((await call(file.url,'GET',undefined,'bob')).status,404);assert.equal((await call(file.url,'DELETE',undefined,'bob')).status,404);
      const own=await call(file.url,'GET',undefined,'alice');assert.equal(await own.text(),'private content');assert.match(own.headers.get('content-disposition'),/^attachment/);assert.equal(own.headers.get('cache-control'),'private, no-store');
      assert.equal((await call(`${file.url}/view`,'GET',undefined,'alice')).status,415);
      assert.equal((await call('/api/saas/files?name=unsafe.svg','POST','<svg></svg>','alice',{'content-type':'image/svg+xml'})).status,415);
      assert.equal((await call('/api/saas/files?name=fake.png','POST','<html>not a raster</html>','alice',{'content-type':'image/png'})).status,415);
      assert.equal((await call('/api/saas/files?name=../secret','POST','test','alice',{'content-type':'text/plain'})).status,400);
      assert.equal((await call('/api/saas/files?name=large','POST',new Uint8Array(10485761),'alice',{'content-type':'application/octet-stream'})).status,413);
      assert.equal((await call(file.url,'DELETE',undefined,'alice')).status,200);assert.equal((await call(file.url,'GET',undefined,'alice')).status,404);
    });
    await t.test('a primary SQL quota reservation prevents concurrent R2 over-allocation',async()=>{
      await db.prepare("INSERT INTO dsh_user_files (id,user_id,name,content_type,size,object_key,state,created_at) VALUES ('quota','bob','quota','text/plain',10485760,'quota','ready',1)").run();
      for(let n=0;n<9;n++)await db.prepare("INSERT INTO dsh_user_files (id,user_id,name,content_type,size,object_key,state,created_at) VALUES (?, 'bob','quota','text/plain',?,?,'ready',1)").bind(`quota${n}`,n===8?10485759:10485760,`quota${n}`).run();
      const results=await Promise.all([call('/api/saas/files?name=a','POST','x','bob',{'content-type':'text/plain'}),call('/api/saas/files?name=b','POST','x','bob',{'content-type':'text/plain'})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    });
    await t.test('profile only edits the signed-in owner and validates the owned avatar',async()=>{
      assert.equal((await call('/api/saas/account-profile','PUT',{name:'Updated'},'alice')).status,200);
      assert.equal((await (await call('/api/saas/account-profile','GET',undefined,'alice')).json()).user.name,'Updated');
      assert.equal((await call('/api/saas/account-profile','PUT',{name:'Admin',role:'admin'},'alice')).status,400);
      assert.equal((await call('/api/saas/account-profile','PUT',{name:'Name',avatarFileId:'quota'},'alice')).status,400);
      assert.equal((await call('/api/saas/account-profile/password','POST',{currentPassword:'wrong',newPassword:'new-password'},'alice')).status,400);
      assert.equal((await call('/api/saas/account-profile/password','POST',{currentPassword:'correct-password',newPassword:'new-password'},'alice')).status,200);
    });
    await t.test('KV only caches public namespaced values with bounded TTL and admin invalidation',async()=>{
      assert.equal((await call('/fixture/cache','POST',{key:'session:alice',value:'secret',ttl:60})).status,400);
      assert.equal((await call('/fixture/cache','POST',{key:'public:catalog',value:{count:2},ttl:1})).status,400);
      assert.deepEqual(await (await call('/fixture/cache','POST',{key:'public:catalog',value:{count:2},ttl:60})).json(),{count:2});
      assert.equal((await call('/api/saas/cache?key=public:catalog','DELETE',undefined,'alice')).status,403);
      assert.equal((await call('/api/saas/cache?key=public:catalog','DELETE',undefined,'admin')).status,200);
    });
    await t.test('contact verification checks host/action and deduplicates concurrent challenge use',async()=>{
      const body={name:'<sender>',email:'sender@example.test',message:'<img src=x onerror=alert(1)>',turnstileToken:'bad'};
      const invalid=await call('/api/saas/contact','POST',body);assert.equal(invalid.status,400,await invalid.text());
      assert.equal((await call('/api/saas/contact','POST',{...body,turnstileToken:'wrong-host'})).status,400);
      const outcomes=await Promise.all([call('/api/saas/contact','POST',{...body,turnstileToken:'contact-unique'}),call('/api/saas/contact','POST',{...body,turnstileToken:'contact-unique'})]);
      assert.deepEqual(outcomes.map(r=>r.status).sort(),[202,400]);assert.equal(messages.length,1);assert.equal(messages[0].to,'support@example.test');assert.doesNotMatch(messages[0].html,/<img|<sender>/);assert.match(messages[0].html,/&lt;img/);
    });
    await t.test('newsletter requires consent and email proof; tokens are hashed, one-use and owner-only status',async()=>{
      assert.equal((await call('/api/saas/newsletter/subscribe','POST',{email:'alice@example.test',consent:false,turnstileToken:'newsletter-a'})).status,400);
      const subscribed=await call('/api/saas/newsletter/subscribe','POST',{email:'alice@example.test',consent:true,turnstileToken:'newsletter-a'});assert.equal(subscribed.status,202,await subscribed.text());
      assert.equal(contactWrites,0,'contact is not subscribed before email confirmation');
      const token=/newsletterToken=([a-f0-9]{64})/u.exec(messages.at(-1).text)[1];
      const rows=await db.prepare('SELECT * FROM dsh_newsletter_consent').all();assert.doesNotMatch(JSON.stringify(rows),new RegExp(token));
      const confirmations = await Promise.all([
        call('/api/saas/newsletter/confirm', 'POST', {token}),
        call('/api/saas/newsletter/confirm', 'POST', {token}),
      ]);
      const statuses = confirmations.map(response => response.status);
      const diagnostic = `Concurrent confirmation statuses: ${statuses.join(', ')}`;
      assert.ok(statuses.includes(200), diagnostic);
      assert.ok(statuses.every(status => status === 200 || status === 409), diagnostic);
      assert.equal(contactWrites, 1);
      assert.equal((await (await call('/api/saas/newsletter','GET',undefined,'alice')).json()).subscribed,true);
      assert.equal((await (await call('/api/saas/newsletter','GET',undefined,'bob')).json()).subscribed,false);
      assert.equal((await call('/api/saas/newsletter','DELETE',undefined,'alice')).status,200);
      assert.equal((await call('/api/saas/newsletter/confirm','POST',{token})).status,400);assert.equal(contacts.get('alice@example.test'),false);
    });
    await t.test('unconfigured support returns no third-party identifier',async()=>{assert.deepEqual(await (await call('/fixture/crisp')).json(),{enabled:false,websiteId:null});});
    await t.test('missing D1 schema fails before sending mail or creating provider contacts',async()=>{
      await db.prepare('DROP TABLE dsh_email_deliveries').run();const count=messages.length;
      assert.equal((await call('/api/saas/newsletter/subscribe','POST',{email:'fresh@example.test',consent:true,turnstileToken:'newsletter-fresh'})).status,503);assert.equal(messages.length,count);
    });
  } finally {await mf.dispose();rmSync(directory,{recursive:true,force:true});}
});
