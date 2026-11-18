#!/usr/bin/env node
/** Read-only deployed SaaS surface; no credentials, uploads or provider actions. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
import {acceptanceLaunchOptions,assertHttpStatus,closeAcceptanceBrowser,recordHttpFailure} from './acceptance-config.mjs';
import {localizePath} from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import {OWNED_BUNDLE_TITLES,readOwnedPluginInventory} from '../tests/parity/owned-plugin-inventory-oracle.mjs';
const raw=process.env.DSH_BASE_URL;assert.ok(raw,'Set an explicit Staging URL');const base=new URL(raw);assert.equal(base.protocol,'https:');assert.equal(base.pathname,'/');assert.equal(base.search,'');assert.equal(base.hash,'');
const app=resolve(import.meta.dirname,'..'),root=resolve(app,'../..'),out=resolve(process.env.DSH_ACCEPTANCE_OUTPUT??join(root,'.artifacts/acceptance/saas-staging'));mkdirSync(out,{recursive:true});
const entry=readFileSync(join(app,'.cloudflare/output/v0/workers/default/assets/index.html'),'utf8').match(/<script[^>]+src="([^"]+)"/u)?.[1];assert.ok(entry);
const ids=['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard'];
const expectedBundles=readOwnedPluginInventory().bundles.map(bundle=>bundle.name).sort();
const expectedFibers=ids.map(id=>`@dsh-base/client-${id}`).sort();
const responseDiagnostics=[];
const report={ok:false,base:base.origin,entry,readOnly:true,cases:[],errors:[],failures:[],mutations:[],denials:[]};let browser,page;
const panel=id=>id==='waffo'?'[data-waffo-panel]':id==='email'?'[data-email-panel]':id==='crisp'?'[data-crisp-panel]':`[data-saas-panel="dsh-base:${id}"]`;
try{
  browser=await puppeteer.launch(acceptanceLaunchOptions());
  for(const locale of ['en','zh-CN'])for(const width of [1280,390]){
    const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(30000);await page.setViewport({width,height:900});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]);
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(['GET','HEAD'].includes(request.method()))return request.continue();
      report.mutations.push({path:new URL(request.url()).pathname,method:request.method()});
      return request.abort('blockedbyclient');
    });
    page.on('response',response=>{
      if(response.status()>=400)responseDiagnostics.push(recordHttpFailure(report.failures,response,{locale,width,path:new URL(response.url()).pathname}));
    });
    const document=await page.goto(base.origin+localizePath('/',locale==='en'?'en':'zh'),{waitUntil:'domcontentloaded'});assert.equal(document.status(),200);assert.ok((await document.text()).includes(entry),'deployed HTML must use this verified build');
    await page.waitForFunction(()=>window.__DSH_BASE_PLUGINS__?.filter(row=>row.enabled).every(row=>row.fiberPhase==='active'));
    if(width===390){await page.click('[data-sidebar-opener]');await page.waitForSelector('[data-sidebar-drawer]:not([data-sidebar-collapsed])');}
    await page.click(`button[aria-label="${locale==='en'?'Plugins':'插件'}"]`);await page.waitForSelector('[data-plugin-package="dsh-base:waffo"]');
    const installed=await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]',rows=>rows.map(row=>row.dataset.pluginPackage));
    assert.deepEqual(installed.sort(),expectedBundles,'every declared bundle appears once');
    const paymentTitle=OWNED_BUNDLE_TITLES['dsh-base:waffo'][locale==='en'?'en':'zh'];
    assert.equal(await page.$eval('[data-plugin-package="dsh-base:waffo"] button[aria-describedby]',el=>el.textContent.trim()),paymentTitle);
    const fibers=await page.evaluate(names=>(window.__DSH_BASE_PLUGINS__??[]).filter(row=>names.includes(row.moduleName)).map(row=>({name:row.moduleName,origin:row.origin,phase:row.fiberPhase})),expectedFibers);
    assert.deepEqual(fibers.map(fiber=>fiber.name).sort(),expectedFibers);
    for(const fiber of fibers){assert.equal(fiber.origin,'custom');assert.equal(fiber.phase,'active');}
    const states=[];
    for(const id of ids){if(await page.$('[data-plugin-detail]'))await page.click('[data-plugin-detail] [data-window-drag] > button');await page.waitForSelector(`[data-plugin-package="dsh-base:${id}"]`);await page.click(`[data-plugin-package="dsh-base:${id}"] button[aria-describedby]`);await page.waitForFunction(selector=>{const el=document.querySelector(selector);return el&&!['idle','loading'].includes(el.dataset.state);},{},panel(id));const state=await page.$eval(panel(id),el=>el.dataset.state);assert.equal(state,'ready',id);
      if(id==='waffo'){
        assert.equal(await page.$eval('[data-plugin-detail] [class*="detailTitle"]',el=>el.textContent.trim()),paymentTitle);
        const componentTitles=await page.$$eval('[data-plugin-row] [class*="rowId"]',els=>els.map(el=>el.textContent.trim()));
        assert.deepEqual(componentTitles,[paymentTitle,paymentTitle],'both runtime components retain the full product name');
        const copy=await page.$eval(panel(id),el=>el.textContent);
        assert.match(copy,/Waffo Pancake/u);assert.doesNotMatch(copy,/Waffo(?! Pancake)/u);
      }
      assert.ok(await page.$eval('[data-plugin-body]',el=>el.scrollWidth-el.clientWidth<=1),`${id}: no horizontal overflow`);states.push({id,state});if(['files','waffo'].includes(id))await page.screenshot({path:join(out,`${locale}-${width}-${id}.png`),captureBeyondViewport:false});}
    report.cases.push({locale,width,bundles:installed.length,states,fibers});await Promise.all(responseDiagnostics);await context.close();
  }
  for(const path of ['/api/saas/account-profile','/api/saas/files','/api/api-keys','/api/user-admin/users','/api/operations-dashboard','/api/entitlements','/api/saas/newsletter/reconcile','/api/site-settings']){const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(30000)});await assertHttpStatus(response,401,report.failures,path);report.denials.push({path,status:response.status});}
  const unavailable=await fetch(new URL('/api/payments/account',base),{signal:AbortSignal.timeout(30000)});
  await assertHttpStatus(unavailable,503,report.failures,'/api/payments/account');
  const paymentStatus=await unavailable.clone().json().catch(()=>null);
  if(paymentStatus?.error!=='payments_unavailable')await recordHttpFailure(report.failures,unavailable,{path:'/api/payments/account'});
  assert.equal(paymentStatus?.error==='payments_unavailable',true,'Staging payment provider is unconfigured');
  report.paymentUnavailable=true;
  const policy=await fetch(new URL('/api/auth-policy',base),{signal:AbortSignal.timeout(30000)});
  await assertHttpStatus(policy,200,report.failures,'/api/auth-policy');
  assert.equal((await policy.json()).signUpEnabled,false,'Staging registration remains closed');report.signupClosed=true;
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.failures,[]);assert.deepEqual(report.mutations,[]);report.ok=true;console.log(JSON.stringify({ok:true,cases:report.cases.length,privateDenials:report.denials.length,out}));
}catch(error){report.failure=String(error?.stack??error);await page?.screenshot({path:join(out,'failure.png'),captureBeyondViewport:false}).catch(()=>{});throw error;}
finally{await Promise.all(responseDiagnostics);await closeAcceptanceBrowser(browser);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
