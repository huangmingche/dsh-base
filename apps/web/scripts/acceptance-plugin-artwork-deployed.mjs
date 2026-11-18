#!/usr/bin/env node
/** Read-only deployed brand artwork check, with independent inventory and pinned whale source. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {acceptanceLaunchOptions,closeAcceptanceBrowser} from './acceptance-config.mjs';
import {localizePath} from '../../../packages/boot/dsh-base-locale-path/src/index.ts';
import {readOfficialSiteMark} from '../../../scripts/assets/official-site-mark.mjs';
import {readOwnedPluginInventory,OWNED_BUNDLE_TITLES,assertComponentPrefix} from '../tests/parity/owned-plugin-inventory-oracle.mjs';
import {CLOUDFLARE_PLUGIN_ICON} from '../../../packages/client/dsh-base-client-session-adapter/src/client/cloudflare-plugin-icon.ts';
const base=process.env.DSH_BASE_URL;assert.ok(base,'Explicit deployed origin required');assert.equal(new URL(base).protocol,'https:');
const root=resolve(import.meta.dirname,'../../..'),out=process.env.DSH_ACCEPTANCE_OUTPUT?resolve(process.env.DSH_ACCEPTANCE_OUTPUT):join(root,'.artifacts/acceptance/plugin-artwork-staging');mkdirSync(out,{recursive:true});
const entry=readFileSync(join(root,'apps/web/.cloudflare/output/v0/workers/default/assets/index.html'),'utf8').match(/<script[^>]+src="([^"]+)"/u)?.[1];assert.ok(entry);
const mark=readOfficialSiteMark(),inventory=readOwnedPluginInventory();
const expectedComponents=inventory.bundles.reduce((sum,bundle)=>sum+bundle.rows.length,0);
const report={ok:false,base,entry,readOnly:true,cases:[],errors:[],failedRequests:[],mutations:[]};let browser,page;
async function verifyArtwork(selector,brand,size){const value=await page.$eval(selector,(root,{path,cloud,size})=>{
 const whale=root.querySelector('[data-dsh-brand-artwork]');const svg=whale?.querySelector('svg');const img=root.querySelector('img');const frame=(whale??img)?.parentElement;const b=frame?.getBoundingClientRect();const frameStyle=frame?getComputedStyle(frame):null;
 const dimensions=element=>{const box=element?.getBoundingClientRect();return box?[box.width,box.height]:null;};
 const centerDelta=(child,parent)=>{const a=child?.getBoundingClientRect(),b=parent?.getBoundingClientRect();return a&&b?[a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2]:null;};
 const outside=[...document.querySelectorAll('svg path')].find(p=>p.getAttribute('d')===path&&!p.closest('[data-dsh-brand-artwork]'));
 return {whale:!!whale,path:svg?.querySelector('path')?.getAttribute('d'),viewBox:svg?.getAttribute('viewBox'),width:svg?.getAttribute('width'),height:svg?.getAttribute('height'),slot:dimensions(whale),renderedWhale:dimensions(svg),slotCenter:centerDelta(whale,frame),whaleCenter:centerDelta(svg,whale),imageSize:img?[Number(img.getAttribute('width')),Number(img.getAttribute('height'))]:null,color:svg?getComputedStyle(svg.querySelector('path')).fill:null,siteColor:outside?getComputedStyle(outside).fill:null,cloud:img?.src===cloud,loaded:!!img?.complete&&img.naturalWidth>0,frame:b?[b.width,b.height]:null,declaredFrame:frameStyle?[parseFloat(frameStyle.width),parseFloat(frameStyle.height)]:null,overflow:root.scrollWidth-root.clientWidth};
},{path:mark.path,cloud:CLOUDFLARE_PLUGIN_ICON,size});
 // The original stylesheet declares content dimensions; native border rounding
 // and box-sizing determine the outer box in the fully composed application.
 assert.deepEqual(value.declaredFrame,size===30?[40,40]:[48,48]);
 if(brand==='Dsh-base'){
  const opticalWidth=size===30?20:24,opticalHeight=opticalWidth*mark.viewBox.height/mark.viewBox.width;
  assert.equal(value.whale,true);assert.equal(value.path,mark.path);assert.equal(value.viewBox,`0 0 ${mark.viewBox.width} ${mark.viewBox.height}`);assert.equal(Number(value.width),opticalWidth);assert.ok(Math.abs(Number(value.height)-opticalHeight)<0.00001);
  assert.deepEqual(value.slot,[size,size],'original square artwork slot');assert.ok(Math.abs(value.renderedWhale[0]-opticalWidth)<0.02&&Math.abs(value.renderedWhale[1]-opticalHeight)<0.02,'optical whale size and aspect ratio');assert.ok([...value.slotCenter,...value.whaleCenter].every(delta=>Math.abs(delta)<0.02),'whale and slot are centered');
  assert.ok(value.siteColor);assert.equal(value.color,value.siteColor,'whale uses the same ink as the site logo');
 }
 else {assert.equal(value.whale,false);assert.equal(value.cloud,true);assert.equal(value.loaded,true);assert.deepEqual(value.imageSize,[size,size]);}
 return value;
}
try{
 browser=await puppeteer.launch(acceptanceLaunchOptions());
 for(const {locale,width,theme} of [{locale:'zh',width:1280,theme:'dark'},{locale:'en',width:390,theme:'light'}]){
  const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(30000);await page.setViewport({width,height:900});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedRequests.push({path:new URL(r.url()).pathname,status:r.status()});});page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(r.method()))report.mutations.push({path:new URL(r.url()).pathname,method:r.method()});});
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
