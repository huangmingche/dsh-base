#!/usr/bin/env node
/** Local-only real DOM verification. All provider/API traffic is intercepted. */
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {acceptanceLaunchOptions,closeAcceptanceBrowser} from '../../../../apps/web/scripts/acceptance-config.mjs';
const repo=resolve(import.meta.dirname,'../../../..'),app=resolve(repo,'apps/web'),require=createRequire(resolve(app,'package.json')),vite=await import(require.resolve('vite')),puppeteer=require('puppeteer-core');
const output=resolve(repo,'.artifacts/saas-ui-browser'),configFile=resolve(app,'vite.parity.config.ts'),root=resolve(import.meta.dirname,'browser');
const keys=['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard'];
const key={id:'key-1',name:'Fixture key',start:'fixture_',enabled:true,expiresAt:null,createdAt:'2026-11-17T00:00:00.000Z',permissions:{profile:['read']}};
const fixtures={
  '/api/auth/get-session':{user:{id:'fixture-user'}},'/api/auth-policy':{email:{enabled:true,ready:true,provider:'resend'},googleEnabled:true},
  '/api/payments':{provider:'waffo',ready:true,plans:[{id:'pro',name:'Fixture plan',productId:'prod-1',type:'subscription',currency:'USD'}]},'/api/payments/account':{orders:[{id:'order-1',planId:'pro',type:'subscription',status:'active',periodEnd:'2026-12-01T00:00:00Z',refunded:false,entitled:true}],portalAvailable:true},
  '/api/saas/account-profile':{user:{id:'fixture-user',name:'Fixture user',username:'fixture',email:'fixture@example.invalid',emailVerified:true,image:null,avatarFileId:null},canChangePassword:true},
  '/api/saas/files/status':{enabled:true,ready:true,maxBytes:10485760},'/api/saas/files':{items:[{id:'file-1',name:'Fixture.png',contentType:'image/png',size:128,createdAt:'2026-11-17',url:'/api/saas/files/file-1'}],nextCursor:null},
  '/api/saas/newsletter/status':{enabled:true,ready:true,provider:'resend',turnstileSiteKey:'fixture-key'},'/api/saas/newsletter':{subscribed:false},'/api/saas/newsletter/reconcile':{items:[]},'/api/saas/contact/status':{enabled:true,ready:true,turnstileSiteKey:'fixture-key'},
  '/api/saas/crisp':{enabled:true,websiteId:'00000000-0000-4000-8000-000000000001'},'/api/saas/cache/status':{enabled:true,ready:true},'/api/saas/cache':{enabled:true,ready:true},
  '/api/entitlements':{features:[{id:'pro-feature',planIds:['pro']}]},'/api/operations-dashboard':{users:{available:true,total:3},payments:{available:true,orders:2,activeSubscriptions:1,refundedOrders:0},email:{available:true,sending:0,accepted:4,rejected:1,unknown:0}},
  '/api/user-admin/status':{enabled:true,canManage:true},'/api/user-admin/users':{users:[{id:'fixture-user',name:'Fixture user',email:'fixture@example.invalid',role:'user',emailVerified:true,banned:false}],total:1,limit:20,offset:0},
  '/api/api-keys/status':{enabled:true,authenticated:true,scopes:['profile:read']},'/api/api-keys':{keys:[key],total:1},
  '/api/saas/notifications/status':{enabled:true,ready:true,channels:{discord:true,feishu:false}},'/api/saas/notifications':{deliveries:[{id:'delivery-1',channel:'discord',kind:'payment',orderId:'order-1',state:'uncertain',attempts:1,createdAt:1794873600000,updatedAt:1794873600000}]},
};
let browser,server;const cases=[],errors=[],requests=[],report={ok:false,cases,errors,requests};
const metrics=async(page,selector)=>page.$eval(selector,node=>{const css=getComputedStyle(node),r=node.getBoundingClientRect();return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:Object.fromEntries(['backgroundColor','color','font','fontWeight','lineHeight','padding','border','borderRadius','height','width','boxShadow'].map(key=>[key,css[key]]))};});
try{
  await mkdir(output,{recursive:true});const config={configFile,root,logLevel:'error',build:{outDir:resolve(output,'dist'),emptyOutDir:true}};
  await vite.build(config);server=await vite.preview({...config,preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  for(const locale of ['en','zh'])for(const theme of ['light','dark'])for(const width of [1280,390]){
    const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width,height:1100,deviceScaleFactor:1});await page.setRequestInterception(true);
    page.on('request',async request=>{const url=new URL(request.url());if(url.origin===origin&&!url.pathname.startsWith('/api/'))return request.continue();requests.push({path:url.pathname,host:url.hostname,method:request.method()});
      if(url.hostname==='challenges.cloudflare.com')return request.respond({status:200,contentType:'application/javascript',body:'window.__CHALLENGE_OPTIONS__=[];window.__CHALLENGE_ACTIVE__={};window.turnstile={render:(node,options)=>{const id="fixture-"+window.__CHALLENGE_OPTIONS__.length;window.__CHALLENGE_OPTIONS__.push({sitekey:options.sitekey,action:options.action});window.__CHALLENGE_ACTIVE__[id]=options;node.textContent="Fixture verification";options.callback("fixture-token");return id;},remove:(id)=>{delete window.__CHALLENGE_ACTIVE__[id];window.__CHALLENGE_REMOVED__=(window.__CHALLENGE_REMOVED__||0)+1;}};'});
      if(url.hostname==='client.crisp.chat')return request.respond({status:200,contentType:'application/javascript',body:'window.__CRISP_FIXTURE_LOADED__=true;'});
      if(url.origin!==origin)return request.abort();
      if(request.method()==='GET'&&fixtures[url.pathname])return request.respond({status:200,contentType:'application/json',body:JSON.stringify(fixtures[url.pathname])});
      if(request.method()==='POST'&&['/api/saas/contact','/api/saas/newsletter/subscribe'].includes(url.pathname))return request.respond({status:202,contentType:'application/json',body:JSON.stringify({accepted:true})});
      if(url.pathname==='/api/api-keys'&&request.method()==='POST')return request.respond({status:201,contentType:'application/json',body:JSON.stringify({key,secret:'fixture-one-time-secret'})});
      return request.abort();
    });
    await page.goto(`${origin}/?locale=${locale}&theme=${theme}`,{waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>window.__SAAS_FIXTURE__.keys.length),14);
    for(const key of keys){await page.evaluate(key=>window.__SAAS_FIXTURE__.select(key),key);await page.waitForSelector(`[data-fixture-panel="${key}"] [data-state="ready"]`);await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await page.mouse.move(0,0);
      const actual=await metrics(page,'main button'),actualShot=await(await page.$('main button')).screenshot();
      await page.evaluate(()=>{const actual=document.querySelector('main button'),reference=document.querySelector('#reference button');window.__SAVED_BUTTON__=actual;actual.replaceWith(reference);});
      const reference=await metrics(page,'main button'),referenceShot=await(await page.$('main button')).screenshot();assert.deepEqual(actual,reference,`${locale}/${theme}/${width}/${key}: official Button styles and geometry`);
      assert.ok(Buffer.from(actualShot).equals(Buffer.from(referenceShot)),`${key}: official Button pixels`);
      await page.evaluate(()=>{const reference=document.querySelector('main button');reference.replaceWith(window.__SAVED_BUTTON__);document.querySelector('#reference').prepend(reference);});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${key} horizontal overflow`);
      if(key==='api-keys'){
        const actualInput=await metrics(page,'main input'),actualInputImage=await(await page.$('main input')).screenshot();
        await page.evaluate(()=>{const actual=document.querySelector('main input').parentElement,reference=document.querySelector('#reference input').parentElement;window.__SAVED_INPUT__=actual;actual.replaceWith(reference);});
        const referenceInput=await metrics(page,'main input'),referenceInputImage=await(await page.$('main input')).screenshot();assert.deepEqual(actualInput,referenceInput,'Official Input geometry and styles');assert.ok(Buffer.from(actualInputImage).equals(Buffer.from(referenceInputImage)),'Official Input pixels');
        await page.evaluate(()=>{const reference=document.querySelector('main input').parentElement;reference.replaceWith(window.__SAVED_INPUT__);document.querySelector('#reference').append(reference);});
        await page.type('[data-saas-action="create"] input','fixture-created');await page.click('[data-saas-action="create"] button[type="submit"]');await page.waitForSelector('[data-saas-result] input');assert.equal(await page.$eval('[data-saas-result] input',node=>node.value),'fixture-one-time-secret');await page.evaluate(()=>window.__SAAS_FIXTURE__.select('email'));await page.waitForSelector('[data-email-panel]');assert.equal(await page.$('[data-saas-result]'),null);}
      if(key==='newsletter'||key==='contact'){
        const form=`[data-saas-action="${key==='newsletter'?'subscribe':'contact'}"]`,submit=`${form} button[type="submit"]`;
        await page.waitForFunction(action=>Object.values(window.__CHALLENGE_ACTIVE__??{}).some(options=>options.action===action),{},key);
        assert.deepEqual(await page.evaluate(()=>window.__CHALLENGE_OPTIONS__.at(-1)),{sitekey:'fixture-key',action:key},'real descriptor supplies the Worker-verified Turnstile action');
        await page.type(`${form} input[type="email"]`,'fixture@example.invalid');
        if(key==='newsletter')await page.click(`${form} [role="switch"]`);else{await page.type(`${form} input[type="text"]`,'Fixture');await page.type(`${form} textarea`,'A fixture support message.');}
        await page.waitForFunction(selector=>!document.querySelector(selector).disabled,{},submit);
        await page.evaluate(action=>Object.values(window.__CHALLENGE_ACTIVE__).find(options=>options.action===action)['expired-callback'](),key);
        await page.waitForFunction(selector=>document.querySelector(selector).disabled,{},submit);
        await page.evaluate(action=>Object.values(window.__CHALLENGE_ACTIVE__).find(options=>options.action===action).callback(`fixture-${action}-renewed`),key);
        await page.waitForFunction(selector=>!document.querySelector(selector).disabled,{},submit);
        const rendered=await page.evaluate(()=>window.__CHALLENGE_OPTIONS__.length),endpoint=key==='newsletter'?'/api/saas/newsletter/subscribe':'/api/saas/contact';
        const submitted=page.waitForRequest(request=>new URL(request.url()).pathname===endpoint&&request.method()==='POST');await page.click(submit);
        assert.equal(JSON.parse((await submitted).postData()).turnstileToken,`fixture-${key}-renewed`);
        await page.waitForFunction(count=>window.__CHALLENGE_OPTIONS__.length>count,{},rendered);
        assert.equal(await page.evaluate(()=>window.__CHALLENGE_OPTIONS__.at(-1).action),key,'retry mounts a fresh challenge with the same action');
      }
      if(key==='crisp'){assert.equal(await page.evaluate(()=>!!window.__CRISP_FIXTURE_LOADED__),false);await page.click('[data-crisp-panel] > div:last-child button');await page.waitForFunction(()=>window.__CRISP_FIXTURE_LOADED__===true);}
      if(key==='notifications'){assert.equal(await page.$eval('[data-saas-action="retry:delivery-1"] button[type="submit"]',node=>node.disabled),true);}
      cases.push({locale,theme,width,key,officialButtonPixels:true});
    }
    assert.ok(await page.evaluate(()=>window.__CHALLENGE_REMOVED__>=2),'challenge widgets removed when their panels unmount');await page.screenshot({path:resolve(output,`${locale}-${theme}-${width}.png`)});await page.close();console.log(`SaaS UI ${locale}/${theme}/${width}: 14 panels passed`);
  }
  assert.deepEqual(errors,[]);report.ok=true;console.log(JSON.stringify({ok:true,cases:cases.length,output}));
}catch(error){report.error=String(error.stack??error);throw error;}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await closeAcceptanceBrowser(browser);await server?.httpServer.close();}
