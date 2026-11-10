#!/usr/bin/env node
/** Deployed artwork check using the signed-in inventory and the official default icon. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {acceptanceLaunchOptions,closeAcceptanceBrowser,remoteAcceptanceConfig,remoteBrowserCookie} from './acceptance-config.mjs';
import {localizePath} from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import {readOwnedPluginInventory,OWNED_BUNDLE_TITLES,assertComponentPrefix} from '../tests/parity/owned-plugin-inventory-oracle.mjs';
import {CLOUDFLARE_PLUGIN_ICON} from '../../../packages/client/dsh-base-client-session-adapter/src/client/cloudflare-plugin-icon.ts';
const target=remoteAcceptanceConfig(),base=target.base;
const root=resolve(import.meta.dirname,'../../..'),out=process.env.DSH_ACCEPTANCE_OUTPUT?resolve(process.env.DSH_ACCEPTANCE_OUTPUT):join(root,'.artifacts/acceptance/plugin-artwork-staging');mkdirSync(out,{recursive:true});
const entry=readFileSync(join(root,'apps/web/.cloudflare/output/v0/workers/default/assets/index.html'),'utf8').match(/<script[^>]+src="([^"]+)"/u)?.[1];assert.ok(entry);
const inventory=readOwnedPluginInventory();
const expectedComponents=inventory.bundles.reduce((sum,bundle)=>sum+bundle.rows.length,0);
// Signed-in Host reads use POST RPC. Track writes to the actual account and SaaS services.
const businessPath=/^\/api\/(?:saas|payments|api-keys|user-admin|operations-dashboard|entitlements|auth|site-settings|plugin-manager)(?:\/|$)/u;
const report={ok:false,base,entry,readOnly:true,cases:[],errors:[],failedRequests:[],mutations:[]};let browser,page;
async function verifyArtwork(selector,brand,size) {
  const result=await page.$eval(selector,(root,{size,cloud})=>{
    const frame=root.querySelector('[class*="cardIcon"],[class*="rowIcon"]');
    const svg=frame?.querySelector('svg'),image=frame?.querySelector('img');
    return {width:svg?.getAttribute('width'),image:image?.getAttribute('src'),cloud:image?.getAttribute('src')===cloud,
      loaded:image?.complete&&image.naturalWidth>0,frame:frame&&parseFloat(getComputedStyle(frame).width)};
  },{size,cloud:CLOUDFLARE_PLUGIN_ICON});
  assert.equal(result.frame,size===30?40:48);
  if(brand==='Dsh-base'){assert.equal(result.image,undefined);assert.equal(Number(result.width),size);}
  else {assert.equal(result.cloud,true);assert.equal(result.loaded,true);}
  return result;
}
try{
 const cookie=await remoteBrowserCookie(target);
 browser=await puppeteer.launch(acceptanceLaunchOptions());
 for(const {locale,width,theme} of [{locale:'zh',width:1280,theme:'dark'},{locale:'en',width:390,theme:'light'}]){
  const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(30000);await page.setViewport({width,height:900});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedRequests.push({path:new URL(r.url()).pathname,status:r.status()});});page.on('request',r=>{if(businessPath.test(new URL(r.url()).pathname)&&!['GET','HEAD'].includes(r.method()))report.mutations.push({path:new URL(r.url()).pathname,method:r.method()});});
  await page.setCookie(cookie);
  await page.goto(base+localizePath('/',locale),{waitUntil:'domcontentloaded'});assert.ok(await page.$(`script[src="${entry}"]`),'exact built entry');
  await page.waitForFunction(()=>window.__DSH_BASE_PLUGINS__?.filter(x=>x.enabled).every(x=>x.fiberPhase==='active'));
  await page.waitForSelector('[contenteditable]');if(width<600){await page.waitForSelector('[data-sidebar-opener]',{visible:true});await page.click('[data-sidebar-opener]');await page.waitForSelector('[data-sidebar-drawer]:not([data-sidebar-collapsed])');}
  await page.click(`button[aria-label="${locale==='zh'?'插件':'Plugins'}"]`);await page.waitForSelector('[data-plugin-package="dsh-base:base"]');
  const names=Object.keys(OWNED_BUNDLE_TITLES),cards=[];assert.equal(await page.$$eval('[data-plugin-group="bundles"] [data-plugin-package]',els=>els.length),names.length);
  for(const name of names){const brand=OWNED_BUNDLE_TITLES[name][locale].startsWith('Dsh-base ')?'Dsh-base':'Cloudflare';cards.push({name,brand,...await verifyArtwork(`[data-plugin-package="${name}"]`,brand,36)});}
  await page.$eval('[data-plugin-package="dsh-base:base"]',el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:join(out,`${locale}-${width}-list.png`),captureBeyondViewport:false});
  let components=0;
  for(const name of names){
   await page.click(`[data-plugin-package="${name}"] button[aria-describedby]`);await page.waitForSelector(`[data-plugin-detail="${name}"]`);
   const brand=OWNED_BUNDLE_TITLES[name][locale].startsWith('Dsh-base ')?'Dsh-base':'Cloudflare';await verifyArtwork(`[data-plugin-detail="${name}"]`,brand,36);
   const expected=inventory.bundles.find(x=>x.name===name);assert.ok(expected);
   const rows=await page.$$eval('[data-plugin-row]',els=>els.map(el=>({id:el.dataset.pluginRow,title:el.querySelector('[class*="rowId"]')?.textContent.trim()})));
   assert.deepEqual(rows.map(x=>x.id).sort(),expected.rows.map(x=>x.entryId).sort());
   for(const row of rows){assertComponentPrefix(row.title,expected.rows.find(x=>x.entryId===row.id).moduleName);await verifyArtwork(`[data-plugin-row="${row.id}"]`,row.title.startsWith('Dsh-base ')?'Dsh-base':'Cloudflare',30);components++;}
   if(name==='dsh-base:base')await page.screenshot({path:join(out,`${locale}-${width}-detail.png`),captureBeyondViewport:false});
   await page.click('[data-plugin-detail] [data-window-drag] > button');await page.waitForSelector('[data-plugin-package="dsh-base:base"]');
  }
  assert.equal(components,expectedComponents);report.cases.push({locale,width,theme,cards,components});await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.mutations,[]);report.ok=true;console.log(JSON.stringify({ok:true,cases:report.cases.length,bundles:inventory.bundles.length,components:expectedComponents,out}));
}catch(error){report.failure=String(error.stack??error);await page?.screenshot({path:join(out,'failure.png'),captureBeyondViewport:false}).catch(()=>{});throw error;}
finally{await closeAcceptanceBrowser(browser);writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
