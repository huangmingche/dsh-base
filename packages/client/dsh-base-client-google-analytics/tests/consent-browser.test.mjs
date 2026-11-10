import assert from 'node:assert/strict';import test from 'node:test';import {createRequire} from 'node:module';import {mkdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {acceptanceLaunchOptions,closeAcceptanceBrowser} from '../../../../apps/web/scripts/acceptance-config.mjs';
const repo=resolve(import.meta.dirname,'../../../..'),app=resolve(repo,'apps/web'),require=createRequire(resolve(app,'package.json')),vite=await import(require.resolve('vite')),puppeteer=require('puppeteer-core');
test('actual consent plugin uses unchanged official Switch pixels and keyboard behavior in both themes, locales and widths',{timeout:120000},async()=>{
 const output=resolve(repo,'.artifacts/analytics-consent-browser');await mkdir(output,{recursive:true});let browser,server;const errors=[],external=[];
 try{
  const config={configFile:resolve(app,'vite.parity.config.ts'),root:resolve(import.meta.dirname,'browser'),logLevel:'error',build:{outDir:resolve(output,'dist'),emptyOutDir:true}};
  await vite.build(config);server=await vite.preview({...config,preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await puppeteer.launch(acceptanceLaunchOptions());
  for(const locale of ['en','zh'])for(const theme of ['light','dark'])for(const width of [1280,390]){
   const page=await browser.newPage();await page.setViewport({width,height:700,deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
   page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin){external.push(url.href);return request.abort();}if(url.pathname==='/api/public-pages')return request.respond({status:200,contentType:'application/json',body:'{"pages":[{"path":"/","availableLocales":["en","zh"]}]}'});return request.continue();});
   await page.goto(`${origin}/?locale=${locale}&theme=${theme}&utm_campaign=launch&private=never-read`,{waitUntil:'networkidle0'});await page.waitForSelector('main [role="switch"]');
   assert.deepEqual(await page.evaluate(()=>window.__ANALYTICS_FIXTURE__.snapshot()),{consent:false});
   for(const checked of [false,true]){
    if(checked){await page.focus('main [role="switch"]');await page.keyboard.press('Space');assert.deepEqual(await page.evaluate(()=>window.__ANALYTICS_FIXTURE__.snapshot()),{consent:true,campaign:'launch'});}
    await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(0,0);
    const actual=await(await page.$('main [role="switch"]')).screenshot();
    await page.evaluate(()=>{const actual=document.querySelector('main [role="switch"]'),reference=document.querySelector('#reference [role="switch"]');window.savedSwitch=actual;actual.replaceWith(reference);});
    const reference=await(await page.$('main [role="switch"]')).screenshot();assert.ok(Buffer.from(actual).equals(Buffer.from(reference)),`${locale}/${theme}/${width}/${checked}: official pixels`);
    await page.evaluate(()=>{const reference=document.querySelector('main [role="switch"]');reference.replaceWith(window.savedSwitch);document.querySelector('#reference').append(reference);});
   }
   await page.evaluate(()=>window.__ANALYTICS_FIXTURE__.disable());assert.equal(await page.$eval('main [role="switch"]',node=>node.disabled),true);assert.deepEqual(await page.evaluate(()=>window.__ANALYTICS_FIXTURE__.snapshot()),{consent:false});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(await page.cookies(),[]);
   await page.screenshot({path:resolve(output,`${locale}-${theme}-${width}.png`)});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await closeAcceptanceBrowser(browser);await server?.httpServer.close();}
});
