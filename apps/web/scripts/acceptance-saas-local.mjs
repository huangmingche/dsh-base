#!/usr/bin/env node
/** Full composed app, real auth/D1/R2/KV, temporary accounts, no external services. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acceptanceLaunchOptions, closeAcceptanceBrowser } from './acceptance-config.mjs';
import { pluginSchemas, applyPluginSchema } from './plugin-schemas.mjs';
import { readOwnedPluginInventory } from '../tests/parity/owned-plugin-inventory-oracle.mjs';

const app=resolve(import.meta.dirname,'..'),root=resolve(app,'../..');
const artifacts=resolve(process.env.DSH_ACCEPTANCE_OUTPUT??join(root,'.artifacts/acceptance/saas-local'));
mkdirSync(artifacts,{recursive:true});
const output=join(app,'.cloudflare/output/v0/workers/default'),config=JSON.parse(readFileSync(join(output,'worker.config.json'),'utf8'));
const {Miniflare,convertV4MiniflareOptions}=createRequire(realpathSync(join(app,'node_modules/@cloudflare/vite-plugin/package.json')))('miniflare');
const directory=mkdtempSync(join(tmpdir(),'dsh-saas-')),port=Number(process.env.DSH_LOCAL_PORT??5199),base=`http://127.0.0.1:${port}`;
const registrationToken=randomBytes(32).toString('base64url');
const bindings=Object.fromEntries(Object.entries(config.env).filter(([,row])=>row.type==='text').map(([key,row])=>[key,row.value]));
Object.assign(bindings,{AUTH_BASE_URL:base,AUTH_SECRET:randomBytes(32).toString('hex'),CREDENTIALS_KEY:randomBytes(32).toString('base64'),AUTH_SIGNUP_ENABLED:'false',AUTH_REGISTRATION_TOKEN:registrationToken,SITE_ADMIN_USER_IDS:'[]',PLATFORM_AI_ENABLED:'false',USER_ADMIN_ENABLED:'true',API_KEYS_ENABLED:'true',FILES_ENABLED:'true',WAFFO_ENABLED:'false',EMAIL_ENABLED:'false',AUTH_GOOGLE_ENABLED:'false',NEWSLETTER_ENABLED:'false',CONTACT_ENABLED:'false',NOTIFICATIONS_ENABLED:'false',CRISP_ENABLED:'false',CACHE_ENABLED:'false'});
const bundles=['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard'];
const expectedInventory=readOwnedPluginInventory();
const expectedWorkers=expectedInventory.rows.filter(row=>row.plane==='worker').map(({entryId,moduleName,enabled,fiberPhase,origin})=>({entryId,moduleName,enabled,fiberPhase,origin}));
const sortEntries=rows=>[...rows].sort((a,b)=>a.entryId.localeCompare(b.entryId));
const report={ok:false,realAuth:true,bundles:[],checks:[],browserErrors:[],outboundRequests:[],anonymousFailures:[],mockedProviders:[],formPhase:false};
const mailMessages=[],contacts=new Map();
async function outbound(request){const url=new URL(request.url);if(report.formPhase){report.mockedProviders.push({host:url.hostname,path:url.pathname.startsWith('/contacts')?'/contacts':url.pathname,method:request.method});if(url.hostname==='challenges.cloudflare.com'&&url.pathname==='/turnstile/v0/siteverify'){const body=await request.json(),action=/^fixture\.(contact|newsletter)\.\d+$/u.exec(body.response)?.[1];return Response.json({success:!!action,hostname:'127.0.0.1',action});}if(url.hostname==='api.resend.com'){if(url.pathname==='/emails'&&request.method==='POST'){mailMessages.push(await request.json());return Response.json({id:randomBytes(12).toString('hex')});}if(url.pathname.startsWith('/contacts/')&&request.method==='PATCH')return Response.json({message:'Not found'},{status:404});if(url.pathname==='/contacts'&&request.method==='POST'){const body=await request.json();contacts.set(body.email,body);return Response.json({id:randomBytes(12).toString('hex')});}}}report.outboundRequests.push(url.origin);return new Response('External services disabled during acceptance',{status:503});}
const options=()=>convertV4MiniflareOptions({host:'127.0.0.1',port,modulesRoot:join(output,'bundle'),modules:['index.js',...readdirSync(join(output,'bundle'),{recursive:true}).filter(file=>file.endsWith('.js')&&file!=='index.js')].map(file=>({type:'ESModule',path:join(output,'bundle',file)})),compatibilityDate:'2026-10-30',compatibilityFlags:config.compatibilityFlags,bindings,
  outboundService:outbound,
  durableObjects:Object.fromEntries(Object.entries(config.env).filter(([,row])=>row.type==='durable-object').map(([name,row])=>[name,{className:row.exportName,useSQLite:true}])),durableObjectsPersist:join(directory,'do'),d1Databases:['AUTH_DB'],d1Persist:join(directory,'d1'),r2Buckets:['FILES'],r2Persist:join(directory,'r2'),kvNamespaces:['CACHE'],kvPersist:join(directory,'kv'),
  assets:{directory:join(output,'assets'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'single-page-application'}}});
const request=(path,init={})=>fetch(base+path,{...init,signal:AbortSignal.timeout(25000)});
async function register(label){const id=randomBytes(8).toString('hex');const response=await request('/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'content-type':'application/json','x-dsh-registration-token':registrationToken},body:JSON.stringify({username:`saas${id}`,email:`saas${id}@example.test`,name:label,password:randomBytes(24).toString('base64url')})});assert.equal(response.status,200,await response.clone().text());const body=await response.json(),cookie=response.headers.getSetCookie().find(value=>value.includes('session_token='))?.split(';')[0];assert.ok(cookie);const divider=cookie.indexOf('=');return{id:body.user.id,cookie,cookieName:cookie.slice(0,divider),cookieValue:cookie.slice(divider+1)};}
let mf,browser,page;
async function clickText(selector,text){const handle=await page.evaluateHandle(({selector,text})=>[...document.querySelectorAll(selector)].find(element=>element.textContent.trim()===text&&element.getBoundingClientRect().width>0)??null,{selector,text});assert.ok(handle.asElement(),`missing ${selector}: ${text}`);try{await handle.asElement().click();}finally{await handle.dispose();}}
const panel=id=>id==='waffo'?'[data-waffo-panel]':id==='email'?'[data-email-panel]':id==='crisp'?'[data-crisp-panel]':`[data-saas-panel="dsh-base:${id}"]`;
async function openBundle(id){if(await page.$('[data-plugin-detail]'))await page.click('[data-plugin-detail] [data-window-drag] > button');await page.waitForSelector(`[data-plugin-package="dsh-base:${id}"]`);await page.click(`[data-plugin-package="dsh-base:${id}"] button[aria-describedby]`);await page.waitForFunction(selector=>{const element=document.querySelector(selector);return element&&!['idle','loading'].includes(element.dataset.state);},{},panel(id));assert.notEqual(await page.$eval(panel(id),element=>element.dataset.state),'error',`${id} loads in composed app`);}
async function newPage(auth){const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(30000);if(report.formPhase)await page.evaluateOnNewDocument(()=>{let count=0;window.__widgetActions=[];window.turnstile={render(_element,options){const id=String(++count);window.__widgetActions.push(options.action);queueMicrotask(()=>options.callback(`fixture.${options.action}.${id}`));return id;},remove(){}};});page.on('pageerror',error=>report.browserErrors.push(error.message));await page.setViewport({width:1280,height:900});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]);if(auth)await page.setCookie({name:auth.cookieName,value:auth.cookieValue,url:base,httpOnly:true,secure:false,sameSite:'Lax'});await page.goto(base,{waitUntil:'domcontentloaded'});if(!auth){await page.waitForSelector('[data-auth-dialog]',{visible:true});return context;}await page.waitForFunction(()=>window.__DSH_BASE_PLUGINS__?.filter(row=>row.enabled).every(row=>row.fiberPhase==='active'));await page.waitForFunction(()=>document.querySelector('[data-plugin-panel]')!==null||document.querySelector('[contenteditable]')!==null);if(auth)await page.waitForFunction(()=>/\/app\/session\/[^/]+/u.test(location.pathname)&&document.querySelector('[contenteditable="true"]'));if(!await page.$('[data-plugin-panel]'))await page.click('button[aria-label="Plugins"]');await page.waitForSelector('[data-plugin-package="dsh-base:waffo"]');return context;}
async function fill(selector,value){const element=await page.waitForSelector(selector,{visible:true});await element.evaluate(node=>{node.focus();node.select();});await page.keyboard.type(value);}
async function action(selector,path,method='POST'){const reply=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()===method);await page.click(selector);const response=await reply;assert.ok(response.ok(),`${method} ${path}: ${response.status()}`);return response.status();}

try{
  mf=new Miniflare(options());await mf.ready;const database=await mf.getD1Database('AUTH_DB');
  for(const file of readdirSync(join(app,'migrations')).filter(name=>name.endsWith('.sql')).sort())for(const sql of readFileSync(join(app,'migrations',file),'utf8').replace(/--[^\n]*/g,'').split(';').filter(value=>value.trim()))await database.prepare(sql).run();
  for(let pass=0;pass<2;pass++)for(const schema of pluginSchemas(root))await applyPluginSchema(schema,async sql=>(await database.prepare(sql).all()).results);
  report.checks.push('all plugin schemas are additive and repeatable');
  const admin=await register('SaaS administrator'),reader=await register('SaaS member');bindings.SITE_ADMIN_USER_IDS=JSON.stringify([admin.id]);await mf.setOptions(options());await mf.ready;
  const inventory=await request('/api/plugin-manager/inventory',{headers:{cookie:admin.cookie}});assert.equal(inventory.status,200);
  report.workerFibers=(await inventory.json()).entries.map(({entryId,moduleName,enabled,fiberPhase,origin})=>({entryId,moduleName,enabled,fiberPhase,origin}));
  assert.deepEqual(sortEntries(report.workerFibers),sortEntries(expectedWorkers),'every declared Worker has its expected origin and active fiber');
  for(const row of report.workerFibers){assert.equal(row.enabled,true,row.moduleName);assert.equal(row.fiberPhase,'active',row.moduleName);assert.ok(['custom','fork'].includes(row.origin),row.moduleName);}
  for(const id of bundles){const name=`@dsh-base/cloudflare-worker-${id==='waffo'?'payment-waffo':id==='dashboard'?'operations-dashboard':id}`;assert.equal(report.workerFibers.find(row=>row.moduleName===name)?.origin,'custom',name);}
  assert.equal((await request('/api/plugin-manager/inventory')).status,401);report.checks.push(`all ${expectedWorkers.length} actual Worker fibers are active with correct origins, including all 14 SaaS plugins; anonymous runtime inventory stays private`);
  browser=await puppeteer.launch(acceptanceLaunchOptions());const anonymous=await newPage();
  page.on('response',response=>{if([401,403,500].includes(response.status()))report.anonymousFailures.push({path:new URL(response.url()).pathname,status:response.status()});});
  assert.equal(await page.$('[data-plugin-panel]'),null,'the plugin catalog is account-scoped');
  assert.deepEqual(report.anonymousFailures,[]);
  await anonymous.close();
  const context=await newPage(admin);
  const installed=await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]',nodes=>nodes.map(node=>node.dataset.pluginPackage));assert.deepEqual(installed.sort(),expectedInventory.bundles.map(row=>row.name).sort(),'every declared bundle is visible');
  report.fibers=await page.evaluate(ids=>(window.__DSH_BASE_PLUGINS__??[]).filter(row=>ids.includes(row.moduleName)).map(row=>({name:row.moduleName,origin:row.origin,phase:row.fiberPhase,enabled:row.enabled})),bundles.map(id=>`@dsh-base/client-${id}`));
  assert.equal(report.fibers.length,14);for(const fiber of report.fibers){assert.equal(fiber.origin,'custom',fiber.name);assert.equal(fiber.phase,'active',fiber.name);assert.equal(fiber.enabled,true,fiber.name);}
  for(const id of bundles){await openBundle(id);report.bundles.push({id,administratorState:await page.$eval(panel(id),element=>element.dataset.state)});}
  await openBundle('account-profile');await fill('[data-saas-action="name"] input','Updated SaaS profile');await action('[data-saas-action="name"] button','/api/saas/account-profile','PUT');
  assert.equal((await(await request('/api/saas/account-profile',{headers:{cookie:admin.cookie}})).json()).user.name,'Updated SaaS profile');
  await openBundle('files');const upload=join(directory,'owned-file.txt');writeFileSync(upload,'Private SaaS file');await(await page.$('[data-saas-action="upload"] input[type="file"]')).uploadFile(upload);
  await action('[data-saas-action="upload"] button','/api/saas/files');const fileId=(await(await request('/api/saas/files',{headers:{cookie:admin.cookie}})).json()).items.find(file=>file.name==='owned-file.txt').id;await page.waitForSelector(`[data-saas-row="${fileId}"]`);
  assert.equal(await(await request(`/api/saas/files/${fileId}`,{headers:{cookie:admin.cookie}})).text(),'Private SaaS file');
  assert.equal((await request(`/api/saas/files/${fileId}`,{headers:{cookie:reader.cookie}})).status,404);
  await action(`[data-saas-action="delete:${fileId}"] button`,`/api/saas/files/${fileId}`,'DELETE');await page.waitForSelector(`[data-saas-row="${fileId}"]`,{hidden:true});
  await openBundle('api-keys');await fill('[data-saas-action="create"] input','Acceptance key');await action('[data-saas-action="create"] button','/api/api-keys');
  await page.waitForSelector('[data-saas-result] input');const created={secret:await page.$eval('[data-saas-result] input',element=>element.value),key:(await(await request('/api/api-keys',{headers:{cookie:admin.cookie}})).json()).keys.find(key=>key.name==='Acceptance key')};assert.ok(created.secret.startsWith('dsh_'));assert.ok(created.key);
  const who=await request('/api/api-keys/whoami',{headers:{authorization:`Bearer ${created.secret}`}});assert.equal(who.status,200);assert.equal((await who.json()).id,admin.id);
  await openBundle('email');await openBundle('api-keys');assert.equal(await page.$('[data-saas-result]'),null,'leaving clears one-time key secret');
  await action(`[data-saas-action="revoke:${created.key.id}"] button`,`/api/api-keys/${created.key.id}`,'DELETE');assert.equal((await request('/api/api-keys/whoami',{headers:{authorization:`Bearer ${created.secret}`}})).status,401);
  report.checks.push('real profile save; private R2 upload/download/delete and cross-owner denial; scoped API-key create/use/revoke and one-time secret cleanup');
  await openBundle('user-admin');assert.equal(await page.$eval(panel('user-admin'),element=>element.dataset.state),'ready');await page.screenshot({path:join(artifacts,'administrator-users.png'),captureBeyondViewport:false});
  await openBundle('dashboard');assert.equal(await page.$eval(panel('dashboard'),element=>element.dataset.state),'ready');await page.screenshot({path:join(artifacts,'administrator-dashboard.png'),captureBeyondViewport:false});
  for(const path of ['/api/user-admin/users','/api/operations-dashboard']){assert.equal((await request(path,{headers:{cookie:reader.cookie}})).status,403);assert.equal((await request(path)).status,401);}
  report.checks.push('user management and real operations counters load for explicit administrator only');
  await context.close();
  // Exercise configured public forms through the actual composed browser and Worker.
  // Only the provider boundary and vendor challenge widget are controlled fixtures.
  Object.assign(bindings,{EMAIL_ENABLED:'true',EMAIL_PROVIDER:'resend',EMAIL_FROM:'no-reply@example.test',RESEND_API_KEY:'test-provider-secret',NEWSLETTER_ENABLED:'true',CONTACT_ENABLED:'true',CONTACT_SUPPORT_EMAIL:'support@example.test',TURNSTILE_SITE_KEY:'test-public-site-key',TURNSTILE_SECRET_KEY:'test-private-site-key'});
  report.formPhase=true;await mf.setOptions(options());await mf.ready;const formDatabase=await mf.getD1Database('AUTH_DB');const formContext=await newPage(reader);
  await openBundle('contact');await fill('[data-saas-action="contact"] input[type="text"]','Test visitor');await fill('[data-saas-action="contact"] input[type="email"]','visitor@example.test');await fill('[data-saas-action="contact"] textarea','A safe test message for the support team.');
  await page.waitForFunction(()=>!document.querySelector('[data-saas-action="contact"] button[type="submit"]').disabled);await action('[data-saas-action="contact"] button[type="submit"]','/api/saas/contact');assert.equal(mailMessages.length,1);assert.equal(mailMessages[0].to,'support@example.test');
  await openBundle('newsletter');await fill('[data-saas-action="subscribe"] input[type="email"]','subscriber@example.test');await page.click('[data-saas-action="subscribe"] [role="switch"]');await page.waitForFunction(()=>!document.querySelector('[data-saas-action="subscribe"] button[type="submit"]').disabled);await action('[data-saas-action="subscribe"] button[type="submit"]','/api/saas/newsletter/subscribe');
  assert.equal(mailMessages.length,2);assert.equal(contacts.size,0,'submitting consent does not subscribe before email confirmation');report.widgetActions=await page.evaluate(()=>window.__widgetActions);assert.ok(report.widgetActions.includes('contact'));assert.ok(report.widgetActions.includes('newsletter'));
  const token=mailMessages[1].html.match(/newsletterToken=([a-f0-9]{64})/u)?.[1];assert.ok(token);await page.deleteCookie({name:reader.cookieName,url:base});await page.goto(`${base}/?newsletterToken=${token}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('[role="dialog"]',{visible:true});assert.equal(contacts.size,0,'opening the email link does not change consent');
  const confirmation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/saas/newsletter/confirm'&&response.request().method()==='POST');await clickText('[role="dialog"] button','Confirm');assert.equal((await confirmation).status(),200);await page.waitForSelector('[data-auth-dialog]',{visible:true});assert.equal(new URL(page.url()).searchParams.has('newsletterToken'),false);assert.ok(contacts.has('subscriber@example.test'));assert.equal((await formDatabase.prepare('SELECT state FROM dsh_newsletter_consent WHERE email=?').bind('subscriber@example.test').first()).state,'confirmed');
  await formContext.close();report.checks.push('configured contact and newsletter forms bind correct Turnstile actions, deliver only through mocked providers, and require an explicit email-confirmation click');
  assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.outboundRequests,[]);report.ok=true;console.log(JSON.stringify({ok:true,bundles:report.bundles.length,checks:report.checks,artifacts}));
}catch(error){report.failure=String(error?.stack??error);await page?.screenshot({path:join(artifacts,'failure.png'),captureBeyondViewport:false}).catch(()=>{});throw error;}
finally{await closeAcceptanceBrowser(browser);await mf?.dispose();rmSync(directory,{recursive:true,force:true});writeFileSync(join(artifacts,'report.json'),JSON.stringify(report,null,2));}
